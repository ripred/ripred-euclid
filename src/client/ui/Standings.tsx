import { PlayerAvatar } from "./PlayerAvatar";
import type { RankingsShareRow } from "../../shared/types/api";
import "./standings.css";

const formatRecord = (row: RankingsShareRow) =>
  `${row.wins}W · ${row.losses}L · ${row.draws}D`;

/** One ranked row, shared by the leaderboard, post previews and snapshots. */
export function StandingRow({
  row,
  rank,
  size = "md",
}: {
  row: RankingsShareRow;
  rank: number;
  size?: "sm" | "md" | "lg";
}) {
  const name = row.name || row.userId;
  return (
    <li
      className={`standing standing--${size}${rank <= 3 ? ` standing--top standing--rank-${rank}` : ""}`}
    >
      <span className="standing__rank num">{rank}</span>
      <PlayerAvatar
        name={name}
        avatar={row.avatar}
        size={size === "sm" ? 26 : size === "lg" ? 44 : 34}
      />
      <span className="standing__who">
        <span className="standing__name" title={name}>
          {name}
        </span>
        <span className="standing__record">
          {formatRecord(row)} · {row.games} {row.games === 1 ? "game" : "games"}
        </span>
      </span>
      <span
        className="standing__rating num"
        aria-label={`Rating ${row.rating}`}
      >
        {row.rating}
      </span>
    </li>
  );
}

export function StandingsList({
  rows,
  label,
  limit,
  size = "md",
  empty,
}: {
  rows: readonly RankingsShareRow[];
  label: string;
  limit?: number;
  size?: "sm" | "md" | "lg";
  empty: string;
}) {
  const shown = limit === undefined ? rows : rows.slice(0, limit);
  if (shown.length === 0) return <p className="standings__empty">{empty}</p>;
  return (
    <ol className="standings" aria-label={label}>
      {shown.map((row, index) => (
        <StandingRow
          key={`${row.userId}-${index}`}
          row={row}
          rank={index + 1}
          size={size}
        />
      ))}
    </ol>
  );
}
