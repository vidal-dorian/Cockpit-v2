// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Decision 083 (US 4 and US 6): the page sends screens and crashes to PostHog through src/web/telemetry.ts only.
// posthog-js is replaced, so nothing calls PostHog. Each test loads the app on fresh modules, because the telemetry module keeps what init gave it.
const ph = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  captureException: vi.fn(),
}));
vi.mock("posthog-js", () => ({ default: ph }));

// A screen that crashes during its render (criteria 31 and 32), reached at /claude.
const crash = vi.hoisted(() => new Error("screen exploded"));
vi.mock("./Claude.tsx", () => ({
  Claude: () => {
    throw crash;
  },
}));

type Routes = Record<string, () => Response>;
let rtl: typeof import("@testing-library/react");
let requested: string[];

async function openApp(
  path: string,
  { key, routes = {} }: { key: string | null; routes?: Routes },
) {
  vi.resetModules();
  window.history.replaceState({}, "", path);
  requested = [];
  const known: Routes = {
    "/api/setup/status": () =>
      Response.json({ configured: true, detectedUrl: "http://localhost" }),
    "/api/telemetry": () => Response.json({ key }),
    "/api/health": () => Response.json({ status: "ok", version: "0.1.0" }),
    "/api/me": () =>
      Response.json({
        id: 7,
        login: "dorian",
        name: "Dorian",
        avatarUrl: null,
        isAdmin: false,
      }),
    "/api/installation": () =>
      Response.json({ installed: true, installUrl: "https://github.com/x" }),
    "/api/me/tokens": () => Response.json({ tokens: [] }),
    "/api/settings/pro-codes": () => Response.json({ codes: [] }),
    "/api/settings/users": () =>
      Response.json({ error: "Forbidden" }, { status: 403 }),
    "/api/me/connect": () =>
      Response.json({
        mcpUrl: "https://cockpit.example.com/mcp",
        connected: false,
        connectedAt: null,
      }),
    "/api/me/routine": () =>
      Response.json({
        connected: false,
        fireUrl: null,
        needsReconnect: false,
        prompt: "This task is started by Cockpit.",
      }),
    ...routes,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const pathname = new URL(raw, "http://localhost").pathname;
      requested.push(pathname);
      const handler = known[pathname];
      if (!handler) throw new TypeError(`Unexpected fetch ${pathname}`);
      return handler();
    }),
  );
  rtl = await import("@testing-library/react");
  const { QueryClient, QueryClientProvider } = await import(
    "@tanstack/react-query"
  );
  const { App } = await import("./App.tsx");
  rtl.render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <App />
    </QueryClientProvider>,
  );
}

const goTo = (path: string) =>
  rtl.act(() => {
    window.history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });

const pageviews = () =>
  ph.capture.mock.calls
    .filter(([event]) => event === "$pageview")
    .map(([, props]) => props?.screen);

