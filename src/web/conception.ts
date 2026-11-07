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

/** Decision 043 I: how many fields a card of the graph shows before « + N champs ». */
export const CARD_FIELDS = 8;

/** The label of a link: its kind, then its cardinality when there is one. */
export const linkLabel = (link: CodeLink) =>
  link.cardinality ? `${link.kind} ${link.cardinality}` : link.kind;
