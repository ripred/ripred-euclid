import { useEffect, useState } from "react";
import type { LiveEditionGame, PlayMode } from "../../shared/edition-contract";
import { requestEdition } from "./edition-api";
import { useEdition } from "./use-edition";
import "./spectators.css";

const modeLabel: Record<PlayMode, string> = {
  solo: "Solo game",
  duel: "Pass & play",
  puzzle: "Puzzle",
};

function readLiveGames(value: unknown): LiveEditionGame[] {
  if (
    !value ||
    typeof value !== "object" ||
    !("games" in value) ||
    !Array.isArray(value.games)
  )
    throw new Error("The live game list could not be read.");
  return value.games.filter(
    (game): game is LiveEditionGame =>
      !!game &&
      typeof game === "object" &&
      typeof game.id === "string" &&
      typeof game.hostName === "string" &&
      Object.hasOwn(modeLabel, game.mode) &&
      Number.isFinite(game.updatedAt) &&
      Number.isInteger(game.revision),
  );
}

/** Shared discovery and viewing controls; each board keeps its own rendering rules. */
export function SpectatorControls() {
  const session = useEdition();
  const [open, setOpen] = useState(false);
  const [games, setGames] = useState<LiveEditionGame[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!document.hidden) {
        try {
          const next = readLiveGames(
            await requestEdition("live", controller.signal),
          );
          if (!controller.signal.aborted) {
            setGames(next);
            setListError(null);
          }
        } catch (failure) {
          if (!controller.signal.aborted)
            setListError(
              failure instanceof Error
                ? failure.message
                : "Unable to load live games.",
            );
        } finally {
          if (!controller.signal.aborted) setListLoading(false);
        }
      }
      if (!controller.signal.aborted)
        timer = setTimeout(() => {
          void poll();
        }, 5000);
    };
    setListLoading(true);
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [open, refresh]);
  const otherGames = games.filter((game) => game.id !== session.ownerGameId);
  const finished = session.game !== null && session.game.winner !== null;
  return (
    <section className="edition-spectators" aria-label="Spectator controls">
      <div className="edition-spectator-bar">
        {session.watching ? (
          <>
            <div className="edition-spectator-status">
              <strong>
                {session.hostName
                  ? `Watching ${session.hostName}`
                  : "Spectator view"}
              </strong>
              <span>
                {session.loading
                  ? "Connecting…"
                  : session.error
                    ? "Connection paused"
                    : finished
                      ? "Read-only · final result"
                      : "Read-only · updates live"}
              </span>
            </div>
            <button type="button" onClick={session.stopWatching}>
              Back to my game
            </button>
          </>
        ) : (
          <div className="edition-sharing-control">
            <button
              type="button"
              aria-pressed={session.spectatorsEnabled}
              disabled={
                !session.ownerGameId ||
                session.loading ||
                session.busy ||
                (!session.spectatorsEnabled && finished)
              }
              onClick={() => {
                void session.setSpectatorsEnabled(!session.spectatorsEnabled);
              }}
              aria-describedby="edition-sharing-description"
            >
              {session.spectatorsEnabled ? "Stop sharing" : "Allow spectators"}
            </button>
            <span id="edition-sharing-description">
              {session.spectatorsEnabled
                ? "Spectators are allowed for this game."
                : session.ownerGameId
                  ? finished
                    ? "Share an active game to let others watch."
                    : "This game is private until you share it."
                  : "Start a game to allow spectators."}
            </span>
          </div>
        )}
        <details
          open={open}
          onToggle={(event) => setOpen(event.currentTarget.open)}
        >
          <summary>Live games</summary>
          <div className="edition-live-list">
            <div className="edition-live-heading">
              <strong>Watch another player</strong>
              <button
                type="button"
                disabled={listLoading}
                onClick={() => setRefresh((value) => value + 1)}
              >
                Refresh
              </button>
            </div>
            <p>
              Shared games appear here while active. Watching will keep your own
              game intact.
            </p>
            {listError && <p role="alert">{listError}</p>}
            {listLoading ? (
              <p role="status">Finding live games…</p>
            ) : otherGames.length === 0 ? (
              <p>
                No live games right now. Invite another player to share theirs.
              </p>
            ) : (
              <ul>
                {otherGames.map((game) => (
                  <li key={game.id}>
                    <div>
                      <strong>{game.hostName}</strong>
                      <span>{modeLabel[game.mode]}</span>
                    </div>
                    <button
                      type="button"
                      disabled={session.watchedId === game.id}
                      aria-label={`Watch ${game.hostName}'s game`}
                      onClick={() => {
                        void session.watch(game.id);
                        setOpen(false);
                      }}
                    >
                      {session.watchedId === game.id ? "Watching" : "Watch"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
      </div>
      {session.watching && session.error && (
        <div className="edition-spectator-error" role="alert">
          <span>{session.error}</span>
          <button
            type="button"
            disabled={session.loading}
            onClick={() => {
              void session.reload();
            }}
          >
            Retry connection
          </button>
        </div>
      )}
    </section>
  );
}
