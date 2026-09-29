import { useState } from "react";

import type { RankingBucket } from "../shared/types/api";
import type { GameVariant } from "../shared/game/rules";
import { rankedPresetLabel } from "./format";
import type { LoadedRankings } from "./rankings-loader";
import { PieceGlyph } from "./ui/BoardDiagram";
import { Icon } from "./ui/Icon";
import { PageShell } from "./ui/PageShell";
import { StandingsList } from "./ui/Standings";
import "./rankings-screen.css";

const BUCKETS: readonly { value: RankingBucket; label: string }[] = [
  { value: "hvh", label: "Redditor matches" },
  { value: "hva", label: "Ranked vs Euclid" },
];

function bucketSubtitle(
  bucket: RankingBucket,
  rankings: Pick<LoadedRankings, "hvaRules">,
): string {
  return bucket === "hvh"
    ? "Live matches between two redditors."
    : rankedPresetLabel(rankings.hvaRules?.rules);
}

export function RankingsScreen({
  rankings,
  loading,
  loaded,
  error,
  onRetry,
  onBack,
  variant = "standard",
  onVariantChange,
}: {
  rankings: LoadedRankings;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  onRetry: () => void;
  onBack: () => void;
  variant?: GameVariant;
  onVariantChange?: (variant: GameVariant) => void;
}) {
  const [bucket, setBucket] = useState<RankingBucket>("hvh");

  return (
    <PageShell
      title="Leaderboard"
      titleId="rankings-title"
      back={{ label: "Back", onClick: onBack }}
      className="rankings"
    >
      {onVariantChange && (
        <div
          className="seg rankings__tabs"
          role="radiogroup"
          aria-label="Game mode leaderboard"
        >
          {(["standard", "tide"] as const).map((choice) => (
            <button
              key={choice}
              type="button"
              role="radio"
              aria-checked={variant === choice}
              tabIndex={variant === choice ? 0 : -1}
              onClick={() => onVariantChange(choice)}
              onKeyDown={(event) => {
                if (
                  !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? "standard"
                    : event.key === "End"
                      ? "tide"
                      : choice === "standard"
                        ? "tide"
                        : "standard";
                onVariantChange(next);
                const buttons =
                  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                    "button",
                  );
                buttons?.[next === "standard" ? 0 : 1]?.focus();
              }}
            >
              {choice === "tide" ? "Tide" : "Standard"}
            </button>
          ))}
        </div>
      )}

      <div
        className="seg rankings__tabs"
        role="tablist"
        aria-label="Leaderboard"
      >
        {BUCKETS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={bucket === option.value}
            aria-controls="rankings-panel"
            onClick={() => setBucket(option.value)}
          >
            <PieceGlyph owner={option.value === "hvh" ? 2 : 1} size={14} />
            {option.label}
          </button>
        ))}
      </div>

      <section
        id="rankings-panel"
        className="panel rankings__panel"
        role="tabpanel"
        aria-label="Full leaderboard"
      >
        <p className="muted rankings__description">
          {variant === "tide" && bucket === "hvh" ? "Tide · " : ""}
          {bucketSubtitle(bucket, rankings)}
          {loaded && ` · ${rankings[bucket].length} players`}
        </p>

        {rankings.preview && (
          <p className="muted">
            Local preview · 500 sample players · Results are fictional
          </p>
        )}

        {loading || (!loaded && !error) ? (
          <p role="status" className="muted">
            {loaded ? "Refreshing leaderboard…" : "Loading leaderboard…"}
          </p>
        ) : null}

        {error ? (
          <div className="notice notice--attention rankings__error">
            <p role="alert">{error}</p>
            {loaded ? <p>Showing the last loaded standings.</p> : null}
            <button type="button" className="btn btn--sm" onClick={onRetry}>
              <Icon name="refresh" size={16} />
              Try again
            </button>
          </div>
        ) : null}

        {loaded ? (
          <StandingsList
            key={bucket}
            rows={rankings[bucket]}
            label={BUCKETS.find((option) => option.value === bucket)!.label}
            size="lg"
            empty="No ranked players yet. The first win claims the top spot."
          />
        ) : null}
      </section>
    </PageShell>
  );
}
