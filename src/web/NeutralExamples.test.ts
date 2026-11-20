import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Ticket #51: no interface text carries the author's name. Source scan: the examples are static attributes.
const dir = import.meta.dirname;
const read = (f: string) => readFileSync(join(dir, f), "utf8");

describe("neutral examples", () => {
  it("given DevelopWindow, AnalyseWindow and ProjectRoutine, when a field shows its example, then it does not contain « dorian »", () => {
    for (const file of [
      "DevelopWindow.tsx",
      "AnalyseWindow.tsx",
      "ProjectRoutine.tsx",
    ]) {
      const placeholders = [
        ...read(file).matchAll(/placeholder=(?:"([^"]*)"|\{([^}]*)\})/g),
      ].map((m) => m[1] ?? m[2]);
      expect(placeholders.length, file).toBeGreaterThan(0);
      for (const p of placeholders) expect(p, file).not.toMatch(/dorian/i);
    }
  });

  it("given the code of src/web outside tests, when searching « dorian », then no displayed text is found", () => {
    const found: string[] = [];
    for (const file of readdirSync(dir, { recursive: true }) as string[]) {
      if (!/\.tsx?$/.test(file) || /\.test\.tsx?$/.test(file)) continue;
      if (/^test-/.test(file.split("/").pop() ?? "")) continue;
      read(file)
        .split("\n")
        .forEach((line, i) => {
          const t = line.trim();
          const comment = /^(\/\/|\/\*|\*)/.test(t);
          if (!comment && /dorian/i.test(line)) found.push(`${file}:${i + 1}`);
        });
    }
    expect(found).toEqual([]);
  });
});
