import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import Markdown from "react-markdown";
import { AnalyseWindow } from "./AnalyseWindow.tsx";
import {
  closedOnGitHub,
  type Decision,
  decide,
  EFFORT_WORD,
  type Finding,
  findingsKey,
  kindWord,
  refreshFindings,
  SEVERITY_WORD,
  toDecide,
  useFindings,
} from "./findings.ts";
import { ACCESS_TEXT, AccessLink } from "./GithubAccess.tsx";
import { chip } from "./ProjectTeam.tsx";
import { RuleCode, SourceCode } from "./Reprise.tsx";
import { ROLE_REFUSAL } from "./roles.ts";
import { Panel } from "./Shell.tsx";
import {
  alertBox,
  badge,
  button,
  card,
  field,
  focusRing,
  ghostButton,
  listCard,
  markdownStyle,
  panelButton,
  panelPrimaryButton,
  primaryButton,
  sectionLabel,
} from "./ui.ts";
import {
  eolRows,
  eolWords,
  fullDate,
  longMonth,
  type Runtime,
  useVersions,
} from "./versions.ts";

const FILTERS = [
  ["all", "Tous"],
  ["bug", "Bugs"],
  ["security", "Failles"],
  ["upgrade", "Versions"],
  ["architecture", "Architecture"],
  ["stack", "Stack"],
  ["dismissed", "Rejetés"],
] as const;
type Filter = (typeof FILTERS)[number][0];

const MARK = {
  bug: "!",
  security: "✕",
  architecture: "·",
  stack: "·",
  upgrade: "·",
};
const ARCHIVED = "Projet archivé : rien ne s'y décide plus.";

const place = (f: Finding) =>
  f.sources[0] && `${f.sources[0].path}:${f.sources[0].startLine}`;

