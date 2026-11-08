import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import { apiModule, cite, submit, webModule } from "./test-code-map.ts";
import { send } from "./test-decisions.ts";
import { ready } from "./test-findings.ts";
import { testAppOptions } from "./test-instance.ts";
import { archiveProject, userWithToken } from "./test-mcp.ts";

// Slice R6 (decision 052 I): `GET /api/projects/:id/versions`, the end of life of the runtimes of the map, read on endoflife.date.
//
// How the fake is injected (the tests never reach the network): `createApp` takes a new option `fetchEndOfLife?: (url: string, init?: RequestInit) => Promise<Response>`,
// like `fetchClientMetadata` and `fireRoutine` (the global fetch when absent). Cockpit adds the abort signal (5 seconds) itself, in `init.signal`. The clock is the `now` option of
// createApp (`() => ms`), used for the 6 months, for « eolFrom passed » and for the 24 hours of the cache. Each test builds its own app on the database of `ready()` with these two options.
//
// What the fake serves (the real shape of https://endoflife.date/api/v1/products/<product>): 200 { schema_version, result: { name, releases: [{ name, isEol, eolFrom }] } } where `name`
// is the cycle (« 20 », « 8.1 »), `isEol` a boolean and `eolFrom` « YYYY-MM-DD » or null; 404 { error } for an unknown product.
// The URL is exactly `https://endoflife.date/api/v1/products/<encodeURIComponent(product)>`.
//
// The answer: 200 { runtimes: [Runtime] }, one per runtime of the stored map, in the order of the modules (by path) then of their runtimes, with
//   Runtime = { module: { path, name }, name, version, product: string, cycle: string | null, state: "eol" | "soon" | "ok" | "unknown", eolFrom: string | null,
//               source: { path, startLine, endLine, commitSha } }
//   `name` and `version` are as the map says (« node », « 20 »); `product` is the endoflife.date product (lowercase name or alias); `cycle` the release found (null when unknown);
//   `eolFrom` the date of the release, null when it has none; `source` the cited manifest line and the commit of the map. No stored map: { runtimes: [] } and nothing is fetched.
// - Product: the name in lowercase, or the alias: node nodejs, .net dotnet, vue.js vue, postgres postgresql, spring boot spring-boot, ruby on rails rails.
// - Version to cycle: the first number found with its decimal if it has one (« ^18.3.1 » → 18.3, « >=8.2 » → 8.2, « v22 » → 22); the cycle is the release named so, else the release named
//   by the number alone (« 18.3 » → « 18 »); no number, no release of that name: unknown.
// - State: eol when `isEol` is true or `eolFrom` is today or past; soon when `eolFrom` is in the next 6 months; ok otherwise; unknown for an unknown product or cycle, or when the site fails.
// - Reads: one per product (not per runtime), 5 seconds at most each (the call is aborted and the runtime is unknown), kept in memory 24 hours per product, an unknown product included;
//   a failure (a network error, a status other than 200 and 404, a body that is not valid) is never kept. Nothing is stored in the database. The route is for members; an archived project can be read.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const NOW = Date.parse("2026-11-08T12:00:00Z");
const DAY = 86_400_000;

type Release = { name: string; isEol: boolean; eolFrom: string | null };
const rel = (
  name: string,
  eolFrom: string | null,
  isEol?: boolean,
): Release => ({
  name,
  eolFrom,
  isEol: isEol ?? (eolFrom !== null && Date.parse(eolFrom) <= NOW),
});
type Product = Release[] | 404 | 500 | "network";

/** The fake endoflife.date: the releases of each product, and the URLs asked. */
function fakeEol(products: Record<string, Product>) {
  const asked: string[] = [];
  const signals: (AbortSignal | undefined | null)[] = [];
  const fetchEndOfLife = vi.fn(async (url: string, init?: RequestInit) => {
    asked.push(url);
    signals.push(init?.signal);
    const product = decodeURIComponent(
      url.replace("https://endoflife.date/api/v1/products/", ""),
    );
    const found = products[product];
    if (found === "network") throw new TypeError("fetch failed");
    if (found === undefined || found === 404)
      return Response.json({ error: "product not found" }, { status: 404 });
    if (found === 500) return Response.json({ error: "boom" }, { status: 500 });
    return Response.json({
      schema_version: "1.2.0",
      result: { name: product, releases: found },
    });
  });
  return { fetchEndOfLife, asked, signals };
}

type Runtime = {
  module: { path: string; name: string };
  name: string;
  version: string;
  product: string;
  cycle: string | null;
  state: string;
  eolFrom: string | null;
  source: {
    path: string;
    startLine: number;
    endLine: number;
    commitSha: string;
  };
};

