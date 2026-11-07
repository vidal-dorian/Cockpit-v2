import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import Markdown from "react-markdown";
import {
  type Decision,
  decide,
  EFFORT_WORD,
  type Finding,
  findingsKey,
  KIND_WORD,
  SEVERITY_WORD,
  toDecide,
  useFindings,
} from "./findings.ts";
import { chip } from "./ProjectTeam.tsx";
import { RuleCode } from "./Reprise.tsx";
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

const FILTERS = [
  ["all", "Tous"],
  ["bug", "Bugs"],
  ["security", "Failles"],
  ["architecture", "Architecture"],
  ["stack", "Stack"],
  ["dismissed", "Rejetés"],
] as const;
type Filter = (typeof FILTERS)[number][0];

const MARK = { bug: "!", security: "✕", architecture: "·", stack: "·" };
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
  const decidable = finding.status === "open" || finding.status === "later";
  return (
    <Panel
      label="Constat"
      badge={
        <span className={badge}>
          {KIND_WORD[finding.kind]} · {SEVERITY_WORD[finding.severity]}
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

/** One finding of the list « Les autres constats »: its type, its place, and the severity as a word. */
function Row({ finding, onOpen }: { finding: Finding; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        aria-label={`Ouvrir ${finding.title}`}
        // The name stays « Ouvrir <titre> »; the type, the place and the severity are its description.
        aria-describedby={`about-${finding.id} severity-${finding.id}`}
        onClick={onOpen}
        className={`grid min-h-[50px] w-full grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3 px-[18px] py-2 text-left hover:bg-raised ${focusRing}`}
      >
        <span aria-hidden="true" className="text-center font-bold text-dim">
          {MARK[finding.kind]}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-semibold">{finding.title}</span>
          <span
            id={`about-${finding.id}`}
            className="block truncate text-[12.5px] text-muted-foreground"
          >
            {KIND_WORD[finding.kind]}
            {place(finding) && ` · ${place(finding)}`}
            {finding.dismissReason && ` · ${finding.dismissReason}`}
          </span>
        </span>
        <span
          id={`severity-${finding.id}`}
          className="text-xs text-muted-foreground"
        >
          {SEVERITY_WORD[finding.severity]}
        </span>
      </button>
    </li>
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
  const [openId, setOpenId] = useState<number | null>(null);
  const all = query.data ?? [];
  const shown =
    filter === "dismissed"
      ? all.filter((f) => f.status === "dismissed")
      : toDecide(all).filter((f) => filter === "all" || f.kind === filter);
  const [first, ...others] = filter === "dismissed" ? [] : shown;
  const rest = filter === "dismissed" ? shown : others;
  const open = all.find((f) => f.id === openId);

  const decision = useMutation({
    mutationFn: (sent: { id: number; action: Decision; reason?: string }) =>
      decide(sent.id, sent.action, sent.reason),
    onSuccess: (_, { action }) => {
      if (action !== "later") setOpenId(null);
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
          La décision n'a pas pu être enregistrée : le constat a peut-être déjà
          été tranché, la liste est relue.
        </p>
      )}
      {query.data && (
        <>
          <fieldset className="mb-4 flex flex-wrap justify-end gap-1.5">
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
          {shown.length === 0 && (
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
                  onClick={() => setOpenId(first.id)}
                  className={`min-w-0 rounded-md text-left ${focusRing}`}
                >
                  <span className="block text-[15px] font-semibold">
                    {first.title}
                  </span>
                  <span
                    id={`about-${first.id}`}
                    className="block text-[12.5px] text-muted-foreground"
                  >
                    {KIND_WORD[first.kind]} {SEVERITY_WORD[first.severity]}
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
          {rest.length > 0 && (
            <section aria-label="Les autres constats">
              <p className={`mb-2 ${sectionLabel}`}>
                {filter === "dismissed" ? "Rejetés" : "Les autres constats"}
              </p>
              <ul className={listCard}>
                {rest.map((f) => (
                  <Row key={f.id} finding={f} onOpen={() => setOpenId(f.id)} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      {open && (
        <FindingPanel
          key={open.id}
          finding={open}
          projectId={projectId}
          fullName={fullName}
          archived={archived}
          busy={busy}
          onDecide={(action, reason) => run(open.id, action, reason)}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}
