import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Slice 12.4 (decision 067 C): the starter CI templates of `catalog/ci/<language>.yml`: each runs on push and pull_request, installs the dependencies and runs the tests.
// `on:` is read as text (no YAML library in the project): its block, or its inline value, must name both events.

const dir = fileURLToPath(new URL("../../catalog/ci/", import.meta.url));

describe("decision 067 C: catalog/ci templates", () => {
  it.each([
    ["node", ["npm ci", "npm test"]],
    ["python", ["pytest"]],
    ["go", ["go build ./...", "go test ./..."]],
    ["rust", ["cargo build", "cargo test"]],
  ])(
    "given the %s template, when it is read, then it exists, runs on push and pull_request and holds %j",
    (language, commands) => {
      const file = `${dir}${language}.yml`;
      expect(existsSync(file), `catalog/ci/${language}.yml exists`).toBe(true);
      const text = readFileSync(file, "utf8");

      const on = /^on:(.*(?:\n[ \t]+.*)*)/m.exec(text)?.[1] ?? "";
      expect(on).toMatch(/\bpush\b/);
      expect(on).toMatch(/\bpull_request\b/);
      for (const command of commands) expect(text).toContain(command);
    },
  );
});
