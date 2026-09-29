// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCompetitionAvailability } from "./use-competition-availability";

let host: HTMLDivElement, root: Root;
let version = 1;
let delayed: (() => void) | null;
let wait: Promise<void> | null;
function Probe({
  enabled,
  refreshKey,
}: {
  enabled: boolean;
  refreshKey: string | undefined;
}) {
  const { availability, error } = useCompetitionAvailability(
    enabled,
    refreshKey,
  );
  return (
    <span>
      {availability ? `version:${availability.serverNow}` : "loading"}
      {error}
    </span>
  );
}
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  version = 1;
  delayed = null;
  wait = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const responseVersion = version;
      if (wait) await wait;
      return {
        ok: true,
        json: async () => ({ competitions: {}, serverNow: responseVersion }),
      };
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function render(
  refreshKey: string | undefined = "first",
  enabled = true,
) {
  await act(async () =>
    root.render(<Probe enabled={enabled} refreshKey={refreshKey} />),
  );
}

describe("shared competition availability", () => {
  it("supports an omitted key and does not poll while disabled", async () => {
    await render(undefined, false);
    expect(fetch).not.toHaveBeenCalled();
    await render(undefined);
    expect(host.textContent).toBe("version:1");
    await render(undefined, false);
    await act(async () => vi.advanceTimersByTime(60000));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(host.textContent).toBe("loading");
  });
  it("drops previous settings availability until the new key is fetched", async () => {
    await render();
    wait = new Promise<void>((resolve) => {
      delayed = resolve;
    });
    version = 2;
    await render("second");
    expect(host.textContent).toBe("loading");
    await act(async () => delayed!());
    expect(host.textContent).toBe("version:2");
  });
  it("does not adopt an old in-flight response after switching settings", async () => {
    wait = new Promise<void>((resolve) => {
      delayed = resolve;
    });
    await render();
    const old = delayed!;
    wait = null;
    version = 2;
    await render("second");
    await act(async () => old());
    expect(host.textContent).toBe("version:2");
  });
  it("refreshes every thirty seconds and on visibility restore", async () => {
    await render();
    version = 2;
    await act(async () => vi.advanceTimersByTime(30000));
    expect(host.textContent).toBe("version:2");
    version = 3;
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    expect(host.textContent).toBe("version:3");
  });
});
