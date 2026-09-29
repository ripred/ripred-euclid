// Local development and ordinary unit tests must never send real telemetry.
// A disabled receipt is deliberately different from proof of ingestion.
export function disabledEvent() {
  return {
    receipt: {
      status: "JOURNEY_RECEIPT_DENIED_DISABLED",
      message: "Journey telemetry is disabled in local development and tests.",
    },
  };
}

export async function disabledStart() {
  return { journeyId: "", ...disabledEvent() };
}
