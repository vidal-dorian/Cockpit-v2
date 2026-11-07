import { useQuery } from "@tanstack/react-query";
import {
  type KeyboardEvent,
  lazy,
  Suspense,
  useCallback,
  useState,
} from "react";
import { AnalyseWindow } from "./AnalyseWindow.tsx";
import { ConceptionObject } from "./ConceptionObject.tsx";
import { fetchCodeMap, linkLabel } from "./conception.ts";
import {
  alertBox,
  button,
  card,
  ghostButton,
  listCard,
  primaryButton,
  sectionLabel,
  tabLink,
} from "./ui.ts";

const ConceptionGraph = lazy(() => import("./ConceptionGraph.tsx"));

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** Decision 043 I, J, K, L: the tab « Conception », one diagram (or list) per module of the map. */
export function ProjectConception({
  projectId,
  fullName,
  archived,
}: {
  projectId: string;
  fullName: string;
  archived: boolean;
}) {
  const map = useQuery({
    queryKey: ["code-map", projectId],
    queryFn: () => fetchCodeMap(projectId),
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"graph" | "list">("graph");
  // The right panel: an object of the module on screen, or the window of the analysis.
  const [side, setSide] = useState<{ object: string } | "analyse" | null>(null);
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
  const module = modules.find((m) => m.path === selected) ?? modules[0];
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

  return (
    <section className="mx-[26px] mt-6" aria-label="Conception">
      {map.isPending && <p className="text-muted-foreground">Chargement…</p>}
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
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border">
            <div role="tablist" className="flex flex-wrap gap-x-2">
              {modules.map((m, i) => (
                <button
                  key={m.path}
                  id={`tab-${i}`}
                  type="button"
                  role="tab"
                  aria-selected={m === module}
                  aria-controls="module-panel"
                  tabIndex={m === module ? 0 : -1}
                  className={tabLink({ isActive: m === module })}
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
            {/* Below md the list only (043 J). */}
            <div className="mb-1.5 hidden gap-1 md:flex">
              {(["graph", "list"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  className={view === v ? button : ghostButton}
                  onClick={() => setView(v)}
                >
                  {v === "graph" ? "Graphe" : "Liste"}
                </button>
              ))}
            </div>
          </div>
          <div
            role="tabpanel"
            id="module-panel"
            aria-labelledby={`tab-${modules.indexOf(module)}`}
            className="mt-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[12.5px] text-muted-foreground">
                  Analysé au commit {module.commitSha.slice(0, 7)}
                  {module.commitsSince !== null &&
                    ` · ${plural(module.commitsSince, "commit", "commits")} depuis`}
                </p>
                <p className="font-mono text-[12.5px]">
                  {module.data.runtimes
                    .map((r) => `${r.name} ${r.version}`)
                    .join(" · ")}
                </p>
              </div>
              {analyse}
            </div>
            <div className={`mt-4 ${view === "graph" ? "md:hidden" : ""}`}>
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
              <div className={`hidden md:block ${card} overflow-hidden`}>
                <Suspense
                  fallback={
                    <p role="status" className="p-4 text-muted-foreground">
                      Chargement du graphe…
                    </p>
                  }
                >
                  <ConceptionGraph module={module} onOpen={openObject} />
                </Suspense>
              </div>
            )}
            <p className="mt-3 text-[12.5px] text-muted-foreground">
              {plural(module.data.objects.length, "objet", "objets")} ·{" "}
              {plural(module.data.links.length, "lien", "liens")} · chaque objet
              cite son fichier
            </p>
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