/** Alice's project, a map made of `modules`, and an app that reads the end of life through `fake`. */
async function withVersions(
  modules: unknown[],
  products: Record<string, Product>,
  clock = { now: NOW },
) {
  const ctx = await ready();
  if (modules.length > 0) {
    const stored = await submit(ctx, modules);
    expect(stored.isError, "the map must be stored for this test").not.toBe(
      true,
    );
  }
  const fake = fakeEol(products);
  const app = createApp(ctx.db, "1.2.3", {
    ...testAppOptions,
    fetchEndOfLife: fake.fetchEndOfLife,
    now: () => clock.now,
  });
  const read = (
    cookie = ctx.alice.cookie,
    id: number | string = ctx.projectId,
  ) => send(app, cookie, "GET", `/api/projects/${id}/versions`);
  const runtimes = async () => {
    const res = await read();
    expect(res.status).toBe(200);
    return ((await res.json()) as { runtimes: Runtime[] }).runtimes;
  };
  return { ...ctx, app, read, runtimes, clock, ...fake };
}

const mod = (
  runtimes: { name: string; version: string }[],
  over: Record<string, unknown> = {},
) =>
  apiModule({
    runtimes: runtimes.map((r, i) => ({
      ...r,
      citation: cite("api/package.json", i + 1),
    })),
    ...over,
  });
const only = async (
  name: string,
  version: string,
  products: Record<string, Product>,
) => {
  const ctx = await withVersions([mod([{ name, version }])], products);
  const [runtime] = await ctx.runtimes();
  return { ...ctx, runtime: runtime as Runtime };
};

describe("decision 052 I: the runtimes of the map and their states", () => {
  it("given a map with two modules, when a member reads the versions, then there is one entry per runtime in the order of the map, with the module, the cited line and the commit", async () => {
    const ctx = await withVersions(
      [
        mod([
          { name: "node", version: "20" },
          { name: "hono", version: "4.6" },
        ]),
        webModule(),
      ],
      { nodejs: [rel("20", "2026-04-30")], react: [rel("18", "2025-06-01")] },
    );

    const found = await ctx.runtimes();

    expect(found.map((r) => [r.module.path, r.name, r.version])).toEqual([
      ["api", "node", "20"],
      ["api", "hono", "4.6"],
      ["web", "react", "18.3"],
    ]);
    expect(found[0]).toMatchObject({
      module: { path: "api", name: "Serveur" },
      product: "nodejs",
      cycle: "20",
      state: "eol",
      eolFrom: "2026-04-30",
      source: {
        path: "api/package.json",
        startLine: 1,
        endLine: 1,
        commitSha: ctx.sha,
      },
    });
    expect(found[1]).toMatchObject({
      product: "hono",
      cycle: null,
      state: "unknown",
      eolFrom: null,
    });
  });

  it("given no map, when the versions are read, then 200 with no runtime and nothing is fetched", async () => {
    const ctx = await withVersions([], {});

    expect(await ctx.runtimes()).toEqual([]);
    expect(ctx.fetchEndOfLife).not.toHaveBeenCalled();
  });

  it.each([
    ["node", "nodejs"],
    ["Node", "nodejs"],
    [".NET", "dotnet"],
    ["Vue.js", "vue"],
    ["Postgres", "postgresql"],
    ["Spring Boot", "spring-boot"],
    ["Ruby on Rails", "rails"],
    ["PHP", "php"],
    ["Symfony", "symfony"],
  ])(
    "given the runtime %s, when the versions are read, then the product asked is %s",
    async (name, product) => {
      const ctx = await only(name, "1", {});

      expect(ctx.runtime.product).toBe(product);
      expect(ctx.asked).toEqual([
        `https://endoflife.date/api/v1/products/${product}`,
      ]);
    },
  );

  it("given a runtime whose name holds characters of a URL, when the versions are read, then the product is encoded in the path", async () => {
    const ctx = await only("a/b?c d", "1", {});

    expect(ctx.asked).toEqual([
      `https://endoflife.date/api/v1/products/${encodeURIComponent("a/b?c d")}`,
    ]);
  });

  it.each([
    ["^18.3.1", "18.3"],
    ["18.3.1", "18.3"],
    [">=8.2", "8.2"],
    ["~7.4.33", "7.4"],
    ["v22", "22"],
    ["20", "20"],
    ["node 20.x", "20"],
  ])(
    "given the version %s, when the versions are read, then the cycle is %s",
    async (version, cycle) => {
      const { runtime } = await only("php", version, {
        php: [
          rel("7.4", "2022-11-28"),
          rel("8.2", "2026-12-31"),
          rel("18.3", null, false),
          rel("22", null, false),
          rel("20", "2026-04-30"),
        ],
      });

      expect(runtime.cycle).toBe(cycle);
    },
  );

  it("given the version 18.3 and no release named 18.3 but a release named 18, when the versions are read, then the cycle is 18", async () => {
    const { runtime } = await only("react", "^18.3.1", {
      react: [rel("18", "2025-06-01"), rel("19", null, false)],
    });

    expect(runtime).toMatchObject({ cycle: "18", state: "eol" });
  });

  it("given a version with no number, when the versions are read, then the runtime is unknown with no cycle", async () => {
    const { runtime } = await only("node", "lts", {
      nodejs: [rel("20", null, false)],
    });

    expect(runtime).toMatchObject({
      cycle: null,
      state: "unknown",
      eolFrom: null,
    });
  });

  it("given a cycle that the product does not list, when the versions are read, then the runtime is unknown", async () => {
    const { runtime } = await only("node", "5", {
      nodejs: [rel("20", null, false)],
    });

    expect(runtime).toMatchObject({ cycle: null, state: "unknown" });
  });

  it("given a release flagged isEol with a future date, when the versions are read, then it is eol", async () => {
    const { runtime } = await only("node", "20", {
      nodejs: [rel("20", "2027-01-01", true)],
    });

    expect(runtime.state).toBe("eol");
  });

  it("given a release whose eolFrom is passed, when the versions are read, then it is eol and says since when", async () => {
    const { runtime } = await only("php", "7.4", {
      php: [rel("7.4", "2022-11-28", false)],
    });

    expect(runtime).toMatchObject({ state: "eol", eolFrom: "2022-11-28" });
  });

  it.each([
    ["in a month", "2026-12-08", "soon"],
    ["in five months", "2027-04-08", "soon"],
    ["in seven months", "2027-06-15", "ok"],
    ["in two years", "2028-11-01", "ok"],
  ])(
    "given a release that ends %s (%s), when the versions are read with today the 8th of November 2026, then it is %s",
    async (_when, date, state) => {
      const { runtime } = await only("node", "22", {
        nodejs: [rel("22", date, false)],
      });

      expect(runtime.state).toBe(state);
    },
  );

  it("given a release with no end of life date and not flagged, when the versions are read, then it is ok with no date", async () => {
    const { runtime } = await only("node", "24", {
      nodejs: [rel("24", null, false)],
    });

    expect(runtime).toMatchObject({ state: "ok", eolFrom: null });
  });

  it("given a product that endoflife.date does not know (404), when the versions are read, then the runtime is unknown", async () => {
    const { runtime } = await only("hono", "4.6", { hono: 404 });

    expect(runtime).toMatchObject({ state: "unknown", cycle: null });
  });
});

