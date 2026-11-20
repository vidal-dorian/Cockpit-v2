import type { Server } from "node:http";
import { endStreams } from "./events.ts";

/** Stops accepting connections, lets the requests in progress finish, then releases everything (SIGTERM during a deployment). */
export async function shutdown(parts: {
  server: Pick<Server, "close" | "closeIdleConnections" | "on">;
  timers: NodeJS.Timeout[];
  pool: { end(): Promise<void> };
  exit: (code: number) => void;
}) {
  // close() refuses new connections and calls back once the open ones are done.
  const closed = new Promise<void>((resolve) =>
    parts.server.close(() => resolve()),
  );
  // A keep-alive connection (the tunnel's) still carries new requests after close(): each answer now ends its connection.
  parts.server.on("request", (_req, res) =>
    res.setHeader("Connection", "close"),
  );
  parts.server.closeIdleConnections();
  // The event streams only end when the client leaves.
  endStreams();
  await closed;
  for (const timer of parts.timers) clearInterval(timer);
  await parts.pool.end();
  parts.exit(0);
}
