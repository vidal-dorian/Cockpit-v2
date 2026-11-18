// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { empty, PROJECT, stubHome } from "./test-home.tsx";
import { renderAt } from "./test-tickets.tsx";

// Slice 14.6, review findings: the planned night uses the server's order; a saved answer whose relaunch was refused says so.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const story = (storyId: number, outcome: string | null = null) => ({
  storyId,
  iWant: `faire la chose ${storyId}`,
  project: PROJECT,
  estimatedSeconds: null,
  outcome,
});

describe("review: /nuit on a planned night", () => {
  it("given an order moved in the evening and the night launched, when a story of the planned night is moved, then the PUT starts from the server's order", async () => {
    stubHome(empty());
    const home = globalThis.fetch;
    let posted = false;
    const puts: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const raw = typeof input === "string" ? input : (input as URL).href;
        const path = new URL(raw, "http://localhost").pathname;
        const method = (init?.method ?? "GET").toUpperCase();
        if (path === "/api/nights" && method === "POST") {
          posted = true;
          return Response.json({ id: 1 }, { status: 201 });
        }
        if (path === "/api/nights/current" && method === "PUT") {
          puts.push(JSON.parse(String(init?.body)));
          return Response.json({});
        }
        if (path === "/api/nights/current")
          return Response.json({
            night: posted
              ? {
                  id: 1,
                  status: "planned",
                  startsAt: "2026-11-08T22:00:00Z",
                  endsAt: "2026-11-09T07:00:00Z",
                  items: [story(3), story(1), story(2)],
                }
              : null,
            ready: posted ? [] : [story(1), story(2), story(3)],
            toValidate: [],
          });
        if (path === "/api/me/night-hours")
          return Response.json({ startHour: 22, endHour: 7, timeZone: "UTC" });
        if (path === "/api/me/launcher")
          return Response.json({
            connected: true,
            needsReconnect: false,
            prompt: "P",
            projectIds: [5],
            missingProjectIds: [],
            autoRelaunch: false,
          });
        return home(input, init);
      }),
    );
    renderAt("/nuit");
    const programme = (
      await screen.findByRole("heading", {
        level: 2,
        name: "Au programme",
      })
    ).closest("section") as HTMLElement;
    const rowOf = (n: number) =>
      within(programme)
        .getAllByRole("listitem")
        .find((li) =>
          li.textContent?.includes(`faire la chose ${n}`),
        ) as HTMLElement;
    const maybe = (
      await screen.findByRole("heading", {
        level: 2,
        name: "Pourrait s'ajouter",
      })
    ).closest("section") as HTMLElement;
    for (const n of [1, 2, 3]) {
      const li = await waitFor(() => {
        const found = within(maybe)
          .getAllByRole("listitem")
          .find((i) => i.textContent?.includes(`faire la chose ${n}`));
        expect(found).toBeDefined();
        return found as HTMLElement;
      });
      fireEvent.click(within(li).getByRole("button", { name: "Ajouter" }));
      await waitFor(() => expect(rowOf(n)).toBeDefined());
    }
    fireEvent.click(
      within(rowOf(1)).getByRole("button", { name: "Descendre" }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "☾ Lancer la nuit · 3 user stories",
      }),
    );
    await screen.findByRole("button", { name: "Annuler la nuit" });

    fireEvent.click(
      within(rowOf(3)).getByRole("button", { name: "Descendre" }),
    );

    await waitFor(() => expect(puts).toEqual([{ storyIds: [1, 3, 2] }]));
  });
});

describe("review: answering a paused question", () => {
  it("given an answer saved but a relaunch refused, when it is sent, then the page says the answer is saved and why the story was not relaunched", async () => {
    stubHome({
      ...empty(),
      forYou: [
        {
          kind: "answer",
          questionId: 7,
          question: "Quel nom ?",
          suggestedAnswers: ["Valider"],
          runId: 12,
          storyId: 21,
          iWant: "relire les exports",
          project: PROJECT,
        },
      ],
    });
    const inner = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
        String(
          typeof input === "string" ? input : (input as URL).href,
        ).includes("/answer")
          ? Response.json(
              { error: "launcher_needs_reconnect", answerSaved: true },
              { status: 409 },
            )
          : inner(input, init),
      ),
    );
    renderAt("/");

    fireEvent.click(await screen.findByRole("button", { name: /Valider/ }));

    expect(
      await screen.findByText(
        /Réponse enregistrée, mais l'US n'a pas pu être relancée : le lanceur est à reconnecter/,
      ),
    ).toBeDefined();
  });
});
