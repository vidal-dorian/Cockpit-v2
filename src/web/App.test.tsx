// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("home page", () => {
  it("shows the title and the server version", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ status: "ok", version: "0.1.0" })),
    );

    renderApp();

    expect(screen.getByRole("heading", { name: "Cockpit" })).toBeDefined();
    expect(await screen.findByText("Serveur OK · v0.1.0")).toBeDefined();
  });

  it("shows the error and lets the user retry", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(Response.json({ status: "ok", version: "0.1.0" }));
    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "Serveur injoignable : Failed to fetch",
    );

    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByText("Serveur OK · v0.1.0")).toBeDefined();
  });
});
