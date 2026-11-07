import { afterEach, describe, expect, it, vi } from "vitest";
import {
  apiModule,
  type Ctx,
  cite,
  FILES,
  ready,
  stored,
  submit,
  text,
  webModule,
} from "./test-code-map.ts";
import { githubCalls } from "./test-github.ts";
import {
  archiveProject,
  callTool,
  expectRefused,
  listedTools,
  mcpRows,
  onlyEntry,
  shape,
  textOf,
  userWithToken,
} from "./test-mcp.ts";

// Slice R1 (decision 043 A, B, D, E): the MCP tool `submit_code_map`, tested through POST /mcp against the fake GitHub.
//
// Pinned where the decision leaves it open (the developer follows these):
// - The arguments are `project_id`, `commit_sha` and `modules`, with the keys of 043 A in snake_case (`start_line`, `end_line`, `cardinality`).
// - An argument that does not fit the schema of A is refused as `Refused: invalid arguments (<path>: <why>)` like every tool (stories.test.ts),
//   the path being zod's, so it contains the name of the faulty field. The other refusals (B) are `Refused: ...` texts that contain the faulty
//   location written as `modules[1].objects[3].citation`: `modules[i].objects[j].citation`, `modules[i].runtimes[j].citation`, `modules[i].manifest`,
//   `modules[i].objects[j].name` (the second object of that name), `modules[i].links[j].from` or `.to` (the unknown end), `modules[i].path` (the second module of that path),
//   and `commit_sha` for a commit GitHub does not know. Positions start at 0.
// - A line count is the number of lines of the text: "a\nb\n" and "a\nb" both have 2 lines.
// - The refusals of GitHub's side (B) are journaled `refused` with a closed lowercase reason code; an archived project is `project_archived`; a failing GitHub is an `error` entry.
// - The 100 files of B are the distinct files cited by the call (objects and runtimes); the manifest of a module is not counted by these tests (they stay under 100 with it, or over 100 without it).

afterEach(() => {
  vi.unstubAllGlobals();
});

const history = async (ctx: Ctx) => mcpRows(ctx.db);

describe("decision 043 A: a valid map is accepted", () => {
  it("given an API and a web module that cite real lines at a real commit, when submit_code_map is called, then it is accepted and one row per module is stored with its commit, name, kind and data", async () => {
    const ctx = await ready();

    const result = await submit(ctx);

    expect(result.isError, textOf(result)).not.toBe(true);
    const rows = await stored(ctx.db);
    expect(rows.map((r) => r.module_path)).toEqual(["api", "web"]);
    expect(rows[0]).toMatchObject({
      module_name: "Serveur",
      module_kind: "api",
      commit_sha: ctx.sha,
    });
    expect(rows[1]).toMatchObject({
      module_name: "Application",
      module_kind: "web",
      commit_sha: ctx.sha,
    });
    expect(rows[0]?.data).toMatchObject({
      manifest: "api/package.json",
      runtimes: apiModule().runtimes,
      objects: apiModule().objects,
      links: apiModule().links,
    });
  });

  it("given a module at the root of the repo with no runtime, an object with no field and a link with no cardinality, when submit_code_map is called, then it is accepted", async () => {
    const ctx = await ready({ ...FILES, "package.json": text(4, "root") });

    const result = await submit(ctx, [
      apiModule({
        path: ".",
        manifest: "package.json",
        runtimes: [],
        links: [{ from: "Order", to: "User", kind: "extends" }],
      }),
    ]);

    expect(result.isError, textOf(result)).not.toBe(true);
    expect((await stored(ctx.db)).map((r) => r.module_path)).toEqual(["."]);
  });

  it("given the same object name in two modules, when submit_code_map is called, then it is accepted (a type of the API reused by the web is an object of each, decision 043 F)", async () => {
    const ctx = await ready();
    const web = webModule();
    const shared = { ...web.objects[0], name: "User" };

    const result = await submit(ctx, [
      apiModule(),
      webModule({ objects: [shared] }),
    ]);

    expect(result.isError, textOf(result)).not.toBe(true);
    expect(await stored(ctx.db)).toHaveLength(2);
  });

  it("given a call that cites exactly 100 distinct files (the manifest included), when it is sent, then it is accepted", async () => {
    const many = Object.fromEntries(
      Array.from({ length: 99 }, (_, i) => [`api/src/f${i}.ts`, text(3)]),
    );
    const ctx = await ready({ ...FILES, ...many });
    const objects = Array.from({ length: 99 }, (_, i) => ({
      name: `O${i}`,
      kind: "type",
      fields: [],
      citation: cite(`api/src/f${i}.ts`, 1, 3),
    }));

    const result = await submit(ctx, [apiModule({ objects, links: [] })]);

    expect(result.isError, textOf(result)).not.toBe(true);
  });

  it("given a valid token, when tools/list is read, then submit_code_map is listed with an English description and project_id, commit_sha and modules as required arguments", async () => {
    const ctx = await ready();

    const tool = (await listedTools(ctx.app, ctx.alice.secret)).find(
      (t) => t.name === "submit_code_map",
    );

    expect(tool?.description).toMatch(/[a-z]{4,}/);
    expect(tool?.inputSchema?.required).toEqual(
      expect.arrayContaining(["project_id", "commit_sha", "modules"]),
    );
  });
});

