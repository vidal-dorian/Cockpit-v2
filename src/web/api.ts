import { hc } from "hono/client";
import type { AppType } from "../server/app.ts";

/** Typed client of the server routes: `client.api.health.$get()`. */
export const client = hc<AppType>("/");