/** Decision 051 F, G, I: the right panel of one finding, its code and its three decisions. Keyed by the finding, so the reason never follows to another one. */
function FindingPanel({
  finding,
  projectId,
  fullName,
  archived,
  busy,
  onDecide,
  onClose,
}: {
  finding: Finding;
  projectId: string;
  fullName: string;
  archived: boolean;
  busy: boolean;
  onDecide: (action: Decision, reason?: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const off = archived || busy;
  // A ticketed or dismissed finding is settled: it only reads (decision 051 G).
  const closed = closedOnGitHub(finding);
  const decidable =
    (finding.status === "open" || finding.status === "later") && !closed;
  return (
    <Panel
      label="Constat"
      badge={
        <span className={badge}>
          {kindWord(finding)} · {SEVERITY_WORD[finding.severity]}
        </span>
      }
      footer={
        <>
          {decidable && (
            <>
              <button
                type="button"
                className={panelPrimaryButton}
                disabled={off}
                onClick={() => onDecide("ticket")}
              >
                En faire un ticket
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={panelButton}
                  disabled={off}
                  onClick={() => onDecide("dismiss", reason.trim())}
                >
                  Rejeter
                </button>
                <button
                  type="button"
                  className={panelButton}
                  disabled={off}
                  onClick={() => onDecide("later")}
                >
                  Plus tard
                </button>
              </div>
              {archived && (
                <p className="text-center text-[13px] text-muted-foreground">
                  {ARCHIVED}
                </p>
              )}
            </>
          )}
          <button type="button" className={ghostButton} onClick={onClose}>
            Fermer
          </button>
        </>
      }
    >
      <h2 className="text-lg leading-snug font-semibold">{finding.title}</h2>
      {finding.effort && (
        <p className="text-[13px] text-muted-foreground">
          Effort : {EFFORT_WORD[finding.effort]}
        </p>
      )}
      {finding.dismissReason && (
        <p className="text-[13px] text-muted-foreground">
          Rejeté : {finding.dismissReason}
        </p>
      )}
      {closed && (
        <p className="text-[13px] text-muted-foreground">Fermée sur GitHub</p>
      )}
      <div className={`text-[13.5px] leading-normal ${markdownStyle}`}>
        <Markdown disallowedElements={["img"]}>{finding.bodyMd}</Markdown>
      </div>
      {finding.unprotected &&
        (finding.kind === "architecture" || finding.kind === "stack") && (
          <p className="text-[13px] text-muted-foreground">
            Aucune règle figée ne protège ce code : reprends d'abord la
            fonctionnalité qui le touche.
          </p>
        )}
      {finding.githubUrl && (
        <a
          href={finding.githubUrl}
          target="_blank"
          rel="noreferrer noopener"
          className={`underline ${focusRing}`}
        >
          Voir l'alerte sur GitHub ↗
        </a>
      )}
      <RuleCode
        projectId={projectId}
        fullName={fullName}
        sources={finding.sources}
      />
      {decidable && (
        <label className="block font-semibold">
          Raison du rejet (facultative)
          <textarea
            rows={2}
            className={field}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      )}
    </Panel>
  );
}

/** One line of the list « Les autres constats »: its type, its place, and the severity as a word. A finding and a runtime in end of life look alike, so both go through here. */
function Row({
  id,
  mark,
  title,
  about,
  severity,
  onOpen,
}: {
  id: string | number;
  mark: string;
  title: string;
  about: string;
  severity: string;
  onOpen: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-label={`Ouvrir ${title}`}
        // The name stays « Ouvrir <titre> »; the type, the place and the severity are its description.
        aria-describedby={`about-${id} severity-${id}`}
        onClick={onOpen}
        className={`grid min-h-[50px] w-full grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3 px-[18px] py-2 text-left hover:bg-raised ${focusRing}`}
      >
        <span aria-hidden="true" className="text-center font-bold text-dim">
          {mark}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-semibold">{title}</span>
          <span
            id={`about-${id}`}
            className="block truncate text-[12.5px] text-muted-foreground"
          >
            {about}
          </span>
        </span>
        <span id={`severity-${id}`} className="text-xs text-muted-foreground">
          {severity}
        </span>
      </button>
    </li>
  );
}

/** Decision 052 J: « node 18 n'est plus maintenu », or « … ne sera plus maintenu en avril 2027 ». */
const runtimeTitle = (r: Runtime) =>
  r.state === "eol" || !r.eolFrom
    ? `${r.name} ${r.version} n'est plus maintenu`
    : `${r.name} ${r.version} ne sera plus maintenu en ${longMonth(r.eolFrom)}`;

type EolRow = ReturnType<typeof eolRows>[number];

/** Decision 052 J: the right panel of a runtime in end of life, not a finding: no decision, but a plan to ask Claude for. */
function RuntimePanel({
  row,
  projectId,
  fullName,
  onPlan,
  onClose,
}: {
  row: EolRow;
  projectId: string;
  fullName: string;
  onPlan: () => void;
  onClose: () => void;
}) {
  const { runtime } = row;
  return (
    <Panel
      label="Version"
      badge={
        <span className={badge}>
          version · {SEVERITY_WORD[runtime.state === "eol" ? "high" : "medium"]}
        </span>
      }
      footer={
        <>
          <button type="button" className={panelPrimaryButton} onClick={onPlan}>
            Demander un plan à Claude
          </button>
          <button type="button" className={ghostButton} onClick={onClose}>
            Fermer
          </button>
        </>
      }
    >
      <h2 className="text-lg leading-snug font-semibold">
        {runtimeTitle(runtime)}
      </h2>
      <p className="text-[13px] text-muted-foreground">
        {runtime.name} {runtime.version}
        {runtime.eolFrom && ` · Fin de vie : ${fullDate(runtime.eolFrom)}`}
      </p>
      {row.all.map((r) => (
        <section
          key={`${r.module.path}:${r.source.path}:${r.source.startLine}`}
          aria-label={r.module.name}
        >
          <h3 className="font-semibold">{r.module.name}</h3>
          <SourceCode
            projectId={projectId}
            fullName={fullName}
            source={r.source}
          />
        </section>
      ))}
    </Panel>
  );
}

/** Decision 051 D to I (screen S44): the fourth view of the tab « Conception », the findings of Claude to decide, the most serious alone on top and in red. */
export function Findings({
  projectId,
  fullName,
  archived,
}: {
  projectId: string;
  fullName: string;
  archived: boolean;
}) {
  const queryClient = useQueryClient();
  const query = useFindings(projectId);
  const [filter, setFilter] = useState<Filter>("all");
  // The right panel: a finding, a runtime in end of life (by its name and version), or the window of the analysis.
  const [openId, setOpenId] = useState<number | null>(null);
  const [openRuntime, setOpenRuntime] = useState<string | null>(null);
  const [analyse, setAnalyse] = useState(false);
  const versions = useVersions(projectId);
  const all = query.data ?? [];
  const shown =
    filter === "dismissed"
      ? all.filter((f) => f.status === "dismissed" || closedOnGitHub(f))
      : toDecide(all).filter((f) => filter === "all" || f.kind === filter);
  const rows =
    filter === "all" || filter === "upgrade"
      ? eolRows(versions.data ?? [])
      : [];
  const openRow = rows.find((r) => r.key === openRuntime);
  const [first, ...others] = filter === "dismissed" ? [] : shown;
  const rest = filter === "dismissed" ? shown : others;
  const open = all.find((f) => f.id === openId);
  const show = (id: number | null, runtime: string | null = null) => {
    setOpenId(id);
    setOpenRuntime(runtime);
  };

  const refresh = useMutation({
    mutationFn: () => refreshFindings(projectId),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: findingsKey(projectId) }),
  });
  const read = refresh.data;
  const disabled = read
    ? (
        [
          ["dependabot", "Dependabot"],
          ["code_scanning", "Code scanning"],
          ["secret_scanning", "Secret scanning"],
        ] as const
      ).filter(([tool]) => read.tools[tool] === "disabled")
    : [];

  const decision = useMutation({
    mutationFn: (sent: { id: number; action: Decision; reason?: string }) =>
      decide(sent.id, sent.action, sent.reason),
    onSuccess: (_, { action }) => {
      if (action !== "later") show(null);
      if (action === "ticket")
        return Promise.all([
          queryClient.invalidateQueries({ queryKey: ["tickets", projectId] }),
          queryClient.invalidateQueries({ queryKey: ["home"] }),
        ]);
    },
    // A stale screen (finding already decided elsewhere): show the real state.
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: findingsKey(projectId) }),
  });
  const run = (id: number, action: Decision, reason?: string) =>
    decision.mutate({ id, action, reason });
  const busy = decision.isPending;

  return (
    <>
      {query.isPending && <p className="text-muted-foreground">Chargement…</p>}
      {query.isError && (
        <div role="alert" className={alertBox}>
          <p>Impossible de lire les constats : réessaie dans un instant.</p>
          <button
            type="button"
            className={`mt-3 ${button}`}
            onClick={() => query.refetch()}
          >
            Réessayer
          </button>
        </div>
      )}
      {decision.isError && (
        <p role="alert" className={`mb-3 ${alertBox}`}>
          {decision.error.message === ROLE_REFUSAL
            ? ROLE_REFUSAL
            : "La décision n'a pas pu être enregistrée : le constat a peut-être déjà été tranché, la liste est relue."}
        </p>
      )}
      {refresh.isError && (
        <p role="alert" className={`mb-3 ${alertBox}`}>
          {refresh.error.message === ROLE_REFUSAL
            ? ROLE_REFUSAL
            : "Les alertes de GitHub n'ont pas pu être lues : réessaie dans un instant."}
        </p>
      )}
      {query.data && (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-end gap-1.5">
            <button
              type="button"
              className={button}
              disabled={archived || refresh.isPending}
              onClick={() => refresh.mutate()}
            >
              Actualiser
            </button>
            <fieldset className="flex flex-wrap justify-end gap-1.5">
              <legend className="sr-only">Filtrer les constats</legend>
              {FILTERS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={filter === key}
                  className={chip(filter === key)}
                  onClick={() => setFilter(key)}
                >
                  {label}
                </button>
              ))}
            </fieldset>
          </div>
          {read?.access && (
            <p role="status" className="mb-2 text-[13px] text-muted-foreground">
              {ACCESS_TEXT[read.access.detail]}{" "}
              <AccessLink detail={read.access.detail} url={read.access.url} />
            </p>
          )}
          {disabled.map(([tool, name]) => (
            <p
              key={tool}
              role="status"
              className="mb-2 text-[13px] text-muted-foreground"
            >
              {name} n'est pas activé sur ce repo.
            </p>
          ))}
          {shown.length === 0 && rows.length === 0 && (
            <p className={`${card} p-4`}>
              {filter === "dismissed"
                ? "Aucun constat rejeté."
                : "Rien à trancher : Claude n'a rien trouvé de nouveau."}
            </p>
          )}
          {first && (
            <section aria-label="À corriger d'abord" className="mb-5">
              <p className="mb-2 text-[11.5px] font-bold tracking-[.08em] text-you-text uppercase">
                1 · À corriger d'abord
              </p>
              <div className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-3.5 rounded-[14px] border border-you-line bg-you-ground px-[18px] py-4">
                <span
                  aria-hidden="true"
                  className="grid size-[34px] place-items-center rounded-[10px] bg-you-soft font-bold text-you-text"
                >
                  {MARK[first.kind]}
                </span>
                <button
                  type="button"
                  aria-label={`Ouvrir ${first.title}`}
                  aria-describedby={`about-${first.id}`}
                  onClick={() => show(first.id)}
                  className={`min-w-0 rounded-md text-left ${focusRing}`}
                >
                  <span className="block text-[15px] font-semibold">
                    {first.title}
                  </span>
                  <span
                    id={`about-${first.id}`}
                    className="block text-[12.5px] text-muted-foreground"
                  >
                    {kindWord(first)} {SEVERITY_WORD[first.severity]}
                    {place(first) && ` · ${place(first)}`}
                  </span>
                </button>
                <button
                  type="button"
                  className={primaryButton}
                  disabled={archived || busy}
                  onClick={() => run(first.id, "ticket")}
                >
                  En faire un ticket
                </button>
              </div>
              {archived && (
                <p className="mt-2 text-[12.5px] text-muted-foreground">
                  {ARCHIVED}
                </p>
              )}
            </section>
          )}
          {(rest.length > 0 || rows.length > 0) && (
            <section aria-label="Les autres constats">
              <p className={`mb-2 ${sectionLabel}`}>
                {filter === "dismissed" ? "Rejetés" : "Les autres constats"}
              </p>
              <ul className={listCard}>
                {rest.map((f) => (
                  <Row
                    key={f.id}
                    id={f.id}
                    mark={MARK[f.kind]}
                    title={f.title}
                    about={`${kindWord(f)}${place(f) ? ` · ${place(f)}` : ""}${f.dismissReason ? ` · ${f.dismissReason}` : ""}${closedOnGitHub(f) ? " · fermée sur GitHub" : ""}`}
                    severity={SEVERITY_WORD[f.severity]}
                    onOpen={() => show(f.id)}
                  />
                ))}
                {rows.map(({ key, runtime }) => (
                  <Row
                    key={key}
                    id={key.replace(/\W/g, "-")}
                    mark="·"
                    title={runtimeTitle(runtime)}
                    about={`version · ${eolWords(runtime)} · endoflife.date`}
                    severity={
                      SEVERITY_WORD[runtime.state === "eol" ? "high" : "medium"]
                    }
                    onOpen={() => show(null, key)}
                  />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      {analyse && (
        <AnalyseWindow
          projectId={projectId}
          fullName={fullName}
          archived={archived}
          initialVersions
          onClose={() => setAnalyse(false)}
        />
      )}
      {!analyse && openRow && (
        <RuntimePanel
          key={openRow.key}
          row={openRow}
          projectId={projectId}
          fullName={fullName}
          onPlan={() => setAnalyse(true)}
          onClose={() => show(null)}
        />
      )}
      {!analyse && open && (
        <FindingPanel
          key={open.id}
          finding={open}
          projectId={projectId}
          fullName={fullName}
          archived={archived}
          busy={busy}
          onDecide={(action, reason) => run(open.id, action, reason)}
          onClose={() => show(null)}
        />
      )}
    </>
  );
}
