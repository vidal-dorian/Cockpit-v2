// biome-ignore-all lint/suspicious/noThenProperty: "then" is the Then field of a Given/When/Then rule (decision 017)
import { useQuery } from "@tanstack/react-query";
import { client } from "./api.ts";

/** Decision 047 I: the rules of the takeover stories to validate, in the order of the ticket, of the story and of the criterion. */
export async function fetchRules(id: string) {
  const res = await client.api.projects[":id"].rules.$get({ param: { id } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).rules;
}

export type Rule = Awaited<ReturnType<typeof fetchRules>>[number];

export const rulesKey = (projectId: string) => ["rules", projectId];

export const useRules = (projectId: string, enabled = true) =>
  useQuery({
    queryKey: rulesKey(projectId),
    queryFn: () => fetchRules(projectId),
    enabled,
  });

// The decisions of the human on a rule (decision 047 E): each answers the rule as it is now.
const param = (id: number) => ({ param: { id: String(id) } });
const fail = (res: { status: number }) => new Error(`HTTP ${res.status}`);

export async function keepRule(id: number) {
  const res = await client.api.criteria[":id"].keep.$post(param(id));
  if (!res.ok) throw fail(res);
  return (await res.json()).rule;
}

export async function unkeepRule(id: number) {
  const res = await client.api.criteria[":id"].unkeep.$post(param(id));
  if (!res.ok) throw fail(res);
  return (await res.json()).rule;
}

export type RuleText = {
  summary: string;
  given: string;
  when: string;
  then: string;
};

export async function correctRule(id: number, json: RuleText) {
  const res = await client.api.criteria[":id"].$patch({ ...param(id), json });
  if (!res.ok) throw fail(res);
  return (await res.json()).rule;
}

export async function reportBug(id: number) {
  const res = await client.api.criteria[":id"].bug.$post(param(id));
  if (!res.ok) throw fail(res);
  return (await res.json()).ticket;
}

/** Decision 047 I: the sentence of the top of the takeover screen. */
export function rulesSentence(rules: Rule[]) {
  if (rules.length === 0) return "Aucune règle trouvée.";
  const kept = rules.filter((r) => r.state === "kept").length;
  return `${rules.length} ${rules.length === 1 ? "règle trouvée" : "règles trouvées"}. ${kept} ${kept > 1 ? "validées" : "validée"}, ${rules.length - kept} à relire.`;
}
