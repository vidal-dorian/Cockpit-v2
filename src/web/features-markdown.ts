// biome-ignore-all lint/suspicious/noThenProperty: "then" is the Then field of a Given/When/Then rule (decision 017)
import { permalink } from "./conception.ts";
import { type Feature, objectsOf, stateWord } from "./features.ts";

/** A code span whose fence is longer than any backtick run of the text. */
const code = (text: string) => {
  const fence = "`".repeat(
    Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length)) + 1,
  );
  return `${fence} ${text} ${fence}`;
};

/** One line of heading text: a newline would end the heading, a trailing `#` run would be read as its closing marks. */
const heading = (text: string) =>
  text.replace(/\s+/g, " ").trim().replace(/(#+)$/, "\\$1");

/** Continuation lines are indented so that a blank line cannot end the list item. */
const item = (label: string, text: string) =>
  `- **${label}** ${text.replace(/\n/g, "\n  ")}`;

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
        `# ${heading(feature.title)}`,
        `Acteurs : ${feature.actors.join(", ")}`,
        ...feature.rules.map((r) =>
          [
            `## ${heading(r.summary)}`,
            `*${stateWord(r)}*`,
            [
              item("Étant donné", r.given),
              item("Quand", r.when),
              item("Alors", r.then),
            ].join("\n"),
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
              ? object.fields
                  .map((f) => `- ${code(f.name)} ${code(f.type)}`)
                  .join("\n")
              : "non cartographié"
          }`;
        }),
      ].join("\n\n"),
    )
    .join("\n\n");
}
