import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { openDatabase } from "./db/db.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error(
    "DATABASE_URL is not set. Example: DATABASE_URL=postgres://user:password@localhost:5432/cockpit",
  );
  process.exit(1);
}

const port = Number(process.env.PORT ?? 3000);
const version = readFileSync("version.txt", "utf8").trim();

const app = createApp(await openDatabase(databaseUrl), version);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Cockpit v${version} listening on http://localhost:${info.port}`);
});
