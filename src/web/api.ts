import { hc } from "hono/client";
import type { AppType } from "../server/app.ts";
import { track } from "./telemetry.ts";

/** Decision 083 F: failed calls are reported as `api_error` (the route, never the address); the caller gets the response or the error unchanged. 401, 403 and 404 are expected. */
async function reportingFetch(input: RequestInfo | URL, init?: RequestInit) {
  const report = (status: number) => {
    const raw =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const route = new URL(raw, "http://localhost").pathname
      .split("/")
      .map((part) =>
        /^\d+$/.test(part) ||
        /^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(part)
          ? ":id"
          : part,
      )
      .join("/");
    track("api_error", { route, status });
  };
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch (error) {
    report(0);
    throw error;
  }
  if (!res.ok && ![401, 403, 404].includes(res.status)) report(res.status);
  return res;
}

/** Typed client of the server routes: `client.api.health.$get()`. */
export const client = hc<AppType>("/", { fetch: reportingFetch });
