import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { parseTeam } from "../server/team.ts";
import { client } from "./api.ts";
import { Panel } from "./Shell.tsx";
import { STORY_STATUSES } from "./tickets.ts";
import { badge, field, ghostButton, kbd, panelPrimaryButton } from "./ui.ts";

// Mirror of BRANCH in src/server/mcp.ts (decision 033 B), `..` being refused next to it.
const BRANCH = /^[A-Za-z0-9._][A-Za-z0-9._/-]*(?<![/.])$/;
const MAX_PROMPT = 10_000;
const MAX_BRANCH = 255;
const validBranch = (name: string) =>
  name.length <= MAX_BRANCH && BRANCH.test(name) && !name.includes("..");

type Story = {
  id: number;
  iWant: string;
  branch: string | null;
  dependsOn: { id: number; iWant: string; status: string }[];
};

const storageKey = (projectId: number) => `cockpit.clone.${projectId}`;

/** The short title of decision 005 D: lower case, no accents, dashes, 40 characters at most. */
const proposedBranch = (story: Story) => {
  const slug = story.iWant
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `us/${story.id}${slug && `-${slug}`}`;
};

async function fetchBranches(id: string) {
  const res = await client.api.projects[":id"].branches.$get({ param: { id } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).branches;
}

async function fetchTeams(id: string) {
  const res = await client.api.projects[":id"].agents.$get({ param: { id } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  return {
    names: body.teams.map((team) => team.name),
    steps: body.team ? parseTeam(body.team) : null,
  };
}

/** Decision 034, in the right panel (decision 045): the form that builds the link of decision 005. The button that opens it is in the decisions of the story. */
export function DevelopWindow({
  story,
  project,
  onClose,
}: {
  story: Story;
  project: { id: number; fullName: string; defaultBranch?: string };
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
  // The message that was copied (or that failed to copy): another message resets both.
  const [copied, setCopied] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState<string | null>(null);

  const branch = story.branch ?? (mode === "new" ? name : existing);
  const branchValid =
    story.branch !== null ||
    (mode === "new" ? validBranch(name) : existing !== "");
  const promptValid = prompt.length <= MAX_PROMPT;
  // The Windows « Copier en tant que chemin d'accès » puts the path between double quotes.
  const cleanFolder = folder
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .trim();
  const valid = branchValid && promptValid && cleanFolder !== "";
  const extra = prompt.trim();
  const message = `/dev-us ${story.id} --branch ${branch}${team ? ` --team ${team}` : ""}${extra ? `\n\n${extra}` : ""}`;
  const href = `claude://code/new?folder=${encodeURIComponent(cleanFolder)}&q=${encodeURIComponent(message)}`;
  const choices = (branches.data ?? []).filter(
    (b) => b !== project.defaultBranch && validBranch(b),
  );
  const pending = story.dependsOn.filter((d) => d.status !== "done");
  const label = "block text-[13px] font-semibold";
  const hint = "text-[12.5px] text-muted-foreground";
  const launchRef = useRef<HTMLAnchorElement>(null);
  return (
    <Panel
      label="Développer avec Claude"
      // Ctrl+Enter launches from the panel, as decision 003 (7) lists and the button shows.
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && valid)
          launchRef.current?.click();
      }}
      badge={
        <span className={badge}>
          <span className="inline-block first-letter:uppercase">
            {STORY_STATUSES.ready}
          </span>
        </span>
      }
      meta={
        <h2
          id="develop-title"
          ref={headingRef}
          tabIndex={-1}
          className="focus:outline-none"
        >
          Développer avec Claude
        </h2>
      }
      footer={
        <>
          <a
            ref={launchRef}
            className={`${panelPrimaryButton} aria-disabled:opacity-50`}
            {...(valid
              ? {
                  href,
                  onClick: () => {
                    try {
                      window.localStorage.setItem(
                        storageKey(project.id),
                        cleanFolder,
                      );
                    } catch {}
                  },
                }
              : { "aria-disabled": true, role: "link" })}
          >
            <span>Lancer Claude</span>
            <span
              aria-hidden="true"
              className={`${kbd} border-primary-foreground/30 text-primary-foreground`}
            >
              Ctrl Entrée
            </span>
          </a>
          <button
            type="button"
            className={ghostButton}
            disabled={!branchValid || !promptValid}
            onClick={() =>
              navigator.clipboard
                .writeText(message)
                .then(() => setCopied(message))
                .catch(() => setCopyFailed(message))
            }
          >
            Copier le prompt
          </button>
          {copied === message && (
            <span role="status" className="text-center text-muted-foreground">
              Copié
            </span>
          )}
          {copyFailed === message && (
            <span role="status" className="text-center text-destructive">
              Copie impossible
            </span>
          )}
          <button type="button" className={ghostButton} onClick={onClose}>
            Annuler
          </button>
        </>
      }
    >
      <p className="text-lg font-semibold">Où Claude doit-il travailler ?</p>
      {/* The only place that exists (decision 045, slices 14.1 and 14.6 add the others). */}
      <div className="flex items-start gap-2.5 rounded-xl border border-foreground bg-raised px-3 py-2.5">
        <span
          aria-hidden="true"
          className="mt-0.5 size-3.5 flex-none rounded-full border-4 border-foreground"
        />
        <span>
          <b className="block text-[13.5px] font-semibold">
            Sur ce PC, avec Claude Desktop
          </b>
          <span className={hint}>Tu suis Claude en direct dans ton clone.</span>
        </span>
      </div>
      {story.branch ? (
        <div className="grid gap-1.5">
          <b className={label}>Branche</b>
          <span className={`${field} mt-0 font-mono text-[12.5px]`}>
            {story.branch}
          </span>
        </div>
      ) : (
        <fieldset className="grid gap-1.5">
          <legend className={`${label} mb-1.5`}>Branche</legend>
          {mode === "new" ? (
            <>
              <input
                aria-label="Nom de la branche"
                className={`${field} mt-0 font-mono text-[12.5px]`}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              {!branchValid && (
                <span role="alert" className="text-destructive">
                  Nom de branche invalide
                </span>
              )}
              <small className={hint}>
                Créée par Claude depuis {project.defaultBranch ?? "main"}.
              </small>
            </>
          ) : (
            <label className="sr-only">
              Branche existante
              <select
                className={field}
                value={existing}
                onChange={(e) => setExisting(e.target.value)}
              >
                <option value="">Choisir une branche</option>
                {choices.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className={`mt-1 flex gap-4 ${hint}`}>
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
          </div>
          {branches.isError && (
            <p className={hint}>
              Impossible de lire les branches du dépôt : seule une nouvelle
              branche est possible.
            </p>
          )}
        </fieldset>
      )}
      {teams.isError && (
        <p className={hint}>
          Impossible de lire les équipes : l'équipe par défaut sera utilisée.
        </p>
      )}
      {teams.data && teams.data.names.length > 0 ? (
        <label className={label}>
          Équipe
          <select
            className={field}
            value={team}
            onChange={(e) => setTeam(e.target.value)}
          >
            <option value="">Par défaut</option>
            {teams.data.names.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      ) : (
        teams.data?.steps && (
          <div className="grid gap-1.5">
            <b className={label}>Équipe</b>
            <span className={`${field} mt-0`}>
              Par défaut · {teams.data.steps.join(" → ")}
            </span>
          </div>
        )
      )}
      <div>
        <label className={label}>
          Dossier du clone
          <input
            required
            className={field}
            value={folder}
            placeholder="C:\Users\dorian\code\mon-repo ou /home/dorian/code/mon-repo"
            onChange={(e) => setFolder(e.target.value)}
          />
        </label>
        <details className={`mt-2 ${hint}`}>
          <summary>Pas encore cloné ?</summary>
          <code>git clone https://github.com/{project.fullName}.git</code>
        </details>
      </div>
      <label className={label}>
        Consigne en plus{" "}
        <span className="font-medium text-muted-foreground">· facultatif</span>
        <textarea
          aria-label="Prompt complémentaire"
          className={field}
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        {!promptValid && (
          <span role="alert" className="text-destructive">
            Le prompt complémentaire ne peut pas dépasser 10 000 caractères.
          </span>
        )}
      </label>
      {pending.map((d) => (
        <p key={d.id} className={hint}>
          ⚠ Dépend de l'US {d.id} ({d.iWant}),{" "}
          {STORY_STATUSES[d.status] ?? d.status}. Claude peut commencer quand
          même.
        </p>
      ))}
      <p className={hint}>
        Mode conseillé dans Claude Desktop : « Accepter les modifications ».
      </p>
      <p className={hint}>
        Claude Desktop va s'ouvrir. Confirme le dossier, puis appuie sur Entrée.
      </p>
      {!valid && cleanFolder === "" && (
        <p className={hint}>Indique le dossier du clone pour lancer Claude.</p>
      )}
      {!story.branch && mode === "existing" && existing === "" && (
        <p className={hint}>Choisis une branche existante.</p>
      )}
    </Panel>
  );
}
