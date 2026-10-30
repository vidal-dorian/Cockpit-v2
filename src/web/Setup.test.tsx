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

const DETECTED = "https://cockpit.example.com";
const ACTION = "https://github.com/settings/apps/new?state=abc123";
const MANIFEST = { name: "Cockpit", url: DETECTED, public: true };

// The router lives inside App (browser router), so the tests set the URL like a browser would.
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

type Call = { method: string; path: string; body: string };

/** Stubs fetch by URL: the setup status and start, anything else is a 404 so the page cannot depend on it. */
function stubApi(options: { configured: boolean; start?: () => Response }) {
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
          configured: options.configured,
          detectedUrl: DETECTED,
        });
      if (path === "/api/setup/start" && method === "POST")
        return (
          options.start ??
          (() => Response.json({ error: "?" }, { status: 500 }))
        )();
      if (path === "/api/health")
        return Response.json({ status: "ok", version: "0.1.0" });
      if (path === "/api/me")
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      return Response.json({ error: "Not found" }, { status: 404 });
    }),
  );
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("start-up wizard", () => {
  it.each(["/", "/projets", "/journal", "/installation"])(
    "given the instance is not configured, when %s loads, then the wizard asks for the start code, the public address prefilled with the detected one, lists the permissions and offers to create the GitHub App",
    async (path) => {
      stubApi({ configured: false });

      renderAt(path);

      expect(
        await screen.findByRole("heading", { name: "Installer Cockpit" }),
      ).toBeDefined();
      expect(screen.getByLabelText("Code de démarrage")).toBeDefined();
      const address = screen.getByLabelText(
        "Adresse publique",
      ) as HTMLInputElement;
      expect(address.value).toBe(DETECTED);
      for (const permission of ["Contenu", "Issues", "Pull requests"])
        expect(screen.getByText(new RegExp(permission))).toBeDefined();
      expect(
        screen.getByRole("button", { name: "Créer l'App GitHub" }),
      ).toBeDefined();
    },
  );

  it("given a start code and an address, when the form is submitted and the server answers 200, then POST /api/setup/start carries them and a form is posted to GitHub with the manifest in a hidden field", async () => {
    const submit = vi
      .spyOn(HTMLFormElement.prototype, "submit")
      .mockImplementation(() => {});
    const calls = stubApi({
      configured: false,
      start: () => Response.json({ action: ACTION, manifest: MANIFEST }),
    });
    renderAt("/");
    fireEvent.change(await screen.findByLabelText("Code de démarrage"), {
      target: { value: "the-code" },
    });
    fireEvent.change(screen.getByLabelText("Adresse publique"), {
      target: { value: "https://cockpit.other.example" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Créer l'App GitHub" }));

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const start = calls.find((c) => c.path === "/api/setup/start");
    expect(start?.method).toBe("POST");
    expect(JSON.parse(start?.body ?? "{}")).toEqual({
      code: "the-code",
      publicUrl: "https://cockpit.other.example",
    });
    const form = submit.mock.contexts[0] as HTMLFormElement;
    expect(form.method.toLowerCase()).toBe("post");
    expect(form.getAttribute("action")).toBe(ACTION);
    const field = form.querySelector('input[name="manifest"]');
    expect(field?.getAttribute("type")).toBe("hidden");
    expect(JSON.parse((field as HTMLInputElement).value)).toEqual(MANIFEST);
  });

  it("given the server answers 403, when the form is submitted, then an alert says the start code is incorrect and nothing is posted to GitHub", async () => {
    const submit = vi
      .spyOn(HTMLFormElement.prototype, "submit")
      .mockImplementation(() => {});
    stubApi({
      configured: false,
      start: () => Response.json({ error: "Forbidden" }, { status: 403 }),
    });
    renderAt("/");
    fireEvent.change(await screen.findByLabelText("Code de démarrage"), {
      target: { value: "wrong" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Créer l'App GitHub" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Code de démarrage incorrect");
    expect(submit).not.toHaveBeenCalled();
  });

  it("given ?erreur=setup-echoue in the URL, when the wizard loads, then an alert says the creation failed and to try again", async () => {
    stubApi({ configured: false });

    renderAt("/installation?erreur=setup-echoue");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/échoué/i);
    expect(alert.textContent).toMatch(/réessaie|réessayer/i);
    expect(
      screen.getByRole("button", { name: "Créer l'App GitHub" }),
    ).toBeDefined();
  });

  it("given the instance is configured, when the page loads, then the normal app renders and not the wizard", async () => {
    stubApi({ configured: true });

    renderAt("/");

    expect(
      await screen.findByRole("heading", { name: "Cockpit" }),
    ).toBeDefined();
    expect(
      screen.queryByRole("heading", { name: "Installer Cockpit" }),
    ).toBeNull();
    expect(
      within(document.body).queryByRole("button", {
        name: "Créer l'App GitHub",
      }),
    ).toBeNull();
  });
});

// Decision 023 B: the wizard shows the sentence of the server, not a generic one.
describe("start-up wizard, refused address", () => {
  const submitWith400 = async (body: unknown) => {
    const submit = vi
      .spyOn(HTMLFormElement.prototype, "submit")
      .mockImplementation(() => {});
    stubApi({
      configured: false,
      start: () => Response.json(body, { status: 400 }),
    });
    renderAt("/");
    fireEvent.change(await screen.findByLabelText("Code de démarrage"), {
      target: { value: "the-code" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Créer l'App GitHub" }));
    return { alert: await screen.findByRole("alert"), submit };
  };

  it("given the server answers 400 that the address must start with https://, when the form is submitted, then the alert shows that exact message and nothing is posted to GitHub", async () => {
    const message =
      "L'adresse publique doit commencer par https:// : claude.ai l'exige.";

    const { alert, submit } = await submitWith400({ error: message });

    expect(alert.textContent).toContain(message);
    expect(submit).not.toHaveBeenCalled();
  });

  it("given the server answers 400 with another error, when the form is submitted, then the alert shows a French message about the address", async () => {
    const { alert } = await submitWith400({
      error: "Adresse publique invalide",
    });

    expect(alert.textContent).toMatch(/adresse publique/i);
  });
});
