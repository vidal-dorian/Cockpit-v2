// Regenerates catalog/history.json (decision 049 B): for each catalogue file that « Préparer pour Claude » writes (not CLAUDE.md),
// the SHA-256 of every version ever committed on the history of the current branch, plus the working text.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const FILES = [
  "agents/test-writer.md",
  "agents/developer.md",
  "agents/reviewer.md",
  "skills/dev-us/SKILL.md",
  "skills/write-us/SKILL.md",
  "agents/cartographer.md",
  "agents/rules-analyst.md",
  "skills/analyser/SKILL.md",
];
const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 26 });
const sha256 = (text) =>
  createHash("sha256").update(text, "utf8").digest("hex");

const history = {};
for (const file of FILES) {
  const versions = git("log", "--format=%H", "--", `catalog/${file}`)
    .split("\n")
    .filter(Boolean)
    .map((commit) => {
      try {
        return git("show", `${commit}:catalog/${file}`);
      } catch {
        return null; // the commit deleted the file
      }
    })
    .filter((text) => text !== null);
  versions.push(readFileSync(`catalog/${file}`, "utf8"));
  history[`.claude/${file}`] = [...new Set(versions.map(sha256))];
}
writeFileSync("catalog/history.json", `${JSON.stringify(history, null, 2)}\n`);
