import { useState, type MouseEventHandler } from "react";

import "./share-preview.css";
import type {
  SharedPostPayload,
  RankingsSharePayload,
  ResultSharePayload,
} from "../shared/types/api";

import { formatDisplayDate } from "./format";
import { ReplayBoardCard } from "./share-replay";
import { buildReplayFrames, frameShapes } from "./share-replay-model";
import { BoardDiagram } from "./ui/BoardDiagram";
import { boardAspectRatio } from "./ui/board-geometry";
import type { ThemeMode } from "./theme";
import { StandingsList } from "./ui/Standings";

function SharedAt({ share }: { share: SharedPostPayload }) {
  return (
    <p className="share__meta">
      r/{share.subredditName} ·{" "}
      <time dateTime={share.sharedAt}>{formatDisplayDate(share.sharedAt)}</time>
    </p>
  );
}

function ResultHeading({ share }: { share: ResultSharePayload }) {
  return (
    <header className="share__heading">
      <p className="eyebrow">Euclid · Shared game</p>
      <h1>{share.headline}</h1>
      <p className="share__rules">{share.subtitle}</p>
    </header>
  );
}

function ResultScores({ share }: { share: ResultSharePayload }) {
  const players = [
    { side: 1, name: share.p1Name },
    { side: 2, name: share.p2Name },
  ] as const;

  return (
    <dl className="share__scores" aria-label="Final scores">
      {players.map(({ side, name }) => (
        <div
          className={`share__player share__player--${side}${share.winnerSide === side ? " share__player--winner" : ""}`}
          key={side}
        >
          <dt>{name}</dt>
          <dd>
            {share.board.m_players[side - 1]?.m_score ?? 0}
            <span className="share__outcome">
              {share.winnerSide === side ? "Winner" : "Opponent"}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The finished position as a still image: light enough for the feed. */
function FinalBoard({ share }: { share: ResultSharePayload }) {
  const frames = buildReplayFrames(share.board);
  const final = frames[frames.length - 1] ?? frames[0];
  const { squares } = frameShapes({ ...final, newSquares: [] });
  return (
    <div
      className="share__board"
      style={{ aspectRatio: boardAspectRatio(share.board.W, share.board.H) }}
    >
      <BoardDiagram
        width={share.board.W}
        height={share.board.H}
        cells={final.board}
        squares={squares}
        title="Final board"
      />
    </div>
  );
}

function RankingsSummary({ share }: { share: RankingsSharePayload }) {
  return (
    <>
      <header className="share__heading">
        <p className="eyebrow">Euclid · Leaderboard snapshot</p>
        <h1>{share.title}</h1>
        <p className="share__rules">{share.subtitle}</p>
      </header>
      <StandingsList
        rows={share.rows}
        label="Shared leaderboard leaders"
        limit={3}
        size="sm"
        empty="No ranked players in this snapshot."
      />
    </>
  );
}

// Full presentation for the expanded entrypoint and posts created with "game".
export function ResultShareView({
  share,
  theme,
}: {
  share: ResultSharePayload;
  theme: ThemeMode;
}) {
  return (
    <section
      className="euclid-result-share"
      aria-label="Shared game result"
      tabIndex={0}
    >
      <article className="panel share__card share__card--result">
        <div className="share__summary">
          <ResultHeading share={share} />
          <ResultScores share={share} />
          <p className="share__detail">{share.details}</p>
          <footer className="share__footer">
            <p>{share.footer}</p>
            <SharedAt share={share} />
          </footer>
        </div>
        <div className="share__replay">
          <ReplayBoardCard board={share.board} theme={theme} compact />
        </div>
      </article>
    </section>
  );
}

export function SharePreview({
  share,
  onExpand,
}: {
  share: SharedPostPayload;
  theme: ThemeMode;
  onExpand: MouseEventHandler<HTMLButtonElement>;
}) {
  const [expansionFailed, setExpansionFailed] = useState(false);
  const expand: MouseEventHandler<HTMLButtonElement> = (event) => {
    try {
      onExpand(event);
      setExpansionFailed(false);
    } catch {
      setExpansionFailed(true);
    }
  };
  const actionLabel =
    share.kind === "rankings"
      ? "View full leaderboard snapshot"
      : "View full result & replay";

  return (
    <section
      className="euclid-share-preview"
      data-expansion-failed={expansionFailed || undefined}
      aria-label={
        share.kind === "rankings"
          ? "Shared leaderboard preview"
          : "Shared game result preview"
      }
    >
      <article
        className={`panel share__card share__card--inline${share.kind === "result" ? " share__card--with-board" : ""}`}
      >
        {share.kind === "result" ? <FinalBoard share={share} /> : null}
        <div className="share__summary">
          {share.kind === "rankings" ? (
            <RankingsSummary share={share} />
          ) : (
            <>
              <ResultHeading share={share} />
              <ResultScores share={share} />
              <p className="share__detail">{share.details}</p>
            </>
          )}
          <SharedAt share={share} />
        </div>
        <div className="share__actions">
          {expansionFailed ? (
            <p className="share__error" role="alert">
              Could not open this post. Try again.
            </p>
          ) : null}
          <button
            type="button"
            className="btn btn--primary share__expand"
            aria-label={actionLabel}
            onClick={expand}
          >
            <span className="share__expand-label">{actionLabel}</span>
            <span className="share__expand-short" aria-hidden="true">
              {share.kind === "rankings"
                ? "View full snapshot"
                : "View full result"}
            </span>
          </button>
        </div>
      </article>
    </section>
  );
}
