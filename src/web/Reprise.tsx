// biome-ignore-all lint/suspicious/noThenProperty: "then" is the Then field of a Given/When/Then rule (decision 017)
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type RefObject, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { AnalyseWindow } from "./AnalyseWindow.tsx";
import { CodeView } from "./CodeView.tsx";
import { fetchCode, permalink } from "./conception.ts";
import {
  correctRule,
  keepRule,
  type Rule,
  type RuleText,
  reportBug,
  rulesKey,
  unkeepRule,
  useRules,
} from "./rules.ts";
import { Panel } from "./Shell.tsx";
import {
  alertBox,
  badge,
  button,
  card,
  field,
  focusRing,
  ghostButton,
  panelButton,
  panelPrimaryButton,
  primaryButton,
  sectionLabel,
  tabLink,
} from "./ui.ts";

type Source = Rule["sources"][number];

const lineRange = ({ startLine, endLine }: Source) =>
  startLine === endLine
    ? `ligne ${startLine}`
    : `lignes ${startLine}–${endLine}`;

/** Decision 047 G: the code of one source, read on GitHub at its commit, with the cited lines marked. */
function SourceCode({
  projectId,
  fullName,
  source,
}: {
  projectId: string;
  fullName: string;
  source: Source;
}) {
  const { path, startLine, endLine, commitSha } = source;
  const code = useQuery({
    queryKey: ["code", projectId, commitSha, path, startLine, endLine],
    queryFn: () =>
      fetchCode(projectId, {
        sha: commitSha,
        path,
        start: String(startLine),
        end: String(endLine),
      }),
    retry: false,
  });
  return (
    <>
      <p className="mt-4 mb-2.5 flex flex-wrap items-baseline gap-x-2">
        <code className="font-mono text-[11.5px]">{path}</code>
        <span className="text-[12.5px] text-muted-foreground">
          {lineRange(source)}
          {code.data && " · vérifié sur GitHub"}
        </span>
      </p>
      {code.isPending && (
        <p className="text-muted-foreground">Chargement du code…</p>
      )}
      {code.data && (
        <CodeView
          path={path}
          firstLine={code.data.firstLine}
          lines={code.data.lines}
          start={startLine}
          end={endLine}
        />
      )}
      {code.isError && (
        <p className="text-muted-foreground">
          Le code n'a pas pu être lu :{" "}
          <a
            href={permalink(fullName, commitSha, path, startLine, endLine)}
            target="_blank"
            rel="noreferrer noopener"
            className={`underline ${focusRing}`}
          >
            ouvre-le sur GitHub ↗
          </a>
        </p>
      )}
    </>
  );
}

/** One tab per source when the rule (or, decision 051 F, the finding) cites several (decision 047 G). */
export function RuleCode({
  projectId,
  fullName,
  sources,
}: {
  projectId: string;
  fullName: string;
  sources: Source[];
}) {
  const [at, setAt] = useState(0);
  const source = sources[at] ?? sources[0];
  if (!source) return null;
  const code = (
    <SourceCode
      key={at}
      projectId={projectId}
      fullName={fullName}
      source={source}
    />
  );
  if (sources.length === 1) return code;
  return (
    <>
      <div
        role="tablist"
        className="mt-4 flex flex-wrap gap-x-2 border-b border-border"
      >
        {sources.map((s, i) => (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: two sources can cite the same file
            key={i}
            type="button"
            role="tab"
            aria-selected={i === at}
            tabIndex={i === at ? 0 : -1}
            className={`${tabLink({ isActive: i === at })} font-mono text-[11.5px]`}
            onClick={() => setAt(i)}
          >
            {s.path}
          </button>
        ))}
      </div>
      <div role="tabpanel">{code}</div>
    </>
  );
}

const textOf = ({ summary, given, when, then }: Rule): RuleText => ({
  summary,
  given,
  when,
  then,
});

const FIELDS = [
  ["summary", "La règle"],
  ["given", "Étant donné"],
  ["when", "Quand"],
  ["then", "Alors"],
] as const;

const kbdOnWhite =
  "rounded-[5px] border border-primary-foreground/30 px-[5px] py-px font-mono text-[10.5px] font-medium";

