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

// Slice 4.1 (decisions 002, 004, 006): the « Jetons MCP » section of the Réglages page, for every user.

type Token = {
  id: number;
  name: string;
  lastFour: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};
type State = {
  tokens: Token[];
  /** What POST /api/me/tokens answers instead of creating. */
  createAnswer?: Response;
  /** What POST .../revoke answers instead of revoking. */
  revokeAnswer?: Response;
};
type Call = { method: string; path: string; body: string };

// 43 base64url characters after ckp_; the last four are « bcde ».
const SECRET = "ckp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde";
const token = (
  id: number,
  name: string,
  extra: Partial<Token> = {},
): Token => ({
  id,
  name,
  lastFour: "wxyz",
  createdAt: "2026-10-21T10:00:00.000Z",
  lastUsedAt: null,
  revokedAt: null,
  ...extra,
});

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

/** A small fake server behind fetch; the signed-in user is NOT an administrator, as the section is every user's. */
function stubApi(state: State) {
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
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      const path = new URL(raw, "http://localhost").pathname;
      const body =
        typeof init?.body === "string"
          ? init.body
          : input instanceof Request
            ? await input.clone().text()
            : "";
      calls.push({ method, path, body });

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
          installUrl: "https://github.com/apps/cockpit-test/installations/new",
        });
      if (path === "/api/settings/users")
        return Response.json({ error: "Forbidden" }, { status: 403 });
      if (path === "/api/me/tokens" && method === "GET")
        // Like the real route: a revoked token is not listed.
        return Response.json({
          tokens: state.tokens.filter((t) => !t.revokedAt),
        });
      if (path === "/api/me/tokens" && method === "POST") {
        if (state.createAnswer) return state.createAnswer;
        const { name } = JSON.parse(body) as { name: string };
        const created = token(
          Math.max(0, ...state.tokens.map((t) => t.id)) + 1,
          name,
          { lastFour: SECRET.slice(-4), createdAt: "2026-10-25T08:00:00.000Z" },
        );
        state.tokens = [created, ...state.tokens];
        return Response.json(
          { token: created, secret: SECRET },
          { status: 201 },
        );
      }
      const revoke = /^\/api\/me\/tokens\/(\d+)\/revoke$/.exec(path);
      if (revoke && method === "POST") {
        if (state.revokeAnswer) return state.revokeAnswer;
        state.tokens = state.tokens.map((t) =>
          t.id === Number(revoke[1])
            ? { ...t, revokedAt: "2026-10-25T09:00:00.000Z" }
            : t,
        );
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected fetch ${method} ${raw}`);
    }),
  );
  return calls;
}

const posts = (calls: Call[]) => calls.filter((c) => c.method === "POST");

const rowOf = (text: string) => {
  const row = screen.getByText(text).closest("li, tr");
  expect(row, `${text} must be inside a list item or a row`).not.toBeNull();
  return row as HTMLElement;
};

/** Where the secret is shown: a field's value, or text. */
const secretField = () =>
  screen.queryByDisplayValue(SECRET) ?? screen.queryByText(SECRET);

const DISMISS = /^(J'ai copié le jeton|Fermer)$/;

function stubClipboard() {
  const writeText = vi.fn(async (_text: string) => {});
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

/** Fills Nom and clicks Créer. */
async function createToken(name: string) {
  const form = await screen.findByRole("textbox", { name: "Nom" });
  fireEvent.change(form, { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: "Créer" }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "clipboard");
  window.history.replaceState({}, "", "/");
});

describe("Réglages page, the section Jetons MCP", () => {
  it("given a user, when /reglages loads, then there is a section Jetons MCP with the form Nouveau jeton (field Nom, button Créer) and a hint naming COCKPIT_MCP_TOKEN", async () => {
    stubApi({ tokens: [] });

    renderAt("/reglages");

    const heading = await screen.findByRole("heading", { name: "Jetons MCP" });
    const section = heading.closest("section") as HTMLElement;
    expect(section).not.toBeNull();
    expect(
      within(section).getByRole("heading", { name: "Nouveau jeton" }),
    ).toBeDefined();
    expect(within(section).getByRole("textbox", { name: "Nom" })).toBeDefined();
    expect(
      within(section).getByRole("button", { name: "Créer" }),
    ).toBeDefined();
    expect(section.textContent).toContain("COCKPIT_MCP_TOKEN");
  });

  it("given three tokens, when /reglages loads, then each row shows its name, … and the last four, the created date and Jamais utilisé or the last use date, with a Révoquer button", async () => {
    stubApi({
      tokens: [
        token(2, "utilisé-pro", {
          lastFour: "uuuu",
          createdAt: "2026-09-02T10:00:00.000Z",
          lastUsedAt: "2026-10-23T10:00:00.000Z",
        }),
        token(1, "neuf-portable", {
          lastFour: "nnnn",
          createdAt: "2026-10-21T10:00:00.000Z",
        }),
      ],
    });

    renderAt("/reglages");

    await screen.findByText("neuf-portable");
    const fresh = rowOf("neuf-portable");
    expect(fresh.textContent).toContain("…nnnn");
    expect(fresh.textContent).toContain(
      new Date("2026-10-21T10:00:00.000Z").toLocaleDateString("fr-FR"),
    );
    expect(within(fresh).getByText("Jamais utilisé")).toBeDefined();

    const used = rowOf("utilisé-pro");
    expect(used.textContent).toContain("…uuuu");
    expect(used.textContent).toContain(
      new Date("2026-09-02T10:00:00.000Z").toLocaleDateString("fr-FR"),
    );
    expect(used.textContent).toContain(
      new Date("2026-10-23T10:00:00.000Z").toLocaleDateString("fr-FR"),
    );
    expect(within(used).queryByText("Jamais utilisé")).toBeNull();
    expect(
      within(fresh).getByRole("button", { name: "Révoquer" }),
    ).toBeDefined();
    expect(
      within(used).getByRole("button", { name: "Révoquer" }),
    ).toBeDefined();
    expect(screen.queryByText("Révoqué")).toBeNull();
  });
});

describe("Réglages page, creating a token", () => {
  it("given a name, when Créer is clicked, then the name is posted to /api/me/tokens and the secret is shown once in a read-only field or code block, with a Copier button and the warning ne pourras plus le revoir", async () => {
    const calls = stubApi({ tokens: [] });
    renderAt("/reglages");

    await createToken("Mon Claude");

    await waitFor(() => expect(secretField()).not.toBeNull());
    const post = posts(calls).find((c) => c.path === "/api/me/tokens");
    expect(JSON.parse(post?.body ?? "null")).toEqual({ name: "Mon Claude" });
    const field = secretField() as HTMLElement;
    if (
      field instanceof HTMLInputElement ||
      field instanceof HTMLTextAreaElement
    )
      expect(field.readOnly).toBe(true);
    else expect(["CODE", "PRE", "SAMP", "OUTPUT"]).toContain(field.tagName);
    expect(screen.getByRole("button", { name: "Copier" })).toBeDefined();
    expect(document.body.textContent).toMatch(/ne pourras plus le revoir/);
    // The list is refetched: the new token is there under its name, with its last four.
    expect(await screen.findByText("Mon Claude")).toBeDefined();
    expect(rowOf("Mon Claude").textContent).toContain("…bcde");
  });

  it("given the secret is shown, when Copier is clicked, then the clipboard receives exactly the secret", async () => {
    stubApi({ tokens: [] });
    const writeText = stubClipboard();
    renderAt("/reglages");
    await createToken("Mon Claude");
    await waitFor(() => expect(secretField()).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Copier" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SECRET));
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it("given the secret is shown, when Copier is clicked, then a Copié. message is announced in a role=status element", async () => {
    stubApi({ tokens: [] });
    stubClipboard();
    renderAt("/reglages");
    await createToken("Mon Claude");
    await waitFor(() => expect(secretField()).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Copier" }));

    const status = await screen.findByText("Copié.");
    expect(status.closest("[role='status']")).not.toBeNull();
  });

  it("given the clipboard refuses the secret, when Copier is clicked, then a French message is announced in a role=status element, without the secret", async () => {
    stubApi({ tokens: [] });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(async () => Promise.reject(new Error("no"))) },
      configurable: true,
    });
    renderAt("/reglages");
    await createToken("Mon Claude");
    await waitFor(() => expect(secretField()).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Copier" }));

    const status = await screen.findByRole("status");
    await waitFor(() => expect(status.textContent?.trim()).not.toBe(""));
    expect(status.textContent).not.toContain("Copié.");
    expect(status.textContent).not.toContain(SECRET);
    // The secret stays on screen so it can be copied by hand.
    expect(secretField()).not.toBeNull();
  });

  it("given the secret is shown, when J'ai copié le jeton is clicked, then the secret, its warning and the Copier button leave the DOM entirely and the token stays in the list", async () => {
    stubApi({ tokens: [] });
    renderAt("/reglages");
    await createToken("Mon Claude");
    await waitFor(() => expect(secretField()).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: DISMISS }));

    await waitFor(() => expect(secretField()).toBeNull());
    expect(document.body.innerHTML).not.toContain(SECRET);
    expect(document.body.textContent).not.toContain(SECRET);
    expect(document.body.textContent).not.toMatch(/ne pourras plus le revoir/);
    expect(screen.queryByRole("button", { name: "Copier" })).toBeNull();
    expect(await screen.findByText("Mon Claude")).toBeDefined();
  });

  it("given a token was just created, when the page is loaded again, then the secret is nowhere, only the last four", async () => {
    stubApi({ tokens: [] });
    renderAt("/reglages");
    await createToken("Mon Claude");
    await waitFor(() => expect(secretField()).not.toBeNull());
    cleanup();

    renderAt("/reglages");

    await screen.findByText("Mon Claude");
    expect(secretField()).toBeNull();
    expect(document.body.innerHTML).not.toContain(SECRET);
    expect(rowOf("Mon Claude").textContent).toContain("…bcde");
  });

  it.each([
    ["Bad request", 400, /nom/i],
    ["too_many_tokens", 409, /20/],
    ["Internal Server Error", 500, /échoué|réessaie/i],
  ])(
    "given the server answers %s (%i), when Créer is clicked, then an alert explains it in French without the raw code and no secret is shown",
    async (code, status, french) => {
      stubApi({
        tokens: [],
        createAnswer: Response.json({ error: code }, { status }),
      });
      renderAt("/reglages");

      await createToken("Mon Claude");

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toMatch(french);
      expect(alert.textContent).not.toContain(code);
      expect(alert.textContent).not.toMatch(/\b(400|409|500)\b/);
      expect(secretField()).toBeNull();
      expect(screen.queryByRole("button", { name: "Copier" })).toBeNull();
    },
  );

  it("given the secret is shown, when J'ai copié le jeton is clicked, then the focus moves to the Nom field", async () => {
    stubApi({ tokens: [] });
    renderAt("/reglages");
    await createToken("Mon Claude");
    await waitFor(() => expect(secretField()).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: DISMISS }));

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("textbox", { name: "Nom" }),
      ),
    );
  });
});

describe("Réglages page, revoking a token", () => {
  it("given an active token, when Révoquer is clicked, then Confirmer la révocation and Annuler appear on the spot, the focus is on Annuler and nothing is sent", async () => {
    const calls = stubApi({
      tokens: [token(2, "portable"), token(1, "bureau")],
    });
    renderAt("/reglages");
    await screen.findByText("portable");

    fireEvent.click(
      within(rowOf("portable")).getByRole("button", { name: "Révoquer" }),
    );

    expect(
      await screen.findByRole("button", { name: "Confirmer la révocation" }),
    ).toBeDefined();
    expect(posts(calls)).toHaveLength(0);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Annuler" }),
    );
    // Only that token asks; the other keeps its Révoquer button.
    expect(
      within(rowOf("bureau")).getByRole("button", { name: "Révoquer" }),
    ).toBeDefined();
  });

  it("given the confirmation is shown, when Annuler is clicked, then it goes away, nothing is sent and the focus is back on Révoquer", async () => {
    const calls = stubApi({ tokens: [token(1, "portable")] });
    renderAt("/reglages");
    await screen.findByText("portable");
    fireEvent.click(screen.getByRole("button", { name: "Révoquer" }));

    fireEvent.click(await screen.findByRole("button", { name: "Annuler" }));

    expect(
      screen.queryByRole("button", { name: "Confirmer la révocation" }),
    ).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Révoquer" }),
    );
    expect(posts(calls)).toHaveLength(0);
  });

  it("given the confirmation is shown, when Confirmer la révocation is clicked, then the token is revoked on the server, leaves the list without any Révoqué marker and a Jeton révoqué. message is announced in a role=status element", async () => {
    const calls = stubApi({
      tokens: [token(2, "portable"), token(1, "bureau")],
    });
    renderAt("/reglages");
    await screen.findByText("portable");
    fireEvent.click(
      within(rowOf("portable")).getByRole("button", { name: "Révoquer" }),
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Confirmer la révocation" }),
    );

    await waitFor(() =>
      expect(
        posts(calls).some((c) => c.path === "/api/me/tokens/2/revoke"),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.queryByText("portable")).toBeNull());
    expect(screen.queryByText("Révoqué")).toBeNull();
    expect(rowOf("bureau")).toBeDefined();
    expect(
      within(rowOf("bureau")).getByRole("button", { name: "Révoquer" }),
    ).toBeDefined();
    expect(posts(calls)).toHaveLength(1);
    const status = await screen.findByText("Jeton révoqué.");
    expect(status.closest("[role='status']")).not.toBeNull();
  });

  it.each([
    ["already_revoked", 409, /déjà révoqué/i],
    ["Internal Server Error", 500, /échoué|réessaie/i],
  ])(
    "given the server answers %s (%i), when a revocation is confirmed, then an alert explains it in French, without the raw code",
    async (code, status, french) => {
      stubApi({
        tokens: [token(1, "portable")],
        revokeAnswer: Response.json({ error: code }, { status }),
      });
      renderAt("/reglages");
      await screen.findByText("portable");
      fireEvent.click(screen.getByRole("button", { name: "Révoquer" }));
      fireEvent.click(
        await screen.findByRole("button", { name: "Confirmer la révocation" }),
      );

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toMatch(french);
      expect(alert.textContent).not.toContain(code);
    },
  );

  it("given the confirmation is shown, when Confirmer la révocation succeeds, then the focus moves to the Jetons MCP section heading", async () => {
    stubApi({ tokens: [token(2, "portable"), token(1, "bureau")] });
    renderAt("/reglages");
    await screen.findByText("portable");
    fireEvent.click(
      within(rowOf("portable")).getByRole("button", { name: "Révoquer" }),
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Confirmer la révocation" }),
    );

    await waitFor(() => expect(screen.queryByText("portable")).toBeNull());
    // The buttons the focus was on are gone: it must not fall back to the page.
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Jetons MCP" }),
    );
  });

  it("given the server refuses the revocation, when Confirmer la révocation is clicked, then the focus is on the error alert", async () => {
    stubApi({
      tokens: [token(1, "portable")],
      revokeAnswer: Response.json(
        { error: "already_revoked" },
        { status: 409 },
      ),
    });
    renderAt("/reglages");
    await screen.findByText("portable");
    fireEvent.click(screen.getByRole("button", { name: "Révoquer" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirmer la révocation" }),
    );

    const alert = await screen.findByRole("alert");

    await waitFor(() => expect(document.activeElement).toBe(alert));
  });
});
