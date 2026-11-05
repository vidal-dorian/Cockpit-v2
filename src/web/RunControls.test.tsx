// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderAt } from "./test-tickets.tsx";

// Slice 7.5 (decision 037 F): the controls of the page of a run. Pinned: GET /api/runs/:id also gives
// run.stopRequestedAt (ISO string | null) and story.status; the page POSTs /api/runs/12/stop and /api/runs/12/close
// (no body) and refetches the run. The stub below answers the refetch with the state the POST would have made.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const STOP = "Arrêt demandé : Claude s'arrêtera à la prochaine étape.";

function stubApi(
  options: {
    status?: string;
    stopRequestedAt?: string | null;
    storyStatus?: string;
    fail?: { status: number; error: string };
  } = {},
) {
  const state = {
    status: options.status ?? "running",
    stopRequestedAt: options.stopRequestedAt ?? null,
  };
  const posts: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const path = new URL(raw, "http://localhost").pathname;
      if (path === "/api/setup/status")
        return Response.json({
          configured: true,
          detectedUrl: "http://localhost",
        });
      if (path === "/api/me")
        return Response.json({ login: "octocat", name: null, avatarUrl: null });
      if (path === "/api/runs/12" && (init?.method ?? "GET") === "GET")
        return Response.json({
          run: {
            id: 12,
            status: state.status,
            branch: "us/42-login",
            model: "claude-x",
            comment: null,
            summary: null,
            startedAt: "2026-11-05T10:00:00.000Z",
            finishedAt:
              state.status === "running" ? null : "2026-11-05T11:00:00.000Z",
            stopRequestedAt: state.stopRequestedAt,
          },
          steps: [],
          story: {
            id: 21,
            iWant: "relire les exports",
            status: options.storyStatus ?? "in_progress",
          },
          project: { id: 5, name: "octocat/hello" },
          criteria: [],
          questions: [],
        });
      if (
        init?.method === "POST" &&
        /^\/api\/runs\/12\/(stop|close)$/.test(path)
      ) {
        posts.push(path);
        if (options.fail)
          return Response.json(
            { error: options.fail.error },
            { status: options.fail.status },
          );
        if (path.endsWith("/stop"))
          state.stopRequestedAt = "2026-11-05T10:30:00.000Z";
        else state.status = "closed_manually";
        return Response.json({ run: { id: 12 } });
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    }),
  );
  return { posts };
}

const main = () => screen.getByRole("main");
const loaded = () =>
  waitFor(() => expect(main().textContent).toContain("Run n° 12"));
const button = (name: string) => within(main()).queryByRole("button", { name });

describe("criterion 7: the controls of a running run", () => {
  it("given a running run, when I click « Demander l'arrêt », then POST /api/runs/12/stop is sent and « Arrêt demandé : Claude s'arrêtera à la prochaine étape. » is shown", async () => {
    const api = stubApi();
    renderAt("/runs/12");
    await loaded();
    expect(main().textContent).not.toContain(STOP);

    fireEvent.click(
      await screen.findByRole("button", { name: "Demander l'arrêt" }),
    );

    await waitFor(() => expect(api.posts).toEqual(["/api/runs/12/stop"]));
    await waitFor(() => expect(main().textContent).toContain(STOP));
  });

  it("given a running run that already has a stop requested, when it loads, then the sentence is shown and « Demander l'arrêt » is not", async () => {
    stubApi({ stopRequestedAt: "2026-11-05T10:30:00.000Z" });
    renderAt("/runs/12");
    await loaded();

    await waitFor(() => expect(main().textContent).toContain(STOP));
    expect(button("Demander l'arrêt")).toBeNull();
  });

  it("given a running run, when I click « Fermer le run », then the confirmation « Confirmer la fermeture » and a sentence saying Claude can no longer report are shown and nothing is sent", async () => {
    const api = stubApi();
    renderAt("/runs/12");
    await loaded();

    fireEvent.click(
      await screen.findByRole("button", { name: "Fermer le run" }),
    );

    expect(
      await screen.findByRole("button", { name: "Confirmer la fermeture" }),
    ).toBeDefined();
    expect(main().textContent).toMatch(/Claude ne pourra plus/);
    expect(api.posts).toEqual([]);
  });

  it("given the confirmation, when I click « Confirmer la fermeture », then POST /api/runs/12/close is sent and the page reloads the run", async () => {
    const api = stubApi();
    renderAt("/runs/12");
    await loaded();
    fireEvent.click(
      await screen.findByRole("button", { name: "Fermer le run" }),
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Confirmer la fermeture" }),
    );

    await waitFor(() => expect(api.posts).toEqual(["/api/runs/12/close"]));
    await waitFor(() =>
      expect(main().textContent).toContain("Fermé à la main"),
    );
    expect(button("Fermer le run")).toBeNull();
    expect(button("Demander l'arrêt")).toBeNull();
  });

  it("given a refusal 409 run_finished, when I stop, then a French role=alert is shown, never the code", async () => {
    stubApi({ fail: { status: 409, error: "run_finished" } });
    renderAt("/runs/12");
    await loaded();

    fireEvent.click(
      await screen.findByRole("button", { name: "Demander l'arrêt" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("run_finished");
    expect(alert.textContent?.length).toBeGreaterThan(0);
  });
});

describe("criterion 7: a finished run", () => {
  it.each(["succeeded", "failed", "stopped", "closed_manually"])(
    "given a %s run, when it loads, then there is neither « Demander l'arrêt » nor « Fermer le run »",
    async (status) => {
      stubApi({ status, storyStatus: "ready" });
      renderAt("/runs/12");
      await loaded();

      // The finished run offers « Relancer » instead (which is what fails today).
      await within(main()).findByRole("link", { name: "Relancer" });
      expect(button("Demander l'arrêt")).toBeNull();
      expect(button("Fermer le run")).toBeNull();
    },
  );

  it.each(["ready", "in_review"])(
    "given a finished run whose story is %s, when it loads, then a link « Relancer » points to /us/21",
    async (storyStatus) => {
      stubApi({ status: "failed", storyStatus });
      renderAt("/runs/12");
      await loaded();

      const link = await within(main()).findByRole("link", {
        name: "Relancer",
      });
      expect(link.getAttribute("href")).toBe("/us/21");
    },
  );

  it.each(["in_progress", "done", "abandoned", "to_validate"])(
    "given a finished run whose story is %s, when it loads, then there is no « Relancer » link",
    async (storyStatus) => {
      stubApi({ status: "failed", storyStatus });
      renderAt("/runs/12");
      await loaded();

      expect(
        within(main()).queryByRole("link", { name: "Relancer" }),
      ).toBeNull();
    },
  );

  it("given a running run, when it loads, then there is no « Relancer » link", async () => {
    stubApi({ storyStatus: "ready" });
    renderAt("/runs/12");
    await loaded();

    expect(within(main()).queryByRole("link", { name: "Relancer" })).toBeNull();
  });
});