describe("decision 052 I: one read per product, kept 24 hours", () => {
  const twoNodes = () =>
    withVersions(
      [
        mod([{ name: "node", version: "20" }]),
        webModule({
          runtimes: [
            {
              name: "node",
              version: "22",
              citation: cite("web/package.json", 2),
            },
            {
              name: "react",
              version: "18.3",
              citation: cite("web/package.json", 3),
            },
          ],
        }),
      ],
      {
        nodejs: [rel("20", "2026-04-30"), rel("22", "2027-04-30")],
        react: [rel("18", "2025-06-01")],
      },
    );

  it("given node in two modules and react in one, when the versions are read, then two products are fetched, one each", async () => {
    const ctx = await twoNodes();

    const found = await ctx.runtimes();

    expect([...ctx.asked].sort()).toEqual([
      "https://endoflife.date/api/v1/products/nodejs",
      "https://endoflife.date/api/v1/products/react",
    ]);
    expect(found.map((r) => r.state)).toEqual(["eol", "soon", "eol"]);
  });

  it("given the versions read, when they are read again within 24 hours, then nothing is fetched again and the answer is the same", async () => {
    const ctx = await twoNodes();
    const first = await ctx.runtimes();
    ctx.clock.now += DAY - 1000;

    const second = await ctx.runtimes();

    expect(ctx.asked).toHaveLength(2);
    expect(second).toEqual(first);
  });

  it("given the versions read, when they are read again after 24 hours, then each product is fetched again once", async () => {
    const ctx = await twoNodes();
    await ctx.runtimes();
    ctx.clock.now += DAY + 1000;

    await ctx.runtimes();

    expect(ctx.asked).toHaveLength(4);
  });

  it("given the cache of a product, when time passes, then the state is judged against the clock of now, not frozen at the first read", async () => {
    const ctx = await withVersions([mod([{ name: "node", version: "22" }])], {
      nodejs: [rel("22", "2027-04-30", false)],
    });
    expect((await ctx.runtimes())[0]?.state).toBe("soon");

    ctx.clock.now = Date.parse("2027-05-01T12:00:00Z");

    expect((await ctx.runtimes())[0]?.state).toBe("eol");
    expect(ctx.asked).toHaveLength(1);
  });

  it("given an unknown product (404), when the versions are read twice within 24 hours, then it is fetched once: the unknown is kept too", async () => {
    const ctx = await withVersions([mod([{ name: "hono", version: "4.6" }])], {
      hono: 404,
    });
    await ctx.runtimes();

    await ctx.runtimes();

    expect(ctx.asked).toHaveLength(1);
  });

  it.each([
    ["a network error", "network"],
    ["a 500", 500],
  ] as const)(
    "given a site that fails with %s, when the versions are read, then the runtime is unknown, the answer is 200, and the failure is not kept: the next read fetches again and sees the site back",
    async (_name, failure) => {
      const products: Record<string, Product> = { nodejs: failure };
      const ctx = await withVersions(
        [mod([{ name: "node", version: "20" }])],
        products,
      );

      expect((await ctx.runtimes())[0]).toMatchObject({
        state: "unknown",
        cycle: null,
      });
      products.nodejs = [rel("20", "2026-04-30")];
      const again = await ctx.runtimes();

      expect(ctx.asked).toHaveLength(2);
      expect(again[0]?.state).toBe("eol");
    },
  );

  it("given a body that is not what endoflife.date serves, when the versions are read, then the runtime is unknown and nothing breaks", async () => {
    const ctx = await withVersions(
      [mod([{ name: "node", version: "20" }])],
      {},
    );
    const app = createApp(ctx.db, "1.2.3", {
      ...testAppOptions,
      fetchEndOfLife: async () =>
        new Response("<html>oops</html>", { status: 200 }),
      now: () => NOW,
    });

    const res = await send(
      app,
      ctx.alice.cookie,
      "GET",
      `/api/projects/${ctx.projectId}/versions`,
    );

    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { runtimes: Runtime[] }).runtimes[0]?.state,
    ).toBe("unknown");
  });

  it("given a site that never answers, when the versions are read, then each read carries an abort signal, is cut at 5 seconds and the runtime is unknown", async () => {
    const asked: (AbortSignal | undefined | null)[] = [];
    const ctx = await withVersions(
      [mod([{ name: "node", version: "20" }])],
      {},
    );
    const app = createApp(ctx.db, "1.2.3", {
      ...testAppOptions,
      fetchEndOfLife: (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          asked.push(init?.signal);
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
      now: () => NOW,
    });
    const started = Date.now();

    const res = await send(
      app,
      ctx.alice.cookie,
      "GET",
      `/api/projects/${ctx.projectId}/versions`,
    );

    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { runtimes: Runtime[] }).runtimes[0]?.state,
    ).toBe("unknown");
    expect(asked[0]).toBeInstanceOf(AbortSignal);
    expect(Date.now() - started).toBeGreaterThanOrEqual(4_900);
    expect(Date.now() - started).toBeLessThan(8_000);
  }, 15_000);
});

describe("decision 052 I: who may read", () => {
  it("given a non-member, no session or an unknown project, when the versions are read, then 404, 401 and 404 and nothing is fetched", async () => {
    const ctx = await withVersions([mod([{ name: "node", version: "20" }])], {
      nodejs: [rel("20", "2026-04-30")],
    });
    const bob = await userWithToken(ctx.app, ctx.db, 2000);

    expect((await ctx.read()).status, "the route exists").toBe(200);
    ctx.fetchEndOfLife.mockClear();
    const stranger = await ctx.read(bob.cookie);

    expect(stranger.status).toBe(404);
    expect(await stranger.json()).toEqual({ error: "Not found" });
    expect((await ctx.read("")).status).toBe(401);
    expect((await ctx.read(ctx.alice.cookie, 99_999)).status).toBe(404);
    expect(ctx.fetchEndOfLife).not.toHaveBeenCalled();
  });

  it("given an archived project, when a member reads the versions, then they are served", async () => {
    const ctx = await withVersions([mod([{ name: "node", version: "20" }])], {
      nodejs: [rel("20", "2026-04-30")],
    });
    await archiveProject(ctx.db, ctx.projectId);

    expect((await ctx.runtimes())[0]?.state).toBe("eol");
  });
});