describe("decision 043 A: the bounds of the schema", () => {
  const nameOf = (n: number) => Array.from({ length: n }, (_, i) => `O${i}`);
  const objects = (n: number) =>
    nameOf(n).map((name) => ({
      name,
      kind: "type",
      fields: [],
      citation: cite("api/src/db.ts", 1, 2),
    }));
  const run = () => ({
    name: "node",
    version: "20",
    citation: cite("api/package.json", 2),
  });
  const first = (over: Record<string, unknown>) => ({
    ...apiModule().objects[0],
    ...over,
  });
  const cases: [
    string,
    string | RegExp,
    () => unknown[],
    Record<string, unknown>?,
  ][] = [
    [
      "a commit_sha of 39 characters",
      "commit_sha",
      () => [apiModule()],
      { commit_sha: "a".repeat(39) },
    ],
    [
      "a commit_sha that is not hexadecimal",
      "commit_sha",
      () => [apiModule()],
      { commit_sha: "g".repeat(40) },
    ],
    ["no module", "modules", () => []],
    [
      "11 modules",
      "modules",
      () =>
        Array.from({ length: 11 }, (_, i) => apiModule({ path: `api${i}` })),
    ],
    ["a module kind desktop", "kind", () => [apiModule({ kind: "desktop" })]],
    ["a module with no name", "name", () => [apiModule({ name: undefined })]],
    [
      "a module with no manifest",
      "manifest",
      () => [apiModule({ manifest: undefined })],
    ],
    [
      "21 runtimes",
      "runtimes",
      () => [apiModule({ runtimes: Array.from({ length: 21 }, run) })],
    ],
    [
      "a runtime with no citation",
      "citation",
      () => [apiModule({ runtimes: [{ name: "node", version: "20" }] })],
    ],
    ["no object", "objects", () => [apiModule({ objects: [], links: [] })]],
    [
      "201 objects",
      "objects",
      () => [apiModule({ objects: objects(201), links: [] })],
    ],
    [
      "an object kind enum",
      "kind",
      () => [apiModule({ objects: [first({ kind: "enum" })], links: [] })],
    ],
    [
      "101 fields",
      "fields",
      () => [
        apiModule({
          objects: [
            first({
              fields: Array.from({ length: 101 }, (_, i) => ({
                name: `f${i}`,
                type: "text",
              })),
            }),
          ],
          links: [],
        }),
      ],
    ],
    [
      "a field with no type",
      "type",
      () => [
        apiModule({
          objects: [first({ fields: [{ name: "id" }] })],
          links: [],
        }),
      ],
    ],
    [
      "501 links",
      "links",
      () => [
        apiModule({
          links: Array.from({ length: 501 }, () => ({
            from: "Order",
            to: "User",
            kind: "contains",
          })),
        }),
      ],
    ],
    [
      "a link kind calls",
      "kind",
      () => [
        apiModule({ links: [{ from: "Order", to: "User", kind: "calls" }] }),
      ],
    ],
    [
      "a cardinality many",
      "cardinality",
      () => [
        apiModule({
          links: [
            {
              from: "Order",
              to: "User",
              kind: "contains",
              cardinality: "many",
            },
          ],
        }),
      ],
    ],
    [
      "a start_line of 0",
      /start_line|citation/,
      () => [
        apiModule({
          objects: [first({ citation: cite("api/src/db.ts", 0, 2) })],
          links: [],
        }),
      ],
    ],
    [
      "a start_line after its end_line",
      /start_line|end_line|citation/,
      () => [
        apiModule({
          objects: [first({ citation: cite("api/src/db.ts", 5, 4) })],
          links: [],
        }),
      ],
    ],
    [
      "a citation with no path",
      "path",
      () => [
        apiModule({
          objects: [first({ citation: { start_line: 1, end_line: 2 } })],
          links: [],
        }),
      ],
    ],
    [
      "a project_id that is not an id",
      "project_id",
      () => [apiModule()],
      { project_id: "x" },
    ],
  ];

  it.each(cases)(
    "given %s, when submit_code_map is called, then Refused naming the faulty field, nothing is stored and one invalid_arguments entry is left",
    async (_name, field, build, args) => {
      const ctx = await ready();

      const refused = expectRefused(await submit(ctx, build(), args));

      expect(refused.startsWith("Refused: invalid arguments (")).toBe(true);
      expect(refused).toMatch(
        field instanceof RegExp ? field : new RegExp(field),
      );
      expect(await stored(ctx.db)).toEqual([]);
      expect((await onlyEntry(ctx.db)).detail).toEqual({
        reason: "invalid_arguments",
      });
    },
  );
});

