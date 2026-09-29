import { Router } from "express";
import { disabledEvent, disabledStart } from "./analytics-disabled.mjs";

export const telemetry = {
  appReady: async () => disabledEvent(),
  startJourney: disabledStart,
  journeyProgress: async () => disabledEvent(),
  journeyInteraction: async () => disabledEvent(),
  endJourney: async () => disabledEvent(),
};

export function createTelemetryRouter({ basePath = "/api/telemetry" } = {}) {
  const router = Router();
  router.post(`${basePath}/journey/:event`, async (req, res) => {
    res.json(
      req.params.event === "start" ? await disabledStart() : disabledEvent(),
    );
  });
  return router;
}

export const telemetryRouter = createTelemetryRouter();
