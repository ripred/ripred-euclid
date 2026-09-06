import type {
  EditionDefinition,
  EditionSnapshot,
  EditionState,
  PlayMode,
} from "./edition-contract";
import { EditionRuleError } from "./edition-contract";

export interface EditionSession<T extends EditionState>
  extends EditionSnapshot<T> {
  lastCommand: { id: string; signature: string };
  /** Written by the transport authority, never copied from command input. */
  activity?: { updatedAt: number; hostName: string };
}

export class EditionError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export class EditionInvariantError extends Error {}

/** Rule upgrades retain the match identity and exact-command retry receipt. */
export function reconcileEditionSession<T extends EditionState>(
  definition: EditionDefinition<T>,
  session: EditionSession<T> | null,
): EditionSession<T> | null {
  if (!session || !definition.reconcile) return session;
  const state = definition.reconcile(session.state);
  if (state.revision !== session.state.revision)
    throw new EditionInvariantError(
      "Reconciling saved rules must preserve the move revision.",
    );
  return state === session.state ? session : { ...session, state };
}

/** Never expose storage keys, account identifiers, or internal exception messages. */
export function editionErrorResponse(error: unknown): {
  status: number;
  error: string;
} {
  if (error instanceof EditionError)
    return { status: error.status, error: error.message };
  if (error instanceof EditionRuleError)
    return { status: 400, error: error.message };
  if (error instanceof EditionInvariantError)
    return {
      status: 500,
      error: "The game could not complete that turn. Please reconnect.",
    };
  return {
    status: 503,
    error: "The game service is temporarily unavailable. Please reconnect.",
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new EditionError("Invalid command.");
  return value as Record<string, unknown>;
}

/** One authoritative transaction contains both the human move and its reply. */
export function runEditionCommand<T extends EditionState>(
  definition: EditionDefinition<T>,
  current: EditionSession<T> | null,
  input: unknown,
  newId: string,
  activity?: { updatedAt: number; hostName: string },
): EditionSession<T> {
  const command = record(input);
  if (
    typeof command.commandId !== "string" ||
    !/^[a-zA-Z0-9-]{8,80}$/.test(command.commandId)
  ) {
    throw new EditionError("Missing command identifier.");
  }
  const signature = JSON.stringify(command);
  if (signature.length > 8192)
    throw new EditionError("Command is too large.", 413);
  if (current?.lastCommand.id === command.commandId) {
    if (current.lastCommand.signature !== signature)
      throw new EditionError(
        "That command was already used for another move.",
        409,
      );
    return reconcileEditionSession(definition, current)!;
  }
  let state: T;
  let mode: PlayMode;
  let id: string;
  if (command.kind === "start") {
    if (
      current &&
      (command.expectedId !== current.id ||
        command.expectedRevision !== current.state.revision)
    ) {
      throw new EditionError(
        "This game changed in another tab. Reload before starting a new one.",
        409,
      );
    }
    if (definition.id === "relay") {
      if (command.mode !== "puzzle")
        throw new EditionError("Relay is a single-player puzzle edition.");
      mode = "puzzle";
    } else {
      if (command.mode !== "solo" && command.mode !== "duel")
        throw new EditionError("Choose solo or pass-and-play.");
      mode = command.mode;
    }
    state = definition.create(command.options);
    id = newId;
  } else if (command.kind === "move" || command.kind === "spectators") {
    if (!current) throw new EditionError("Start a game first.", 409);
    if (
      command.expectedId !== current.id ||
      command.expectedRevision !== current.state.revision
    ) {
      throw new EditionError(
        "This game changed in another tab. The current board has been restored.",
        409,
      );
    }
    // Validate the client's snapshot before applying a pure saved-state upgrade.
    current = reconcileEditionSession(definition, current)!;
    if (command.kind === "spectators") {
      if (typeof command.enabled !== "boolean")
        throw new EditionError("Choose whether to allow spectators.");
      return {
        ...current,
        spectatorsEnabled: command.enabled,
        ...(activity ? { activity } : {}),
        lastCommand: { id: command.commandId, signature },
      };
    }
    if (current.state.winner !== null && current.mode !== "puzzle")
      throw new EditionError("This game has finished.", 409);
    if (current.mode === "solo" && current.state.turn !== 1)
      throw new EditionError("Wait for your turn.", 409);
    state = definition.move(current.state, command.action);
    mode = current.mode;
    id = current.id;
    if (state.revision !== current.state.revision + 1)
      throw new EditionInvariantError(
        "Edition rules must advance exactly one revision.",
      );
  } else {
    throw new EditionError("Unknown command.");
  }
  // Never choose or apply an opponent move after the winning placement.
  if (mode === "solo" && state.winner === null && state.turn === 2) {
    const revision = state.revision;
    state = definition.move(state, definition.chooseMove(state));
    if (
      state.revision !== revision + 1 ||
      (state.winner === null && state.turn !== 1)
    ) {
      throw new EditionInvariantError("The opponent did not finish its turn.");
    }
  }
  return {
    id,
    mode,
    state,
    spectatorsEnabled:
      command.kind === "start" ? false : current?.spectatorsEnabled === true,
    ...(activity
      ? { activity }
      : current?.activity
        ? { activity: current.activity }
        : {}),
    lastCommand: { id: command.commandId, signature },
  };
}

export function editionSnapshot<T extends EditionState>(
  session: EditionSession<T> | null,
): EditionSnapshot<T> | null {
  return session
    ? {
        id: session.id,
        mode: session.mode,
        state: session.state,
        spectatorsEnabled: session.spectatorsEnabled === true,
      }
    : null;
}
