import { useState } from "react";

import type { ShareBucket } from "../shared/types/api";
import { rankedPresetLabel } from "./format";
import type { LoadedRankings } from "./rankings-loader";
import { PieceGlyph } from "./ui/BoardDiagram";
import { Icon } from "./ui/Icon";
import { PageShell } from "./ui/PageShell";
import { StandingsList } from "./ui/Standings";
import "./rankings-screen.css";

const BUCKETS: readonly { value: ShareBucket; label: string }[] = [
  { value: "hvh", label: "Redditor matches" },
  { value: "hva", label: "Ranked vs Euclid" },
];

function bucketSubtitle(
  bucket: ShareBucket,
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
  notice,
  shareBusy,
  onRetry,
  onShare,
  onBack,
}: {
  rankings: LoadedRankings;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  notice: string;
  shareBusy: string | null;
  onRetry: () => void;
  onShare: (bucket: ShareBucket) => void;
  onBack: () => void;
}) {
  const [bucket, setBucket] = useState<ShareBucket>("hvh");
  const sharePending = shareBusy?.startsWith("rankings:") ?? false;

  return (
    <PageShell
      title="Leaderboard"
      titleId="rankings-title"
      back={{
        label: sharePending ? "Sharing…" : "Back",
        onClick: onBack,
        disabled: sharePending,
        busy: sharePending,
      }}
      className="rankings"
    >
      {notice ? <p className="notice">{notice}</p> : null}

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
        <div className="rankings__head">
          <p className="muted">
            {bucketSubtitle(bucket, rankings)}
            {loaded && ` · ${rankings[bucket].length} players`}
          </p>
          {loaded && !rankings.preview ? (
            <button
              type="button"
              className="btn btn--sm"
              disabled={sharePending}
              onClick={() => onShare(bucket)}
            >
              <Icon name="share" size={16} />
              {shareBusy === `rankings:${bucket}`
                ? "Sharing…"
                : "Share leaderboard"}
            </button>
          ) : null}
        </div>

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
