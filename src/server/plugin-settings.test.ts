import { describe, expect, it } from "vitest";
import { pluginSettings } from "./plugin-settings.ts";

// Slice 12.3 (decision 066 F, G): the pure function that computes the text of `.claude/settings.json` from the text read.
//
// Assumed contract: `pluginSettings(before: string | null, { login, repo }, install: boolean): string` in src/server/plugin-settings.ts.
// - Installing sets extraKnownMarketplaces["cockpit-<login lower case>"] = { source: { source: "github", repo } } and enabledPlugins["commun@cockpit-<login>"] = true.
// - Removing deletes those two entries, and a key left empty. Every other key is kept, in its order; a new key is appended.
// - The text is JSON.stringify(object, null, 2) + "\n"; a null `before` (no file) is an empty object.
// - A text that is not a JSON object (invalid, array, string) makes it throw (the route answers 409 invalid_settings).

const WHO = { login: "Alice", repo: "alice/plugins" };
const INSTALLED = {
  extraKnownMarketplaces: {
    "cockpit-alice": { source: { source: "github", repo: "alice/plugins" } },
  },
  enabledPlugins: { "commun@cockpit-alice": true },
};
const text = (o: unknown) => `${JSON.stringify(o, null, 2)}\n`;

describe("decision 066 G: pluginSettings", () => {
  it("given no file, when installing, then the two entries are written under a lower case marketplace name", () => {
    expect(pluginSettings(null, WHO, true)).toBe(text(INSTALLED));
  });

  it("given other keys and other plugins, when installing, then they are kept and the new keys come last", () => {
    const before = text({
      permissions: { allow: ["Bash"] },
      enabledPlugins: { "other@x": true },
    });

    expect(pluginSettings(before, WHO, true)).toBe(
      text({
        permissions: { allow: ["Bash"] },
        enabledPlugins: { "other@x": true, "commun@cockpit-alice": true },
        extraKnownMarketplaces: INSTALLED.extraKnownMarketplaces,
      }),
    );
  });

  it("given the plugin installed next to other entries, when removing, then only the two entries go", () => {
    const before = text({
      model: "opus",
      extraKnownMarketplaces: {
        ...INSTALLED.extraKnownMarketplaces,
        "cockpit-bob": { source: { source: "github", repo: "bob/p" } },
      },
      enabledPlugins: { "commun@cockpit-alice": true, "other@x": false },
    });

    expect(pluginSettings(before, WHO, false)).toBe(
      text({
        model: "opus",
        extraKnownMarketplaces: {
          "cockpit-bob": { source: { source: "github", repo: "bob/p" } },
        },
        enabledPlugins: { "other@x": false },
      }),
    );
  });

  it("given only the plugin installed, when removing, then the keys left empty are dropped", () => {
    expect(
      pluginSettings(text({ model: "opus", ...INSTALLED }), WHO, false),
    ).toBe(text({ model: "opus" }));
  });

  it.each([
    ["not JSON", "{ nope"],
    ["an array", "[]"],
    ["a string", '"x"'],
  ])(
    "given a file that is %s, when installing, then it throws",
    (_n, before) => {
      expect(() => pluginSettings(before, WHO, true)).toThrow();
    },
  );
});
