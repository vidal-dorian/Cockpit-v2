import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useCallback, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { AnalyseWindow } from "./AnalyseWindow.tsx";
import { fetchCodeMap } from "./conception.ts";
import {
  chosenFeature,
  type Feature,
  objectHref,
  objectsOf,
  ruleHref,
  stateWord,
  useFeatures,
} from "./features.ts";
import { featuresMarkdown } from "./features-markdown.ts";
import {
  alertBox,
  badge,
  button,
  card,
  focusRing,
  ghostButton,
  listCard,
  primaryButton,
  sectionLabel,
} from "./ui.ts";

const FeaturesGraph = lazy(() => import("./FeaturesGraph.tsx"));

/** Downloads a text file the browser builds itself: no request. */
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  // A title can hold characters a file name cannot.
  anchor.download = name.replace(/[\\/:*?"<>|]/g, "-");
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** « Exporter en Markdown » and « Tout le projet » (decision 048 I), for the actions slot of the header. */
export function FeaturesExport({
  fullName,
  feature,
  features,
  modules,
}: {
  fullName: string;
  feature: Feature;
  features: Feature[];
  modules: Parameters<typeof featuresMarkdown>[1];
}) {
  const exportFile = (name: string, list: Feature[]) =>
    download(
      `conception-${name}.md`,
      featuresMarkdown(list, modules, fullName),
    );
  return (
    <>
      <button
        type="button"
        className={button}
        onClick={() => exportFile(feature.title, [feature])}
      >
        Exporter en Markdown
      </button>
      <button
        type="button"
        className={ghostButton}
        onClick={() =>
          exportFile(fullName.split("/").pop() ?? fullName, features)
        }
      >
        Tout le projet
      </button>
    </>
  );
}

/** Decision 048 E to J: the third view of the tab « Conception », the graph of the features (S43) or its four catalogues as lists. */
export function ProjectFeatures({
  projectId,
  fullName,
  archived,
}: {
  projectId: string;
  fullName: string;
  archived: boolean;
}) {
  const features = useFeatures(projectId);
  const map = useQuery({
    queryKey: ["code-map", projectId],
    queryFn: () => fetchCodeMap(projectId),
  });
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<"graph" | "list">("graph");
  const [analyse, setAnalyse] = useState<"map" | "rules" | null>(null);
  const openAnalyse = useCallback(() => setAnalyse("map"), []);
  const choose = useCallback(
    (id: number) => setParams({ f: String(id) }, { replace: true }),
    [setParams],
  );
  const feature = chosenFeature(features.data?.features ?? [], params.get("f"));
  const failed = features.isError || map.isError;
  const objects = feature ? objectsOf(feature) : [];
  const absent = objects.filter((o) => !o.inMap).length;
  const analyseButton = (
    label: string,
    className: string,
    open: "map" | "rules" = "map",
  ) => (
    <button
      type="button"
      className={className}
      onClick={() => setAnalyse(open)}
    >
      {label}
    </button>
  );
  const unmappedNotice = absent > 0 && (
    <div className="mt-2 flex flex-wrap items-center gap-3">
      <p className="text-[13px] text-muted-foreground">
        {absent === 1
          ? "Cet objet n'est pas dans la carte du code. Relance l'analyse pour l'y ajouter."
          : "Ces objets ne sont pas dans la carte du code. Relance l'analyse pour les y ajouter."}
      </p>
      {analyseButton("Relancer l'analyse", button)}
    </div>
  );

  return (
    <>
      {(features.isPending || map.isPending) && !failed && (
        <p className="loading text-muted-foreground">Chargement…</p>
      )}
      {failed && (
        <div role="alert" className={alertBox}>
          <p>
            Impossible de lire les fonctionnalités : réessaie dans un instant.
          </p>
          <button
            type="button"
            className={`mt-3 ${button}`}
            onClick={() => {
              features.refetch();
              map.refetch();
            }}
          >
            Réessayer
          </button>
        </div>
      )}
      {features.data && map.data && !feature && (
        <div className={`${card} flex flex-wrap items-center gap-3.5 p-4`}>
          <p className="min-w-0 flex-1">
            Pas encore de fonctionnalité reprise. Choisis-en une dans « Analyser
            avec Claude ».
          </p>
          {analyseButton("Analyser avec Claude", primaryButton, "rules")}
        </div>
      )}
      {features.data && map.data && feature && (
        <>
          {/* Below md the list only (007). */}
          <div className="hidden justify-end gap-1 md:flex">
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
          {view === "graph" && (
            <div className={`mt-4 hidden md:block ${card} overflow-hidden`}>
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
                <FeaturesGraph
                  projectId={projectId}
                  data={features.data}
                  chosenId={feature.id}
                  onChoose={choose}
                  onAnalyse={openAnalyse}
                />
              </Suspense>
            </div>
          )}
          {view === "graph" && (
            <p className="mt-3 hidden text-[12.5px] text-muted-foreground md:block">
              En clair : ce qui touche « {feature.title} ». En gris : le reste
              de l'application.
            </p>
          )}
          <div
            className={`mt-4 grid gap-4 ${view === "graph" ? "md:hidden" : ""}`}
          >
            <section aria-label="Acteurs">
              <p className={`mb-2 ${sectionLabel}`}>Acteurs</p>
              <ul className={listCard}>
                {feature.actors.map((a) => (
                  <li key={a} className="min-h-[50px] px-4 py-3">
                    {a}
                  </li>
                ))}
              </ul>
            </section>
            <section aria-label="Fonctionnalités">
              <p className={`mb-2 ${sectionLabel}`}>Fonctionnalités</p>
              <ul className={listCard}>
                {features.data.features.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      aria-current={f.id === feature.id || undefined}
                      onClick={() => choose(f.id)}
                      className={`block min-h-[50px] w-full px-4 py-3 text-left hover:bg-raised ${f.id === feature.id ? "bg-raised font-bold" : ""} ${focusRing}`}
                    >
                      {f.title}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
            <section aria-label="Règles">
              <p className={`mb-2 ${sectionLabel}`}>Règles</p>
              <ul className={listCard}>
                {feature.rules.map((r) => (
                  <li
                    key={r.id}
                    className="flex min-h-[50px] items-center justify-between gap-3 px-4 py-3"
                  >
                    <Link
                      to={ruleHref(projectId, r)}
                      className={`rounded-md underline ${focusRing}`}
                    >
                      {r.summary}
                    </Link>
                    <span className={badge}>{stateWord(r)}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section aria-label="Objets">
              <p className={`mb-2 ${sectionLabel}`}>Objets</p>
              <ul className={listCard}>
                {objects.map((o) => (
                  <li key={o.name} className="min-h-[50px] px-4 py-3">
                    {o.inMap ? (
                      <Link
                        to={objectHref(projectId, o.name)}
                        className={`rounded-md font-mono underline ${focusRing}`}
                      >
                        {o.name}
                      </Link>
                    ) : (
                      <span className="text-dim">
                        <span className="font-mono">{o.name}</span>{" "}
                        <span className="text-xs">non cartographié</span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {unmappedNotice}
            </section>
          </div>
          {view === "graph" && (
            <div className="hidden md:block">{unmappedNotice}</div>
          )}
        </>
      )}
      {analyse && (
        <AnalyseWindow
          projectId={projectId}
          fullName={fullName}
          archived={archived}
          initialRules={analyse === "rules"}
          onClose={() => setAnalyse(null)}
        />
      )}
    </>
  );
}
