// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";

// Slice 13.1 (decision 076 D, F; screen S48): Réglages › Membres at /reglages/membres. The contract with the server is the one of
// src/server/test-members.ts (GET /api/members, POST /api/projects/:id/invitations, POST /api/invitations/:id/renew,
// DELETE /api/invitations/:id, PATCH and DELETE /api/projects/:id/members/:userId). Pinned labels: the menu entry « Membres »,
// a field « @login GitHub », one button per project (named by its full name, aria-pressed on the chosen one), a select « Rôle »
// (« lecture seule », « peut valider » by default, « peut valider et lancer »), « Créer le lien d'invitation », then the link
// shown with « Copier »; rows have « Modifier » (a select « Rôle » and « Enregistrer », or « Retirer » then « Confirmer le retrait »),
// « Nouveau lien » and « Annuler » (invitations).

type Members = {
  me: { login: string; name: string | null; projects: number };
  projects: { id: number; fullName: string }[];
  members: {
    userId: number;
    login: string;
    name: string | null;
    projectId: number;
    projectName: string;
    role: string;
    lastLoginAt: string | null;
  }[];
  invitations: {
    id: number;
    login: string;
    projectId: number;
    projectName: string;
    role: string;
    createdAt: string;
  }[];
};
type Call = { method: string; path: string; body: unknown };

const LINK =
  "https://cockpit.example.com/invitations/s3cr3t-link-value-0123456789";
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const data = (over: Partial<Members> = {}): Members => ({
  me: { login: "dorian", name: "Dorian", projects: 2 },
  projects: [
    { id: 1, fullName: "acme/gestion" },
    { id: 2, fullName: "acme/api" },
  ],
  members: [
    {
      userId: 10,
      login: "marie",
      name: "Marie L.",
      projectId: 1,
      projectName: "acme/gestion",
      role: "can_launch",
      lastLoginAt: ago(3_600_000 + 60_000),
    },
    {
      userId: 11,
      login: "karim",
      name: "Karim B.",
      projectId: 2,
      projectName: "acme/api",
      role: "read_only",
      lastLoginAt: null,
    },
  ],
  invitations: [
    {
      id: 5,
      login: "paul",
      projectId: 1,
      projectName: "acme/gestion",
      role: "can_validate",
      createdAt: ago(2 * 86_400_000 + 60_000),
    },
  ],
  ...over,
});

function stubApi(state: {
  members: Members;
  answers?: Record<string, Response>;
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
          detectedUrl: "http://localhost",
        });
      if (path === "/api/health")
        return Response.json({ status: "ok", version: "0.1.0" });
      if (path === "/api/me")
        return Response.json({
          login: "dorian",
          name: "Dorian",
          avatarUrl: null,
          isAdmin: false,
        });
      if (path === "/api/installation")
        return Response.json({
          installed: true,
          installUrl: "https://github.com/x",
        });
      if (path === "/api/members" && method === "GET")
        return Response.json(state.members);
      if (method === "POST" && /^\/api\/projects\/\d+\/invitations$/.test(path))
        return Response.json(
          {
            invitation: { id: 9, expiresAt: "2026-11-16T00:00:00.000Z" },
            url: LINK,
          },
          { status: 201 },
        );
      if (method === "POST" && /^\/api\/invitations\/\d+\/renew$/.test(path))
        return Response.json({ url: LINK });
      if (path.startsWith("/api/invitations/") || path.includes("/members/"))
        return Response.json({ ok: true });
      throw new Error(`Unexpected fetch ${method} ${raw}`);
    }),
  );
  return calls;
}

function renderAt(path: string) {
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "clipboard");
  window.history.replaceState({}, "", "/");
});

const rowOf = (text: string) => {
  const row = screen.getByText(text, { exact: false }).closest("li, tr");
  expect(row, `${text} must be inside a list item or a row`).not.toBeNull();
  return row as HTMLElement;
};
const bodies = (calls: Call[], method: string, re: RegExp) =>
  calls
    .filter((c) => c.method === method && re.test(c.path))
    .map((c) => c.body);

describe("S48, 076 F: the state sentence and the list", () => {
  it("given two people on shared projects, when /reglages/membres loads, then the menu has Membres and the sentence says « 2 personnes voient tes projets partagés. »", async () => {
    stubApi({ members: data() });

    renderAt("/reglages/membres");

    await screen.findByText("2 personnes voient tes projets partagés.");
    expect(
      screen.getByText("Chacune ne voit que ce que tu lui partages."),
    ).toBeDefined();
    expect(
      within(screen.getByRole("navigation", { name: "Réglages" })).getByRole(
        "link",
        { name: "Membres" },
      ),
    ).toBeDefined();
  });

  it("given nobody on the projects, when the page loads, then « Personne ne voit tes projets. » and « Invite quelqu'un sur un de tes projets. »", async () => {
    stubApi({ members: data({ members: [], invitations: [] }) });

    renderAt("/reglages/membres");

    await screen.findByText("Personne ne voit tes projets.");
    expect(
      screen.getByText("Invite quelqu'un sur un de tes projets."),
    ).toBeDefined();
  });

  it("given members and an invitation, when the page loads, then the owner comes first, then one line per member and project, then the pending invitation", async () => {
    stubApi({ members: data() });

    renderAt("/reglages/membres");

    await screen.findByText("Marie L.");
    const lines = screen
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "");
    const mine = lines.findIndex(
      (t) => t.includes("Dorian") && t.includes("toi"),
    );
    const marie = lines.findIndex((t) => t.includes("Marie L."));
    const karim = lines.findIndex((t) => t.includes("Karim B."));
    const paul = lines.findIndex((t) => t.includes("@paul"));
    expect(mine).toBeGreaterThanOrEqual(0);
    expect([mine, marie, karim, paul]).toEqual(
      [mine, marie, karim, paul].slice().sort((a, b) => a - b),
    );
    expect(lines[mine]).toContain("propriétaire · 2 projets");
    expect(rowOf("Marie L.").textContent).toContain(
      "acme/gestion · peut valider et lancer · actif il y a 1 h",
    );
    expect(rowOf("Karim B.").textContent).toContain("acme/api · lecture seule");
    expect(rowOf("@paul").textContent).toContain(
      "acme/gestion · invitation créée il y a 2 j",
    );
  });
});

