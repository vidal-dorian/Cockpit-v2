import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import { App } from "./App.tsx";

// Shared by the web tests of slice 13.2 (decision 077, screen S49 as amended by F and G). The contract with the server is the one of
// src/server/test-plans.ts (GET /api/me/plan, POST /api/me/pro-code, GET and POST /api/settings/pro-codes, PATCH /api/settings/pro-codes/:id,
// POST /api/settings/pro-codes/:id/revoke; GET /api/projects says `lockedBy` and `ownerPlan`). Pinned labels:
// - Réglages menu entry « Abonnement » (/reglages/abonnement), after « Membres ». The state sentence is the heading; the cards are three sections named
//   « Gratuit », « Pro », « Entreprise » (headings); buttons « Passer à Pro » and « Nous contacter » show the sentence of G in a `status` or `alert` region.
//   Under the cards a section « J'ai un code Pro » with a textbox « Code Pro » and a button « Activer »; a refused code reads « Ce code n'est pas valable. ».
// - Instance (/reglages/utilisateurs, administrator) gets a section « Codes Pro »: a textbox « Note » (80 characters at most), a select « Durée »
//   (« sans fin » by default, « jusqu'au ») which shows a date field « Date de fin », a button « Générer un code »; the secret is shown once with « Copier ».
//   A row of the list holds the note, the state (« libre », « utilisé », « expiré », « révoqué »), « @login » when used; a free or used code has « Révoquer »
//   then « Confirmer la révocation »; a used code has « Modifier la durée » (select « Durée », field « Date de fin », « Enregistrer »). The body sent carries
//   `until: null` for « sans fin », else an ISO instant that starts with the date chosen.
// - A project with `lockedBy: "<login>"` shows « Ce projet est en lecture seule : l'abonnement Gratuit de @<login> couvre 3 projets. » on its pages.
//   The window « Analyser avec Claude » of a project whose `ownerPlan` is "free" says « La reprise fait partie de l'offre Pro. » with a link « Abonnement »
//   (/reglages/abonnement) and no « Ouvrir Claude »; a project that does not say `ownerPlan`, or says "pro", keeps the window as it is.

export type Plan = {
  plan: "free" | "pro";
  via: "admin" | "code" | null;
  until: string | null;
  repos: number;
  limit: number | null;
  teamLimit: number | null;
};
export type Code = {
  id: number;
  note: string;
  state: "free" | "used" | "expired" | "revoked";
  until: string | null;
  createdAt: string;
  expiresAt: string;
  login: string | null;
};
export type Call = { method: string; path: string; body: unknown };

export const FREE: Plan = {
  plan: "free",
  via: null,
  until: null,
  repos: 2,
  limit: 3,
  teamLimit: 2,
};
export const PRO: Plan = {
  ...FREE,
  plan: "pro",
  via: "code",
  limit: null,
  teamLimit: null,
};

export const code = (id: number, over: Partial<Code> = {}): Code => ({
  id,
  note: `pour la personne ${id}`,
  state: "free",
  until: null,
  createdAt: "2026-11-01T10:00:00.000Z",
  expiresAt: "2026-12-01T10:00:00.000Z",
  login: null,
  ...over,
});

export function renderAt(path: string) {
  window.history.replaceState({}, "", path);
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <App />
    </QueryClientProvider>,
  );
}

/** A fake server behind fetch for the Réglages pages; `state.plan` changes when a code is accepted, `answers` overrides `"METHOD /path"`. */
export function stubPlans(state: {
  plan: Plan;
  isAdmin?: boolean;
  codes?: Code[];
  answers?: Record<string, Response>;
  /** The plan a good code gives. */
  givenPlan?: Plan;
}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      const path = new URL(raw, "http://localhost").pathname;
      const text = typeof init?.body === "string" ? init.body : "";
      calls.push({ method, path, body: text ? JSON.parse(text) : undefined });
      const answer = state.answers?.[`${method} ${path}`];
      if (answer) return answer;
      if (path === "/api/setup/status")
        return Response.json({
          configured: true,
          hasAdmin: true,
          detectedUrl: "http://localhost",
        });
      if (path === "/api/health")
        return Response.json({ status: "ok", version: "0.1.0" });
      if (path === "/api/me")
        return Response.json({
          login: "dorian",
          name: "Dorian",
          avatarUrl: null,
          isAdmin: state.isAdmin === true,
        });
      if (path === "/api/installation")
        return Response.json({ installed: true, installUrl: "https://x" });
      if (path === "/api/me/plan") return Response.json(state.plan);
      if (path === "/api/me/pro-code" && method === "POST") {
        if (state.givenPlan) {
          state.plan = state.givenPlan;
          return Response.json(state.plan);
        }
        return Response.json({ error: "invalid_code" }, { status: 400 });
      }
      if (path === "/api/settings/users") return Response.json({ users: [] });
      if (path === "/api/settings/pro-codes" && method === "GET")
        return Response.json({ codes: state.codes ?? [] });
      if (path === "/api/settings/pro-codes" && method === "POST")
        return Response.json(
          { code: code(9, { note: "pour Karim" }), secret: "SECRET-CODE-0123" },
          { status: 201 },
        );
      if (path.startsWith("/api/settings/pro-codes/"))
        return Response.json({ code: code(1) });
      throw new Error(`Unexpected fetch ${method} ${raw}`);
    }),
  );
  return calls;
}

/** Adds fields to every project of GET /api/projects of the fetch fake already stubbed. */
export function patchProjects(fields: Record<string, unknown>) {
  const inner = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const res = await inner(input, init);
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const path = new URL(raw, "http://localhost").pathname;
      if (path !== "/api/projects" || (init?.method ?? "GET") !== "GET")
        return res;
      const body = await res.json();
      return Response.json({
        projects: body.projects.map((p: object) => ({ ...p, ...fields })),
      });
    }),
  );
}
