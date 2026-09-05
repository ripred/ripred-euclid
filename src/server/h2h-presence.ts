import type { H2HMappingRead, H2HStore } from "./h2h-store";

export type H2HPresence =
  | { state: "idle" }
  | { state: "queued" }
  | { state: "active"; mapping: H2HMappingRead };

export type H2HPresenceReader = Pick<H2HStore, "getMapping" | "isQueued">;

export async function resolveH2HPresence(
  reader: H2HPresenceReader,
  userId: string,
): Promise<H2HPresence> {
  const initialMapping = await reader.getMapping(userId);
  if (initialMapping) return { state: "active", mapping: initialMapping };

  const queued = await reader.isQueued(userId);

  // Pairing atomically removes the queue entry and creates the mapping. Reading
  // the mapping again prevents that transition from appearing to be idle.
  const stabilizedMapping = await reader.getMapping(userId);
  if (stabilizedMapping) {
    return { state: "active", mapping: stabilizedMapping };
  }
  return { state: queued ? "queued" : "idle" };
}