describe("decision 043 B: the refusals say where", () => {
  const object = (i: number, over: Record<string, unknown>) => {
    const objects = apiModule().objects.map((o, j) =>
      j === i ? { ...o, ...over } : o,
    );
    return apiModule({ objects });
  };
  const cases: [string, string, () => unknown[], Record<string, unknown>?][] = [
    [
      "a file absent at that commit",
      "modules[0].objects[1].citation",
      () => [object(1, { citation: cite("api/src/missing.ts") })],
    ],
    [
      "a citation of a directory",
      "modules[0].objects[1].citation",
      () => [object(1, { citation: cite("api/src") })],
    ],
    [
      "a citation of a path that does not exist at all",
      "modules[1].objects[0].citation",
      () => [
        apiModule(),
        webModule({
          objects: [
            { ...webModule().objects[0], citation: cite("nowhere/at/all.ts") },
          ],
        }),
      ],
    ],
    [
      "lines past the end of the file (31 on a file of 30)",
      "modules[0].objects[0].citation",
      () => [object(0, { citation: cite("api/src/db.ts", 28, 31) })],
    ],
    [
      "a start_line past the end of the file",
      "modules[0].objects[2].citation",
      () => [object(2, { citation: cite("api/src/db.ts", 31, 31) })],
    ],
    [
      "a runtime citing lines past the end of its manifest",
      "modules[0].runtimes[1].citation",
      () => [
        apiModule({
          runtimes: [
            apiModule().runtimes[0],
            {
              name: "hono",
              version: "4.6",
              citation: cite("api/package.json", 7),
            },
          ],
        }),
      ],
    ],
    [
      "a manifest absent at that commit",
      "modules[0].manifest",
      () => [apiModule({ manifest: "api/pom.xml" })],
    ],
    [
      "a manifest that is a directory",
      "modules[1].manifest",
      () => [apiModule(), webModule({ manifest: "web/src" })],
    ],
    [
      "two objects of the same name in a module",
      "modules[0].objects[2].name",
      () => [object(2, { name: "User" })],
    ],
    [
      "a link from an unknown object",
      "modules[0].links[1].from",
      () => [
        apiModule({
          links: [
            apiModule().links[0],
            { from: "Ghost", to: "Order", kind: "contains" },
          ],
        }),
      ],
    ],
    [
      "a link to an unknown object",
      "modules[0].links[0].to",
      () => [
        apiModule({
          links: [{ from: "Order", to: "Ghost", kind: "references" }],
        }),
      ],
    ],
    [
      "a link to an object that only another module has",
      "modules[1].links[0].to",
      () => [
        apiModule(),
        webModule({
          links: [{ from: "Session", to: "User", kind: "references" }],
        }),
      ],
    ],
    [
      "two modules at the same path",
      "modules[1].path",
      () => [apiModule(), webModule({ path: "api" })],
    ],
    [
      "a commit GitHub does not know",
      "commit_sha",
      () => [apiModule(), webModule()],
      { commit_sha: "f".repeat(40) },
    ],
  ];

  it.each(cases)(
    "given %s, when submit_code_map is called, then Refused with the location %s, nothing is stored and one refused entry is left",
    async (_name, where, build, args) => {
      const ctx = await ready();

      const refused = expectRefused(await submit(ctx, build(), args));

      expect(refused).toContain(where);
      expect(await stored(ctx.db)).toEqual([]);
      const entry = await onlyEntry(ctx.db);
      expect(entry).toMatchObject({
        action: "submit_code_map",
        result: "refused",
      });
      expect(entry.detail?.reason).toMatch(/^[a-z_]+$/);
    },
  );

  it("given a file that exists in a later commit only, when it is cited at the older commit, then Refused at its citation", async () => {
    const ctx = await ready();
    ctx.git.push({ "api/src/new.ts": text(5) });

    const refused = expectRefused(
      await submit(ctx, [
        apiModule({
          objects: [
            { ...apiModule().objects[0], citation: cite("api/src/new.ts") },
          ],
          links: [],
        }),
      ]),
    );

    expect(refused).toContain("modules[0].objects[0].citation");
    expect(await stored(ctx.db)).toEqual([]);
  });

  it("given the same file at the later commit, when it is cited at that commit, then it is accepted", async () => {
    const ctx = await ready();
    const later = ctx.git.push({ "api/src/new.ts": text(5) });

    const result = await submit(
      ctx,
      [
        apiModule({
          objects: [
            {
              ...apiModule().objects[0],
              citation: cite("api/src/new.ts", 1, 5),
            },
          ],
          links: [],
        }),
      ],
      { commit_sha: later },
    );

    expect(result.isError, textOf(result)).not.toBe(true);
    expect((await stored(ctx.db))[0]?.commit_sha).toBe(later);
  });

  it("given a file of exactly 30 lines, when its last line is cited, then it is accepted (the boundary of 'past the end')", async () => {
    const ctx = await ready();

    const result = await submit(ctx, [
      apiModule({
        objects: [
          {
            ...apiModule().objects[0],
            citation: cite("api/src/db.ts", 30, 30),
          },
        ],
        links: [],
      }),
    ]);

    expect(result.isError, textOf(result)).not.toBe(true);
  });

  it("given a file with no final newline, when the line after its last text line is cited, then it is refused", async () => {
    const ctx = await ready({ ...FILES, "api/src/two.ts": "a\nb" });
    const at = (end: number) => [
      apiModule({
        objects: [
          {
            ...apiModule().objects[0],
            citation: cite("api/src/two.ts", 1, end),
          },
        ],
        links: [],
      }),
    ];

    expect((await submit(ctx, at(2))).isError).not.toBe(true);
    expect(expectRefused(await submit(ctx, at(3)))).toContain(
      "modules[0].objects[0].citation",
    );
  });

  it.each([
    ["a symlink", { "api/src/link.ts": { kind: "symlink" as const } }],
    ["a submodule", { "api/src/lib.ts": { kind: "submodule" as const } }],
    [
      "a file too large to read",
      { "api/src/big.ts": { kind: "large" as const } },
    ],
  ])(
    "given %s cited by an object, when submit_code_map is called, then Refused at its citation (not a readable file)",
    async (_name, entries) => {
      const ctx = await ready(FILES, { entries });
      const [path] = Object.keys(entries) as string[];

      const refused = expectRefused(
        await submit(ctx, [
          apiModule({
            objects: [
              { ...apiModule().objects[0], citation: cite(path as string) },
            ],
            links: [],
          }),
        ]),
      );

      expect(refused).toContain("modules[0].objects[0].citation");
      expect(await stored(ctx.db)).toEqual([]);
    },
  );

  it("given an archived project, when submit_code_map is called, then Refused project_archived, nothing is stored", async () => {
    const ctx = await ready();
    await archiveProject(ctx.db, ctx.projectId);

    const refused = expectRefused(await submit(ctx));

    expect(refused).toMatch(/archived/i);
    expect(await stored(ctx.db)).toEqual([]);
    expect((await onlyEntry(ctx.db)).detail).toEqual({
      reason: "project_archived",
    });
  });

  it("given a project of someone else, when submit_code_map is called, then Refused not_found and nothing is stored", async () => {
    const ctx = await ready();
    const bob = await userWithToken(ctx.app, ctx.db, 2000);

    const refused = expectRefused(
      await callTool(ctx.app, bob.secret, "submit_code_map", {
        project_id: ctx.projectId,
        commit_sha: ctx.sha,
        modules: [apiModule()],
      }),
    );

    expect(refused).toMatch(/Refused/);
    expect(await stored(ctx.db)).toEqual([]);
  });

  it("given 101 distinct files cited in one call, when it is sent, then Refused naming the limit of 100 files (send the modules in several calls) and nothing is stored", async () => {
    const many = Object.fromEntries(
      Array.from({ length: 101 }, (_, i) => [`api/src/f${i}.ts`, text(3)]),
    );
    const ctx = await ready({ ...FILES, ...many });
    const objects = Array.from({ length: 101 }, (_, i) => ({
      name: `O${i}`,
      kind: "type",
      fields: [],
      citation: cite(`api/src/f${i}.ts`, 1, 3),
    }));

    const refused = expectRefused(
      await submit(ctx, [apiModule({ objects, links: [] })]),
    );

    expect(refused).toContain("100");
    expect(refused).toMatch(/several calls|more than one call|separate calls/i);
    expect(await stored(ctx.db)).toEqual([]);
  });

  it("given a module with no runtime, a manifest no runtime cites and objects citing 100 other files, when it is sent, then Refused: the manifest counts among the distinct files", async () => {
    const many = Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => [`api/src/f${i}.ts`, text(3)]),
    );
    const ctx = await ready({ ...FILES, ...many });
    const objects = Array.from({ length: 100 }, (_, i) => ({
      name: `O${i}`,
      kind: "type",
      fields: [],
      citation: cite(`api/src/f${i}.ts`, 1, 3),
    }));

    const refused = expectRefused(
      await submit(ctx, [apiModule({ objects, links: [], runtimes: [] })]),
    );

    expect(refused).toContain("101");
    expect(await stored(ctx.db)).toEqual([]);
  });

  it("given a valid call, when it is sent, then each folder of the repo is read once, the root included", async () => {
    const ctx = await ready();

    await submit(ctx);

    const trees = githubCalls(ctx.fetchMock)
      .filter((c) => c.path.includes("/git/trees/"))
      .map((c) => c.path);
    expect(trees.length).toBeGreaterThan(0);
    expect(new Set(trees).size).toBe(trees.length);
  });

  it("given a call that cites the same file 150 times, when it is sent, then it is accepted (the limit counts distinct files)", async () => {
    const ctx = await ready();
    const objects = Array.from({ length: 150 }, (_, i) => ({
      name: `O${i}`,
      kind: "type",
      fields: [],
      citation: cite("api/src/db.ts", 1, 2),
    }));

    const result = await submit(ctx, [apiModule({ objects, links: [] })]);

    expect(result.isError, textOf(result)).not.toBe(true);
  });
});