describe("S48, 076 D: inviting", () => {
  it("given two projects, when the owner types @marie, picks the second project and a role and submits, then the invitation is posted for that project with the login without its @, and the link is shown once with Copier", async () => {
    const calls = stubApi({ members: data({ members: [], invitations: [] }) });
    const writeText = vi.fn(async (_t: string) => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    renderAt("/reglages/membres");

    fireEvent.change(
      await screen.findByRole("textbox", { name: "@login GitHub" }),
      {
        target: { value: "@marie" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "acme/api" }));
    expect(
      screen
        .getByRole("button", { name: "acme/api" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "acme/gestion" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      (screen.getByRole("combobox", { name: "Rôle" }) as HTMLSelectElement)
        .value,
    ).toBe("can_validate");
    fireEvent.change(screen.getByRole("combobox", { name: "Rôle" }), {
      target: { value: "can_launch" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Créer le lien d'invitation" }),
    );

    await screen.findByText(LINK);
    expect(bodies(calls, "POST", /^\/api\/projects\/2\/invitations$/)).toEqual([
      { login: "marie", role: "can_launch" },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Copier" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LINK));
  });

  it.each([
    ["unknown_login", 404, /fantome/],
    ["already_member", 409, /déjà membre/],
    ["already_invited", 409, /déjà invité/],
    ["self", 409, /toi/],
  ])(
    "given the server answering %s, when the owner submits, then a French alert says why and no link is shown",
    async (error, status, text) => {
      stubApi({
        members: data({ members: [], invitations: [] }),
        answers: {
          "POST /api/projects/1/invitations": Response.json(
            { error },
            { status },
          ),
        },
      });
      renderAt("/reglages/membres");

      fireEvent.change(
        await screen.findByRole("textbox", { name: "@login GitHub" }),
        {
          target: { value: "fantome" },
        },
      );
      fireEvent.click(screen.getByRole("button", { name: "acme/gestion" }));
      fireEvent.click(
        screen.getByRole("button", { name: "Créer le lien d'invitation" }),
      );

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toMatch(text);
      expect(screen.queryByText(LINK)).toBeNull();
    },
  );
});

describe("S48, 076 F: managing members and invitations", () => {
  it("given Marie, when the owner opens Modifier, picks lecture seule and saves, then the role is patched on that project and member", async () => {
    const calls = stubApi({ members: data() });
    renderAt("/reglages/membres");
    await screen.findByText("Marie L.");

    fireEvent.click(
      within(rowOf("Marie L.")).getByRole("button", { name: "Modifier" }),
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Rôle" }), {
      target: { value: "read_only" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(
        bodies(calls, "PATCH", /^\/api\/projects\/1\/members\/10$/),
      ).toEqual([{ role: "read_only" }]),
    );
  });

  it("given Marie, when the owner chooses Retirer, then nothing is sent until she confirms", async () => {
    const calls = stubApi({ members: data() });
    renderAt("/reglages/membres");
    await screen.findByText("Marie L.");

    fireEvent.click(
      within(rowOf("Marie L.")).getByRole("button", { name: "Modifier" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Retirer" }));
    expect(calls.filter((c) => c.method === "DELETE")).toEqual([]);
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmer le retrait" }),
    );

    await waitFor(() =>
      expect(
        calls.filter((c) => c.method === "DELETE").map((c) => c.path),
      ).toEqual(["/api/projects/1/members/10"]),
    );
  });

  it("given Paul's pending invitation, when the owner clicks Nouveau lien, then the invitation is renewed and the new link is shown once", async () => {
    const calls = stubApi({ members: data() });
    renderAt("/reglages/membres");
    await screen.findByText("@paul", { exact: false });

    fireEvent.click(
      within(rowOf("@paul")).getByRole("button", { name: "Nouveau lien" }),
    );

    await screen.findByText(LINK);
    expect(
      calls.filter(
        (c) => c.method === "POST" && c.path === "/api/invitations/5/renew",
      ),
    ).toHaveLength(1);
  });

  it("given Paul's pending invitation, when the owner clicks Annuler, then it is deleted", async () => {
    const calls = stubApi({ members: data() });
    renderAt("/reglages/membres");
    await screen.findByText("@paul", { exact: false });

    fireEvent.click(
      within(rowOf("@paul")).getByRole("button", { name: "Annuler" }),
    );

    await waitFor(() =>
      expect(
        calls.filter((c) => c.method === "DELETE").map((c) => c.path),
      ).toEqual(["/api/invitations/5"]),
    );
  });
});
