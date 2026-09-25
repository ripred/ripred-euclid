/// <reference types="vitest/config" />
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type ResolvedConfig } from "vite";

import pkg from "./package.json" with { type: "json" };

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Inlines the built script, stylesheet and favicon into index.html, so the
 * one file plays anywhere: from any web host, or opened straight from disk
 * where browsers refuse to load separate module scripts.
 */
function inlineIntoHtml(): Plugin {
  let config: ResolvedConfig;
  return {
    name: "euclid:inline-into-html",
    apply: "build",
    enforce: "post",
    configResolved(resolved) {
      config = resolved;
    },
    generateBundle(_options, bundle) {
      for (const html of Object.values(bundle)) {
        if (html.type !== "asset" || !html.fileName.endsWith(".html")) continue;
        let source = String(html.source);
        for (const [fileName, item] of Object.entries(bundle)) {
          const name = escapeRegExp(fileName);
          if (item.type === "chunk") {
            const tag = new RegExp(
              `<script[^>]*src="[^"]*${name}"[^>]*></script>`,
            );
            if (!tag.test(source)) continue;
            // A literal "</script" inside the code would end the element early.
            const code = item.code.replace(/<\/script/gi, "<\\/script");
            source = source.replace(
              tag,
              () => `<script type="module">${code}</script>`,
            );
            delete bundle[fileName];
          } else if (fileName.endsWith(".css")) {
            const tag = new RegExp(`<link[^>]*href="[^"]*${name}"[^>]*>`);
            if (!tag.test(source)) continue;
            const css = String(item.source).replace(/<\/style/gi, "<\\/style");
            source = source.replace(tag, () => `<style>${css}</style>`);
            delete bundle[fileName];
          }
        }
        source = source.replace(
          /(<link rel="icon"[^>]*href=")\.\/([^"]+\.svg)"/,
          (_match, start: string, file: string) => {
            const svg = readFileSync(resolve(config.publicDir, file));
            return `${start}data:image/svg+xml;base64,${svg.toString("base64")}"`;
          },
        );
        html.source = source;
      }
    },
  };
}

/**
 * Development only: the icon page posts rendered icons here, and they are
 * written into public/icons. Nothing like this exists in a production build.
 */
function iconWriter(): Plugin {
  const allowed = new Set([
    "icon.svg",
    "icon-192.png",
    "icon-512.png",
    "icon-maskable-512.png",
    "apple-touch-icon.png",
  ]);
  return {
    name: "euclid:icon-writer",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__dev/icon", (request, response) => {
        const file = new URL(request.url ?? "", "http://dev").searchParams.get(
          "file",
        );
        if (request.method !== "POST" || !file || !allowed.has(file)) {
          response.statusCode = 400;
          response.end("Unsupported icon.");
          return;
        }
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          writeFileSync(
            resolve(server.config.publicDir, "icons", file),
            Buffer.concat(chunks),
          );
          response.statusCode = 204;
          response.end();
        });
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), inlineIntoHtml(), iconWriter()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Everything the page needs travels inside index.html.
    assetsInlineLimit: () => true,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
  test: {
    include: ["src/**/*.spec.{ts,tsx}"],
  },
});
