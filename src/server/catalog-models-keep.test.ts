import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogStates } from "./catalog-update.ts";
import { withProject } from "./test-mcp.ts";

// Slice R5 (decision 051 L), the places where the model line of the repo's copy must be kept: the diff of the plan, the prepare path, and the test of an old original copy.

afterEach(() => {
  vi.unstubAllGlobals();
});

const REPO = "user1000/app";
const DEV = ".claude/agents/developer.md";
const DEV_US = ".claude/skills/dev-us/SKILL.md";
const sha256 = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");
const fromCatalog = (relative: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../catalog/${relative}`, import.meta.url)),
    "utf8",
  );
const DEV_TEXT = fromCatalog("agents/developer.md");
const DEV_US_TEXT = fromCatalog("skills/dev-us/SKILL.md");
const withModel = (text: string, model: string) =>
  text.replace(/^model:.*$/m, `model: ${model}`);
const pastOf = (text: string) => `${text}\nA sentence an older version had.\n`;

async function ready(files: Record<string, string>) {
  const ctx = await withProject({
    gitRepos: { [REPO]: { files: { "README.md": "# app\n", ...files } } },
  });
  return { ...ctx, git: ctx.fetchMock.git(REPO) };
}
const post = (
  ctx: Awaited<ReturnType<typeof ready>>,
  path: string,
  body?: unknown,
) =>
  ctx.app.request(`/api/projects/${ctx.projectId}${path}`, {
    method: "POST",
    headers: { cookie: ctx.alice.cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const remember = (
  ctx: Awaited<ReturnType<typeof ready>>,
  path: string,
  text: string,
) =>
  ctx.db.execute(
    sql`insert into catalog_writes (project_id, path, sha256, written_at) values (${ctx.projectId}, ${path}, ${sha256(text)}, now())`,
  );

describe("decision 051 L: the plan shows what the update writes", () => {
  it("given an old developer set to opus, when the catalog plan is read, then its content keeps model: opus", async () => {
    const old = withModel(pastOf(DEV_TEXT), "opus");
    const ctx = await ready({ [DEV_US]: DEV_US_TEXT, [DEV]: old });
    await remember(ctx, DEV, old);

    const res = await post(ctx, "/catalog/plan");

    const { plan } = (await res.json()) as {
      plan: { files: { path: string; content: string }[] };
    };
    expect(plan.files.find((f) => f.path === DEV)?.content).toBe(
      withModel(DEV_TEXT, "opus"),
    );
  });
});

describe("decision 051 L: the prepare path keeps the model of an old copy", () => {
  it("given an old developer set to opus, when the repo is prepared, then the plan and the commit hold the new text with model: opus", async () => {
    const old = withModel(pastOf(DEV_TEXT), "opus");
    const ctx = await ready({ [DEV]: old });
    await remember(ctx, DEV, old);

    const planned = await post(ctx, "/prepare");
    const { plan } = (await planned.json()) as {
      plan: { files: { path: string; status: string; content: string }[] };
    };
    const file = plan.files.find((f) => f.path === DEV);
    expect(file?.status).toBe("update");
    expect(file?.content).toBe(withModel(DEV_TEXT, "opus"));

    const res = await post(ctx, "/prepare/apply", { plan });

    expect(res.status).toBe(200);
    const sha = ((await res.json()) as { commitSha: string }).commitSha;
    expect(ctx.git.filesAt(sha)?.[DEV]).toBe(withModel(DEV_TEXT, "opus"));
  });

  it("given an update file whose content is not the catalogue text with the repo's model line, when it is applied, then it answers 400", async () => {
    const old = withModel(pastOf(DEV_TEXT), "opus");
    const ctx = await ready({ [DEV]: old });
    await remember(ctx, DEV, old);
    const planned = await post(ctx, "/prepare");
    const { plan } = (await planned.json()) as {
      plan: { files: { path: string; content: string }[] };
    };
    for (const f of plan.files)
      if (f.path === DEV) f.content = `${f.content}\nsmuggled\n`;

    const res = await post(ctx, "/prepare/apply", { plan });

    expect(res.status).toBe(400);
  });
});

describe("decision 051 L: an old copy is recognised with any model line", () => {
  it("given a history entry whose model is not today's and a copy with a model the user chose, when the states are computed, then it is old", () => {
    const past = withModel(pastOf(DEV_TEXT), "haiku");

    const result = catalogStates({
      files: { [DEV_US]: DEV_US_TEXT, [DEV]: withModel(past, "opus") },
      history: { [DEV]: [sha256(past)] },
    });

    expect(result?.find((f) => f.path === DEV)?.state).toBe("old");
  });
});
