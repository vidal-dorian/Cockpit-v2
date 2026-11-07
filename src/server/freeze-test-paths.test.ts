import { describe, expect, it } from "vitest";
import { isTestPath } from "./pr-files.ts";

// Slice R4 (decision 050 D): what counts as a test in a PR. `isTestPath(path)` of src/server/pr-files.ts, a pure function on a repo path.

describe("decision 050 D: isTestPath", () => {
  it.each([
    "test/a.ts",
    "tests/unit/a.py",
    "src/__tests__/a.ts",
    "spec/models/user.rb",
    "src/test/java/com/acme/Invoice.java",
    "api/tests/helpers/db.ts",
    "src/a.test.ts",
    "src/web/App.test.tsx",
    "src/a.spec.js",
    "pkg/invoice_test.go",
    "tests_helper/x_test.py",
    "src/Service/InvoiceTest.php",
    "src/main/java/InvoiceTest.java",
  ])("given the path %s, when it is tested, then it is a test", (path) => {
    expect(isTestPath(path)).toBe(true);
  });

  it.each([
    "src/app.ts",
    "vitest.config.ts",
    "jest.config.js",
    "package.json",
    "src/latest.ts",
    "contest/x.ts",
    "src/protest/x.ts",
    "src/testing/x.ts",
    "src/Contest.ts",
    "src/attest.ts",
    "src/fixtures/invoice.ts",
    "src/specification/x.ts",
  ])(
    "given the path %s (config file or « test » inside a word), when it is tested, then it is not a test",
    (path) => {
      expect(isTestPath(path)).toBe(false);
    },
  );
});
