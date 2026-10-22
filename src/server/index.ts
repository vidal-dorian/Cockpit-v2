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

// Read before opening the database, so a missing setting fails fast.
function required(name: string) {
  const value = process.env[name];
  if (!value) {
    console.error(
      `${name} is not set (see the README, "Créer la GitHub App").`,
    );
    process.exit(1);
  }
  return value;
}
// Normalised (lowercase scheme, no trailing slash) because it is glued to paths and decides the Secure cookie flag.
function parseOrigin(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:")
      return url.origin;
  } catch {}
  console.error(
    "PUBLIC_URL is not a valid http(s) URL. Example: PUBLIC_URL=https://cockpit.example.com",
  );
  process.exit(1);
}
const githubClientId = required("GITHUB_CLIENT_ID");
const githubClientSecret = required("GITHUB_CLIENT_SECRET");
const publicUrl = parseOrigin(required("PUBLIC_URL"));
const allowedLogins = required("ALLOWED_GITHUB_LOGINS")
  .split(",")
  .map((login) => login.trim())
  .filter(Boolean);

const port = Number(process.env.PORT ?? 3000);
const version = readFileSync("version.txt", "utf8").trim();

const app = createApp(await openDatabase(databaseUrl), version, {
  githubClientId,
  githubClientSecret,
  publicUrl,
  allowedLogins,
});

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Cockpit v${version} listening on http://localhost:${info.port}`);
});
