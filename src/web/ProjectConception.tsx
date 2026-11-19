import { useQuery } from "@tanstack/react-query";
import {
  type KeyboardEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useState,
} from "react";
import { NavLink, useSearchParams } from "react-router";
import { AnalyseWindow } from "./AnalyseWindow.tsx";
import { ConceptionObject } from "./ConceptionObject.tsx";
import { fetchCodeMap, linkLabel } from "./conception.ts";
import { Findings } from "./Findings.tsx";
import { toDecide, useFindings } from "./findings.ts";
import { ProjectFeatures } from "./ProjectFeatures.tsx";
import { chip } from "./ProjectTeam.tsx";
import { Reprise } from "./Reprise.tsx";
import { useRules } from "./rules.ts";
import {
  alertBox,
  button,
  card,
  chipLink,
  listCard,
  primaryButton,
  sectionLabel,
} from "./ui.ts";
import { eolWords, useVersions } from "./versions.ts";

const ConceptionGraph = lazy(() => import("./ConceptionGraph.tsx"));

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** Decision 043 I, J, K, L: the tab « Conception », one diagram (or list) per module of the map; decision 047 I: with the chip « Règles », the takeover screen; decision 048 E: with « Fonctionnalités », the graph of the features; decision 051 D: with « Constats », the findings of Claude. */
export function ProjectConception({
  projectId,
  fullName,
  archived,
  screen = "map",
}: {
  projectId: string;
  fullName: string;
  archived: boolean;
  screen?: "map" | "rules" | "features" | "findings";
}) {
  const map = useQuery({
    queryKey: ["code-map", projectId],
    queryFn: () => fetchCodeMap(projectId),
  });
  const rules = useRules(projectId);
  const findings = useFindings(projectId);
  const versions = useVersions(projectId, (map.data?.length ?? 0) > 0);
  // Decision 047 J: a rule leads here with `?objet=<name>`, which opens the panel of that object.
  const wanted = useSearchParams()[0].get("objet");
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"graph" | "list">("graph");
  // The right panel: an object of the module on screen, or the window of the analysis.
  const [side, setSide] = useState<{ object: string } | "analyse" | null>(
    wanted ? { object: wanted } : null,
  );
  // The URL can change while the tab stays mounted (a chip of the features or takeover screen): it opens the panel too.
  useEffect(() => {
    if (!wanted) return;
    setSelected(null); // so the module is found from `wanted`, not from a tab chosen earlier
    setSide({ object: wanted });
  }, [wanted]);
  const openObject = useCallback((object: string) => setSide({ object }), []);
  const closeObject = (name: string) => {
    setSide(null);
    // Back to the button that opened the panel (the list one, or the card when the list is hidden).
    for (const el of document.querySelectorAll<HTMLElement>("[data-object]")) {
      if (el.dataset.object !== name) continue;
      el.focus();
      if (document.activeElement === el) break;
    }
  };
  const modules = map.data ?? [];
  const module =
    modules.find((m) => m.path === selected) ??
    modules.find((m) => m.data.objects.some((o) => o.name === wanted)) ??
    modules[0];
  const object =
    side && side !== "analyse"
      ? module?.data.objects.find((o) => o.name === side.object)
      : undefined;
  const selectTab = (m: (typeof modules)[number]) => {
    setSelected(m.path);
    setSide(null);
  };
  const onTabKeyDown = (e: KeyboardEvent<HTMLElement>, at: number) => {
    const to = {
      ArrowRight: (at + 1) % modules.length,
      ArrowLeft: (at - 1 + modules.length) % modules.length,
      Home: 0,
      End: modules.length - 1,
    }[e.key];
    const next = modules[to as number];
    if (to === undefined || !next) return;
    e.preventDefault();
    selectTab(next);
    document.getElementById(`tab-${to}`)?.focus();
  };
  const analyse = (
    <button
      type="button"
      className={module ? button : primaryButton}
      onClick={() => setSide("analyse")}
    >
      {module ? "Relancer l'analyse" : "Analyser avec Claude"}
    </button>
  );

  const chips = (
    <nav aria-label="Vues de la conception" className="mb-4 flex gap-2">
      <NavLink to={`/projets/${projectId}/conception`} end className={chipLink}>
        Modèle
      </NavLink>
      <NavLink
        to={`/projets/${projectId}/conception/regles`}
        className={chipLink}
      >
        {rules.data ? `Règles · ${rules.data.length}` : "Règles"}
      </NavLink>
      <NavLink
        to={`/projets/${projectId}/conception/fonctionnalites`}
        className={chipLink}
      >
        Fonctionnalités
      </NavLink>
      <NavLink
        to={`/projets/${projectId}/conception/constats`}
        className={chipLink}
      >
        {findings.data
          ? `Constats · ${toDecide(findings.data).length}`
          : "Constats"}
      </NavLink>
    </nav>
  );
  if (screen === "rules")
    return (
      <section className="mx-[26px] mt-6" aria-label="Conception">
        {chips}
        <Reprise
          projectId={projectId}
          fullName={fullName}
          archived={archived}
        />
      </section>
    );

  if (screen === "findings")
    return (
      <section className="mx-[26px] mt-6" aria-label="Conception">
        {chips}
        <Findings
          projectId={projectId}
          fullName={fullName}
          archived={archived}
        />
      </section>
    );

  if (screen === "features")
    return (
      <section className="mx-[26px] mt-6" aria-label="Conception">
        {chips}
        <ProjectFeatures
          projectId={projectId}
          fullName={fullName}
          archived={archived}
        />
      </section>
    );

  return (
    <section className="mx-[26px] mt-6" aria-label="Conception">
      {chips}
      {map.isPending && (
        <p className="loading text-muted-foreground">Chargement…</p>
      )}
      {map.isError && (
        <div role="alert" className={alertBox}>
          <p>Impossible de lire la carte : réessaie dans un instant.</p>
          <button
            type="button"
            className={`mt-3 ${button}`}
            onClick={() => map.refetch()}
          >
            Réessayer
          </button>
        </div>
      )}
      {map.data && !module && (
        <div className={`${card} flex flex-wrap items-center gap-3.5 p-4`}>
          <p className="min-w-0 flex-1">
            Pas encore de carte. Claude lit le repo et dessine le modèle de
            chaque sous-projet.
          </p>
          {analyse}
        </div>
      )}
      {module && (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Below md the list only (043 J). */}
            <div className="hidden gap-1.5 md:flex">
              {(["graph", "list"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  className={chip(view === v)}
                  onClick={() => setView(v)}
                >
                  {v === "graph" ? "Graphe" : "Liste"}
                </button>
              ))}
            </div>
            <div role="tablist" className="ml-auto flex flex-wrap gap-1.5">
              {modules.map((m, i) => (
                <button
                  key={m.path}
                  id={`tab-${i}`}
                  type="button"
                  role="tab"
                  aria-selected={m === module}
                  aria-controls="module-panel"
                  tabIndex={m === module ? 0 : -1}
                  className={chip(m === module)}
                  onClick={() => selectTab(m)}
                  onKeyDown={(e) => onTabKeyDown(e, i)}
                >
                  {m.name}
                  <span className="ml-2 text-xs font-normal text-dim">
                    {m.kind}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div
            role="tabpanel"
            id="module-panel"
            aria-labelledby={`tab-${modules.indexOf(module)}`}
            className="mt-3.5"
          >
            <div className={`${view === "graph" ? "md:hidden" : ""}`}>
              <p className={`mb-2 ${sectionLabel}`}>Objets</p>
              <ul className={listCard}>
                {module.data.objects.map((o) => (
                  <li key={o.name}>
                    <button
                      type="button"
                      data-object={o.name}
                      onClick={() => openObject(o.name)}
                      className="block min-h-[50px] w-full px-4 py-3 text-left hover:bg-raised"
                    >
                      <span className="font-bold">{o.name}</span>{" "}
                      <span className="text-xs text-dim">{o.kind}</span>
                      <span className="mt-1 block font-mono text-[12.5px] text-muted-foreground">
                        {o.fields.map((f) => `${f.name} ${f.type}`).join(" · ")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {module.data.links.length > 0 && (
                <>
                  <p className={`mt-4 mb-2 ${sectionLabel}`}>Liens</p>
                  <ul className={listCard}>
                    {module.data.links.map((l, i) => (
                      <li
                        // biome-ignore lint/suspicious/noArrayIndexKey: two links can differ only by their cardinality
                        key={`${i}-${l.from}-${l.kind}-${l.to}`}
                        className="min-h-[50px] px-4 py-3"
                      >
                        {l.from}{" "}
                        <span className="text-dim">{linkLabel(l)}</span> {l.to}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            {view === "graph" && (
              <div
                className={`relative hidden h-[420px] md:block ${card} overflow-hidden`}
              >
                <p className={`absolute top-3.5 left-4 z-10 ${sectionLabel}`}>
                  {module.name} · {module.path}
                </p>
                <Suspense
                  fallback={
                    <p
                      role="status"
                      className="loading p-4 text-muted-foreground"
                    >
                      Chargement du graphe…
                    </p>
                  }
                >
                  <ConceptionGraph
                    module={module}
                    selected={object?.name}
                    onOpen={openObject}
                  />
                </Suspense>
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[12.5px] text-muted-foreground">
              <p>
                {plural(module.data.objects.length, "objet", "objets")} ·{" "}
                {plural(module.data.links.length, "lien", "liens")} · chaque
                objet cite son fichier
              </p>
              <p>
                Analysé au commit {module.commitSha.slice(0, 7)}
                {module.commitsSince !== null &&
                  ` · ${plural(module.commitsSince, "commit", "commits")} depuis`}
              </p>
              <p className="font-mono">
                {module.data.runtimes
                  .flatMap((r) => {
                    // Decision 052 J: the end of life in words, as its own item of the line.
                    const known = versions.data?.find(
                      (v) =>
                        v.module.path === module.path &&
                        v.name === r.name &&
                        v.version === r.version,
                    );
                    const eol = known && eolWords(known);
                    return eol
                      ? [`${r.name} ${r.version}`, eol]
                      : `${r.name} ${r.version}`;
                  })
                  .join(" · ")}
              </p>
              <span className="ml-auto">{analyse}</span>
            </div>
          </div>
        </>
      )}
      {side === "analyse" && (
        <AnalyseWindow
          projectId={projectId}
          fullName={fullName}
          archived={archived}
          onClose={() => setSide(null)}
        />
      )}
      {module && object && (
        <ConceptionObject
          projectId={projectId}
          fullName={fullName}
          module={module}
          object={object}
          onClose={() => closeObject(object.name)}
        />
      )}
    </section>
  );
}