describe("decision 043 D: the modules of a call replace the stored ones", () => {
  it("given a stored map of api and web, when a new call sends api only at a later commit, then api is replaced (one row, new commit, new data) and web stays untouched", async () => {
    const ctx = await ready();
    expect((await submit(ctx)).isError).not.toBe(true);
    const later = ctx.git.push({ "api/src/db.ts": text(40, "db") });

    const result = await submit(
      ctx,
      [
        apiModule({
          name: "Serveur v2",
          objects: [
            {
              ...apiModule().objects[0],
              citation: cite("api/src/db.ts", 35, 40),
            },
          ],
          links: [],
        }),
      ],
      { commit_sha: later },
    );

    expect(result.isError, textOf(result)).not.toBe(true);
    const rows = await stored(ctx.db);
    expect(
      rows.map((r) => [r.module_path, r.commit_sha, r.module_name]),
    ).toEqual([
      ["api", later, "Serveur v2"],
      ["web", ctx.sha, "Application"],
    ]);
    expect(rows[0]?.data).toMatchObject({ objects: [expect.anything()] });
  });

  it("given a stored map, when a call sends api (valid) and web (a citation past the end), then it is refused as a whole: api keeps its old commit and data (all or nothing)", async () => {
    const ctx = await ready();
    expect((await submit(ctx)).isError).not.toBe(true);
    const before = await stored(ctx.db);
    const later = ctx.git.push({ "api/src/extra.ts": text(3) });

    const refused = expectRefused(
      await submit(
        ctx,
        [
          apiModule({ name: "Serveur v2" }),
          webModule({
            objects: [
              {
                ...webModule().objects[0],
                citation: cite("web/src/types.ts", 9, 11),
              },
            ],
          }),
        ],
        { commit_sha: later },
      ),
    );

    expect(refused).toContain("modules[1].objects[0].citation");
    expect(await stored(ctx.db)).toEqual(before);
  });

  it("given a call sent twice with the same modules, when both are accepted, then there is still one row per module", async () => {
    const ctx = await ready();

    await submit(ctx);
    await submit(ctx);

    expect(await stored(ctx.db)).toHaveLength(2);
  });
});

