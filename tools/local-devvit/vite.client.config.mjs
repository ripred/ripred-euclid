import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vite";
import base from "../../src/client/vite.config";

const apiOrigin = `http://127.0.0.1:${process.env.EUCLID_API_PORT ?? 7475}`;

/**
 * `?as=name` gives one tab its own local Redditor, so two tabs can play a
 * match and a third can watch. The name lives in that tab's session storage.
 */
const tabIdentity = {
  name: "euclid-local-tab-identity",
  transformIndexHtml: () => [
    {
      tag: "script",
      injectTo: "head-prepend",
      children: `(() => {
  const key = "euclid-local-user";
  const asked = new URLSearchParams(location.search).get("as");
  if (asked) sessionStorage.setItem(key, asked);
  const user = sessionStorage.getItem(key);
  if (!user) return;
  const send = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set("x-euclid-local-user", user);
    return send(input, { ...init, headers });
  };
})();`,
    },
  ],
};

// Serves the real client with a local Devvit stand-in and the local API.
export default mergeConfig(
  base,
  defineConfig({
    plugins: [tabIdentity],
    resolve: {
      alias: {
        "@devvit/web/client": fileURLToPath(
          new URL("./client-shim.mjs", import.meta.url),
        ),
      },
    },
    server: {
      host: "127.0.0.1",
      proxy: { "/api": apiOrigin, "/__local": apiOrigin },
    },
  }),
);
