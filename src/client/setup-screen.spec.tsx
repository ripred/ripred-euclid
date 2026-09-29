// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SUBREDDIT_SETTINGS,
  type SubredditSettings,
} from "../shared/subreddit-settings";
import { SetupScreen } from "./setup-screen";
import { STANDARD_WIN_SCORE, type SoloMode } from "../shared/game/rules";
import {
  readPracticePreferences,
  savePracticePreferences,
} from "./solo-preferences";
import { readSoundPreference, saveSoundPreference } from "./sound/engine";

let root: Root, host: HTMLDivElement;
let stored: SubredditSettings;
let loseReply: boolean, recoveryOffline: boolean, rejectSave: boolean;
let reads: number;
let isModerator: boolean;
let releaseSave: (() => void) | undefined;
let failSettingsLoad: boolean;
const onDone = vi.fn(),
  onPlayground = vi.fn();
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
  const [practice, setPractice] = useState(readPracticePreferences);
  const [sound, setSound] = useState(readSoundPreference);
  const [soloMode, setSoloMode] = useState<SoloMode>("practice");
  const [winScore, setWinScore] = useState<number>(STANDARD_WIN_SCORE);
  useEffect(() => savePracticePreferences(practice), [practice]);
  useEffect(() => saveSoundPreference(sound), [sound]);
  return (
    <SetupScreen
      soloMode={soloMode}
      onSoloModeChange={setSoloMode}
      difficulty={practice.difficulty}
      onDifficultyChange={(difficulty) =>
        setPractice((p) => ({ ...p, difficulty }))
      }
      assistOn={practice.assist}
      onAssistChange={(assist) => setPractice((p) => ({ ...p, assist }))}
      winScore={winScore}
      onWinScoreChange={setWinScore}
      soundOn={sound}
      onSoundChange={setSound}
      appVersion="test-version"
      onDone={onDone}
      isModerator={isModerator}
      settings={settings}
      onSettingsChange={setSettings}
      onPlayground={onPlayground}
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
  localStorage.clear();
  isModerator = true;
  releaseSave = undefined;
  failSettingsLoad = false;
  onDone.mockReset();
  onPlayground.mockReset();
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
        if (releaseSave)
          await new Promise<void>((resolve) => {
            releaseSave = resolve;
          });
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
        if (recoveryOffline || failSettingsLoad) throw new Error("Offline");
      }
      return reply({ settings: stored });
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
  await settle();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("moderator settings save recovery", () => {
  beforeEach(async () => click(button("Subreddit")));
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

describe("unified Options", () => {
  it("saves application timing and shared standings without applying a template", async () => {
    await click(button("Subreddit"));
    const select = host.querySelector<HTMLSelectElement>(".setup select")!;
    await act(async () => {
      select.value = "immediately";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(stored.challengeApplyTiming).toBe("immediately");
    await act(async () =>
      host.querySelectorAll<HTMLInputElement>(".setup input")[2]!.click(),
    );
    expect(stored.showLiveChallengeStandings).toBe(false);
    expect(stored.dailyChallenges).toBe(false);
    expect(stored.weeklyChallenges).toBe(false);
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([url]) => String(url).endsWith("/apply")),
    ).toBe(false);
  });
  it("supports keyboard switching between personal and subreddit options", async () => {
    await act(async () => {
      button("Your options").focus();
      button("Your options").dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(button("Subreddit"));
    expect(button("Subreddit").getAttribute("aria-selected")).toBe("true");
    await act(async () =>
      button("Subreddit").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
      ),
    );
    expect(document.activeElement).toBe(button("Your options"));
    expect(host.querySelector("#setup-difficulty")).not.toBeNull();
  });
  it("disables further changes while a save is pending", async () => {
    releaseSave = () => {};
    await click(button("Subreddit"));
    await act(async () =>
      host.querySelector<HTMLInputElement>(".setup input")!.click(),
    );
    expect(
      host.querySelector<HTMLFieldSetElement>(".setup fieldset")!.disabled,
    ).toBe(true);
    expect(host.querySelector('.setup [role="status"]')?.textContent).toBe(
      "Saving…",
    );
    expect(button("Your options").disabled).toBe(true);
    expect(button("Done").disabled).toBe(true);
    expect(button("Challenge playground").disabled).toBe(true);
    await act(async () =>
      host
        .querySelector(".setup")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        ),
    );
    expect(host.querySelector(".setup")).not.toBeNull();
    await act(async () => releaseSave!());
    expect(
      host.querySelector<HTMLFieldSetElement>(".setup fieldset")!.disabled,
    ).toBe(false);
    expect(button("Your options").disabled).toBe(false);
    expect(button("Done").disabled).toBe(false);
    expect(button("Challenge playground").disabled).toBe(false);
  });
  it("allows retry after loading settings fails without blocking the playground", async () => {
    failSettingsLoad = true;
    await click(button("Subreddit"));
    expect(
      host.querySelector<HTMLFieldSetElement>(".setup fieldset")!.disabled,
    ).toBe(true);
    expect(button("Challenge playground").disabled).toBe(false);
    failSettingsLoad = false;
    await click(button("Retry"));
    expect(
      host.querySelector<HTMLFieldSetElement>(".setup fieldset")!.disabled,
    ).toBe(false);
  });
});

async function setInput(selector: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("personal Options", () => {
  it("focuses the title and keeps moderator controls hidden for players", async () => {
    isModerator = false;
    await act(async () => root.render(<Harness />));
    expect(document.activeElement?.id).toBe("setup-title");
    expect(host.querySelector('[role="tablist"]')).toBeNull();
    expect(host.textContent).not.toContain("Challenge playground");
    expect(reads).toBe(0);
    expect(host.textContent).toContain("test-version");
  });

  it("remembers difficulty, hints and sound across visits but resets winning score", async () => {
    await setInput("#setup-difficulty", "8");
    await setInput("#setup-win-score", "42");
    await click(control("Square hints"));
    await click(control("Sound effects"));
    expect(readPracticePreferences()).toEqual({
      difficulty: "brutal",
      assist: true,
    });
    expect(readSoundPreference()).toBe(true);
    expect(
      host.querySelector<HTMLInputElement>("#setup-win-score")!.value,
    ).toBe("42");
    await click(button("Ranked"));
    expect(host.querySelector("#setup-difficulty")).toBeNull();
    expect(host.querySelector("#setup-win-score")).toBeNull();
    expect(host.textContent).toContain("Hints are off");
    expect(control("Sound effects")).toBeTruthy();
    await click(button("Practice"));
    expect(
      host.querySelector<HTMLInputElement>("#setup-win-score")!.value,
    ).toBe("42");
    await act(async () => root.render(<Harness key="new-visit" />));
    expect(
      host.querySelector<HTMLInputElement>("#setup-win-score")!.value,
    ).toBe(String(STANDARD_WIN_SCORE));
    expect(
      host.querySelector<HTMLInputElement>("#setup-difficulty")!.value,
    ).toBe("8");
    expect((control("Square hints") as HTMLInputElement).checked).toBe(true);
    expect((control("Sound effects") as HTMLInputElement).checked).toBe(true);
  });

  it("lets moderators reach the playground with both challenges disabled", async () => {
    await click(button("Subreddit"));
    await click(button("Challenge playground"));
    expect(onPlayground).toHaveBeenCalledOnce();
    expect(writes).toEqual([]);
  });
});
