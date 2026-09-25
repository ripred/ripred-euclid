// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LevelSlider } from "./LevelSlider";

const LEVELS = ["low", "mid", "high"] as const;

afterEach(() => {
  document.body.innerHTML = "";
});

async function render(value: (typeof LEVELS)[number], onChange = vi.fn()) {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  await act(async () =>
    createRoot(host).render(
      <LevelSlider
        id="level"
        label="Level"
        options={LEVELS}
        value={value}
        onChange={onChange}
        format={(level) => level.toUpperCase()}
        hint="Pick one."
      />,
    ),
  );
  return { host, onChange };
}

describe("level slider", () => {
  it("names the selected level on the thumb and for assistive tech", async () => {
    const { host } = await render("mid");
    const input = host.querySelector("input")!;
    expect(input.type).toBe("range");
    expect(input.max).toBe("2");
    expect(input.value).toBe("1");
    expect(input.getAttribute("aria-valuetext")).toBe("MID");
    expect(input.getAttribute("aria-describedby")).toBe("level-hint");
    expect(host.querySelector(".level-slider__bubble")?.textContent).toBe(
      "MID",
    );
    expect(host.querySelector("label")?.htmlFor).toBe("level");
  });

  it("draws one tick per level and marks those reached", async () => {
    const { host } = await render("mid");
    const ticks = [...host.querySelectorAll(".level-slider__ticks span")];
    expect(ticks).toHaveLength(3);
    expect(ticks.map((tick) => tick.hasAttribute("data-reached"))).toEqual([
      true,
      true,
      false,
    ]);
    expect(host.querySelector(".level-slider__ends")?.textContent).toBe(
      "LOWHIGH",
    );
  });

  it("reports the level for the thumb's position", async () => {
    const { host, onChange } = await render("low");
    const input = host.querySelector("input")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "2");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("high");
  });
});