describe("decision 043 E: the call is journaled by the MCP wrapper", () => {
  it("given an accepted call, when it is journaled, then there is one ok entry of submit_code_map for the project, claude / mcp, with the token", async () => {
    const ctx = await ready();

    await submit(ctx);

    expect(shape(await onlyEntry(ctx.db))).toMatchObject({
      user_id: ctx.alice.id,
      token_id: ctx.alice.tokenId,
      project_id: ctx.projectId,
      actor: "claude",
      origin: "mcp",
      action: "submit_code_map",
      result: "ok",
    });
  });

  it("given a refused call, when it is journaled, then there is one refused entry for the project and no object name or file path of the call is in it", async () => {
    const ctx = await ready();

    expectRefused(
      await submit(ctx, [
        apiModule({
          objects: [
            {
              ...apiModule().objects[0],
              name: "SecretObjectName",
              citation: cite("api/src/missing-secret.ts"),
            },
          ],
          links: [],
        }),
      ]),
    );

    const entries = await history(ctx);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      project_id: ctx.projectId,
      result: "refused",
    });
    expect(JSON.stringify(entries)).not.toMatch(
      /SecretObjectName|missing-secret/,
    );
  });

  it("given GitHub failing while the citations are read, when the call is made, then an error entry is left, the answer says to retry, and nothing is stored", async () => {
    const ctx = await ready();
    ctx.fetchMock.update({ failOn: (c) => c.path.includes("/git/trees/") });

    const result = await submit(ctx);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^Error:/);
    expect(await stored(ctx.db)).toEqual([]);
    expect((await onlyEntry(ctx.db)).result).toBe("error");
  });
});
