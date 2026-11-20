import { describe, expect, it } from "vitest";
import { send } from "./test-decisions.ts";
import { seedProject, userWithToken, withProject } from "./test-mcp.ts";

// Slice 15.3 (decision 073 H, F): the favourite projects and the theme.
//
// Pinned choices (the decision leaves them open):
// - PUT /api/projects/:id/favorite { favorite: boolean } answers 200 { favorite }; a project that is not the caller's: 404 { error: "Not found" }; no session: 401;
//   a body without a boolean `favorite`: 400.
// - The flag is read as `favorite: boolean` on each project of GET /api/projects (the Projects page) and of GET /api/home `projects`
//   (the sidebar lists from /api/home, and an idle favourite must show there).
// - PUT /api/me/theme { theme: "dark" | "light" | "system" } answers 200 { theme }; GET /api/me gives `theme` ("dark" by default).
//   Anything else: 400; no session: 401.
// - A project has one member only (decision 008), so « another member does not see it » is tested with another user's own project.

type Ctx = Awaited<ReturnType<typeof withProject>>;
const projectsOf = async (ctx: Ctx, cookie: string) =>
  (
    (await (await send(ctx.app, cookie, "GET", "/api/projects")).json()) as {
      projects: { id: number; favorite: boolean }[];
    }
  ).projects;
const homeOf = async (ctx: Ctx, cookie: string) =>
  (
    (await (await send(ctx.app, cookie, "GET", "/api/home")).json()) as {
      projects: { id: number; favorite: boolean }[];
    }
  ).projects;

describe("slice 15.3 H: favourite projects", () => {
  it("given a project, when the user marks it a favourite, then /api/projects and /api/home show it, and un-marking removes it", async () => {
    const ctx = await withProject();
    const { alice, projectId } = ctx;
    expect((await projectsOf(ctx, alice.cookie))[0]?.favorite).toBe(false);

    const put = await send(
      ctx.app,
      alice.cookie,
      "PUT",
      `/api/projects/${projectId}/favorite`,
      { favorite: true },
    );

    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ favorite: true });
    expect((await projectsOf(ctx, alice.cookie))[0]?.favorite).toBe(true);
    expect((await homeOf(ctx, alice.cookie))[0]?.favorite).toBe(true);
    await send(
      ctx.app,
      alice.cookie,
      "PUT",
      `/api/projects/${projectId}/favorite`,
      { favorite: false },
    );
    expect((await projectsOf(ctx, alice.cookie))[0]?.favorite).toBe(false);
  });

  it("given two users, when one marks a favourite, then the other does not see it and cannot mark the first one's project (404)", async () => {
    const ctx = await withProject();
    const bob = await userWithToken(ctx.app, ctx.db, 2000);
    const bobProject = await seedProject(ctx.db, bob.id, {
      githubRepoId: 2,
      fullName: "user2000/app",
    });
    await send(
      ctx.app,
      ctx.alice.cookie,
      "PUT",
      `/api/projects/${ctx.projectId}/favorite`,
      { favorite: true },
    );

    const stranger = await send(
      ctx.app,
      bob.cookie,
      "PUT",
      `/api/projects/${ctx.projectId}/favorite`,
      { favorite: true },
    );

    expect(stranger.status).toBe(404);
    expect(await projectsOf(ctx, bob.cookie)).toEqual([
      expect.objectContaining({ id: bobProject, favorite: false }),
    ]);
    expect((await projectsOf(ctx, ctx.alice.cookie))[0]?.favorite).toBe(true);
  });

  it("given a bad body or no session, when the favourite route is called, then 400 and 401", async () => {
    const ctx = await withProject();
    const path = `/api/projects/${ctx.projectId}/favorite`;

    expect(
      (await send(ctx.app, ctx.alice.cookie, "PUT", path, { favorite: "yes" }))
        .status,
    ).toBe(400);
    expect(
      (await send(ctx.app, "", "PUT", path, { favorite: true })).status,
    ).toBe(401);
  });
});

describe("slice 15.3 F: the theme", () => {
  it("given a new user, when /api/me is read, then the theme is dark; after PUT light or system it is that, on every read", async () => {
    const ctx = await withProject();
    const me = async () =>
      (await (
        await send(ctx.app, ctx.alice.cookie, "GET", "/api/me")
      ).json()) as {
        theme: string;
      };
    expect((await me()).theme).toBe("dark");

    for (const theme of ["light", "system", "dark"]) {
      const put = await send(
        ctx.app,
        ctx.alice.cookie,
        "PUT",
        "/api/me/theme",
        {
          theme,
        },
      );
      expect(put.status, theme).toBe(200);
      expect(await put.json()).toEqual({ theme });
      expect((await me()).theme).toBe(theme);
    }
  });

  it("given an invalid theme or no session, when PUT /api/me/theme is called, then 400 and 401, and the theme does not change", async () => {
    const ctx = await withProject();

    for (const body of [{ theme: "blue" }, {}, { theme: 1 }])
      expect(
        (await send(ctx.app, ctx.alice.cookie, "PUT", "/api/me/theme", body))
          .status,
      ).toBe(400);
    expect(
      (await send(ctx.app, "", "PUT", "/api/me/theme", { theme: "light" }))
        .status,
    ).toBe(401);
    const me = (await (
      await send(ctx.app, ctx.alice.cookie, "GET", "/api/me")
    ).json()) as { theme: string };
    expect(me.theme).toBe("dark");
  });
});

describe("story 50: the single-key shortcuts switch", () => {
  it("given a new user, when PUT /api/me/single-key-shortcuts is called, then /api/me tells it on every read; an invalid body is a 400 and no session a 401", async () => {
    const ctx = await withProject();
    const me = async () =>
      (await (
        await send(ctx.app, ctx.alice.cookie, "GET", "/api/me")
      ).json()) as { singleKeyShortcutsOff: boolean };
    expect((await me()).singleKeyShortcutsOff).toBe(false);

    const put = (cookie: string, body: unknown) =>
      send(ctx.app, cookie, "PUT", "/api/me/single-key-shortcuts", body);
    expect((await put(ctx.alice.cookie, { off: true })).status).toBe(200);
    expect((await me()).singleKeyShortcutsOff).toBe(true);
    expect((await put(ctx.alice.cookie, { off: "yes" })).status).toBe(400);
    expect((await put("", { off: false })).status).toBe(401);
    expect((await me()).singleKeyShortcutsOff).toBe(true);
  });
});