/** Decision 047 J: an object of the map leads to the tab « Modèle »; an absent one is grey and says what to do. */
function ObjectChips({
  projectId,
  objects,
  onAnalyse,
}: {
  projectId: string;
  objects: Rule["objects"];
  onAnalyse: () => void;
}) {
  const absent = objects.filter((o) => !o.inMap).length;
  const chip =
    "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 font-mono text-[12px] whitespace-nowrap";
  return (
    <>
      <p className={sectionLabel}>Objets touchés</p>
      <ul className="flex flex-wrap gap-1.5">
        {objects.map((o) => (
          <li key={o.name}>
            {o.inMap ? (
              <Link
                to={`/projets/${projectId}/conception?objet=${encodeURIComponent(o.name)}`}
                className={`${chip} border-border-strong bg-raised hover:bg-raised-hover ${focusRing}`}
              >
                {o.name}
              </Link>
            ) : (
              <span
                className={`${chip} border-dashed border-border-strong text-dim`}
              >
                {o.name}
                <span className="font-sans text-[11px]">non cartographié</span>
              </span>
            )}
          </li>
        ))}
      </ul>
      {absent > 0 && (
        <>
          <p className="text-[13px] text-muted-foreground">
            {absent === 1
              ? "Cet objet n'est pas dans la carte du code. Relance l'analyse pour l'y ajouter."
              : "Ces objets ne sont pas dans la carte du code. Relance l'analyse pour les y ajouter."}
          </p>
          <Link
            to="#analyser"
            className={`self-start underline ${focusRing}`}
            onClick={(event) => {
              event.preventDefault();
              onAnalyse();
            }}
          >
            Relancer l'analyse
          </Link>
        </>
      )}
    </>
  );
}

/** Decision 047 E and I: the panel of one rule, its decisions and their keys. Keyed by the rule, so the correction form never follows to another one. */
function RulePanel({
  projectId,
  rule,
  position,
  total,
  archived,
  busy,
  failed,
  headingRef,
  go,
  onKeep,
  onBug,
  onSave,
  onAnalyse,
}: {
  projectId: string;
  rule: Rule;
  position: number;
  total: number;
  archived: boolean;
  busy: boolean;
  failed: boolean;
  headingRef: RefObject<HTMLHeadingElement | null>;
  go: (step: 1 | -1) => void;
  onKeep: () => void;
  onBug: () => void;
  onSave: (text: RuleText) => Promise<unknown>;
  onAnalyse: () => void;
}) {
  const [editing, setEditing] = useState<RuleText | null>(null);
  const kept = rule.state === "kept";
  const canDecide = !archived && !busy;

  // The form closed: the focus goes back to the heading, which the form had replaced.
  const wasEditing = useRef(false);
  useEffect(() => {
    if (wasEditing.current && !editing) headingRef.current?.focus();
    wasEditing.current = editing !== null;
  }, [editing, headingRef]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        editing
      )
        return;
      const target = event.target as HTMLElement;
      if (target.isContentEditable || target.closest("input, textarea, select"))
        return;
      const key = event.key.toLowerCase();
      if (key === "v" && canDecide && !kept) onKeep();
      else if (key === "m" && canDecide) setEditing(textOf(rule));
      else if (key === "b" && canDecide) onBug();
      else if (key === "p" || key === "j") go(1);
      else if (key === "k") go(-1);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [editing, canDecide, kept, rule, onKeep, onBug, go]);

  const incomplete =
    editing !== null && Object.values(editing).some((v) => v.trim() === "");

  return (
    <Panel
      label="Règle à juger"
      badge={
        <span className={badge}>
          Règle {position} sur {total}
        </span>
      }
      counter={{
        index: position - 1,
        total,
        onPrevious: () => go(-1),
        onNext: () => go(1),
        words: {
          count: kept ? "validée" : "à relire",
          previous: "Précédente",
          next: "Suivante",
        },
      }}
      footer={
        !editing && (
          <>
            <button
              type="button"
              className={panelPrimaryButton}
              disabled={!canDecide || kept}
              onClick={onKeep}
            >
              Valider la règle <kbd className={kbdOnWhite}>V</kbd>
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className={panelButton}
                disabled={!canDecide}
                onClick={() => setEditing(textOf(rule))}
              >
                Corriger le texte
              </button>
              <button
                type="button"
                className={panelButton}
                disabled={!canDecide}
                onClick={onBug}
              >
                C'est un bug
              </button>
            </div>
          </>
        )
      }
    >
      {editing ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (incomplete || busy) return;
            onSave({
              summary: editing.summary.trim(),
              given: editing.given.trim(),
              when: editing.when.trim(),
              then: editing.then.trim(),
            }).then(
              () => setEditing(null),
              () => {},
            );
          }}
        >
          {FIELDS.map(([name, text], index) => (
            <label key={name} className="block font-semibold">
              {text}
              <textarea
                // The button that opened the form is gone: keep the keyboard focus in it.
                // biome-ignore lint/a11y/noAutofocus: focus moves with the form the user just asked for
                autoFocus={index === 0}
                required
                rows={2}
                value={editing[name]}
                onChange={(event) =>
                  setEditing({ ...editing, [name]: event.target.value })
                }
                className={field}
              />
            </label>
          ))}
          <div className="mt-2 flex flex-col gap-2">
            <button
              type="submit"
              className={panelPrimaryButton}
              disabled={incomplete || busy}
            >
              Enregistrer
            </button>
            <button
              type="button"
              className={ghostButton}
              onClick={() => setEditing(null)}
            >
              Annuler
            </button>
          </div>
        </form>
      ) : (
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-lg leading-snug font-semibold focus:outline-none"
        >
          {rule.summary}
        </h2>
      )}
      <p className="text-[13.5px] leading-normal text-muted-foreground">
        {rule.reasoning}
      </p>
      {rule.doubt && (
        <div className={`${card} flex flex-col gap-1 px-3.5 py-3`}>
          <p className={sectionLabel}>Ce que Claude n'a pas pu trancher</p>
          <p className="text-[13px] leading-normal text-muted-foreground">
            {rule.doubt}
          </p>
        </div>
      )}
      {!editing && (
        <div className="grid gap-1 leading-normal">
          {(
            [
              ["Étant donné", rule.given],
              ["Quand", rule.when],
              ["Alors", rule.then],
            ] as const
          ).map(([label, text]) => (
            <p key={label}>
              <span className="font-semibold">{label}</span> {text}
            </p>
          ))}
        </div>
      )}
      {rule.objects.length > 0 && (
        <ObjectChips
          projectId={projectId}
          objects={rule.objects}
          onAnalyse={onAnalyse}
        />
      )}
      <p className={sectionLabel}>Une fois validée</p>
      <p className="text-[13px] text-muted-foreground">
        Claude écrit un test qui la fige, pour qu'aucun changement ne la casse
        sans que tu le saches.
      </p>
      {failed && (
        <p role="alert" className={alertBox}>
          La décision n'a pas pu être enregistrée : réessaie.
        </p>
      )}
    </Panel>
  );
}

