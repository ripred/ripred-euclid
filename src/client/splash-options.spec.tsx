// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SUBREDDIT_SETTINGS,
  type SubredditSettings,
} from "../shared/subreddit-settings";
import { SplashOptions } from "./splash-options";

let root: Root, host: HTMLDivElement;
let stored: SubredditSettings;
let loseReply: boolean, recoveryOffline: boolean, rejectSave: boolean;
let reads: number;
const writes: SubredditSettings[] = [];
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
function Harness() {
  const [settings, setSettings] = useState<SubredditSettings>({
    ...DEFAULT_SUBREDDIT_SETTINGS,
  });
  return (
    <SplashOptions
      onClose={() => {}}
      isModerator
      settings={settings}
      onSettingsChange={setSettings}
      onPlayground={() => {}}
      expansionError={null}
    />
  );
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function click(element: HTMLElement) {
  await act(async () => element.click());
  await settle();
}
function control(label: string): HTMLInputElement | HTMLSelectElement {
  const element = Array.from(host.querySelectorAll("label"))
    .find((item) => item.textContent?.startsWith(label))
    ?.querySelector<HTMLInputElement | HTMLSelectElement>("input, select");
  expect(element, label).toBeTruthy();
  return element!;
}
function button(label: string) {
  const element = Array.from(host.querySelectorAll("button")).find(
    (item) => item.textContent === label,
  );
  expect(element, label).toBeTruthy();
  return element!;
}

beforeEach(async () => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  stored = { ...DEFAULT_SUBREDDIT_SETTINGS };
  reads = 0;
  writes.length = 0;
  loseReply = false;
  recoveryOffline = false;
  rejectSave = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        const { settings } = JSON.parse(String(init.body)) as {
          settings: SubredditSettings;
        };
        writes.push(settings);
        if (rejectSave)
          return reply({ message: "Moderator access was revoked." }, 403);
        stored = settings;
        if (loseReply) {
          loseReply = false;
          throw new Error("Save reply lost");
        }
      } else {
        reads += 1;
        if (recoveryOffline) throw new Error("Offline");
      }
      return reply({ settings: stored });
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
  await settle();
  await click(button("Subreddit"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("moderator settings save recovery", () => {
  it("recovers a committed save after its response is lost before another full settings save", async () => {
    loseReply = true;
    await click(control("Daily challenges"));
    expect((control("Daily challenges") as HTMLInputElement).checked).toBe(
      true,
    );
    expect(host.textContent).toContain("Saved for this subreddit");
    expect(reads).toBe(2);
    await click(control("Weekly challenges"));
    expect(writes[1]).toMatchObject({
      dailyChallenges: true,
      weeklyChallenges: true,
    });
  });

  it("locks saves when their outcome is unknown until current settings can be reloaded", async () => {
    loseReply = true;
    recoveryOffline = true;
    await click(control("Daily challenges"));
    expect(host.textContent).toContain(
      "The save result could not be confirmed",
    );
    expect(control("Weekly challenges").matches(":disabled")).toBe(true);
    expect(control("Apply changes").matches(":disabled")).toBe(true);
    recoveryOffline = false;
    await click(button("Retry"));
    expect((control("Daily challenges") as HTMLInputElement).checked).toBe(
      true,
    );
    expect(control("Weekly challenges").matches(":disabled")).toBe(false);
    await click(control("Weekly challenges"));
    expect(writes[1]).toMatchObject({
      dailyChallenges: true,
      weeklyChallenges: true,
    });
  });

  it("keeps the prior values after a definite rejection without treating the write as uncertain", async () => {
    rejectSave = true;
    await click(control("Daily challenges"));
    expect(host.textContent).toContain("Moderator access was revoked");
    expect((control("Daily challenges") as HTMLInputElement).checked).toBe(
      false,
    );
    expect(control("Weekly challenges").matches(":disabled")).toBe(false);
    expect(reads).toBe(1);
  });
});
