import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// A repo-specific section of an agent is wrapped in `<!-- repo-specific -->` ... `<!-- /repo-specific -->`
// (each marker on its own line). It is dropped from the comparison; an optional `<!-- generic -->` line
// inside it starts the catalog's own text, which stands in for the section.
const SECTION =
  /<!-- repo-specific -->\n([\s\S]*?)(?:<!-- generic -->\n([\s\S]*?))?<!-- \/repo-specific -->\n/g;

/** Names of the agents present in both folders whose files differ outside the repo-specific sections. */
export function agentDrift(repoDir: string, catalogDir: string): string[] {
  const inCatalog = new Set(readdirSync(catalogDir));
  return readdirSync(repoDir)
    .filter((name) => inCatalog.has(name))
    .filter((name) => {
      const repo = readFileSync(join(repoDir, name), "utf8").replace(
        SECTION,
        (_m, _r, generic) => generic ?? "",
      );
      return repo !== readFileSync(join(catalogDir, name), "utf8");
    });
}
