// biome-ignore-all lint/suspicious/noThenProperty: "then" is the Then field of a Given/When/Then rule (decision 017)
import { permalink } from "./conception.ts";
import { type Feature, objectsOf, stateWord } from "./features.ts";

/** Decision 048 I: the business documentation of some features, built in the browser: actors, rules with a permalink per source, and the objects they touch with their fields. */
export function featuresMarkdown(
  features: Feature[],
  modules: {
    data: {
      objects: { name: string; fields: { name: string; type: string }[] }[];
    };
  }[],
  fullName: string,
) {
  const mapped = new Map(
    modules.flatMap((m) => m.data.objects).map((o) => [o.name, o]),
  );
  return features
    .map((feature) =>
      [
        `# ${feature.title}`,
        `Acteurs : ${feature.actors.join(", ")}`,
        ...feature.rules.map((r) =>
          [
            `## ${r.summary}`,
            `*${stateWord(r)}*`,
            `- **Étant donné** ${r.given}\n- **Quand** ${r.when}\n- **Alors** ${r.then}`,
            ...r.sources.map(
              (s) =>
                `- ${permalink(fullName, s.commitSha, s.path, s.startLine, s.endLine)}`,
            ),
          ].join("\n\n"),
        ),
        "## Objets touchés",
        ...objectsOf(feature).map(({ name }) => {
          const object = mapped.get(name);
          return `### ${name}\n\n${
            object
              ? object.fields.map((f) => `- \`${f.name}\` ${f.type}`).join("\n")
              : "non cartographié"
          }`;
        }),
      ].join("\n\n"),
    )
    .join("\n\n");
}