/** Decision 047 E, I, J: the takeover screen, the code of the open rule in the center and the rule in the right panel. */
export function Reprise({
  projectId,
  fullName,
  archived,
}: {
  projectId: string;
  fullName: string;
  archived: boolean;
}) {
  const queryClient = useQueryClient();
  const query = useRules(projectId);
  const rules = query.data ?? [];
  const [params, setParams] = useSearchParams();
  const wanted = Number(params.get("regle"));
  const found = rules.findIndex((r) => r.id === wanted);
  // Opens on the first rule to decide, or on the rule of the URL.
  const index =
    found >= 0
      ? found
      : Math.max(
          0,
          rules.findIndex((r) => r.state === "pending"),
        );
  const rule = rules[index];
  const [analyse, setAnalyse] = useState(false);
  const [notice, setNotice] = useState<{ text: string; undo?: number } | null>(
    null,
  );
  // The rule the URL asked for when the screen loaded: said once if it is no longer to decide.
  const asked = useRef(params.get("regle"));
  useEffect(() => {
    if (!query.data || asked.current === null) return;
    if (!query.data.some((r) => String(r.id) === asked.current))
      setNotice({ text: "Cette règle n'est plus à trancher." });
    asked.current = null;
  }, [query.data]);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const open = (id: number | undefined) => {
    if (id !== undefined) setParams({ regle: String(id) }, { replace: true });
  };
  // The open rule is always in the URL, also when it was chosen by default or when the one asked for is gone.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `open` only reads the setter of the URL
  useEffect(() => {
    if (rule && params.get("regle") !== String(rule.id)) open(rule.id);
  }, [rule?.id, params]);

  // The panel heading takes the focus when another rule opens or the window closes, not when the screen loads.
  const seen = useRef<string>(undefined);
  const where = analyse ? "analyse" : String(rule?.id);
  useEffect(() => {
    if (!rule) return;
    if (seen.current !== undefined && seen.current !== where)
      headingRef.current?.focus();
    seen.current = where;
  }, [rule, where]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 8_000);
    return () => clearTimeout(timer);
  }, [notice]);

  const decision = useMutation({
    mutationFn: (act: () => Promise<unknown>) => act(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["story"] }),
    // A stale screen (rule already decided elsewhere, story validated, ticket abandoned): show the real state.
    onError: () =>
      queryClient.invalidateQueries({ queryKey: rulesKey(projectId) }),
  });
  const replace = (next: Rule) =>
    queryClient.setQueryData<Rule[]>(rulesKey(projectId), (old) =>
      old?.map((r) => (r.id === next.id ? next : r)),
    );
  const go = (step: 1 | -1) => open(rules[index + step]?.id);
  const keep = (target: Rule) =>
    decision.mutate(async () => {
      replace(await keepRule(target.id));
      setNotice({ text: "Règle validée.", undo: target.id });
      open(rules[index + 1]?.id);
    });
  const bug = (target: Rule) =>
    decision.mutate(async () => {
      await reportBug(target.id);
      queryClient.setQueryData<Rule[]>(rulesKey(projectId), (old) =>
        old?.filter((r) => r.id !== target.id),
      );
      setNotice({ text: "Bug noté dans un nouveau ticket." });
      open((rules[index + 1] ?? rules[index - 1])?.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tickets", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["home"] }),
      ]);
    });

  const undo = (id: number) =>
    decision.mutate(async () => {
      replace(await unkeepRule(id));
      setNotice(null);
      open(id);
    });

  const absent = rules.filter((r) => r.objects.some((o) => !o.inMap)).length;
  const analyseButton = (label: string) => (
    <button type="button" className={button} onClick={() => setAnalyse(true)}>
      {label}
    </button>
  );

  return (
    <>
      {query.isPending && <p className="text-muted-foreground">Chargement…</p>}
      {query.isError && (
        <div role="alert" className={alertBox}>
          <p>Impossible de lire les règles : réessaie dans un instant.</p>
          <button
            type="button"
            className={`mt-3 ${button}`}
            onClick={() => query.refetch()}
          >
            Réessayer
          </button>
        </div>
      )}
      {query.data && !rule && (
        <div className={`${card} flex flex-wrap items-center gap-3.5 p-4`}>
          <p className="min-w-0 flex-1">
            Pas encore de règle. Choisis une fonctionnalité à reprendre et
            Claude en tire les règles.
          </p>
          <button
            type="button"
            className={primaryButton}
            onClick={() => setAnalyse(true)}
          >
            Analyser avec Claude
          </button>
        </div>
      )}
      {absent > 0 && (
        <div className={`${card} mb-2 flex flex-wrap items-center gap-3.5 p-4`}>
          <p className="min-w-0 flex-1">
            {absent === 1
              ? "1 règle cite des objets absents de la carte. Relance l'analyse pour qu'elle les montre."
              : `${absent} règles citent des objets absents de la carte. Relance l'analyse pour qu'elle les montre.`}
          </p>
          {analyseButton("Relancer l'analyse")}
        </div>
      )}
      {notice && (
        <p
          role="status"
          className={`${card} mb-2 flex items-center justify-between gap-3 py-2 pr-2 pl-4`}
        >
          {notice.text}
          {notice.undo !== undefined && (
            <button
              type="button"
              className={ghostButton}
              onClick={() => undo(notice.undo as number)}
            >
              Annuler
            </button>
          )}
        </p>
      )}
      {rule && (
        <RuleCode
          key={`code-${rule.id}`}
          projectId={projectId}
          fullName={fullName}
          sources={rule.sources}
        />
      )}
      {analyse ? (
        <AnalyseWindow
          projectId={projectId}
          fullName={fullName}
          archived={archived}
          onClose={() => setAnalyse(false)}
        />
      ) : (
        rule && (
          <RulePanel
            key={`rule-${rule.id}`}
            projectId={projectId}
            rule={rule}
            position={index + 1}
            total={rules.length}
            archived={archived}
            busy={decision.isPending}
            failed={decision.isError}
            headingRef={headingRef}
            go={go}
            onKeep={() => keep(rule)}
            onBug={() => bug(rule)}
            onSave={(text) =>
              decision.mutateAsync(async () =>
                replace(await correctRule(rule.id, text)),
              )
            }
            onAnalyse={() => setAnalyse(true)}
          />
        )
      )}
    </>
  );
}
