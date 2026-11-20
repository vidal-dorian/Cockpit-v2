import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, NavLink, useParams, useSearchParams } from "react-router";
import { client } from "./api.ts";
import { CatalogLine } from "./CatalogLine.tsx";
import { fetchCodeMap } from "./conception.ts";
import { chosenFeature, featureSentence, useFeatures } from "./features.ts";
import { findingsSentence, toDecide, useFindings } from "./findings.ts";
import { ACCESS_TEXT, AccessLink } from "./GithubAccess.tsx";
import { ProjectAgents } from "./ProjectAgents.tsx";
import { ciSentence, fetchWorkflows, ProjectCi } from "./ProjectCi.tsx";
import { FILES } from "./ProjectClaudeConfig.tsx";
import { ProjectConception } from "./ProjectConception.tsx";
import { ProjectDelivered } from "./ProjectDelivered.tsx";
import { FeaturesExport } from "./ProjectFeatures.tsx";
import { ProjectHistory } from "./ProjectHistory.tsx";
import { fetchStories, ProjectKanban } from "./ProjectKanban.tsx";
import { ProjectPrepare } from "./ProjectPrepare.tsx";
import {
  fetchSchedule,
  ProjectRoutine,
  writingSentence,
} from "./ProjectRoutine.tsx";
import { fetchProjects } from "./Projects.tsx";
import { ProjectTickets } from "./ProjectTickets.tsx";
import { atLeast } from "./roles.ts";
import { rulesSentence, useRules } from "./rules.ts";
import { Breadcrumb, fetchMe, StateSentence } from "./Shell.tsx";
import { fetchTickets } from "./tickets.ts";
import { UpdatesLine } from "./UpdatesLine.tsx";
import {
  alertBox,
  badge,
  button,
  focusRing,
  listCard,
  primaryButton,
  sectionLabel,
  urgentBadge,
} from "./ui.ts";

/** The lines of the health check, or why there are none (decision 013); null when the server answers 401. */
async function fetchHealth(id: string) {
  const res = await client.api.projects[":id"].health.$get({ param: { id } });
  if (res.status === 401) return null;
  if (res.status === 404) return "not_found" as const;
  if (res.status === 409) return "unreachable" as const;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).lines;
}

export const LABELS: Record<string, string> = {
  claude_md: "CLAUDE.md",
  ci: "CI",
  mcp: "Serveur MCP de Cockpit",
  agents: "Agents et skill de développement",
  catalog: "Fichiers de Claude à jour",
  webhook: "Webhook de Cockpit",
  github_alerts: "Alertes GitHub",
  updates: "Mises à jour automatiques",
};

// One sentence per red line, by "key.detail"; the codes of the server are never shown.
const EXPLANATIONS: Record<string, string> = {
  "claude_md.missing":
    "Ajoute un fichier CLAUDE.md à la racine du repo (ou dans .claude/) pour expliquer le projet à Claude.",
  "ci.missing":
    "Aucun workflow dans .github/workflows : ajoute un fichier .yml qui lance tes tests.",
  "mcp.invalid_json": "Le fichier .mcp.json n'est pas un JSON valide.",
  "mcp.secret_in_clear":
    "Le .mcp.json contient un secret en clair pour Cockpit : utilise une référence à une variable d'environnement.",
  "agents.missing":
    "Il manque la skill dev-us, ou un des agents de l'équipe (test-writer, developer, reviewer par défaut, ou ceux de .claude/team.md et des équipes de .claude/teams/), dans le dossier .claude/.",
  "agents.invalid_team":
    "Le fichier .claude/team.md, ou une équipe de .claude/teams/, n'est pas lisible.",
  "webhook.wrong_url":
    "L'adresse du webhook de l'App sur GitHub n'est pas celle de Cockpit, ou le webhook est désactivé : corrige-la dans les réglages de l'App.",
  "webhook.last_delivery_failed":
    "La dernière livraison du webhook a échoué : regarde les livraisons récentes dans les réglages de l'App sur GitHub.",
  "webhook.unknown":
    "Impossible de lire le webhook sur GitHub : réessaie dans une minute.",
  ...Object.fromEntries(
    Object.entries(ACCESS_TEXT).map(([detail, text]) => [
      `github_alerts.${detail}`,
      text,
    ]),
  ),
};

type ProjectTab =
  | "kanban"
  | "tickets"
  | "conception"
  | "sante"
  | "agents"
  | "ci"
  | "historique"
  | "reglages";

