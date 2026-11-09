import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { proposedBranch } from "../server/branch.ts";
import { parseTeam } from "../server/team.ts";
import { AddResult, fetchAgentTeams, useAddTeam } from "./AgentTeams.tsx";
import { client } from "./api.ts";
import { fetchBudgets } from "./Cost.tsx";
import { fetchLauncher } from "./LauncherSettings.tsx";
import { Panel } from "./Shell.tsx";
import { STORY_STATUSES } from "./tickets.ts";
import {
  alertBox,
  badge,
  button,
  field,
  ghostButton,
  kbd,
  panelPrimaryButton,
} from "./ui.ts";

// Mirror of BRANCH in src/server/launcher.ts (decision 033 B), `..` being refused next to it.
const BRANCH = /^[A-Za-z0-9._][A-Za-z0-9._/-]*(?<![/.])$/;
const MAX_PROMPT = 10_000;
const MAX_BRANCH = 255;
const validBranch = (name: string) =>
  name.length <= MAX_BRANCH && BRANCH.test(name) && !name.includes("..");

type Story = {
  id: number;
  iWant: string;
  status: string;
  branch: string | null;
  dependsOn: { id: number; iWant: string; status: string }[];
};

const storageKey = (projectId: number) => `cockpit.clone.${projectId}`;

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
    teams: body.teams,
    steps: body.team ? parseTeam(body.team) : null,
  };
}

