import { useQuery } from "@tanstack/react-query";
import { client } from "./api.ts";

/** Decision 051 C: the findings of a project as the server gives them, their cited sources and the choice-L reminder (`unprotected`) included. */
export async function fetchFindings(id: string) {
  const res = await client.api.projects[":id"].findings.$get({
    param: { id },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).findings;
}

export type Finding = Awaited<ReturnType<typeof fetchFindings>>[number];

export const findingsKey = (projectId: string) => ["findings", projectId];

export const useFindings = (projectId: string, enabled = true) =>
  useQuery({
    queryKey: findingsKey(projectId),
    queryFn: () => fetchFindings(projectId),
    enabled,
  });

export type Decision = "ticket" | "dismiss" | "later";

/** Decision 051 G: the human decisions, which only exist in the interface. */
export async function decide(id: number, action: Decision, reason?: string) {
  const param = { param: { id: String(id) } };
  const res =
    action === "dismiss"
      ? await client.api.findings[":id"].dismiss.$post(param, {
          init: {
            body: JSON.stringify(reason ? { reason } : {}),
            headers: { "content-type": "application/json" },
          },
        })
      : await client.api.findings[":id"][action].$post(param);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export const KIND_WORD = {
  bug: "bug",
  security: "faille",
  architecture: "architecture",
  stack: "stack",
};
export const SEVERITY_WORD = {
  critical: "critique",
  high: "haute",
  medium: "moyenne",
  low: "basse",
};
export const EFFORT_WORD = { small: "petit", medium: "moyen", large: "grand" };

const RANK = { critical: 0, high: 1, medium: 2, low: 3 };

/** Decision 051 D: what is left to decide (open or put off), the most serious first, then the most recent. */
export const toDecide = (findings: Finding[]) =>
  findings
    .filter((f) => f.status === "open" || f.status === "later")
    .sort(
      (a, b) =>
        RANK[a.severity] - RANK[b.severity] ||
        Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );

/** « 9 constats sur hello, dont 2 failles. » */
export function findingsSentence(name: string, todo: Finding[]) {
  if (todo.length === 0) return `Aucun constat à trancher sur ${name}.`;
  const holes = todo.filter((f) => f.kind === "security").length;
  const count = `${todo.length} ${todo.length === 1 ? "constat" : "constats"}`;
  const dont = holes
    ? `, dont ${holes} ${holes === 1 ? "faille" : "failles"}`
    : "";
  return `${count} sur ${name}${dont}.`;
}
