import { useEffect, useRef, useState } from "react";
import type { ChallengeOptions } from "../shared/challenge";
import {
  CHALLENGE_PERIODS,
  CHALLENGE_SETTING,
  type ChallengePeriod,
} from "../shared/challenge-spotlights";
import type {
  CompetitionApplyRequest,
  CompetitionTemplate,
  CompetitionTemplatesResponse,
  CompetitionTemplateVersion,
} from "../shared/competitions";
import { errorMessage } from "../shared/error-message";
import {
  applyCompetitionTemplate,
  readCompetitionTemplates,
  requestCompetitionTemplates,
} from "./challenge-api";
import { JsonRequestError } from "./fetch-json";
import { formatCompetitionDate } from "./competition-display";
import { Dialog } from "./ui/Dialog";
import { pointLabel } from "./ui/board-geometry";

type Application = {
  period: ChallengePeriod;
  request: CompetitionApplyRequest;
};
const label = (period: ChallengePeriod) =>
  period === "daily" ? "Daily" : "Weekly";

function TemplateDescription({
  version,
  pending = false,
}: {
  version: CompetitionTemplateVersion;
  pending?: boolean;
}) {
  const { options } = version;
  return (
    <div className="challenge-template__version">
      <p>
        <strong>{pending ? "Pending" : "Saved"}</strong>
        {version.effectiveAt
          ? ` · ${pending ? "Effective" : "From"} ${formatCompetitionDate(version.effectiveAt)}`
          : " · Default settings"}
      </p>
      <p className="field__hint">
        {options.minimumMoves} moves · {options.targetSquares} squares ·{" "}
        {options.geometry} · {options.blockedCount} blocked
        {options.sharedCorner
          ? " · Shared corner required"
          : " · Shared corner optional"}
        {options.multipleSolutions
          ? " · Multiple solutions required"
          : " · One or more solutions"}
        {options.blockedPoints.length > 0 &&
          ` · Fixed blocks: ${options.blockedPoints.map((point) => pointLabel(point % 8, Math.floor(point / 8))).join(", ")}`}
      </p>
    </div>
  );
}