const TABS: { tab: ProjectTab; to: string; label: string }[] = [
  { tab: "kanban", to: "", label: "Kanban" },
  { tab: "tickets", to: "/tickets", label: "Tickets" },
  { tab: "conception", to: "/conception", label: "Conception" },
  { tab: "sante", to: "/sante", label: "Santé" },
  { tab: "agents", to: "/agents", label: "Claude" },
  { tab: "ci", to: "/ci", label: "CI / CD" },
  { tab: "historique", to: "/historique", label: "Historique" },
  { tab: "reglages", to: "/reglages", label: "Réglages" },
];

// The tabs of the mockups sit 22px apart with their underline touching the border: the padding of a plain tab does not fit.
const projectTab = ({ isActive }: { isActive: boolean }) =>
  `inline-flex items-center border-b-2 pb-2.5 text-sm font-semibold whitespace-nowrap ${focusRing} ${isActive ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`;

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

// The muted second half of the sentence of the tabs other than the Kanban.
const TAB_REST: Record<ProjectTab, string> = {
  kanban: "",
  tickets: "",
  conception: "Le modèle de chaque sous-projet, lu par Claude dans le code.",
  sante: "Ce que Claude trouve dans le repo avant de travailler.",
  agents: "Chacun lit le repo, puis passe la main au suivant.",
  ci: "",
  historique: "",
  reglages: "",
};

