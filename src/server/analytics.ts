export type Analytics = { key: string; host: string };

/** The instance's PostHog project (decision 082 A); undefined without POSTHOG_KEY. Compose passes an empty host when unset. */
export function analyticsFromEnv(
  env: Record<string, string | undefined>,
): Analytics | undefined {
  if (!env.POSTHOG_KEY) return undefined;
  return {
    key: env.POSTHOG_KEY,
    host: env.POSTHOG_HOST || "https://eu.i.posthog.com",
  };
}