/** A single settings/apply flow serves both competitions; practice stays separate. */
export function ChallengeTemplateControls({
  options,
  disabled,
  onLoad,
  onBusyChange,
}: {
  options: ChallengeOptions | null;
  disabled: boolean;
  onLoad: (options: CompetitionTemplate) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [data, setData] = useState<CompetitionTemplatesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);
  const [confirmation, setConfirmation] = useState<Application | null>(null);
  const [retry, setRetry] = useState<Application | null>(null);
  const pending = useRef(false);
  const live = useRef(true);

  useEffect(() => {
    onBusyChange(applying || confirmation !== null);
    return () => onBusyChange(false);
  }, [applying, confirmation, onBusyChange]);

  useEffect(() => {
    live.current = true;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void requestCompetitionTemplates(controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setData(next);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            errorMessage(cause, "Challenge settings could not be loaded."),
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      live.current = false;
      controller.abort();
    };
  }, [reload]);

  async function apply(application: Application) {
    if (pending.current) return;
    pending.current = true;
    setApplying(true);
    setError("");
    setMessage("");
    try {
      const next = await applyCompetitionTemplate(
        application.period,
        application.request,
      );
      if (!live.current) return;
      setData(next);
      setRetry(null);
      const state = next.templates[application.period];
      setMessage(
        state.pending
          ? `${label(application.period)} settings saved for ${formatCompetitionDate(state.pending.effectiveAt)}.`
          : `${label(application.period)} settings applied. ${next.settings[CHALLENGE_SETTING[application.period]] ? "The new puzzle is ready." : "The challenge remains disabled."}`,
      );
    } catch (cause) {
      if (!live.current) return;
      const rejected =
        cause instanceof JsonRequestError &&
        cause.status < 500 &&
        cause.payload?.code !== "pending";
      setRetry(rejected ? null : application);
      setError(
        errorMessage(cause, "Challenge settings could not be applied.") +
          (rejected
            ? " Review the saved settings before applying again."
            : " Retry this apply request to confirm whether it was saved."),
      );
      try {
        const refreshed =
          cause instanceof JsonRequestError && cause.payload?.templates
            ? readCompetitionTemplates(cause.payload.templates)
            : await requestCompetitionTemplates();
        if (live.current) setData(refreshed);
      } catch {
        // Preserve the exact command after a lost reply. A later retry must
        // never create another replacement for the same Apply action.
        if (live.current && rejected) setData(null);
      }
    } finally {
      pending.current = false;
      if (live.current) setApplying(false);
    }
  }

  function prepare(period: ChallengePeriod) {
    if (!data || !options || pending.current || retry) return;
    const template = { ...options, blockedPoints: [...options.blockedPoints] };
    delete template.seed;
    const immediate = data.settings.challengeApplyTiming === "immediately";
    const application: Application = {
      period,
      request: {
        options: template,
        expectedRevision: data.templates[period].revision,
        commandId: crypto.randomUUID(),
        ...(immediate ? { confirmReset: true } : {}),
      },
    };
    if (immediate) setConfirmation(application);
    else void apply(application);
  }

  return (
    <section
      className="challenge-templates"
      aria-label="Saved challenge settings"
    >
      <h2 className="panel__title">Subreddit challenge settings</h2>
      <p className="field__hint">
        Apply the options above to a shared challenge. The test seed is never
        saved. Applying settings does not enable a challenge.
      </p>
      <p className="challenge-templates__timing">
        Apply changes:{" "}
        <strong>
          {data
            ? data.settings.challengeApplyTiming === "immediately"
              ? "Immediately"
              : "Next scheduled start"
            : "Loading…"}
        </strong>
        . Change this in Options → Subreddit.
      </p>
      <fieldset
        disabled={
          disabled || loading || applying || !!confirmation || !!retry || !data
        }
      >
        {CHALLENGE_PERIODS.map((period) => {
          const state = data?.templates[period];
          return (
            <section
              className="challenge-template"
              key={period}
              aria-label={`${label(period)} saved settings`}
            >
              <h3>
                {label(period)} challenge
                {data && !data.settings[CHALLENGE_SETTING[period]]
                  ? " · Disabled"
                  : ""}
              </h3>
              <p className="field__hint">
                {period === "daily"
                  ? "Starts every day at 00:00 GMT."
                  : "Starts Monday at 00:00 GMT."}
              </p>
              {data &&
                data.settings[CHALLENGE_SETTING[period]] &&
                state?.activationAt != null &&
                state.activationAt > data.serverNow && (
                  <p className="field__hint">
                    Opens {formatCompetitionDate(state.activationAt)}.
                  </p>
                )}
              {state && (
                <>
                  <TemplateDescription version={state.active} />
                  {state.pending && (
                    <TemplateDescription version={state.pending} pending />
                  )}
                  {state.generationError && (
                    <p className="notice notice--attention" role="alert">
                      {state.generationError} Adjust or reapply these settings
                      to try generation again.
                    </p>
                  )}
                </>
              )}
              <div className="challenge-actions">
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => {
                    if (!state) return;
                    onLoad((state.pending ?? state.active).options);
                    setMessage(
                      `${label(period)} ${state.pending ? "pending" : "saved"} settings loaded into the playground.`,
                    );
                  }}
                >
                  Load {period} settings
                </button>
                <button
                  type="button"
                  className="btn btn--sm"
                  disabled={!options}
                  onClick={() => prepare(period)}
                >
                  Apply to {label(period)}
                </button>
              </div>
              {state?.pending && (
                <p className="field__hint">
                  Load uses the pending settings. Applying again replaces that
                  pending change.
                </p>
              )}
            </section>
          );
        })}
      </fieldset>
      {(loading || applying || message) && (
        <p role="status" className="field__hint">
          {loading
            ? "Loading saved challenge settings…"
            : applying
              ? "Applying settings and preparing the challenge…"
              : message}
        </p>
      )}
      {error && (
        <p role="alert" className="notice notice--attention">
          {error}
        </p>
      )}
      <div className="challenge-actions">
        {retry && (
          <button
            type="button"
            className="btn"
            disabled={disabled || applying}
            onClick={() => void apply(retry)}
          >
            Retry apply request
          </button>
        )}
        {!retry && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={disabled || applying || loading || !!confirmation}
            onClick={() => setReload((value) => value + 1)}
          >
            Refresh saved settings
          </button>
        )}
      </div>
      {confirmation && (
        <Dialog
          labelledBy="challenge-apply-title"
          onDismiss={() => setConfirmation(null)}
        >
          <h2 id="challenge-apply-title">
            Replace the {confirmation.period} challenge now?
          </h2>
          <p>
            A new puzzle will replace the current puzzle. Current entries and
            standings will be reset without awarding a winner. The normal{" "}
            {confirmation.period === "daily" ? "daily" : "Monday"} 00:00 GMT
            deadline stays the same.
          </p>
          <p>
            Generation must succeed before anything changes. A disabled
            challenge remains disabled.
          </p>
          <div className="challenge-actions">
            <button
              type="button"
              autoFocus
              className="btn btn--ghost"
              onClick={() => setConfirmation(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                const application = confirmation;
                setConfirmation(null);
                void apply(application);
              }}
            >
              Replace challenge
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