const settled = () => rtl.screen.findByText("Dorian");

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  rtl?.cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("PostHog on the page", () => {
  it("given GET /api/telemetry returns { key: null }, when the page loads then the user changes screen, then posthog-js is never initialised and no event is captured", async () => {
    await openApp("/", { key: null });
    await settled();
    await rtl.waitFor(() => expect(requested).toContain("/api/telemetry"));

    await goTo("/projets");
    await rtl.screen.findByText("Dorian");

    expect(ph.init).not.toHaveBeenCalled();
    expect(ph.identify).not.toHaveBeenCalled();
    expect(ph.capture).not.toHaveBeenCalled();
  });

  it('given GET /api/telemetry returns a key and the logged-in user has id 7, when the page loads, then posthog-js is initialised with the EU host, memory persistence, identified_only profiles, no autocapture and no session recording, then identify("7") is called without any person property', async () => {
    await openApp("/", { key: "phc_test" });

    await rtl.waitFor(() => expect(ph.init).toHaveBeenCalled());
    const [key, options] = ph.init.mock.calls[0] ?? [];
    expect(key).toBe("phc_test");
    expect(options).toMatchObject({
      api_host: "https://eu.i.posthog.com",
      persistence: "memory",
      person_profiles: "identified_only",
      autocapture: false,
      disable_session_recording: true,
    });
    await rtl.waitFor(() => expect(ph.identify).toHaveBeenCalledWith("7"));
  });

  it("given telemetry is active, when the user goes from the home page to /projets/12/conception, then a $pageview is captured with screen /projets/:id/conception", async () => {
    await openApp("/", { key: "phc_test" });
    await rtl.waitFor(() => expect(pageviews()).toContain("/"));

    await goTo("/projets/12/conception");

    await rtl.waitFor(() =>
      expect(pageviews()).toContain("/projets/:id/conception"),
    );
    expect(JSON.stringify(ph.capture.mock.calls)).not.toContain("/projets/12");
  });

  it("given telemetry is active, when the user opens an address that does not exist, then the $pageview has screen *", async () => {
    await openApp("/n-existe-pas", { key: "phc_test" });

    await rtl.waitFor(() => expect(pageviews()).toEqual(["*"]));
  });

  it("given telemetry is active, when an event goes through before_send, then it no longer contains $current_url, $pathname, $referrer, $referring_domain nor any $initial_* property", async () => {
    await openApp("/", { key: "phc_test" });
    await rtl.waitFor(() => expect(ph.init).toHaveBeenCalled());
    const beforeSend = ph.init.mock.calls[0]?.[1]?.before_send;
    expect(beforeSend).toBeTypeOf("function");

    const out = beforeSend({
      event: "$pageview",
      properties: {
        screen: "/",
        $current_url: "http://localhost/projets/12",
        $pathname: "/projets/12",
        $referrer: "http://elsewhere",
        $referring_domain: "elsewhere",
        $initial_current_url: "http://localhost/projets/12",
        $initial_referrer: "http://elsewhere",
        $browser: "Firefox",
      },
      $set: { $initial_pathname: "/x", plan: "free" },
      $set_once: {
        $initial_current_url: "http://localhost/projets/12",
        $initial_referring_domain: "elsewhere",
      },
    });

    const json = JSON.stringify(out);
    expect(out).not.toBeNull();
    for (const name of [
      "$current_url",
      "$pathname",
      "$referrer",
      "$referring_domain",
      "$initial_",
    ])
      expect(json).not.toContain(name);
    expect(out.properties).toMatchObject({ screen: "/", $browser: "Firefox" });
  });

  it("given telemetry is active, when posthog-js is initialised, then capture_exceptions is true", async () => {
    await openApp("/", { key: "phc_test" });

    await rtl.waitFor(() => expect(ph.init).toHaveBeenCalled());
    expect(ph.init.mock.calls[0]?.[1]?.capture_exceptions).toBe(true);
  });
});

const LINE =
  "Cockpit envoie à PostHog (serveurs dans l'Union européenne) les écrans ouverts, les actions faites et les erreurs rencontrées, sans le contenu de vos projets.";

describe("the line of Réglages", () => {
  it("given telemetry is active, when the user opens Réglages, then a line says what Cockpit sends to PostHog", async () => {
    await openApp("/reglages", { key: "phc_test" });

    expect(await rtl.screen.findByText(LINE)).toBeDefined();
  });

  it("given telemetry is not configured, when the user opens Réglages, then the line is not shown", async () => {
    await openApp("/reglages", { key: null });
    await rtl.screen.findByRole("heading", { name: "Jetons MCP" });
    await rtl.waitFor(() => expect(requested).toContain("/api/telemetry"));

    expect(rtl.screen.queryByText(LINE)).toBeNull();
  });
});

describe("crashes", () => {
  it("given telemetry is active, when a screen crashes during its render, then captureException is called with the error and the page shows « Quelque chose a planté. Recharge la page. »", async () => {
    await openApp("/claude", { key: "phc_test" });

    expect(
      await rtl.screen.findByText("Quelque chose a planté. Recharge la page."),
    ).toBeDefined();
    await rtl.waitFor(() => expect(ph.captureException).toHaveBeenCalled());
    expect(ph.captureException.mock.calls[0]?.[0]).toBe(crash);
  });

  it("given telemetry is not configured, when a screen crashes, then nothing is sent to PostHog and the page shows the same message", async () => {
    await openApp("/claude", { key: null });

    expect(
      await rtl.screen.findByText("Quelque chose a planté. Recharge la page."),
    ).toBeDefined();
    expect(requested).toContain("/api/telemetry");
    expect(ph.init).not.toHaveBeenCalled();
    expect(ph.captureException).not.toHaveBeenCalled();
    expect(ph.capture).not.toHaveBeenCalled();
  });

  it("given telemetry is not configured, when a call gets a 503, then nothing is sent to PostHog and the page keeps working", async () => {
    await openApp("/", {
      key: null,
      routes: { "/api/home": () => Response.json({}, { status: 503 }) },
    });

    await settled();
    await rtl.waitFor(() => expect(requested).toContain("/api/home"));
    expect(requested).toContain("/api/telemetry");
    expect(ph.init).not.toHaveBeenCalled();
    expect(ph.capture).not.toHaveBeenCalled();
  });
});
