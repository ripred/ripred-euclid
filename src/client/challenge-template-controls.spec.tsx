// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChallengeOptions } from "../shared/challenge";
import { byPeriod } from "../shared/challenge-spotlights";
import type {
  CompetitionApplyRequest,
  CompetitionTemplatesResponse,
} from "../shared/competitions";
import { DEFAULT_SUBREDDIT_SETTINGS } from "../shared/subreddit-settings";
import { ChallengeTemplateControls } from "./challenge-template-controls";

const options: ChallengeOptions = {
  minimumMoves: 3,
  targetSquares: 4,
  geometry: "oblique",
  sharedCorner: false,
  blockedCount: 4,
  blockedPoints: [4, 9],
  multipleSolutions: true,
  seed: "private-test-seed",
};
const { seed: _seed, ...template } = options;
const now = Date.UTC(2026, 8, 27, 23, 30);
const nextStart = Date.UTC(2026, 8, 28);
const initial = (): CompetitionTemplatesResponse => ({
  settings: { ...DEFAULT_SUBREDDIT_SETTINGS },
  templates: byPeriod((period) => ({
    active: {
      revision: 1,
      savedAt: now,
      effectiveAt: 0,
      options: { ...template, minimumMoves: period === "daily" ? 1 : 2 },
    },
    pending: null,
    revision: period === "daily" ? 3 : 5,
    generationError: null,
  })),
  serverNow: now,
});
let root: Root, host: HTMLDivElement;
let state: CompetitionTemplatesResponse;
const loads = vi.fn(),
  busyChanges = vi.fn();
let requests: CompetitionApplyRequest[];
let applyHandler:
  | ((request: CompetitionApplyRequest, url: string) => Promise<Response>)
  | null;
