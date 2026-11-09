// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fileOf, layerFiles } from "./test-attachments.tsx";
import { renderAt } from "./test-tickets.tsx";
import { stubBar } from "./test-tickets-full.tsx";

// Slice 15.1 (decision 071 C, D): « Idée » of the phone bar opens the panel « Noter une idée »; « Photo » is a camera input.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const pressIdea = async () =>
  fireEvent.click(
    within(
      await screen.findByRole("navigation", {
        name: "Navigation du téléphone",
      }),
    ).getByRole("button", { name: /Idée/ }),
  );
const dialog = () => screen.findByRole("dialog", { name: "Noter une idée" });
const ticketPosts = (api: { sent: { method: string; path: string }[] }) =>
  api.sent.filter(
    (s) =>
      s.method === "POST" && /^\/api\/projects\/\d+\/tickets$/.test(s.path),
  );

describe("slice 15.1: the idea from the phone bar", () => {
  it("given a project, when I press Idée and submit a title, then the ticket is created and « Idée notée dans … » shows", async () => {
    const api = stubBar();
    renderAt("/");

    await pressIdea();
    const panel = within(await dialog());
    fireEvent.change(panel.getByRole("textbox", { name: "Titre" }), {
      target: { value: "ranger le Kanban" },
    });
    fireEvent.click(panel.getByRole("button", { name: /^Noter/ }));

    await waitFor(() => expect(ticketPosts(api)).toHaveLength(1));
    expect(await screen.findByText(/Idée notée dans hello/)).toBeDefined();
  });

  it("given no project, when the shell renders, then the phone nav has no Idée tab", async () => {
    stubBar({}, []);
    renderAt("/");

    const nav = within(
      await screen.findByRole("navigation", {
        name: "Navigation du téléphone",
      }),
    );
    expect(nav.queryByRole("button", { name: /Idée/ })).toBeNull();
  });

  it("given the panel, when a picture is chosen with Photo, then it is listed and uploaded once the ticket exists, and there is no Dicter", async () => {
    const api = stubBar();
    const files = layerFiles();
    renderAt("/");

    await pressIdea();
    const panel = await dialog();
    const photo = panel.querySelector<HTMLInputElement>(
      'input[type="file"][capture="environment"]',
    );
    expect(photo?.getAttribute("accept")).toBe("image/*");
    expect(within(panel).getByText(/Photo/)).toBeDefined();
    expect(within(panel).queryByText(/Dicter/)).toBeNull();

    fireEvent.change(photo as HTMLInputElement, {
      target: { files: [fileOf("photo.jpg", 2_048, "image/jpeg")] },
    });
    fireEvent.change(within(panel).getByRole("textbox", { name: "Titre" }), {
      target: { value: "x" },
    });
    expect(within(panel).getByText("photo.jpg · 2 Ko")).toBeDefined();
    fireEvent.click(within(panel).getByRole("button", { name: /^Noter/ }));

    await waitFor(() =>
      expect(files.uploads.map((u) => u.name)).toEqual(["photo.jpg"]),
    );
    expect(ticketPosts(api)).toHaveLength(1);
  });
});
