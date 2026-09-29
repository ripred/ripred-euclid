import { describe, expect, it } from "vitest";
import { RESULT_HUB_TITLES } from "../shared/result-sharing";
import { getResultSharePresentation } from "./result-share-ui";

describe.each(["ai", "h2h"] as const)(
  "%s result share presentation",
  (kind) => {
    const hub = RESULT_HUB_TITLES[kind];

    it("marks only a confirmed posted response as complete and preserves server copy", () => {
      expect(
        getResultSharePresentation(
          {
            status: "posted",
            message: " Result shared to r/Euclid. ",
          },
          kind,
        ),
      ).toEqual({
        completed: true,
        notice: "Result shared to r/Euclid.",
      });
      expect(
        getResultSharePresentation(
          {
            status: "pending",
            message: " The result is prepared. ",
          },
          kind,
        ),
      ).toEqual({
        completed: false,
        notice: "The result is prepared. Posting has not been confirmed yet.",
      });
    });

    it.each([{}, { message: "" }, { message: "   " }])(
      "names the correct hub when the message is %j",
      (response) => {
        expect(
          getResultSharePresentation({ status: "pending", ...response }, kind),
        ).toEqual({
          completed: false,
          notice: `Your result comment in ${hub} is prepared, but posting has not been confirmed yet.`,
        });
        expect(
          getResultSharePresentation({ status: "posted", ...response }, kind),
        ).toEqual({
          completed: true,
          notice: `Shared as a comment in ${hub}.`,
        });
      },
    );

    it.each([{}, { message: "Result shared." }])(
      "does not claim publication without status even with message %j",
      (response) => {
        expect(getResultSharePresentation(response, kind)).toEqual({
          completed: false,
          notice:
            "Reddit did not return a confirmed share status. Please try again.",
        });
      },
    );
  },
);
