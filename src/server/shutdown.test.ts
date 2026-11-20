import { readFileSync } from "node:fs";
import { Agent, createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { onStop } from "./events.ts";
import { shutdown } from "./shutdown.ts";

const root = join(import.meta.dirname, "../..");

afterEach(() => {
  vi.useRealTimers();
});

/** A real HTTP server whose only route answers when `release()` is called. */
async function slowServer() {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let arrived = () => {};
  const reachedHandler = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const server = createServer((_req, res) => {
    arrived();
    void gate.then(() => res.end("done"));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, port, release, reachedHandler };
}

describe("graceful shutdown (SIGTERM during a deployment)", () => {
  it("given a request in progress, when the shutdown starts, then no new connection is accepted and the request is awaited before the process exits", async () => {
    const { server, port, release, reachedHandler } = await slowServer();
    const exit = vi.fn();
    const inFlight = fetch(`http://127.0.0.1:${port}/`).then((r) => r.text());
    await reachedHandler;

    const stopping = shutdown({
      server,
      timers: [],
      pool: { end: async () => {} },
      exit,
    });

    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(exit).not.toHaveBeenCalled();

    release();
    expect(await inFlight).toBe("done");
    await stopping;
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("given the requests in progress are finished, when the shutdown completes, then the schedules are stopped, the pool is closed and the process exits with code 0", async () => {
    const { server } = await slowServer();
    const calls: string[] = [];
    const timers = [
      setInterval(() => {}, 100_000),
      setInterval(() => {}, 100_000),
    ];
    const clear = vi.spyOn(globalThis, "clearInterval");
    const pool = {
      end: vi.fn(async () => {
        calls.push("pool");
      }),
    };
    const exit = vi.fn((code: number) => {
      calls.push(`exit:${code}`);
    });

    await shutdown({ server, timers, pool, exit });

    for (const timer of timers) expect(clear).toHaveBeenCalledWith(timer);
    expect(pool.end).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["pool", "exit:0"]);
    clear.mockRestore();
    for (const timer of timers) clearInterval(timer);
  });

  it("given an open event stream and a keep-alive connection, when the shutdown starts, then the stream ends and the next request is answered with Connection: close", async () => {
    let endStream = () => {};
    const server = createServer((req, res) => {
      if (req.url === "/stream") {
        res.write(": open\n\n");
        onStop(() => res.end());
      } else res.end("ok");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    const get = (path: string) =>
      new Promise<{ connection: unknown; done: Promise<void> }>((resolve) => {
        request({ port, path, agent, host: "127.0.0.1" }, (res) => {
          res.resume();
          resolve({
            connection: res.headers.connection,
            done: new Promise((r) => res.on("close", () => r())),
          });
        }).end();
      });
    // Warm the keep-alive connection, then open the stream on another socket.
    await (await get("/")).done;
    const streamAgent = new Agent();
    const stream = new Promise<void>((resolve) => {
      request({ port, path: "/stream", agent: streamAgent }, (res) => {
        res.resume();
        res.on("close", () => resolve());
        endStream = resolve;
      }).end();
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const exit = vi.fn();

    const stopping = shutdown({
      server,
      timers: [],
      pool: { end: async () => {} },
      exit,
    });
    await stream;
    await stopping;

    expect(exit).toHaveBeenCalledWith(0);
    endStream();
    agent.destroy();
    streamAgent.destroy();
  });

  it("given the entry point, when it is read, then it keeps the server of serve() and hands it, the schedules and the pool to shutdown on SIGTERM", () => {
    const source = readFileSync(join(root, "src/server/index.ts"), "utf8");

    expect(source).toMatch(
      /import\s*\{[^}]*\bshutdown\b[^}]*\}\s*from\s*"\.\/shutdown\.ts"/,
    );
    expect(source).toMatch(/process\.on\(\s*"SIGTERM"/);
    expect(source).toMatch(/=\s*serve\(/);
    expect(source).toMatch(/\bshutdown\(/);
  });
});

describe("compose.yaml, service app", () => {
  const compose = readFileSync(join(root, "compose.yaml"), "utf8");
  const app = compose.split(/^ {2}app:\n/m)[1]?.split(/^ {2}\S.*:\n/m)[0] ?? "";

  it("given the app service, when Docker stops it, then init is true so the signal reaches Node", () => {
    expect(app).toMatch(/^ {4}init:\s*true\s*$/m);
  });

  it("given the app service, when Docker stops it, then stop_grace_period exceeds the longest GitHub write (about 100 s)", () => {
    const match = app.match(
      /^ {4}stop_grace_period:\s*["']?(\d+)(s|m)["']?\s*$/m,
    );
    expect(match).not.toBeNull();
    const seconds = Number(match?.[1]) * (match?.[2] === "m" ? 60 : 1);
    expect(seconds).toBeGreaterThan(100);
  });
});
