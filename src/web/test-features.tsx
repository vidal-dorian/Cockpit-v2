// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import { vi } from "vitest";
import { SHA_API } from "./test-conception.tsx";
import { type FakeRule, stubReprise } from "./test-reprise.tsx";

// Shared by the web tests of slice R3 (decision 048, screen S43): the project 5 (octocat/hello) whose server answers the features.
// The shape is the one pinned in src/server/features.test.ts:
// - GET /api/projects/5/features -> { features: [FakeFeature], links: [{ from, to, kind }] }

export type FakeFeature = {
  id: number;
  title: string;
  actors: string[];
  rules: {
    id: number;
    storyId: number;
    storyStatus: string;
    summary: string;
    state: "pending" | "kept";
    given: string;
    when: string;
    then: string;
    sources: {
      path: string;
      startLine: number;
      endLine: number;
      commitSha: string;
    }[];
    objects: { name: string; inMap: boolean }[];
  }[];
};
export type FakeLink = { from: string; to: string; kind: string };

export const FILE = "src/Service/FactureService.php";
export const SHA_B = "e".repeat(40);

type FeatureRule = FakeFeature["rules"][number];
export const featureRule = (
  id: number,
  over: Partial<FeatureRule> = {},
): FeatureRule => ({
  id,
  storyId: 31,
  storyStatus: "to_validate",
  summary: `Règle de fonctionnalité ${id}.`,
  state: "pending",
  given: `un état ${id}`,
  when: `une action ${id}`,
  then: `un résultat ${id}`,
  sources: [{ path: FILE, startLine: 40, endLine: 58, commitSha: SHA_API }],
  objects: [],
  ...over,
});

/** « Facturer »: 2 actors, 3 rules, 2 objects (Order in the map, Ghost not). */
export const FACTURER: FakeFeature = {
  id: 11,
  title: "Facturer",
  actors: ["Client", "Comptable"],
  rules: [
    featureRule(101, {
      summary: "Une facture garde le prix du jour.",
      objects: [
        { name: "Order", inMap: true },
        { name: "Ghost", inMap: false },
      ],
      sources: [
        { path: FILE, startLine: 40, endLine: 58, commitSha: SHA_API },
        {
          path: "src/Model/Order.php",
          startLine: 5,
          endLine: 5,
          commitSha: SHA_B,
        },
      ],
    }),
    featureRule(102, {
      summary: "Une facture payée ne change plus.",
      state: "kept",
      objects: [{ name: "Order", inMap: true }],
    }),
    featureRule(103, {
      storyId: 32,
      storyStatus: "ready",
      summary: "Une facture a un numéro unique.",
    }),
  ],
};

/** « Relancer les impayés »: 1 actor, 1 rule, 1 object (Session, in the map). */
export const RELANCER: FakeFeature = {
  id: 12,
  title: "Relancer les impayés",
  actors: ["Client"],
  rules: [
    featureRule(104, {
      storyId: 33,
      summary: "Une relance part au bout de trente jours.",
      objects: [{ name: "Session", inMap: true }],
    }),
  ],
};

/** The fake server of the features screen, on top of the one of the takeover screen (map, rules, analyse window). */
export function stubFeatures(
  features: FakeFeature[],
  links: FakeLink[] = [],
  options: Parameters<typeof stubReprise>[1] = {},
  rules: FakeRule[] = [],
) {
  const api = stubReprise(rules, options);
  const inner = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const url = new URL(raw, "http://localhost");
      if (url.pathname === "/api/projects/5/features")
        return Response.json({ features, links });
      return inner(input, init);
    }),
  );
  return api;
}

/** Stubs the browser's file download (a Blob URL and a click on an anchor); `restore` puts the globals back. */
export function stubDownloads() {
  const originals = {
    create: URL.createObjectURL,
    revoke: URL.revokeObjectURL,
    click: HTMLAnchorElement.prototype.click,
  };
  const blobs = new Map<string, Blob>();
  const files: { name: string; text: () => Promise<string> }[] = [];
  URL.createObjectURL = (blob: Blob | MediaSource) => {
    const url = `blob:test/${blobs.size}`;
    blobs.set(url, blob as Blob);
    return url;
  };
  URL.revokeObjectURL = () => {};
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    const blob = blobs.get(this.href) as Blob;
    files.push({
      name: this.download,
      text: () =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsText(blob);
        }),
    });
  };
  return {
    files,
    restore() {
      URL.createObjectURL = originals.create;
      URL.revokeObjectURL = originals.revoke;
      HTMLAnchorElement.prototype.click = originals.click;
    },
  };
}