/** The page of a project in eight tabs (decision 028 G); the health is read whatever the tab, for « Projet introuvable » and the mark of the Santé tab. */
export function ProjectPage({
  tab,
  view,
}: {
  tab: ProjectTab;
  /** The takeover screen (decision 047 I) or the features (decision 048 E) of the Conception tab. */
  view?: "rules" | "features" | "findings" | "delivered";
}) {
  const { id = "" } = useParams();
  const projects = useQuery({ queryKey: ["projects"], queryFn: fetchProjects });
  // No retry and no refetch on focus: the alert has its own Réessayer, "Revérifier" reads again, and each read costs several GitHub calls.
  const health = useQuery({
    queryKey: ["health", id],
    queryFn: () => fetchHealth(id),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const project = projects.data?.find((p) => String(p.id) === id);
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  // What writes in the repo is the owner's (decision 076 G): the other roles read the bilan.
  const owner = atLeast(project?.role, "owner");
  const stories = useQuery({
    queryKey: ["stories", id],
    queryFn: () => fetchStories(id),
    enabled: tab === "kanban",
  });
  // How many files the plan of « Préparer pour Claude » adds, while it is on screen.
  const [planned, setPlanned] = useState<number | null>(null);
  const [moreRight, setMoreRight] = useState(false);
  // Decision 080 I reopened: tabs hidden on the right show a fade.
  const measureTabs = (nav: HTMLElement | null) => {
    if (nav)
      setMoreRight(nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 1);
  };
  const notFound = health.data === "not_found";
  const board = (stories.data ?? []).filter((s) => s.status !== "abandoned");
  const count = (...statuses: string[]) =>
    board.filter((s) => statuses.includes(s.status)).length;
  // A story Claude rewrites does not wait for you (decision 085 E, as on the home page).
  const waiting = count("to_validate", "in_review");
  const working = count("in_progress");
  const asking = board.find((s) => s.questionPending);
  const firstWaiting = board.find((s) =>
    ["to_validate", "in_review"].includes(s.status),
  );
  // The sentence names what waits, and leads to the first thing to do (decision 085 E).
  const toStory = (id: number | undefined, text: string) => (
    <Link to={`?us=${id}`} className={`underline ${focusRing}`}>
      {text}
    </Link>
  );
  const kanbanSentence = {
    inline: true,
    title: stories.isPending ? (
      "Chargement…"
    ) : stories.isError ? (
      (project?.fullName.split("/").pop() ?? "Projet")
    ) : asking ? (
      <>Claude t'attend sur {toStory(asking.id, `l'US ${asking.id}`)}.</>
    ) : waiting > 0 ? (
      <>
        {toStory(
          firstWaiting?.id,
          waiting === 1
            ? "1 user story t'attend"
            : `${waiting} user stories t'attendent`,
        )}
        .
      </>
    ) : working > 0 ? (
      `Claude développe ${plural(working, "user story", "user stories")}.`
    ) : (
      "Rien ne t'attend sur ce projet."
    ),
    rest: !stories.data
      ? undefined
      : board.length === 0
        ? "Aucune user story pour l'instant."
        : asking
          ? `${plural(board.length - 1, "autre user story", "autres user stories")} au Kanban.`
          : `${plural(board.length, "user story", "user stories")} au Kanban.`,
  };
  const red = Array.isArray(health.data)
    ? health.data.filter((line) => !line.ok).length
    : 0;
  const tickets = useQuery({
    queryKey: ["tickets", id],
    queryFn: () => fetchTickets(id),
    enabled: tab === "tickets",
  });
  const codeMap = useQuery({
    queryKey: ["code-map", id],
    queryFn: () => fetchCodeMap(id),
    enabled: tab === "conception",
  });
  const workflows = useQuery({
    queryKey: ["workflows", id],
    queryFn: () => fetchWorkflows(id),
    retry: false,
  });
  const schedule = useQuery({
    queryKey: ["routine-schedule", id],
    queryFn: () => fetchSchedule(id),
    enabled: tab === "tickets",
  });
  const rules = useRules(id, tab === "conception");
  const findings = useFindings(id, tab === "conception");
  const features = useFeatures(id, tab === "conception" && view === "features");
  const search = useSearchParams()[0];
  const feature = chosenFeature(features.data?.features ?? [], search.get("f"));
  // Decision 065 D: a chip of the tab Agents other than Agents.
  const fichier =
    tab === "agents" && FILES.some((f) => f === search.get("fichier"));
  const waitingUs = (tickets.data ?? []).filter((t) => t.step === "new").length;
  const name = project?.fullName.split("/").pop() ?? "Projet";
  const sentence: { title: React.ReactNode; rest?: string; inline?: boolean } =
    tab === "kanban"
      ? kanbanSentence
      : tab === "sante" && planned !== null
        ? {
            title: `Voici ce que Cockpit va écrire dans ${name}.`,
            rest: `${plural(planned, "fichier nouveau", "fichiers nouveaux")}, rien n'est écrasé.`,
          }
        : tab === "sante" && Array.isArray(health.data)
          ? red > 0
            ? {
                title: `${name} n'est pas encore prêt pour Claude.`,
                rest: `${plural(red, "ligne", "lignes")} du bilan à corriger, un seul commit suffit.`,
              }
            : {
                title: `${name} est prêt pour Claude.`,
                rest: "Tout le bilan est au vert.",
              }
          : tab === "conception" && view === "findings" && findings.data
            ? {
                title: findingsSentence(name, toDecide(findings.data)),
                rest:
                  toDecide(findings.data).length > 0
                    ? "Triés par gravité. Une faille devient un ticket en un clic."
                    : undefined,
              }
            : tab === "conception" && view === "rules" && rules.data
              ? { title: rulesSentence(rules.data), rest: undefined }
              : tab === "conception" && view === "features" && features.data
                ? {
                    title: feature
                      ? featureSentence(feature)
                      : "Pas encore de fonctionnalité.",
                    rest: feature
                      ? "Un clic sur une règle ouvre l'onglet Règles."
                      : undefined,
                  }
                : tab === "conception" && view === "features"
                  ? { title: name, rest: undefined }
                  : tab === "conception" &&
                      codeMap.data &&
                      codeMap.data.length > 0
                    ? {
                        title: `Claude a lu ${name} : voici son modèle.`,
                        rest: `${plural(codeMap.data.length, "sous-projet", "sous-projets")}, ${plural(
                          codeMap.data.reduce(
                            (n, m) => n + m.data.objects.length,
                            0,
                          ),
                          "objet",
                          "objets",
                        )}, chacun avec le code qui le prouve.`,
                      }
                    : tab === "tickets" && tickets.data
                      ? {
                          title: `${plural(tickets.data.length, "ticket", "tickets")}, ${waitingUs} ${waitingUs === 1 ? "attend" : "attendent"} leurs user stories.`,
                          rest: writingSentence(schedule.data),
                        }
                      : tab === "ci" && workflows.data?.data
                        ? {
                            title: ciSentence(workflows.data.data.workflows)
                              .title,
                          }
                        : {
                            title:
                              tab === "reglages"
                                ? `Réglages de ${name}.`
                                : tab === "agents" && fichier
                                  ? `Ce que Claude lit dans ${project?.fullName ?? name}.`
                                  : tab === "agents"
                                    ? `Les agents et les équipes de ${name}.`
                                    : tab === "historique" &&
                                        view === "delivered"
                                      ? `Ce que ${name} a livré.`
                                      : tab === "historique"
                                        ? `Ce qui s'est passé sur ${name}.`
                                        : name,
                            rest:
                              view === "delivered"
                                ? "Une ligne par PR, écrite à partir de son titre."
                                : fichier
                                  ? "Chaque modification passe par un diff, puis un commit."
                                  : TAB_REST[tab],
                          };

  return (
    <main className="pb-6">
      {notFound ? (
        <>
          <Breadcrumb trail={[{ label: "Projets", to: "/projets" }]} />
          <StateSentence
            title="Projet introuvable"
            rest="Il a peut-être été archivé ou retiré de l'App."
          />
        </>
      ) : (
        <div className="flex flex-col gap-1.5 px-[26px] pt-6">
          {projects.isPending ? (
            <h1 className="loading text-[26px] leading-tight font-semibold text-muted-foreground">
              Chargement…
            </h1>
          ) : (
            <>
              {/* The actions share the breadcrumb's row, the sentence sits under both (S36, S41). */}
              <div className="flex items-start gap-3">
                <nav
                  aria-label="Fil d'Ariane"
                  className="flex flex-wrap items-baseline gap-1.5 text-[12.5px] text-muted-foreground"
                >
                  <Link
                    to="/projets"
                    className={`rounded-md hover:text-foreground ${focusRing}`}
                  >
                    Projets
                  </Link>
                  <span aria-hidden="true">›</span>
                  <span>{name}</span>
                  {project && (
                    <span className="font-mono text-[11.5px]">
                      {project.fullName}
                    </span>
                  )}
                </nav>
                {project && (
                  <div className="ml-auto flex flex-wrap justify-end gap-2">
                    {view === "features" &&
                      feature &&
                      features.data &&
                      codeMap.data && (
                        <FeaturesExport
                          fullName={project.fullName}
                          feature={feature}
                          features={features.data.features}
                          modules={codeMap.data}
                        />
                      )}
                    <a
                      href={`https://github.com/${project.fullName}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      className={button}
                    >
                      Ouvrir sur GitHub ↗
                    </a>
                  </div>
                )}
              </div>
              <h1 className="text-[26px] leading-tight font-semibold tracking-[-.01em]">
                {sentence.title}
                {sentence.rest && (
                  <>
                    {sentence.inline && " "}
                    <span
                      className={`font-medium text-muted-foreground ${sentence.inline ? "" : "block"}`}
                    >
                      {sentence.rest}
                    </span>
                  </>
                )}
              </h1>
            </>
          )}
        </div>
      )}
      {project?.lockedBy && (
        <p
          role="status"
          className="mx-[26px] mt-4 rounded-[14px] bg-raised p-4"
        >
          Ce projet est en lecture seule : l'abonnement Gratuit de @
          {project.lockedBy} couvre 3 projets.
          {project.lockedBy === me.data?.login && (
            <>
              {" "}
              <Link
                to="/reglages/abonnement"
                className={`underline ${focusRing}`}
              >
                Voir l'abonnement
              </Link>
            </>
          )}
        </p>
      )}
      {!notFound && (
        <nav
          aria-label="Sections du projet"
          ref={measureTabs}
          onScroll={(e) => measureTabs(e.currentTarget)}
          data-more-right={moreRight}
          className="mt-4 flex gap-x-[22px] border-b border-border px-[26px] max-md:mt-3 max-md:overflow-x-auto max-md:pt-1 max-md:[scrollbar-width:none] max-md:data-[more-right=true]:[mask-image:linear-gradient(to_right,#000_calc(100%-40px),transparent)] md:flex-wrap"
        >
          {TABS.map((t) => (
            <NavLink
              key={t.tab}
              to={`/projets/${id}${t.to}`}
              end={t.to === ""}
              className={projectTab}
            >
              {t.tab === "sante" && red > 0
                ? `Santé · ${red} à corriger`
                : t.tab === "ci" && workflows.data?.data?.proposal
                  ? `${t.label} · 1 à relire`
                  : t.label}
            </NavLink>
          ))}
        </nav>
      )}
      {!notFound && tab === "sante" && (
        <section className="mx-[26px] mt-5" aria-labelledby="bilan">
          <h2 id="bilan" className="sr-only">
            Bilan de santé
          </h2>
          <div aria-live="polite">
            {health.isPending && (
              <p className="loading text-muted-foreground">Chargement…</p>
            )}
            {health.isError && (
              <div role="alert" className={alertBox}>
                <p>
                  Impossible de lire le bilan : GitHub ne répond pas comme
                  prévu.
                </p>
                <button
                  type="button"
                  onClick={() => health.refetch()}
                  className={`mt-3 ${button}`}
                >
                  Réessayer
                </button>
              </div>
            )}
            {health.data === null && (
              <a href="/api/auth/login" className={primaryButton}>
                Se connecter avec GitHub
              </a>
            )}
            {health.data === "unreachable" && (
              <p role="alert" className={alertBox}>
                L'App Cockpit ne voit plus ce repo : vérifie sur GitHub qu'elle
                y a encore accès.
              </p>
            )}
            {Array.isArray(health.data) && (
              <>
                {project && owner && (
                  <ProjectPrepare
                    projectId={id}
                    fullName={project.fullName}
                    archived={project.archived}
                    onPlan={setPlanned}
                    red={health.data.some(
                      (line) =>
                        !line.ok &&
                        (line.key === "claude_md" || line.key === "agents"),
                    )}
                  />
                )}
                <div className="mt-6 mb-2 flex items-baseline justify-between gap-3">
                  <p className="text-[12.5px] text-muted-foreground">
                    <span className={sectionLabel}>Le bilan</span> · relu à
                    chaque push
                  </p>
                  <button
                    type="button"
                    onClick={() => health.refetch()}
                    disabled={health.isFetching}
                    aria-busy={health.isFetching}
                    className={`rounded-md text-[13px] text-muted-foreground hover:text-foreground disabled:opacity-50 ${focusRing}`}
                  >
                    {health.isFetching ? "Vérification…" : "Relancer le bilan"}
                  </button>
                </div>
                <ul className={listCard}>
                  {health.data.map((line) =>
                    line.key === "catalog" && project ? (
                      <CatalogLine
                        key={line.key}
                        line={line}
                        projectId={id}
                        fullName={project.fullName}
                        archived={project.archived || !owner}
                      />
                    ) : line.key === "updates" && project ? (
                      <UpdatesLine
                        key={line.key}
                        line={line}
                        projectId={id}
                        fullName={project.fullName}
                        archived={project.archived || !owner}
                      />
                    ) : (
                      <li
                        key={line.key}
                        className="flex min-h-[50px] items-center gap-3.5 px-4 py-2"
                      >
                        <span aria-hidden="true" className="w-4 text-dim">
                          {line.ok ? "✓" : "✕"}
                        </span>
                        <p className="min-w-0 flex-1">
                          <span className="block font-semibold">
                            {LABELS[line.key]}
                          </span>
                          {!line.ok && (
                            <span className="block text-[12.5px] text-muted-foreground">
                              {EXPLANATIONS[`${line.key}.${line.detail}`]}{" "}
                              {line.key === "ci" && (
                                <Link
                                  to={`/projets/${id}/ci`}
                                  className={`underline ${focusRing}`}
                                >
                                  Voir l'onglet CI / CD
                                </Link>
                              )}
                              {line.key === "webhook" &&
                                "url" in line &&
                                line.url && (
                                  <AccessLink
                                    detail={line.detail}
                                    url={line.url}
                                  />
                                )}
                              {line.key === "github_alerts" && (
                                <AccessLink
                                  detail={line.detail}
                                  url={"url" in line ? line.url : undefined}
                                />
                              )}
                            </span>
                          )}
                        </p>
                        <span className={line.ok ? badge : urgentBadge}>
                          {line.ok ? "OK" : "À corriger"}
                        </span>
                      </li>
                    ),
                  )}
                </ul>
              </>
            )}
          </div>
        </section>
      )}
      {!notFound && tab === "kanban" && <ProjectKanban projectId={id} />}
      {!notFound && tab === "tickets" && <ProjectTickets projectId={id} />}
      {!notFound && tab === "conception" && project && (
        <ProjectConception
          projectId={id}
          fullName={project.fullName}
          archived={project.archived}
          screen={view === "delivered" ? "map" : (view ?? "map")}
        />
      )}
      {!notFound && tab === "agents" && project && (
        <ProjectAgents
          projectId={id}
          fullName={project.fullName}
          archived={project.archived}
        />
      )}
      {!notFound && tab === "ci" && project && (
        <ProjectCi
          projectId={id}
          fullName={project.fullName}
          archived={project.archived}
        />
      )}
      {!notFound && tab === "historique" && view === "delivered" && (
        <ProjectDelivered projectId={id} archived={project?.archived} />
      )}
      {!notFound && tab === "historique" && view !== "delivered" && (
        <ProjectHistory projectId={id} />
      )}
      {!notFound && tab === "reglages" && (
        <ProjectRoutine projectId={id} archived={project?.archived ?? false} />
      )}
    </main>
  );
}
