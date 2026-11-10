import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { AGENT_NAME, MAX_TEAM_NAME } from "../server/team.ts";
import { parseAgent } from "./agent-file.ts";
import { type Failure, ProblemAlert } from "./ProjectPrepare.tsx";
import type { StarterTeams } from "./ProjectTeam.tsx";
import {
  addParallelTo,
  addStep,
  DRAG_TYPE,
  groupsOf,
  insertAtGroup,
  insertStepAfter,
  keyOf,
  linkOnCanvas,
  moveStep,
  parseMax,
  removeStep,
  stepLabel,
  type TeamStep,
  teamChecks,
  teamSummary,
  tidy,
  untilChoice,
} from "./team-file.ts";
import {
  badge,
  button,
  card,
  field,
  ghostButton,
  listCard,
  primaryButton,
  sectionLabel,
} from "./ui.ts";

// React Flow stays out of the main bundle (decision 031 B); the lists and the panel work while it loads.
const Graph = lazy(() => import("./TeamCanvasGraph.tsx"));

// Decision 074 B: the text of an agent a team needs and the repo lacks comes from the starter teams, in this order.
const LEVEL_ORDER = ["standard", "premium", "max", "eco"];

/** The development agents of the catalog: those of the four starter teams, one text each. */
export function catalogAgents({ teams }: StarterTeams) {
  const found = new Map<string, string>();
  for (const id of LEVEL_ORDER)
    for (const { name, text } of teams.find((t) => t.id === id)?.agents ?? [])
      if (!found.has(name)) found.set(name, text);
  return found;
}

type Agent = { name: string; text: string | null };
type Draft = { steps: TeamStep[]; body: string };
type AgentFile = { name: string; before: null; after: string };
/** A `link` is the « puis » link after the step `key`, up to the step labelled `to`. */
type Selection = { kind: "step" | "loop" | "link"; key: string; to?: string };
type History = { past: TeamStep[][]; steps: TeamStep[]; future: TeamStep[][] };

