// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Call, code, FREE, renderAt, stubPlans } from "./test-plans.tsx";

// Slice 13.2 (decision 077 I): the card « Codes Pro » of Réglages › Instance (/reglages/utilisateurs), administrator only. Labels and contract: src/web/test-plans.tsx.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "clipboard");
  window.history.replaceState({}, "", "/");
});

const sent = (calls: Call[], method: string, re: RegExp) =>
  calls.filter((c) => c.method === method && re.test(c.path));
const rowOf = (text: string) => {
  const row = screen.getByText(text, { exact: false }).closest("li, tr");
  expect(row, `${text} must be inside a list item or a row`).not.toBeNull();
  return within(row as HTMLElement);
};

const CODES = [
  code(1, { note: "pour Karim" }),
  code(2, { note: "pour Marie", state: "used", login: "marie" }),
  code(3, { note: "pour Paul", state: "revoked" }),
  code(4, { note: "pour Zoé", state: "expired" }),
];

describe("077 I: the list of codes", () => {
  it("given four codes, when the Instance page loads, then each row says its note and state, the login of the used one, and offers only the gestures of its state", async () => {
    stubPlans({ plan: FREE, isAdmin: true, codes: CODES });

    renderAt("/reglages/utilisateurs");

    await screen.findByRole("heading", { name: "Codes Pro" });
    await screen.findByText("pour Karim", { exact: false });
    expect(rowOf("pour Karim").getByText("libre")).toBeDefined();
    expect(
      rowOf("pour Karim").getByRole("button", { name: "Révoquer" }),
    ).toBeDefined();
    expect(
      rowOf("pour Karim").queryByRole("button", { name: "Modifier la durée" }),
    ).toBeNull();
    expect(rowOf("pour Marie").getByText("utilisé")).toBeDefined();
    expect(
      rowOf("pour Marie").getByText("@marie", { exact: false }),
    ).toBeDefined();
    expect(
      rowOf("pour Marie").getByRole("button", { name: "Modifier la durée" }),
    ).toBeDefined();
    expect(
      rowOf("pour Marie").getByRole("button", { name: "Révoquer" }),
    ).toBeDefined();
    expect(rowOf("pour Paul").getByText("révoqué")).toBeDefined();
    expect(
      rowOf("pour Paul").queryByRole("button", { name: "Révoquer" }),
    ).toBeNull();
    expect(rowOf("pour Zoé").getByText("expiré")).toBeDefined();
    expect(
      rowOf("pour Zoé").queryByRole("button", { name: "Révoquer" }),
    ).toBeNull();
  });
});

describe("077 I: generating a code", () => {
  it("given a note and « sans fin », when Générer un code is clicked, then the note is posted with no end and the secret is shown once with Copier, which copies it", async () => {
    const calls = stubPlans({ plan: FREE, isAdmin: true });
    const writeText = vi.fn(async (_t: string) => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    renderAt("/reglages/utilisateurs");

    const note = await screen.findByRole("textbox", { name: "Note" });
    expect(note.getAttribute("maxlength")).toBe("80");
    fireEvent.change(note, { target: { value: "pour Karim" } });
    fireEvent.click(screen.getByRole("button", { name: "Générer un code" }));

    await screen.findByText("SECRET-CODE-0123", { exact: false });
    expect(
      sent(calls, "POST", /^\/api\/settings\/pro-codes$/).map((c) => c.body),
    ).toEqual([{ note: "pour Karim", until: null }]);
    fireEvent.click(screen.getByRole("button", { name: "Copier" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("SECRET-CODE-0123"),
    );
  });

  it("given « jusqu'au » and a date, when the code is generated, then the end posted is that day", async () => {
    const calls = stubPlans({ plan: FREE, isAdmin: true });
    renderAt("/reglages/utilisateurs");

    fireEvent.change(await screen.findByRole("textbox", { name: "Note" }), {
      target: { value: "pour Karim" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Durée" }), {
      target: { value: "jusqu'au" },
    });
    fireEvent.change(screen.getByLabelText("Date de fin"), {
      target: { value: "2027-03-12" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Générer un code" }));

    await waitFor(() =>
      expect(sent(calls, "POST", /^\/api\/settings\/pro-codes$/)).toHaveLength(
        1,
      ),
    );
    const body = sent(calls, "POST", /^\/api\/settings\/pro-codes$/)[0]
      ?.body as {
      note: string;
      until: string;
    };
    expect(body.until.startsWith("2027-03-12")).toBe(true);
  });
});

describe("077 I: Modifier la durée and Révoquer", () => {
  it("given a used code, when its duration is changed to a date, then the end is patched for that code", async () => {
    const calls = stubPlans({ plan: FREE, isAdmin: true, codes: CODES });
    renderAt("/reglages/utilisateurs");
    await screen.findByText("pour Marie", { exact: false });

    fireEvent.click(
      rowOf("pour Marie").getByRole("button", { name: "Modifier la durée" }),
    );
    const edit = rowOf("pour Marie");
    fireEvent.change(edit.getByRole("combobox", { name: "Durée" }), {
      target: { value: "jusqu'au" },
    });
    fireEvent.change(edit.getByLabelText("Date de fin"), {
      target: { value: "2027-03-12" },
    });
    fireEvent.click(edit.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(
        sent(calls, "PATCH", /^\/api\/settings\/pro-codes\/2$/),
      ).toHaveLength(1),
    );
    const body = sent(calls, "PATCH", /^\/api\/settings\/pro-codes\/2$/)[0]
      ?.body as {
      until: string;
    };
    expect(body.until.startsWith("2027-03-12")).toBe(true);
  });

  it("given a free code, when Révoquer is clicked, then nothing is sent before Confirmer la révocation, which revokes that code", async () => {
    const calls = stubPlans({ plan: FREE, isAdmin: true, codes: CODES });
    renderAt("/reglages/utilisateurs");
    await screen.findByText("pour Karim", { exact: false });

    fireEvent.click(
      rowOf("pour Karim").getByRole("button", { name: "Révoquer" }),
    );

    expect(sent(calls, "POST", /\/revoke$/)).toHaveLength(0);
    fireEvent.click(
      rowOf("pour Karim").getByRole("button", {
        name: "Confirmer la révocation",
      }),
    );
    await waitFor(() =>
      expect(
        sent(calls, "POST", /^\/api\/settings\/pro-codes\/1\/revoke$/),
      ).toHaveLength(1),
    );
  });
});
