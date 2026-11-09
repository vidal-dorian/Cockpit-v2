import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Slice 15.2 (decision 072 A): the page is installable: a manifest, its icons, a service worker.
const dir = dirname(fileURLToPath(import.meta.url));
const publicDir = join(dir, "public");
const read = (path: string) => readFileSync(join(dir, path), "utf8");

describe("the installable page (decision 072 A)", () => {
  it("given the public folder, when the manifest is read, then it is named Cockpit, standalone, with 192 and 512 px icons that exist", () => {
    const manifest = JSON.parse(read("public/manifest.webmanifest")) as {
      name: string;
      display: string;
      icons: { src: string; sizes: string; type?: string }[];
    };

    expect(manifest.name).toBe("Cockpit");
    expect(manifest.display).toBe("standalone");
    for (const size of ["192x192", "512x512"]) {
      const icon = manifest.icons.find((i) => i.sizes === size);
      expect(icon, `the ${size} icon`).toBeDefined();
      expect(icon?.src.endsWith(".png")).toBe(true);
      expect(
        existsSync(join(publicDir, (icon?.src ?? "").replace(/^\//, ""))),
        `${icon?.src} on disk`,
      ).toBe(true);
    }
  });

  it("given index.html, when it is read, then it links the manifest and an apple-touch-icon", () => {
    const html = read("index.html");

    expect(html).toMatch(
      /<link[^>]*rel="manifest"[^>]*href="\/manifest\.webmanifest"/,
    );
    expect(html).toMatch(/<link[^>]*rel="apple-touch-icon"/);
  });

  it("given the public folder, when it is listed, then the service worker sw.js is there", () => {
    expect(existsSync(join(publicDir, "sw.js"))).toBe(true);
  });
});
