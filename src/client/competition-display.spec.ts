import { describe, expect, it } from "vitest";
import {
  competitionAvailabilityText,
  competitionLabel,
  formatCompetitionCountdown,
  formatCompetitionDate,
} from "./competition-display";
import type { CompetitionAvailability } from "../shared/competitions";

describe("competition presentation", () => {
  it("formats UTC midnight explicitly as GMT independent of local timezone", () => {
    expect(formatCompetitionDate(Date.UTC(2026, 8, 28))).toBe(
      "28 Sept 2026, 00:00 GMT",
    );
  });
  it("clamps elapsed countdowns and includes days for weekly periods", () => {
    expect(formatCompetitionCountdown(-100)).toBe("0h 00m 00s");
    expect(formatCompetitionCountdown(86400000 + 62000)).toBe("1d 0h 01m 02s");
    expect(competitionLabel("weekly")).toBe("Weekly challenge");
  });
  it("distinguishes availability and avoids implying expired boards are still playable", () => {
    const item: CompetitionAvailability = {
      period: "daily",
      enabled: true,
      status: "open",
      instanceId: "daily",
      opensAt: 1000,
      endsAt: 10000,
      showStandings: true,
    };
    expect(competitionAvailabilityText(item, 10001)).toContain("has ended");
    expect(
      competitionAvailabilityText({ ...item, status: "scheduled" }, 0),
    ).toBe("Opens in 0h 00m 01s");
    expect(
      competitionAvailabilityText({ ...item, enabled: false }, 0),
    ).toContain("Disabled");
    expect(
      competitionAvailabilityText({ ...item, status: "unavailable" }, 0),
    ).toContain("unavailable");
  });
});
