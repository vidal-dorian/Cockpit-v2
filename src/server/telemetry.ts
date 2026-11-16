/** Decision 083 E: one event to PostHog (EU), never awaited by the caller; a failure only goes to the logs. Nothing here takes args, detail or an error message. */
export function sendEvent(
  event: string,
  userId: number | null,
  properties: Record<string, unknown>,
) {
  const key = process.env.POSTHOG_KEY;
  if (!key) return;
  fetch("https://eu.i.posthog.com/i/v0/e/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      event,
      distinct_id: userId == null ? "server" : String(userId),
      properties:
        userId == null
          ? { ...properties, $process_person_profile: false }
          : properties,
    }),
    signal: AbortSignal.timeout(10_000),
  })
    .then((res) => {
      // Frees the connection: undici keeps it until the body is read or cancelled.
      res.body?.cancel().catch(() => {});
      if (!res.ok) console.warn(`PostHog answered ${res.status} for ${event}`);
    })
    .catch((error) => console.warn(`PostHog event ${event} not sent:`, error));
}
