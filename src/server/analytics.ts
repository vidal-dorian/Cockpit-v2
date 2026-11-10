export type Analytics = { key: string; host: string };

/** The instance's PostHog project (decision 082 A); undefined without POSTHOG_KEY. Compose passes an empty host when unset. */
export function analyticsFromEnv(
  env: Record<string, string | undefined>,
): Analytics | undefined {
  if (!env.POSTHOG_KEY) return undefined;
  const host = env.POSTHOG_HOST || "https://eu.i.posthog.com";
  // The page shows `new URL(host).host`: a host without a scheme would crash it, so it stops the start-up instead.
  if (!URL.canParse(host) || !/^https?:$/.test(new URL(host).protocol))
    throw new Error(`POSTHOG_HOST must be an http(s) URL, got "${host}"`);
  return { key: env.POSTHOG_KEY, host };
}
