import { useMutation } from "@tanstack/react-query";
import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { client } from "./api.ts";
import { DiffList } from "./DiffList.tsx";
import { diffLines } from "./diff.ts";
import { type Failure, failure, message } from "./ProjectPrepare.tsx";
import {
  addStep,
  cardId,
  DEFAULT_STEPS,
  defaultUntil,
  linkSteps,
  moveStep,
  readTeam,
  removeStep,
  type TeamStep,
  writeTeam,
} from "./team-file.ts";
import {
  alertBox,
  button,
  card,
  field,
  focusRing,
  primaryButton,
} from "./ui.ts";

// React Flow stays out of the main bundle, as react-markdown does (App.tsx); the panel works while it loads.
const StepGraph = lazy(() => import("./ProjectTeamGraph.tsx"));

const TDD_AGENTS = ["test-writer", "reviewer"];
// A team name is an agent name that fits `.claude/teams/<name>.md` in 255 characters (decision 032 A).
const TEAM_NAME = /^[a-z0-9][a-z0-9-]*$/;
const MAX_TEAM_NAME = 238;

type Agent = { name: string; text: string | null };
type Draft = { steps: TeamStep[]; body: string };
type Done = { url: string; pullRequest: boolean };
function StepPanel({
  uid,
  step,
  index,
  steps,
  freeAgents,
  onChange,
  onRemove,
  canEditAgent,
  onEditAgent,
}: {
  uid: string;
  step: TeamStep;
  index: number;
  steps: TeamStep[];
  freeAgents: string[];
  onChange: (next: TeamStep) => void;
  onRemove: () => void;
  canEditAgent: boolean;
  onEditAgent?: () => void;
}) {
  return (
    <div className={`${card} mt-4 p-4`}>
      <h3 className="font-mono font-semibold">{step.agent}</h3>
      <label htmlFor={`${uid}-step-agent`} className="mt-3 block">
        Agent
      </label>
      <select
        id={`${uid}-step-agent`}
        className={field}
        value={step.agent}
        onChange={(e) => onChange({ ...step, agent: e.target.value })}
      >
        {[step.agent, ...freeAgents].map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      <label htmlFor={`${uid}-step-does`} className="mt-3 block">
        Ce qu'il fait
      </label>
      <input
        id={`${uid}-step-does`}
        className={field}
        value={step.does}
        onChange={(e) => onChange({ ...step, does: e.target.value })}
      />
      <label htmlFor={`${uid}-step-loop`} className="mt-3 block">
        Boucle
      </label>
      <select
        id={`${uid}-step-loop`}
        className={field}
        value={step.loopTo ?? ""}
        onChange={(e) =>
          onChange({
            ...step,
            loopTo: e.target.value || null,
            until: e.target.value
              ? step.until.trim() === ""
                ? defaultUntil(e.target.value)
                : step.until
              : "",
          })
        }
      >
        <option value="">Aucune</option>
        {steps.slice(0, index + 1).map((s) => (
          <option key={s.agent} value={s.agent}>
            {s.agent}
          </option>
        ))}
      </select>
      {step.loopTo !== null && (
        <>
          <label htmlFor={`${uid}-step-until`} className="mt-3 block">
            Condition
          </label>
          <input
            id={`${uid}-step-until`}
            className={field}
            value={step.until}
            onChange={(e) => onChange({ ...step, until: e.target.value })}
          />
        </>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={onRemove} className={button}>
          Retirer l'étape
        </button>
        {onEditAgent && (
          <button
            type="button"
            disabled={!canEditAgent}
            onClick={onEditAgent}
            className={button}
          >
            Modifier l'agent
          </button>
        )}
      </div>
    </div>
  );
}

/** The graph and the panel of one step on a draft owned by the caller (the team shown, or the new one in its dialog). With `withAdd`, a select and « Ajouter à l'équipe » too: the dialog has no right column behind it. */
function StepEditor({
  steps,
  onSteps,
  agents,
  archived,
  withAdd,
  onEditAgent,
}: {
  steps: TeamStep[];
  onSteps: (next: TeamStep[]) => void;
  agents: Agent[];
  archived: boolean;
  withAdd?: boolean;
  /** Absent in the dialog: the agent form would open behind it. */
  onEditAgent?: (name: string) => void;
}) {
  const uid = useId();
  const [open, setOpen] = useState<string | null>(null);
  const [picked, setPicked] = useState("");
  const [selectedLoop, setSelectedLoop] = useState<string | null>(null);
  const [warn, setWarn] = useState(false);
  const [announced, setAnnounced] = useState("");

  const free = agents
    .map((a) => a.name)
    .filter((name) => !steps.some((s) => s.agent === name));
  const toAdd = free.includes(picked) ? picked : (free[0] ?? "");
  const openStep = steps.find((s) => s.agent === open);
  // A selection is only kept while its loop exists.
  const loopShown = steps.some((s) => s.agent === selectedLoop && s.loopTo)
    ? selectedLoop
    : null;
  // Re-rendering the graph drops the focus of a card: the card to focus is remembered and focused again after the render.
  const focusAfter = useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: steps is the trigger
  useEffect(() => {
    const target = focusAfter.current;
    focusAfter.current = null;
    // A frame later: React Flow sets its nodes in an effect of its own.
    if (target)
      requestAnimationFrame(() => document.getElementById(target)?.focus());
  }, [steps]);
  const remove = (agent: string) => {
    setWarn(TDD_AGENTS.includes(agent));
    const next = removeStep(steps, agent);
    const i = steps.findIndex((s) => s.agent === agent);
    const near = next[i] ?? next[i - 1];
    focusAfter.current = near ? cardId(uid, near.agent) : `${uid}-help`;
    onSteps(next);
    if (open === agent) setOpen(null);
  };
  const move = (agent: string, direction: "up" | "down") => {
    const next = moveStep(steps, agent, direction);
    if (next === steps) return; // an end of the team
    focusAfter.current = cardId(uid, agent);
    onSteps(next);
    setAnnounced(
      `${agent} : étape ${next.findIndex((s) => s.agent === agent) + 1} sur ${next.length}`,
    );
  };

  return (
    <>
      <Suspense
        fallback={
          <p role="status" className="text-muted-foreground">
            Chargement du graphe…
          </p>
        }
      >
        <StepGraph
          id={uid}
          steps={steps}
          agents={agents}
          selectedLoop={loopShown}
          onOpen={setOpen}
          // A loop drawn is made at once, with the default condition (decision 042 B).
          onLink={(from, to) =>
            onSteps(linkSteps(steps, from, to, defaultUntil(to)))
          }
          onSelectLoop={setSelectedLoop}
          onMove={move}
          onRemove={remove}
          onDropAgent={(agent) => {
            if (!archived && agents.some((a) => a.name === agent))
              onSteps(addStep(steps, agent));
          }}
        />
      </Suspense>
      <p
        id={`${uid}-help`}
        tabIndex={-1}
        className="mt-2 text-sm text-muted-foreground"
      >
        Au clavier, sur une carte : Alt+← / Alt+→ déplace, Entrée ouvre, Suppr
        retire.
      </p>
      <p aria-live="polite" className="sr-only">
        {announced}
      </p>
      {loopShown !== null && (
        <button
          type="button"
          onClick={() => {
            onSteps(
              steps.map((s) =>
                s.agent === loopShown ? { ...s, loopTo: null, until: "" } : s,
              ),
            );
            setSelectedLoop(null);
          }}
          className={`mt-3 ${button}`}
        >
          Retirer la boucle
        </button>
      )}
      <p role="status" className="mt-3 empty:hidden">
        {warn && "Le TDD du CLAUDE.md du projet s'appuie sur cette étape"}
      </p>
      {openStep && (
        <StepPanel
          uid={uid}
          step={openStep}
          index={steps.indexOf(openStep)}
          steps={steps}
          freeAgents={free}
          onChange={(next) => {
            // A renamed agent keeps the loops that pointed to it, its own included.
            const rename = (name: string | null) =>
              name === openStep.agent ? next.agent : name;
            onSteps(
              steps.map((s) =>
                s === openStep
                  ? { ...next, loopTo: rename(next.loopTo) }
                  : { ...s, loopTo: rename(s.loopTo) },
              ),
            );
            setOpen(next.agent);
          }}
          onRemove={() => remove(openStep.agent)}
          canEditAgent={
            typeof agents.find((a) => a.name === openStep.agent)?.text ===
            "string"
          }
          onEditAgent={onEditAgent && (() => onEditAgent(openStep.agent))}
        />
      )}
      {withAdd && (
        <div className={`${card} mt-3 p-4`}>
          <label htmlFor={`${uid}-step-add`} className="block">
            Agent à ajouter
          </label>
          <select
            id={`${uid}-step-add`}
            className={field}
            value={toAdd}
            onChange={(e) => setPicked(e.target.value)}
          >
            {free.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={archived || free.length === 0}
            onClick={() => onSteps(addStep(steps, toAdd))}
            className={`mt-3 ${button}`}
          >
            Ajouter à l'équipe
          </button>
        </div>
      )}
    </>
  );
}

function Problem({ problem }: { problem: Failure }) {
  return (
    <div role="alert" className={`mt-3 ${alertBox}`}>
      <p>{message(problem)}</p>
      {problem.settingsUrl && (
        <a href={problem.settingsUrl} className={`underline ${focusRing}`}>
          Réglages de l'App sur GitHub
        </a>
      )}
    </div>
  );
}

/** Decision 041: a new team is configured in a modal window, on its own draft, so the team shown behind it is never edited by mistake. */
function NewTeamDialog({
  start,
  taken,
  agents,
  archived,
  pending,
  problem,
  onCreate,
  onCancel,
}: {
  start: Draft;
  taken: string[];
  agents: Agent[];
  archived: boolean;
  pending: boolean;
  problem: Failure | null;
  onCreate: (name: string, draft: Draft) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [newName, setNewName] = useState("");
  const [draft, setDraft] = useState(start);
  // The graph measures its box when it mounts: only once the dialog is shown, or it fits into nothing.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    // Unmounting an open modal skips the native close steps: give the focus back by hand.
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    setShown(true);
    return () => opener?.focus();
  }, []);
  const nameProblem = !newName
    ? null
    : !TEAM_NAME.test(newName) || newName.length > MAX_TEAM_NAME
      ? "Nom invalide : lettres minuscules, chiffres et tirets, sans tiret au début"
      : taken.includes(newName)
        ? "Ce nom est déjà pris"
        : null;
  const { steps } = draft;
  return (
    // Escape closes the dialog natively, which is « Annuler ».
    <dialog
      ref={ref}
      aria-labelledby="team-new-title"
      onClose={onCancel}
      className="m-auto w-[min(48rem,calc(100%-2rem))] rounded-xl border border-border-strong bg-background p-4 text-foreground backdrop:bg-background/80"
    >
      <h3 id="team-new-title" className="font-heading text-lg font-bold">
        Nouvelle équipe
      </h3>
      <label htmlFor="team-new" className="mt-3 block">
        Nom de l'équipe
      </label>
      <input
        id="team-new"
        className={field}
        value={newName}
        aria-describedby="team-new-problem"
        onChange={(e) => setNewName(e.target.value)}
      />
      <p id="team-new-problem" className="mt-2 empty:hidden">
        {nameProblem}
      </p>
      {shown && (
        <StepEditor
          steps={steps}
          onSteps={(next) => setDraft({ ...draft, steps: next })}
          agents={agents}
          archived={archived}
          withAdd
        />
      )}
      {problem && <Problem problem={problem} />}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={
            archived ||
            pending ||
            !newName ||
            nameProblem !== null ||
            steps.length === 0 ||
            !steps.every((s) => s.loopTo === null || s.until.trim() !== "")
          }
          onClick={() => onCreate(newName, draft)}
          className={primaryButton}
        >
          Créer l'équipe
        </button>
        <button type="button" onClick={onCancel} className={button}>
          Annuler
        </button>
      </div>
    </dialog>
  );
}

/** Decisions 031 and 032: a team (`.claude/team.md` or `.claude/teams/<name>.md`) as a graph on one draft, saved by a commit shown before as a diff. */
export function ProjectTeam({
  projectId,
  fullName,
  archived,
  hidden,
  agents,
  team,
  teams,
  onSaved,
  onEditAgent,
  onTeamSteps,
}: {
  projectId: string;
  fullName: string;
  archived: boolean;
  /** While an agent form is open: the section steps aside, its draft is kept. */
  hidden: boolean;
  agents: Agent[];
  team: string | null;
  teams: { name: string; text: string }[];
  onSaved: () => void;
  onEditAgent: (name: string) => void;
  /** Tells the right column which agents the team shown has, and how to add one last (decision 042 C); null while the team cannot be edited. */
  onTeamSteps: (
    team: { agents: string[]; add: (agent: string) => void } | null,
  ) => void;
}) {
  // The team shown: null is the default one. A named team that is not in `teams` yet is a new one, started from `copy`.
  const [name, setName] = useState<string | null>(null);
  const [copy, setCopy] = useState<Draft>({ steps: DEFAULT_STEPS, body: "" });
  const current =
    name === null ? team : (teams.find((t) => t.name === name)?.text ?? null);
  const initial = useMemo<Draft | null>(
    () =>
      current !== null
        ? readTeam(current)
        : name === null
          ? { steps: DEFAULT_STEPS, body: "" }
          : copy,
    [current, name, copy],
  );
  const [draft, setDraft] = useState(initial);
  const key = `${name ?? ""}:${current}`;
  const [seen, setSeen] = useState(key);
  const [switchTo, setSwitchTo] = useState<string | null>(null);
  // The draft of the new team while its dialog is open, started from the current team as read.
  const [creating, setCreating] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [problem, setProblem] = useState<Failure | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  // Another team or a new text read (after a commit or a conflict) starts a new draft; a re-read of the same text keeps the edits.
  if (seen !== key) {
    setSeen(key);
    setDraft(initial);
    setShowDiff(false);
  }

  const shownSteps = draft?.steps;
  useEffect(
    () =>
      onTeamSteps(
        shownSteps
          ? {
              agents: shownSteps.map((s) => s.agent),
              add: (agent) =>
                setDraft((d) => d && { ...d, steps: addStep(d.steps, agent) }),
            }
          : null,
      ),
    [shownSteps, onTeamSteps],
  );

  const commit = useMutation({
    mutationFn: async (sent: {
      name: string | null;
      before: string | null;
      after: string | null;
      created?: Draft;
    }) => {
      const res = await client.api.projects[":id"].team.apply.$post(
        { param: { id: projectId } },
        {
          init: {
            body: JSON.stringify({
              ...sent,
              name: sent.name ?? undefined,
              created: undefined,
            }),
            headers: { "content-type": "application/json" },
          },
        },
      );
      return res.ok
        ? { done: await res.json() }
        : { failure: await failure(res) };
    },
    onSuccess: (answer, { after, name: savedName, created }) => {
      if (answer.failure) {
        setProblem(answer.failure);
        if (answer.failure.code !== "repo_changed") return;
      } else {
        const { commitSha, pullRequest } = answer.done;
        if (after === null) setName(null); // the team is gone: back to the default one
        if (created) {
          // Not in `teams` until the reload below answers: the picker and the draft start from what was sent.
          setCopy(created);
          setName(savedName);
          setCreating(null);
        }
        setDone({
          url:
            pullRequest?.url ??
            `https://github.com/${fullName}/commit/${commitSha}`,
          pullRequest: pullRequest !== undefined,
        });
      }
      onSaved();
    },
    onError: () => setProblem({ code: "", status: 0 }),
  });

  const dirty =
    draft !== null &&
    initial !== null &&
    writeTeam(draft.steps, draft.body) !==
      writeTeam(initial.steps, initial.body);
  const goTo = (next: string | null) => {
    setName(next);
    setSwitchTo(null);
    setCreating(null);
    setDeleting(false);
    setProblem(null);
    setDone(null);
  };
  const picker = (
    <>
      <label htmlFor="team-pick" className="mt-3 block">
        Équipe
      </label>
      <select
        id="team-pick"
        className={field}
        value={name ?? ""}
        // A save or a removal in flight answers for the team it was sent for: no switching meanwhile.
        disabled={commit.isPending}
        onChange={(e) => {
          const next = e.target.value || null;
          if (!dirty) return goTo(next);
          setCreating(null);
          setDeleting(false);
          setSwitchTo(next ?? "");
        }}
      >
        <option value="">Par défaut (team.md)</option>
        {/* A new team is not in the repo yet. */}
        {(current === null && name !== null
          ? [...teams.map((t) => t.name), name]
          : teams.map((t) => t.name)
        ).map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      {switchTo !== null && (
        <div className="mt-3">
          <p id="switch-team-warning">
            Les changements non enregistrés seront perdus
          </p>
          <button
            type="button"
            aria-describedby="switch-team-warning"
            disabled={commit.isPending}
            onClick={() => goTo(switchTo || null)}
            className={`mt-2 ${button}`}
          >
            Confirmer le changement
          </button>
          <button
            type="button"
            aria-describedby="switch-team-warning"
            // The select that asked keeps its value: focus goes to the safe choice.
            // biome-ignore lint/a11y/noAutofocus: focus moves with the confirmation the user just asked for
            autoFocus
            onClick={() => setSwitchTo(null)}
            className={`mt-2 ml-2 ${button}`}
          >
            Annuler
          </button>
        </div>
      )}
      {name !== null && current !== null && (
        <p className="mt-3">
          Pour la lancer :{" "}
          <code>
            /dev-us {"<US>"} --team {name}
          </code>
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={archived || commit.isPending}
          onClick={() => {
            setSwitchTo(null);
            setDeleting(false);
            setProblem(null);
            setDone(null);
            setCreating(initial ?? { steps: DEFAULT_STEPS, body: "" });
          }}
          className={button}
        >
          Nouvelle équipe
        </button>
        {name !== null && current !== null && !deleting && (
          <button
            type="button"
            disabled={archived || commit.isPending}
            onClick={() => {
              setSwitchTo(null);
              setCreating(null);
              setDeleting(true);
            }}
            className={button}
          >
            Supprimer l'équipe
          </button>
        )}
      </div>
      {creating && (
        <NewTeamDialog
          start={creating}
          taken={teams.map((t) => t.name)}
          agents={agents}
          archived={archived}
          pending={commit.isPending}
          problem={problem}
          onCreate={(newName, created) =>
            commit.mutate({
              name: newName,
              before: null,
              after: writeTeam(created.steps, created.body),
              created,
            })
          }
          onCancel={() => {
            setCreating(null);
            setProblem(null);
          }}
        />
      )}
      {deleting && (
        <div className="mt-3">
          <p id="delete-team-warning">
            L'équipe sera retirée du repo par un commit
          </p>
          <button
            type="button"
            aria-describedby="delete-team-warning"
            disabled={archived || commit.isPending}
            onClick={() => {
              setProblem(null);
              setDone(null);
              setDeleting(false);
              commit.mutate({ name, before: current, after: null });
            }}
            className={`mt-2 min-h-10 rounded-xl bg-destructive px-4 font-semibold text-card disabled:opacity-50 ${focusRing}`}
          >
            Confirmer la suppression
          </button>
          <button
            type="button"
            aria-describedby="delete-team-warning"
            // The button that asked is gone: keep the keyboard focus on the safe choice.
            // biome-ignore lint/a11y/noAutofocus: focus moves with the confirmation the user just asked for
            autoFocus
            onClick={() => setDeleting(false)}
            className={`mt-2 ml-2 ${button}`}
          >
            Annuler
          </button>
        </div>
      )}
    </>
  );
  const heading = (
    <h2 id="team" className="font-heading text-xl font-bold">
      Équipe
    </h2>
  );
  if (!draft)
    return (
      <section aria-labelledby="team" hidden={hidden}>
        {heading}
        {picker}
        <p className="mt-3">
          {name === null ? "Ce team.md contient" : "Cette équipe contient"} des
          lignes que Cockpit ne sait pas réécrire : modifie-le sur GitHub
        </p>
      </section>
    );

  const { steps, body } = draft;
  const after = writeTeam(steps, body);
  // Compared with the draft as opened, not the file text: a file Cockpit would only reformat is not a change. Without a file the default steps are still worth a commit.
  const unchanged =
    current !== null &&
    initial !== null &&
    after === writeTeam(initial.steps, initial.body);
  const lines = showDiff ? diffLines(current ?? "", after) : null;
  const canCommit =
    !archived &&
    !commit.isPending &&
    !unchanged &&
    steps.length > 0 &&
    steps.every((s) => s.loopTo === null || s.until.trim() !== "");

  return (
    <section aria-labelledby="team" hidden={hidden}>
      {heading}
      {picker}
      <StepEditor
        key={key}
        steps={steps}
        onSteps={(next) => setDraft({ steps: next, body })}
        agents={agents}
        archived={archived}
        onEditAgent={onEditAgent}
      />
      {problem && !creating && <Problem problem={problem} />}
      {done && (
        <div className="mt-3 rounded-xl bg-done-soft p-4 text-done-text">
          <p>
            {done.pullRequest
              ? "La branche par défaut est protégée : une pull request est ouverte"
              : "C'est fait"}
          </p>
          <a href={done.url} className={`underline ${focusRing}`}>
            {done.pullRequest ? "Voir la pull request" : "Voir le commit"}
          </a>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={unchanged}
          onClick={() => setShowDiff(true)}
          className={button}
        >
          Voir les changements
        </button>
        <button
          type="button"
          disabled={!canCommit}
          onClick={() => {
            setProblem(null);
            setDone(null);
            commit.mutate({ name, before: current, after });
          }}
          className={primaryButton}
        >
          Faire le commit
        </button>
      </div>
      {showDiff &&
        (lines ? (
          <DiffList lines={lines} />
        ) : (
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-sm">
            {after}
          </pre>
        ))}
    </section>
  );
}