/** The steps in a list for the keyboard (decision 031 F, 079 D7): hidden from `sm` up until it has the focus when `className` says so. */
export function StepList({
  steps,
  className,
  onMove,
  onSelect,
}: {
  steps: TeamStep[];
  className: string;
  onMove: (key: string, direction: "up" | "down") => void;
  onSelect: (key: string) => void;
}) {
  const uid = useId();
  const [moved, setMoved] = useState<{ key: string; dir: "up" | "down" }>();
  // A moved row's DOM node is reinserted, which drops the focus: put it back on the button that was used (or its sibling at the end of the list).
  useEffect(() => {
    if (!moved) return;
    const at = (dir: string) =>
      document.getElementById(
        `${uid}-move-${dir}-${moved.key}`,
      ) as HTMLButtonElement | null;
    const other = moved.dir === "up" ? "down" : "up";
    const target = at(moved.dir)?.disabled ? at(other) : at(moved.dir);
    target?.focus();
  }, [moved, uid]);
  return (
    <ul className={`${listCard} ${className}`}>
      {steps.map((s, i) => (
        <li
          key={keyOf(s)}
          className="flex min-h-[50px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2"
        >
          <span className="font-semibold">{i + 1}</span>{" "}
          <span className="font-mono font-semibold">{stepLabel(s)}</span>{" "}
          <span>{s.does}</span>
          {s.parallel && (
            <span className="text-muted-foreground">
              en même temps que {stepLabel(steps[i - 1] as TeamStep)}
            </span>
          )}
          {s.loopTo !== null && (
            <span className="text-muted-foreground">
              Boucle vers {s.loopTo} : {s.until}
              {s.max !== undefined && ` · ${s.max} fois au plus`}
            </span>
          )}
          <span className="flex gap-2 sm:ml-auto">
            {(["up", "down"] as const).map((dir) => (
              <button
                key={dir}
                type="button"
                id={`${uid}-move-${dir}-${keyOf(s)}`}
                disabled={dir === "up" ? i === 0 : i === steps.length - 1}
                onClick={() => {
                  onMove(keyOf(s), dir);
                  setMoved({ key: keyOf(s), dir });
                }}
                className={button}
              >
                {dir === "up" ? "Monter" : "Descendre"}
              </button>
            ))}
            <button
              type="button"
              onClick={() => onSelect(keyOf(s))}
              className={button}
            >
              Modifier
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** « Quand suivre ce lien », its text, « Au plus » and the fixed sentence of decision 079 C: shared by the panel of a step and of a loop. */
function LoopFields({
  uid,
  step,
  onChange,
}: {
  uid: string;
  step: TeamStep;
  onChange: (patch: Partial<TeamStep>) => void;
}) {
  // « Une condition à toi » is any other text: its `until` starts empty.
  const choices = ["the verdict is ready", "the tests pass", "always", ""];
  const current = untilChoice(step.until, step.agent);
  return (
    <>
      <label htmlFor={`${uid}-when`} className="mt-3 block">
        Quand suivre ce lien
      </label>
      <select
        id={`${uid}-when`}
        className={field}
        value={current}
        onChange={(e) =>
          onChange({
            until:
              choices.find(
                (c) => untilChoice(c, step.agent) === e.target.value,
              ) ?? "",
          })
        }
      >
        {choices.map((c) => (
          <option key={c} value={untilChoice(c, step.agent)}>
            {untilChoice(c, step.agent)}
          </option>
        ))}
      </select>
      {current === untilChoice("", step.agent) && (
        <>
          <label htmlFor={`${uid}-until`} className="mt-3 block">
            Jusqu'à ce que
          </label>
          <input
            id={`${uid}-until`}
            className={field}
            value={step.until}
            onChange={(e) => onChange({ until: e.target.value })}
          />
        </>
      )}
      <label htmlFor={`${uid}-max`} className="mt-3 block">
        Au plus
      </label>
      <input
        id={`${uid}-max`}
        type="number"
        min={1}
        max={9}
        className={field}
        value={step.max ?? ""}
        onChange={(e) => onChange({ max: parseMax(e.target.value) })}
      />
      <p className="mt-2 text-[12.5px] text-muted-foreground">
        Si la limite est atteinte, Claude s'arrête et te pose la question
      </p>
    </>
  );
}

/** « Nom de l'étape »: the `id` is only applied while it is a free key. */
function IdField({
  uid,
  step,
  taken,
  onRename,
}: {
  uid: string;
  step: TeamStep;
  taken: (key: string) => boolean;
  onRename: (id: string | undefined) => void;
}) {
  const [text, setText] = useState(step.id ?? "");
  const bad =
    (text !== "" && !AGENT_NAME.test(text)) || taken(text || step.agent);
  return (
    <>
      <label htmlFor={`${uid}-id`} className="mt-3 block">
        Nom de l'étape
      </label>
      <input
        id={`${uid}-id`}
        className={field}
        value={text}
        aria-invalid={bad}
        aria-describedby={`${uid}-id-problem`}
        onChange={(e) => {
          setText(e.target.value);
          const free =
            (e.target.value === "" || AGENT_NAME.test(e.target.value)) &&
            !taken(e.target.value || step.agent);
          if (free) onRename(e.target.value || undefined);
        }}
      />
      <p id={`${uid}-id-problem`} className="mt-1 empty:hidden">
        {bad &&
          "Nom invalide ou déjà pris : lettres minuscules, chiffres et tirets"}
      </p>
    </>
  );
}

/** What the team canvas draws a step with: the agent file (the model and the tools are read there), and where the agent comes from. */
function StepPanel({
  uid,
  steps,
  step,
  agentText,
  origin,
  onChange,
  onRename,
  onRemove,
}: {
  uid: string;
  steps: TeamStep[];
  step: TeamStep;
  agentText: string | null | undefined;
  origin: string;
  onChange: (key: string, patch: Partial<TeamStep>) => void;
  onRename: (id: string | undefined) => void;
  onRemove: () => void;
}) {
  const key = keyOf(step);
  const index = steps.indexOf(step);
  const groups = groupsOf(steps);
  const group = groups.find((g) => g.includes(step)) as TeamStep[];
  const head = group[0] as TeamStep;
  const before = groups.slice(0, groups.indexOf(group)).flat();
  const fields = agentText ? parseAgent(agentText) : null;
  return (
    <>
      <h3 className="font-heading font-bold">Étape sélectionnée</h3>
      <p className="mt-2 font-mono font-semibold">{step.agent}</p>
      <p className="text-[12.5px] text-muted-foreground">{origin}</p>
      {fields && (
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          Modèle : {fields.model || "celui de la session"} · Outils :{" "}
          {fields.tools || "tous"}
        </p>
      )}
      <IdField
        uid={uid}
        step={step}
        taken={(k) => steps.some((s) => s !== step && keyOf(s) === k)}
        onRename={onRename}
      />
      <label htmlFor={`${uid}-does`} className="mt-3 block">
        Consigne pour cette étape
      </label>
      <input
        id={`${uid}-does`}
        className={field}
        value={step.does}
        onChange={(e) => onChange(key, { does: e.target.value })}
      />
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        S'ajoute à la consigne de l'agent, seulement dans cette équipe.
      </p>
      <label className="mt-3 flex items-center gap-2">
        <input
          type="checkbox"
          disabled={index === 0}
          checked={step.parallel === true}
          onChange={(e) =>
            onChange(key, { parallel: e.target.checked || undefined })
          }
        />
        En même temps que l'étape d'avant
      </label>
      {group.length > 1 && (
        <>
          <label htmlFor={`${uid}-wait`} className="mt-3 block">
            Quand plusieurs liens arrivent
          </label>
          <select
            id={`${uid}-wait`}
            className={field}
            value={head.wait ?? "all"}
            onChange={(e) =>
              onChange(keyOf(head), {
                wait: e.target.value === "first" ? "first" : undefined,
              })
            }
          >
            <option value="all">Attendre tous</option>
            <option value="first">Le premier suffit</option>
          </select>
          {head.wait === "first" && (
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              Le travail des autres branches est abandonné.
            </p>
          )}
        </>
      )}
      <label htmlFor={`${uid}-loop`} className="mt-3 block">
        Boucle
      </label>
      <select
        id={`${uid}-loop`}
        className={field}
        value={step.loopTo ?? ""}
        onChange={(e) =>
          onChange(
            key,
            e.target.value
              ? {
                  loopTo: e.target.value,
                  until: step.until || "the verdict is ready",
                  max: step.max ?? 3,
                }
              : { loopTo: null, until: "", max: undefined },
          )
        }
      >
        <option value="">Aucune</option>
        {[...before, step].map((s) => (
          <option key={keyOf(s)} value={keyOf(s)}>
            {stepLabel(s)}
          </option>
        ))}
      </select>
      {step.loopTo !== null && (
        <LoopFields uid={uid} step={step} onChange={(p) => onChange(key, p)} />
      )}
      <button type="button" onClick={onRemove} className={`mt-4 ${button}`}>
        Retirer l'étape
      </button>
    </>
  );
}

/** Decision 079: a team on a full-screen canvas, on its own draft, so the team shown behind it is never edited by mistake (042). */
export function TeamCanvas({
  back,
  edit,
  defaultTeam,
  start,
  taken,
  repo,
  catalog,
  archived,
  pending,
  problem,
  onSave,
  onCancel,
}: {
  /** The header button, « ‹ <projet> · Agents »: it is « Annuler ». */
  back: string;
  /** The name of a team being edited: shown, not editable, and the canvas saves instead of creating. */
  edit?: string;
  /** The team of `.claude/team.md`. */
  defaultTeam?: boolean;
  start: Draft;
  taken: string[];
  /** The agents of the repo; absent on the page of the user's teams, which has only the catalogue (074 B6). */
  repo?: Agent[];
  /** The catalogue agents: name and text. */
  catalog: Map<string, string>;
  archived: boolean;
  pending: boolean;
  problem: Failure | null;
  /** `added`: the catalogue agents the repo lacks and the team uses (decision 074 B7). */
  onSave: (name: string, draft: Draft, added: AgentFile[]) => void;
  onCancel: () => void;
}) {
  const uid = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [name, setName] = useState(edit ?? "");
  const [history, setHistory] = useState<History>({
    past: [],
    steps: start.steps,
    future: [],
  });
  const [selected, setSelected] = useState<Selection | null>(null);
  // The graph measures its box when it mounts: only once the dialog is shown, or it fits into nothing.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    // Unmounting an open modal skips the native close steps: give the focus back by hand.
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    setShown(true);
    return () => opener?.focus();
  }, []);

  const { steps } = history;
  const setSteps = (next: TeamStep[]) =>
    setHistory((h) => ({
      past: [...h.past, h.steps],
      steps: next,
      future: [],
    }));
  const known = useMemo(
    () => [
      ...(repo ?? []),
      ...[...catalog]
        .filter(([n]) => !repo?.some((a) => a.name === n))
        .map(([n, text]) => ({ name: n, text })),
    ],
    [repo, catalog],
  );
  const inCatalog = useMemo(
    () => [...catalog.keys()].filter((n) => !repo?.some((a) => a.name === n)),
    [repo, catalog],
  );
  const palette = useMemo(
    () => [...(repo?.map((a) => a.name) ?? []), ...inCatalog],
    [repo, inCatalog],
  );
  const fromCatalog = (n: string) =>
    !repo?.some((a) => a.name === n) && catalog.has(n);

  const nameProblem =
    edit !== undefined || !name
      ? null
      : !AGENT_NAME.test(name) || name.length > MAX_TEAM_NAME
        ? "Nom invalide : lettres minuscules, chiffres et tirets, sans tiret au début"
        : taken.includes(name)
          ? "Ce nom est déjà pris"
          : null;
  const checks = teamChecks(steps);
  const chosen = steps.find((s) => keyOf(s) === selected?.key);
  // A selection is only kept while its step (or its loop) exists.
  const target =
    chosen && (selected?.kind !== "loop" || chosen.loopTo !== null)
      ? chosen
      : null;

  const change = (key: string, patch: Partial<TeamStep>) =>
    setSteps(
      tidy(steps.map((s) => (keyOf(s) === key ? { ...s, ...patch } : s))),
    );
  // A new `id` is a new key: the loops that named the old one follow it.
  const rename = (step: TeamStep, id: string | undefined) => {
    const [from, to] = [keyOf(step), id ?? step.agent];
    const named = (s: TeamStep) =>
      s.loopTo === from ? { ...s, loopTo: to } : s;
    setSteps(steps.map((s) => (s === step ? { ...named(s), id } : named(s))));
    setSelected(selected && { ...selected, key: to });
  };
  const remove = (key: string) => {
    setSteps(removeStep(steps, key));
    setSelected(null);
    // The button that asked is gone: the keyboard stays in the panel.
    panelRef.current?.focus();
  };
  const link = (from: string, to: string) => {
    const next = linkOnCanvas(steps, from, to);
    if (next === steps) return;
    const loop = next.find((s) => keyOf(s) === from)?.loopTo === to;
    setSteps(next);
    // A new loop is selected to be set.
    setSelected(loop ? { kind: "loop", key: from } : null);
  };
  const undo = () =>
    setHistory(({ past, steps: now, future }) =>
      past.length === 0
        ? { past, steps: now, future }
        : {
            past: past.slice(0, -1),
            steps: past.at(-1) as TeamStep[],
            future: [now, ...future],
          },
    );
  const redo = () =>
    setHistory(({ past, steps: now, future }) =>
      future.length === 0
        ? { past, steps: now, future }
        : {
            past: [...past, now],
            steps: future[0] as TeamStep[],
            future: future.slice(1),
          },
    );

  const save = () =>
    onSave(
      name,
      { steps, body: start.body },
      [...new Set(steps.map((s) => s.agent))].flatMap((n) =>
        repo && fromCatalog(n)
          ? [{ name: n, before: null, after: catalog.get(n) as string }]
          : [],
      ),
    );

  const [search, setSearch] = useState("");
  const matches = (n: string) => n.includes(search.trim().toLowerCase());
  const group = (label: string, names: string[]) => (
    <fieldset className="mt-3 min-w-0">
      <legend className={sectionLabel}>{label}</legend>
      <div className="mt-1 flex flex-col gap-1">
        {names.filter(matches).map((n) => (
          <button
            key={n}
            type="button"
            draggable
            onDragStart={(e) => e.dataTransfer.setData(DRAG_TYPE, n)}
            onClick={() => setSteps(addStep(steps, n))}
            className={`${button} justify-start font-mono`}
          >
            {n}
          </button>
        ))}
      </div>
    </fieldset>
  );

  const verified = (
    <>
      <h4 className={`mt-4 ${sectionLabel}`}>Ce que Cockpit vérifie</h4>
      <ul className="mt-1">
        {checks.map((c) => (
          <li key={c.text}>
            <span aria-hidden="true">{c.ok ? "✓" : "✗"}</span> {c.text}
          </li>
        ))}
      </ul>
    </>
  );

  return (
    // Escape closes the dialog natively, which is « Annuler ».
    <dialog
      ref={ref}
      aria-label={`${edit === undefined ? "Nouvelle équipe" : "Modifier l'équipe"} · ${name}`}
      onClose={onCancel}
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-background p-0 text-foreground backdrop:bg-background/80 open:flex open:flex-col"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2">
        <button type="button" onClick={onCancel} className={ghostButton}>
          {back}
        </button>
        <span className="font-heading font-bold">
          {edit === undefined ? "Nouvelle équipe" : "Modifier l'équipe"} ·
        </span>
        <input
          aria-label="Nom de l'équipe"
          className={`${field} mt-0 w-56`}
          value={name}
          readOnly={edit !== undefined}
          aria-describedby={`${uid}-name-problem`}
          onChange={(e) => setName(e.target.value)}
        />
        <span className={badge}>brouillon</span>
        <span className="text-[12.5px] text-muted-foreground">
          {teamSummary(steps)}
        </span>
        <span className="flex gap-2 sm:ml-auto">
          <button type="button" onClick={onCancel} className={button}>
            Annuler
          </button>
          <button
            type="button"
            disabled={
              archived ||
              pending ||
              !name ||
              nameProblem !== null ||
              steps.length === 0 ||
              !checks.every((c) => c.ok)
            }
            onClick={save}
            className={primaryButton}
          >
            {edit === undefined ? "Créer l'équipe" : "Enregistrer"}
          </button>
        </span>
        <p id={`${uid}-name-problem`} className="w-full empty:hidden">
          {nameProblem}
        </p>
        {problem && (
          <div className="w-full">
            <ProblemAlert problem={problem} />
          </div>
        )}
      </header>
      <div className="grid min-h-0 flex-1 gap-3 overflow-auto p-3 lg:grid-cols-[15rem_minmax(0,1fr)_20rem]">
        <aside aria-label="Agents" className="min-w-0">
          <input
            aria-label="Chercher un agent…"
            placeholder="Chercher un agent…"
            className={`${field} mt-0`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {repo &&
            group(
              "Agents du repo",
              repo.map((a) => a.name),
            )}
          {group("Catalogue de Cockpit", inCatalog)}
          <p className="mt-3 text-[12.5px] text-muted-foreground">
            Glisse un agent sur le canevas, ou sur un lien pour l'intercaler.
          </p>
        </aside>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={history.past.length === 0}
              onClick={undo}
              className={button}
            >
              Défaire
            </button>
            <button
              type="button"
              disabled={history.future.length === 0}
              onClick={redo}
              className={button}
            >
              Refaire
            </button>
          </div>
          <div
            className={`${card} relative hidden h-[max(28rem,calc(100dvh-13rem))] sm:block`}
          >
            {shown && (
              <Suspense
                fallback={
                  <p role="status" className="text-muted-foreground">
                    Chargement du canevas…
                  </p>
                }
              >
                <Graph
                  id={uid}
                  steps={steps}
                  agents={known}
                  selected={target && selected}
                  onSelect={setSelected}
                  onLink={link}
                  onDropAt={(drop, agent) =>
                    setSteps(
                      "after" in drop
                        ? insertStepAfter(steps, drop.after, agent)
                        : "parallelTo" in drop
                          ? addParallelTo(steps, drop.parallelTo, agent)
                          : insertAtGroup(steps, drop.group, agent),
                    )
                  }
                  onRemoveStep={remove}
                  onRemoveLoop={(key) => {
                    change(key, { loopTo: null, until: "", max: undefined });
                    setSelected(null);
                  }}
                />
              </Suspense>
            )}
          </div>
          {/* The list stays for the keyboard (visually hidden from sm up) and is the only view on a phone (decision 079 D7). */}
          <StepList
            steps={steps}
            className="sm:not-focus-within:sr-only"
            onMove={(key, dir) => setSteps(moveStep(steps, key, dir))}
            onSelect={(key) => setSelected({ kind: "step", key })}
          />
        </div>
        <section
          ref={panelRef}
          tabIndex={-1}
          aria-label="Panneau"
          className={`${card} min-w-0 p-4 outline-none`}
        >
          {target && selected?.kind === "step" ? (
            <StepPanel
              key={steps.indexOf(target)}
              uid={uid}
              steps={steps}
              step={target}
              agentText={known.find((a) => a.name === target.agent)?.text}
              origin={
                repo
                  ? repo.some((a) => a.name === target.agent)
                    ? "Agent du repo"
                    : fromCatalog(target.agent)
                      ? "Agent du catalogue · sera ajouté à .claude/agents/ au commit."
                      : "Agent absent du repo"
                  : catalog.has(target.agent)
                    ? "Agent du catalogue"
                    : "Agent absent du catalogue"
              }
              onChange={change}
              onRename={(id) => rename(target, id)}
              onRemove={() => remove(keyOf(target))}
            />
          ) : target && selected?.kind === "link" ? (
            <>
              <h3 className="font-heading font-bold">
                Intercaler entre {stepLabel(target)} et {selected.to}
              </h3>
              <ul className="mt-2 flex flex-col gap-1">
                {palette.map((agent) => (
                  <li key={agent}>
                    <button
                      type="button"
                      onClick={() => {
                        setSteps(insertStepAfter(steps, keyOf(target), agent));
                        setSelected(null);
                      }}
                      className={`w-full text-left font-mono ${button}`}
                    >
                      {agent}
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className={`mt-3 ${button}`}
              >
                Annuler
              </button>
            </>
          ) : target ? (
            <>
              <h3 className="font-heading font-bold">
                Lien sélectionné · {stepLabel(target)} →{" "}
                {stepLabel(
                  steps.find((s) => keyOf(s) === target.loopTo) ?? target,
                )}
              </h3>
              <LoopFields
                uid={uid}
                step={target}
                onChange={(p) => change(keyOf(target), p)}
              />
              <button
                type="button"
                onClick={() => {
                  change(keyOf(target), {
                    loopTo: null,
                    until: "",
                    max: undefined,
                  });
                  setSelected(null);
                  panelRef.current?.focus();
                }}
                className={`mt-4 ${button}`}
              >
                Supprimer le lien
              </button>
            </>
          ) : (
            <>
              <h3 className="font-heading font-bold">L'équipe</h3>
              {verified}
              <h4 className={`mt-3 ${sectionLabel}`}>
                Le fichier qui sera écrit
              </h4>
              <p>
                <code>
                  {defaultTeam
                    ? ".claude/team.md"
                    : `.claude/teams/${name || "<nom>"}.md`}
                </code>
              </p>
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                lancé par{" "}
                <code>
                  /dev-us {"<US>"}
                  {defaultTeam ? "" : ` --team ${name || "<nom>"}`}
                </code>
              </p>
            </>
          )}
          {target && verified}
        </section>
      </div>
    </dialog>
  );
}
