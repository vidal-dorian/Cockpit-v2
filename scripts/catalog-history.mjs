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
  "agents/bug-hunter.md",
  "agents/security-reviewer.md",
  "agents/architect.md",
  "skills/analyser/SKILL.md",
];
const git = (...args) =>
  execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 1 << 26,
    stdio: ["ignore", "pipe", "ignore"], // a commit that deleted the file makes `git show` fail: no `fatal:` on screen
  });
const sha256 = (text) =>
  createHash("sha256").update(text, "utf8").digest("hex");

// A shallow clone would silently drop the oldest versions: an original copy would then read as modified by hand.
if (git("rev-parse", "--is-shallow-repository").trim() === "true") {
  console.error(
    "Shallow clone: run `git fetch --unshallow` first, so every version of the catalogue is listed.",
  );
  process.exit(1);
}

const history = {};
for (const file of FILES) {
  // Oldest first, the working text last: the last hash of each list is the current version.
  const versions = git(
    "log",
    "--reverse",
    "--format=%H",
    "--",
    `catalog/${file}`,
  )
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
