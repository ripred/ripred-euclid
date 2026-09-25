// Renders static .dc.html design artboards to PNG with a minimal template runtime.
import { chromium } from "playwright-core";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [, , outDir, ...files] = process.argv;

const runtime = `
class DCLogic { constructor(){ this.props = {}; this.state = null; } setState(s){ this.state = Object.assign({}, this.state, s); } forceUpdate(){} }
function dcResolve(expr, scope){
  expr = expr.trim();
  if (expr === 'true') return true; if (expr === 'false') return false;
  if (/^-?\\d+(\\.\\d+)?$/.test(expr)) return Number(expr);
  return expr.split('.').reduce((v, k) => v == null ? undefined : v[k], scope);
}
function dcInterp(str, scope){
  const whole = str.match(/^\\s*\\{\\{([^}]+)\\}\\}\\s*$/);
  if (whole) return dcResolve(whole[1], scope);
  return str.replace(/\\{\\{([^}]+)\\}\\}/g, (_, e) => { const v = dcResolve(e, scope); return v == null ? '' : String(v); });
}
function dcWalk(node, scope){
  if (node.nodeType === 3) { if (node.nodeValue.includes('{{')) node.nodeValue = dcInterp(node.nodeValue, scope); return [node]; }
  if (node.nodeType !== 1) return [node];
  const tag = node.tagName.toLowerCase();
  if (tag === 'sc-for') {
    const list = dcResolve(node.getAttribute('list').replace(/[{}]/g, ''), scope) || [];
    const as = node.getAttribute('as') || 'item';
    const out = [];
    list.forEach((item, i) => {
      node.childNodes.forEach(ch => { const c = ch.cloneNode(true); out.push(...dcWalk(c, Object.assign({}, scope, { [as]: item, $index: i }))); });
    });
    return out;
  }
  if (tag === 'sc-if') {
    const v = dcResolve(node.getAttribute('value').replace(/[{}]/g, ''), scope);
    if (!v) return [];
    const out = [];
    [...node.childNodes].forEach(ch => out.push(...dcWalk(ch.cloneNode(true), scope)));
    return out;
  }
  for (const attr of [...node.attributes]) {
    if (/^on[A-Z]/.test(attr.name) || /^on/i.test(attr.name) || attr.name.startsWith('hint-')) { node.removeAttribute(attr.name); continue; }
    if (attr.value.includes('{{')) { const v = dcInterp(attr.value, scope); node.setAttribute(attr.name, v == null ? '' : String(v)); }
  }
  const kids = [...node.childNodes];
  kids.forEach(ch => { const rep = dcWalk(ch, scope); if (rep.length !== 1 || rep[0] !== ch) { rep.forEach(r => node.insertBefore(r, ch)); ch.remove(); } });
  return [node];
}
`;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const helmet = (src.match(/<helmet>([\s\S]*?)<\/helmet>/) || [, ""])[1];
  const body = (src.match(/<x-dc>([\s\S]*?)<\/x-dc>/) || [, ""])[1].replace(/<helmet>[\s\S]*?<\/helmet>/, "");
  const scriptTag = src.match(/<script type="text\/x-dc"([^>]*)>([\s\S]*?)<\/script>/);
  const props = JSON.parse(scriptTag[1].match(/data-props='([^']*)'/)[1].replace(/&amp;/g, "&").replace(/&#39;/g, "'"));
  const { width, height } = props.$preview;
  const html = `<!doctype html><html><head><meta charset="utf-8">${helmet}</head><body style="margin:0"><div id="root"></div>
<template id="t">${body}</template>
<script>${runtime}
${scriptTag[2]}
const comp = new Component(); const vals = comp.renderVals();
const frag = document.getElementById('t').content.cloneNode(true);
const root = document.getElementById('root');
[...frag.childNodes].forEach(ch => dcWalk(ch, vals).forEach(n => root.appendChild(n)));
</script></body></html>`;
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  const name = path.basename(file).replace(".dc.html", "");
  const out = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width, height } });
  console.log("rendered", out);
  await page.close();
}
await browser.close();
