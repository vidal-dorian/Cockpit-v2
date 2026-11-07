import { useQuery } from "@tanstack/react-query";
import { client } from "./api.ts";

/** Decision 048 C: the takeover features of the project with their actors and rules, and the links of the map between the objects they cite. */
export async function fetchFeatures(id: string) {
  const res = await client.api.projects[":id"].features.$get({
    param: { id },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

export type Features = Awaited<ReturnType<typeof fetchFeatures>>;
export type Feature = Features["features"][number];
export type FeatureRule = Feature["rules"][number];

export const useFeatures = (projectId: string, enabled = true) =>
  useQuery({
    queryKey: ["features", projectId],
    queryFn: () => fetchFeatures(projectId),
    enabled,
  });

/** Decision 048 E: the feature of `?f=`, the first one when it is missing or unknown. */
export const chosenFeature = (features: Feature[], wanted: string | null) =>
  features.find((f) => String(f.id) === wanted) ?? features[0];

/** The objects a feature touches, once each by name, in the order of its rules. */
export const objectsOf = (feature: Feature) => [
  ...new Map(
    feature.rules.flatMap((r) => r.objects).map((o) => [o.name, o]),
  ).values(),
];

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** Decision 048 E: « Facturer » : 2 acteurs, 3 règles, 2 objets. */
export const featureSentence = (feature: Feature) =>
  `« ${feature.title} » : ${plural(feature.actors.length, "acteur", "acteurs")}, ${plural(feature.rules.length, "règle", "règles")}, ${plural(objectsOf(feature).length, "objet", "objets")}.`;

/** Decision 048 G: a rule to validate opens the takeover screen on it, any other the page of its story. */
export const ruleHref = (projectId: string, rule: FeatureRule) =>
  rule.storyStatus === "to_validate"
    ? `/projets/${projectId}/conception/regles?regle=${rule.id}`
    : `/us/${rule.storyId}`;

/** Decision 048 G: an object of the map opens the tab « Modèle » on it. */
export const objectHref = (projectId: string, name: string) =>
  `/projets/${projectId}/conception?objet=${encodeURIComponent(name)}`;

export const stateWord = (rule: FeatureRule) =>
  rule.state === "kept" ? "voulue" : "à trancher";
