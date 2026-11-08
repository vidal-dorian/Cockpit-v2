// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderAt, story, stubTicketApi, ticket } from "./test-tickets.tsx";

// Slice 14.3 (decision 057 F): « Mettre en file » next to « Lancer dans le cloud », in the cloud target of « Développer avec Claude ».
// It POSTs /api/queue { storyId } and the panel says « Mis en file ». Same fakes as DevelopCloud.test.tsx (launcher connected, project 5 ticked).

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("criterion 6: the window queues a story", () => {
  it("given the cloud target, when « Mettre en file » is clicked, then POST /api/queue { storyId: 42 } is sent and the panel says it was queued", async () => {
    stubTicketApi(
      [ticket(7, "Idée")],
      [story(42, 7, "Me connecter", { status: "ready" })],
    );
    const inner = globalThis.fetch;
    const posts: { path: string; body: unknown }[] = [];
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
        const method = (init?.method ?? "GET").toUpperCase();
        if (path === "/api/stories/42" && method === "GET") {
          const body = await (await inner(input, init)).json();
          body.story.branch = null;
          body.project.archived = false;
          return Response.json(body);
        }
        if (path === "/api/projects/5/branches")
          return Response.json({ branches: ["main"] });
        if (path === "/api/projects/5/agents")
          return Response.json({
            agents: [],
            catalog: [],
            team: null,
            teams: [],
          });
        if (path === "/api/me/launcher")
          return Response.json({
            prompt: "p",
            connected: true,
            needsReconnect: false,
            projectIds: [5],
          });
        if (path === "/api/queue" && method === "POST") {
          posts.push({ path, body: JSON.parse(String(init?.body)) });
          return Response.json({}, { status: 201 });
        }
        return inner(input, init);
      }),
    );
    renderAt("/us/42");
    await waitFor(() =>
      expect(screen.getByRole("main").textContent).toContain("Me connecter"),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Développer avec Claude" }),
    );
    const ui = within(
      await screen.findByRole("complementary", {
        name: "Développer avec Claude",
      }),
    );
    await ui.findByRole("radio", { name: /Dans le cloud/ });

    fireEvent.click(ui.getByRole("button", { name: "Mettre en file" }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]?.body).toEqual({ storyId: 42 });
    expect(await ui.findByText(/Mis en file/)).toBeDefined();
  });
});
