import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { client } from "./api.ts";
import { STORY_STATUSES } from "./tickets.ts";
import { button, card, field, primaryButton } from "./ui.ts";

// Mirror of BRANCH in src/server/mcp.ts (decision 033 B), `..` being refused next to it.
const BRANCH = /^[A-Za-z0-9._][A-Za-z0-9._/-]*(?<![/.])$/;
const MAX_PROMPT = 10_000;

type Story = {
  id: number;
  iWant: string;
  branch: string | null;
  dependsOn: { id: number; iWant: string; status: string }[];
};

const storageKey = (projectId: number) => `cockpit.clone.${projectId}`;

/** The short title of decision 005 D: lower case, no accents, dashes, 40 characters at most. */
const proposedBranch = (story: Story) =>
  `us/${story.id}-${story.iWant
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 40)
    .replace(/-+$/, "")}`;

async function fetchBranches(id: string) {
  const res = await client.api.projects[":id"].branches.$get({ param: { id } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).branches;
}

async function fetchTeams(id: string) {
  const res = await client.api.projects[":id"].agents.$get({ param: { id } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).teams.map((team) => team.name);
}

function Panel({
  story,
  project,
  onClose,
}: {
  story: Story;
  project: { id: number; fullName: string };
  onClose: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  const branches = useQuery({
    queryKey: ["develop-branches", project.id],
    queryFn: () => fetchBranches(String(project.id)),
    retry: false,
  });
  const teams = useQuery({
    queryKey: ["develop-teams", project.id],
    queryFn: () => fetchTeams(String(project.id)),
    retry: false,
  });
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [name, setName] = useState(() => proposedBranch(story));
  const [existing, setExisting] = useState("");
  const [team, setTeam] = useState("");
  const [folder, setFolder] = useState(() => {
    try {
      return window.localStorage.getItem(storageKey(project.id)) ?? "";
    } catch {
      return "";
    }
  });
  const [prompt, setPrompt] = useState("");
  const [copied, setCopied] = useState(false);

  const branch = story.branch ?? (mode === "new" ? name : existing);
  const branchValid =
    story.branch !== null ||
    (BRANCH.test(branch) && !branch.includes("..")) ||
    (mode === "existing" && existing !== "");
  const promptValid = prompt.length <= MAX_PROMPT;
  const valid = branchValid && promptValid && folder.trim() !== "";
  const message = `/dev-us ${story.id} --branch ${branch}${team ? ` --team ${team}` : ""}${prompt ? `\n\n${prompt}` : ""}`;
  const href = `claude://code/new?folder=${encodeURIComponent(folder)}&q=${encodeURIComponent(message)}`;
  const pending = story.dependsOn.filter((d) => d.status !== "done");
  const label = "block font-semibold";

  return (
    <section
      aria-labelledby="develop-title"
      className={`mt-4 grid gap-4 p-4 ${card}`}
    >
      <h2
        id="develop-title"
        ref={headingRef}
        tabIndex={-1}
        className="font-heading text-xl font-bold"
      >
        Développer avec Claude
      </h2>
      {story.branch ? (
        <p>
          <span className="font-semibold">Branche</span> {story.branch}
        </p>
      ) : (
        <fieldset className="grid gap-2">
          <label>
            <input
              type="radio"
              name="branch-mode"
              checked={mode === "new"}
              onChange={() => setMode("new")}
            />{" "}
            Nouvelle branche
          </label>
          <label>
            <input
              type="radio"
              name="branch-mode"
              checked={mode === "existing"}
              disabled={!branches.data}
              onChange={() => setMode("existing")}
            />{" "}
            Branche existante
          </label>
          {branches.isError && (
            <p className="text-muted-foreground">
              Impossible de lire les branches du dépôt : seule une nouvelle
              branche est possible.
            </p>
          )}
          {mode === "new" ? (
            <label className={label}>
              Nom de la branche
              <input
                className={field}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              {!branchValid && (
                <span role="alert" className="text-destructive">
                  Nom de branche invalide
                </span>
              )}
            </label>
          ) : (
            <label className={label}>
              Branche existante
              <select
                className={field}
                value={existing}
                onChange={(e) => setExisting(e.target.value)}
              >
                <option value="">Choisir une branche</option>
                {(branches.data ?? []).map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
          )}
        </fieldset>
      )}
      {teams.data && teams.data.length > 0 && (
        <label className={label}>
          Équipe
          <select
            className={field}
            value={team}
            onChange={(e) => setTeam(e.target.value)}
          >
            <option value="">Par défaut</option>
            {teams.data.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      )}
      <div>
        <label className={label}>
          Dossier du clone
          <input
            className={field}
            value={folder}
            placeholder="C:\Users\dorian\code\mon-repo ou /home/dorian/code/mon-repo"
            onChange={(e) => setFolder(e.target.value)}
          />
        </label>
        <details className="mt-2">
          <summary>Pas encore cloné ?</summary>
          <code>git clone https://github.com/{project.fullName}.git</code>
        </details>
      </div>
      <label className={label}>
        Prompt complémentaire
        <textarea
          className={field}
          rows={4}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        {!promptValid && (
          <span role="alert" className="text-destructive">
            Le prompt complémentaire ne peut pas dépasser 10 000 caractères.
          </span>
        )}
      </label>
      {pending.length > 0 && (
        <div>
          <p className="font-semibold">Dépendances pas encore terminées</p>
          <ul>
            {pending.map((d) => (
              <li key={d.id}>
                {d.iWant} ({STORY_STATUSES[d.status] ?? d.status})
              </li>
            ))}
          </ul>
        </div>
      )}
      <p>
        Mode conseillé dans Claude Desktop : « Accepter les modifications ».
      </p>
      <p>
        Claude Desktop va s'ouvrir. Confirme le dossier, puis appuie sur Entrée.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <a
          className={primaryButton}
          {...(valid
            ? {
                href,
                onClick: () => {
                  try {
                    window.localStorage.setItem(storageKey(project.id), folder);
                  } catch {}
                },
              }
            : { "aria-disabled": true })}
        >
          <span>Lancer Claude</span>
        </a>
        <button
          type="button"
          className={button}
          onClick={() =>
            navigator.clipboard.writeText(message).then(() => setCopied(true))
          }
        >
          Copier le prompt
        </button>
        {copied && <span role="status">Copié</span>}
        <button type="button" className={button} onClick={onClose}>
          Annuler
        </button>
      </div>
    </section>
  );
}

/** Decision 034: the button of a ready story and the panel that opens the link of decision 005. */
export function DevelopWindow({
  story,
  project,
}: {
  story: Story;
  project: { id: number; fullName: string };
}) {
  const [open, setOpen] = useState(false);
  if (open)
    return (
      <Panel story={story} project={project} onClose={() => setOpen(false)} />
    );
  return (
    <button
      type="button"
      className={`mt-4 ${primaryButton}`}
      onClick={() => setOpen(true)}
    >
      Développer avec Claude
    </button>
  );
}
