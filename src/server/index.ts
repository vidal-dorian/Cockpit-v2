import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { openDatabase } from "./db/db.ts";

const port = Number(process.env.PORT ?? 3000);
const databasePath = process.env.DATABASE_PATH ?? "data/cockpit.db";
const version = readFileSync("version.txt", "utf8").trim();

mkdirSync(dirname(databasePath), { recursive: true });
const app = createApp(openDatabase(databasePath), version);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Cockpit v${version} listening on http://localhost:${info.port}`);
});
