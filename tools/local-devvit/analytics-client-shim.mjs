import { disabledEvent, disabledStart } from "./analytics-disabled.mjs";

export function createTelemetryClient(options = {}) {
  let journeyId;
  const journeySession = options.journeySession ?? {
    getActiveJourneyId: () => journeyId,
    setJourneyId: (value) => {
      journeyId = value;
    },
    clearJourneyId: () => {
      journeyId = undefined;
    },
    isPersistent: () => false,
  };
  return {
    journeySession,
    getActiveJourneyId: () => journeySession.getActiveJourneyId(),
    setJourneyId: (value) => journeySession.setJourneyId(value),
    clearJourneyId: () => journeySession.clearJourneyId(),
    startJourney: disabledStart,
    appReady: async () => disabledEvent(),
    progress: async () => disabledEvent(),
    interaction: async () => disabledEvent(),
    endJourney: async () => {
      journeySession.clearJourneyId();
      return disabledEvent();
    },
  };
}

export const telemetry = createTelemetryClient();
