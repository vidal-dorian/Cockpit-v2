import { client } from "./api.ts";

/** Decision 043 G: the modules of the map, each with its commit, its age in commits and its `data`. */
export async function fetchCodeMap(id: string) {
  const res = await client.api.projects[":id"]["code-map"].$get({
    param: { id },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).modules;
}

export type CodeModule = Awaited<ReturnType<typeof fetchCodeMap>>[number];
export type CodeObject = CodeModule["data"]["objects"][number];
export type CodeLink = CodeModule["data"]["links"][number];

/** Decision 043 H and 047 H: the cited lines and three lines around them, read on GitHub. The route reads its query by hand, so the client does not type it: `$path` gives the address, the answer is typed here. */
export async function fetchCode(
  id: string,
  query: { sha: string; path: string; start: string; end: string },
) {
  const path = client.api.projects[":id"].code.$path({ param: { id } });
  const res = await fetch(`${path}?${new URLSearchParams(query)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { firstLine: number; lines: string[] };
}

/** The permalink of the cited lines at the commit they were read on. */
export const permalink = (
  fullName: string,
  sha: string,
  path: string,
  start: number,
  end: number,
) =>
  `https://github.com/${fullName}/blob/${sha}/${path.split("/").map(encodeURIComponent).join("/")}#${start === end ? `L${start}` : `L${start}-L${end}`}`;

/** Decision 043 I: how many fields a card of the graph shows before « + N champs ». */
export const CARD_FIELDS = 8;

/** The label of a link: its kind, then its cardinality when there is one. */
export const linkLabel = (link: CodeLink) =>
  link.cardinality ? `${link.kind} ${link.cardinality}` : link.kind;
