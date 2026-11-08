import { useQuery } from "@tanstack/react-query";
import { client } from "./api.ts";

/** Decision 052 I: the runtimes of the map with their end of life, as judged by the server. */
export async function fetchVersions(id: string) {
  const res = await client.api.projects[":id"].versions.$get({
    param: { id },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).runtimes;
}

export type Runtime = Awaited<ReturnType<typeof fetchVersions>>[number];

/** The end of life is a nicety: a failed read only means no mention (decision 052 J), so no retry. */
export const useVersions = (projectId: string, enabled = true) =>
  useQuery({
    queryKey: ["versions", projectId],
    queryFn: () => fetchVersions(projectId),
    enabled,
    retry: false,
  });

const date = (iso: string, options: Intl.DateTimeFormatOptions) =>
  new Date(iso).toLocaleDateString("fr-FR", { timeZone: "UTC", ...options });

/** « avr. 2025 » */
export const shortMonth = (iso: string) =>
  date(iso, { month: "short", year: "numeric" });
/** « avril 2027 » */
export const longMonth = (iso: string) =>
  date(iso, { month: "long", year: "numeric" });
/** « 30 avril 2025 » */
export const fullDate = (iso: string) =>
  date(iso, { day: "numeric", month: "long", year: "numeric" });

/** « fin de vie depuis avr. 2022 » or « fin de vie en avr. 2027 », null for a runtime that is neither. */
export const eolWords = (r: Runtime) =>
  r.state === "eol"
    ? `fin de vie${r.eolFrom ? ` depuis ${shortMonth(r.eolFrom)}` : ""}`
    : r.state === "soon" && r.eolFrom
      ? `fin de vie en ${shortMonth(r.eolFrom)}`
      : null;

/** Decision 052 J: the runtimes to show as rows, one per name and version whatever the number of modules, in the order of the server. */
export function eolRows(runtimes: Runtime[]) {
  const rows = new Map<string, { runtime: Runtime; all: Runtime[] }>();
  for (const r of runtimes) {
    if (r.state !== "eol" && r.state !== "soon") continue;
    const key = `${r.name} ${r.version}`;
    const row = rows.get(key);
    if (row) row.all.push(r);
    else rows.set(key, { runtime: r, all: [r] });
  }
  return [...rows.entries()].map(([key, row]) => ({ key, ...row }));
}