// What the user reads for a refused or failed launch (decision 054 H); the codes of the server are not meant to be read.
const LAUNCH_ERRORS: Record<string, string> = {
  launch_pending:
    "Un lancement de cette US est déjà en cours : attends quelques minutes avant de réessayer.",
  run_active: "Cette US a déjà un run en cours.",
  wrong_status:
    "Cette US n'est plus à développer (ni prête, ni en relecture) : recharge la page.",
  branch_mismatch:
    "Cette US a déjà une autre branche : recharge la page pour la retrouver.",
  fire_failed: "Claude n'a pas pu être lancé : réessaie dans un instant.",
  already_queued: "Cette US est déjà dans la file.",
  project_not_in_launcher:
    "Ce projet n'est plus coché dans le lanceur : coche-le dans Réglages.",
  project_archived: "Ce projet est archivé.",
  monthly_budget_reached:
    "Le plafond par mois est atteint : relève-le dans la page Coût pour lancer.",
};

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
  const globalTeams = useQuery({
    queryKey: ["agent-teams"],
    queryFn: fetchAgentTeams,
    retry: false,
  });
  const addTeam = useAddTeam();
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
  const launcher = useQuery({
    queryKey: ["launcher"],
    queryFn: fetchLauncher,
    retry: false,
  });
  const cloudPossible =
    !!launcher.data?.connected &&
    !launcher.data.needsReconnect &&
    launcher.data.projectIds.includes(project.id);
  const budgets = useQuery({
    queryKey: ["budgets"],
    queryFn: fetchBudgets,
    retry: false,
  });
  // Prefilled with the cap per run until the user types.
  const [typedCap, setTypedCap] = useState<string>();
  const cap = typedCap ?? `${budgets.data?.runUsd ?? ""}`;
  const [chosen, setChosen] = useState<"cloud" | "pc">();
  const cloud = cloudPossible && chosen !== "pc";
  const queryClient = useQueryClient();
  const launch = useMutation({
    // A refusal may mean the launcher changed (a token refused): the next read decides if the cloud is still possible.
    onError: () => queryClient.invalidateQueries({ queryKey: ["launcher"] }),
    mutationFn: async () => {
      const res = await client.api.stories[":id"].launch.$post({
        param: { id: String(story.id) },
        json: {
          branch,
          team: team || undefined,
          comment: extra || undefined,
          budgetUsd: cap ? Number(cap) : undefined,
        },
      });
      if (!res.ok) {
        const answer: { error?: string } = await res.json().catch(() => ({}));
        throw new Error(
          LAUNCH_ERRORS[answer.error ?? ""] ??
            "Le lancement a été refusé : vérifie le lanceur dans Réglages.",
        );
      }
      return res.json();
    },
  });
  const queue = useMutation({
    mutationFn: async () => {
      const res = await client.api.queue.$post({ json: { storyId: story.id } });
      if (!res.ok) {
        const answer: { error?: string } = await res.json().catch(() => ({}));
        throw new Error(
          LAUNCH_ERRORS[answer.error ?? ""] ??
            "Cette US ne peut pas être mise en file : recharge la page.",
        );
      }
    },
  });
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
  const extra = prompt.trim();
  const valid = branchValid && promptValid && (cloud || cleanFolder !== "");
  const canLaunch = valid && !launch.isPending && !launch.isSuccess;
  const message = `/dev-us ${story.id} --branch ${branch}${team ? ` --team ${team}` : ""}${extra ? `\n\n${extra}` : ""}`;
  const href = `claude://code/new?folder=${encodeURIComponent(cleanFolder)}&q=${encodeURIComponent(message)}`;
  // Stale: a global team of the same name has another text than the repo copy.
  const staleTeam = (name: string) => {
    const repoTeam = teams.data?.teams.find((t) => t.name === name);
    const global = globalTeams.data?.find((t) => t.name === name);
    return repoTeam && global && repoTeam.text !== global.text ? global : null;
  };
  const stale = team ? staleTeam(team) : null;
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
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && valid) {
          if (!cloud) launchRef.current?.click();
          else if (canLaunch) launch.mutate();
        }
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
          {cloud ? (
            <>
              <button
                type="button"
                className={panelPrimaryButton}
                disabled={!canLaunch}
                onClick={() => launch.mutate()}
              >
                <span>Lancer dans le cloud</span>
                <span
                  aria-hidden="true"
                  className={`${kbd} border-primary-foreground/30 text-primary-foreground`}
                >
                  Ctrl Entrée
                </span>
              </button>
              {story.status === "ready" && (
                <button
                  type="button"
                  className={ghostButton}
                  disabled={queue.isPending || queue.isSuccess}
                  onClick={() => queue.mutate()}
                >
                  Mettre en file
                </button>
              )}
            </>
          ) : (
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
            </>
          )}
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
      <div className="grid gap-2">
        {(
          [
            [
              "cloud",
              "Dans le cloud",
              "Ton PC peut être éteint. Claude ouvre la PR et te prévient.",
            ],
            [
              "pc",
              "Sur ce PC, avec Claude Desktop",
              "Tu suis Claude en direct dans ton clone.",
            ],
          ] as const
        ).map(([value, title, text]) => (
          <label
            key={value}
            className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 has-[:disabled]:opacity-50 ${(value === "cloud") === cloud ? "border-foreground bg-raised" : "border-border"}`}
          >
            <input
              type="radio"
              name="target"
              className="mt-0.5"
              checked={(value === "cloud") === cloud}
              disabled={value === "cloud" && !cloudPossible}
              onChange={() => setChosen(value)}
            />
            <span>
              <b className="block text-[13.5px] font-semibold">{title}</b>
              <span className={hint}>{text}</span>
            </span>
          </label>
        ))}
        {!cloudPossible && !launcher.isPending && (
          <p className={hint}>
            {launcher.isError
              ? "Impossible de lire le lanceur."
              : !launcher.data?.connected
                ? "Le lanceur n'est pas relié."
                : launcher.data.needsReconnect
                  ? "Le lanceur est à reconnecter."
                  : "Ce projet n'est pas coché dans le lanceur."}{" "}
            <Link to="/reglages/taches-cloud" className="underline">
              régler le lanceur dans Réglages
            </Link>
            .
          </p>
        )}
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
      {teams.data && teams.data.teams.length > 0 ? (
        <label className={label}>
          Équipe
          <select
            className={field}
            value={team}
            onChange={(e) => setTeam(e.target.value)}
          >
            <option value="">Par défaut</option>
            {teams.data.teams.map(({ name: t }) => (
              <option key={t} value={t}>
                {t}
                {staleTeam(t) && " · à mettre à jour"}
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
      {stale && (
        <div role="status" className="rounded-xl border bg-raised p-3">
          <p>
            L'équipe {stale.name} a changé dans Équipes d'agents depuis son
            ajout à ce projet. Claude suivra la version du repo tant que tu ne
            la mets pas à jour.
          </p>
          <button
            type="button"
            className={`mt-3 ${button}`}
            disabled={addTeam.isPending}
            onClick={() =>
              addTeam.mutate(
                { project, team: stale },
                {
                  onSuccess: () =>
                    queryClient.invalidateQueries({
                      queryKey: ["develop-teams", project.id],
                    }),
                },
              )
            }
          >
            Mettre à jour dans le projet
          </button>
        </div>
      )}
      <AddResult added={addTeam.data} failed={addTeam.isError} />
      {!cloud && (
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
      )}
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
      {cloud && (
        <div>
          <label className={label}>
            Plafond
            <input
              type="number"
              min="0.01"
              step="any"
              aria-describedby="cap-hint"
              className={field}
              value={cap}
              onChange={(e) => setTypedCap(e.target.value)}
            />
          </label>
          <p id="cap-hint" className={hint}>
            En dollars, facultatif (vide : ton plafond par run). Au plafond,
            Cockpit demande l'arrêt du run.
          </p>
        </div>
      )}
      {pending.map((d) => (
        <p key={d.id} className={hint}>
          ⚠ Dépend de l'US {d.id} ({d.iWant}),{" "}
          {STORY_STATUSES[d.status] ?? d.status}. Claude peut commencer quand
          même.
        </p>
      ))}
      {cloud ? (
        <>
          {launch.isSuccess && (
            <p role="status">
              Lancé dans le cloud.{" "}
              {launch.data.sessionUrl && (
                <a
                  href={launch.data.sessionUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline"
                >
                  Voir la session ↗
                </a>
              )}
            </p>
          )}
          {queue.isSuccess && (
            <p role="status">
              Mis en file :{" "}
              <Link to="/claude" className="underline">
                voir la file
              </Link>
              .
            </p>
          )}
          {queue.isError && (
            <p role="alert" className={alertBox}>
              {queue.error.message}
            </p>
          )}
          {launch.isError && (
            <div role="alert" className={alertBox}>
              <p>{launch.error.message}</p>
              <button
                type="button"
                onClick={() => launch.mutate()}
                className={`mt-3 ${button}`}
              >
                Réessayer
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <p className={hint}>
            Mode conseillé dans Claude Desktop : « Accepter les modifications ».
          </p>
          <p className={hint}>
            Claude Desktop va s'ouvrir. Confirme le dossier, puis appuie sur
            Entrée.
          </p>
          {!valid && cleanFolder === "" && (
            <p className={hint}>
              Indique le dossier du clone pour lancer Claude.
            </p>
          )}
        </>
      )}
      {!story.branch && mode === "existing" && existing === "" && (
        <p className={hint}>Choisis une branche existante.</p>
      )}
    </Panel>
  );
}