const reply = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function mount() {
  await act(async () =>
    root.render(
      <ChallengeTemplateControls
        options={options}
        disabled={false}
        onLoad={loads}
        onBusyChange={busyChanges}
      />,
    ),
  );
  await settle();
}
function button(text: string) {
  const result = Array.from(host.querySelectorAll("button")).find(
    (element) => element.textContent === text,
  );
  expect(result, text).toBeTruthy();
  return result!;
}
async function click(text: string) {
  await act(async () => button(text).click());
  await settle();
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  state = initial();
  requests = [];
  applyHandler = null;
  loads.mockReset();
  busyChanges.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (!init?.body) return reply(state);
      const request = JSON.parse(String(init.body)) as CompetitionApplyRequest;
      requests.push(request);
      return applyHandler ? applyHandler(request, url) : reply(state);
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("saved competition templates", () => {
  it("shows a future activation date only for an enabled challenge", async () => {
    state.settings.dailyChallenges = true;
    state.templates.daily.activationAt = nextStart;
    state.templates.weekly.activationAt = nextStart;
    await mount();
    const daily = host.querySelector('[aria-label="Daily saved settings"]')!;
    const weekly = host.querySelector('[aria-label="Weekly saved settings"]')!;
    expect(daily.textContent).toContain("Opens 28 Sept 2026, 00:00 GMT.");
    expect(weekly.textContent).not.toContain("Opens ");
    state.templates.daily.activationAt = now;
    await click("Refresh saved settings");
    expect(daily.textContent).not.toContain("Opens ");
  });

  it("loads complete independent saved or pending templates and shows GMT activation", async () => {
    state.templates.daily.pending = {
      options: template,
      effectiveAt: nextStart,
      savedAt: now,
      revision: 3,
    };
    await mount();
    expect(host.textContent).toContain("Next scheduled start");
    expect(host.textContent).toContain("28 Sept 2026, 00:00 GMT");
    expect(host.textContent).toContain("Fixed blocks: E1, B2");
    await click("Load daily settings");
    expect(loads).toHaveBeenLastCalledWith(template);
    await click("Load weekly settings");
    expect(loads).toHaveBeenLastCalledWith(
      state.templates.weekly.active.options,
    );
    expect(host.textContent).toContain("Weekly saved settings loaded");
  });

  it("applies all generation options without the test seed or enabling a challenge", async () => {
    applyHandler = async (request) => {
      state.templates.daily.pending = {
        revision: 4,
        options: request.options,
        effectiveAt: nextStart,
        savedAt: now,
      };
      state.templates.daily.revision = 4;
      return reply(state);
    };
    await mount();
    await click("Apply to Daily");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({
      options: template,
      expectedRevision: 3,
      commandId: expect.any(String),
    });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.textContent).toContain(
      "Daily settings saved for 28 Sept 2026, 00:00 GMT",
    );
    expect(host.textContent).toContain("Daily challenge · Disabled");
    expect(state.templates.weekly.revision).toBe(5);
  });

  it("confirms immediate replacements and preserves disabled status", async () => {
    state.settings.challengeApplyTiming = "immediately";
    await mount();
    await click("Apply to Weekly");
    expect(host.textContent).toContain(
      "Current entries and standings will be reset without awarding a winner",
    );
    expect(busyChanges).toHaveBeenLastCalledWith(true);
    expect(requests).toHaveLength(0);
    await click("Cancel");
    expect(requests).toHaveLength(0);
    await click("Apply to Weekly");
    await click("Replace challenge");
    expect(requests[0]).toMatchObject({
      expectedRevision: 5,
      confirmReset: true,
      options: template,
    });
    expect(host.textContent).toContain("The challenge remains disabled");
    expect(busyChanges).toHaveBeenLastCalledWith(false);
  });

  it("retries the same Apply command after a response is lost, even after refreshing state", async () => {
    state.settings.challengeApplyTiming = "immediately";
    let replacements = 0;
    const seen = new Set<string>();
    applyHandler = async (request) => {
      if (!seen.has(request.commandId)) {
        seen.add(request.commandId);
        replacements += 1;
        state.templates.daily.revision += 1;
        throw new Error("Connection lost");
      }
      return reply(state);
    };
    await mount();
    await click("Apply to Daily");
    await click("Replace challenge");
    expect(button("Apply to Weekly").matches(":disabled")).toBe(true);
    await click("Retry apply request");
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(replacements).toBe(1);
    expect(host.textContent).toContain("Daily settings applied");
  });

  it("refreshes stale settings without replaying a destructive command", async () => {
    applyHandler = async () => {
      state.templates.daily.revision = 8;
      return reply(
        {
          code: "stale",
          message: "Another moderator updated these settings.",
          templates: state,
        },
        409,
      );
    };
    await mount();
    await click("Apply to Daily");
    expect(host.textContent).toContain(
      "Review the saved settings before applying again",
    );
    expect(host.textContent).not.toContain("Retry apply request");
    const rejectedCommand = requests[0]!.commandId;
    applyHandler = null;
    await click("Apply to Daily");
    expect(requests[1]!.expectedRevision).toBe(8);
    expect(requests[1]!.commandId).not.toBe(rejectedCommand);
  });

  it("retains the original command through a lost reply and an in-progress retry", async () => {
    state.settings.challengeApplyTiming = "immediately";
    let calls = 0;
    applyHandler = async () => {
      calls += 1;
      if (calls === 1)
        throw new Error("Connection lost before generation finished");
      if (calls === 2)
        return reply(
          { code: "pending", message: "This change is still being prepared." },
          409,
        );
      state.templates.daily.revision += 1;
      return reply(state);
    };
    await mount();
    await click("Apply to Daily");
    await click("Replace challenge");
    await click("Retry apply request");
    expect(host.textContent).toContain("This change is still being prepared");
    expect(button("Apply to Daily").matches(":disabled")).toBe(true);
    await click("Retry apply request");
    expect(requests).toHaveLength(3);
    expect(requests[1]).toEqual(requests[0]);
    expect(requests[2]).toEqual(requests[0]);
    expect(host.textContent).toContain("Daily settings applied");
  });

  it("reports generation failure while leaving the saved templates available", async () => {
    applyHandler = async () =>
      reply(
        { code: "search_limit", message: "No certified puzzle found." },
        422,
      );
    await mount();
    await click("Apply to Daily");
    expect(host.textContent).toContain("No certified puzzle found");
    expect(state.templates.daily.revision).toBe(3);
    await click("Load weekly settings");
    expect(loads).toHaveBeenCalledWith(state.templates.weekly.active.options);
  });

  it("allows retrying a failed initial load and never applies without saved revisions", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Offline"));
    await mount();
    expect(host.textContent).toContain("Offline");
    expect(button("Apply to Daily").matches(":disabled")).toBe(true);
    await click("Refresh saved settings");
    expect(button("Apply to Daily").matches(":disabled")).toBe(false);
  });
});
