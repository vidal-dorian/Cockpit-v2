// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

// Slice R2 (decision 047 F): Shiki, and so the module that wraps it, is loaded on demand, only when code is displayed. A mocked module runs its factory
// when it is first imported: it must not happen before a CodeView has code to show (see the pins of src/web/CodeView.test.tsx).

const loaded = vi.hoisted(() => ({ count: 0 }));
vi.mock("./highlight.ts", () => {
  loaded.count += 1;
  return {
    highlightLines: async (lines: string[]) =>
      lines.map((l) => `<span class="tok">${l}</span>`),
  };
});

afterEach(cleanup);

it("given the screens are imported, when no code is shown, then the highlighter is not loaded; when a CodeView shows PHP code, then it is loaded", async () => {
  const { CodeView } = await import("./CodeView.tsx");
  await import("./App.tsx");
  expect(loaded.count).toBe(0);

  const { container } = render(
    <CodeView
      path="a.php"
      firstLine={1}
      lines={["echo 1;"]}
      start={1}
      end={1}
    />,
  );

  await waitFor(() => expect(container.querySelector(".tok")).not.toBeNull());
  expect(loaded.count).toBe(1);
});
