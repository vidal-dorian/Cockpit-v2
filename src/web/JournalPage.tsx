import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { ACTIONS, JournalEntry } from "./Journal.tsx";
import {
  ACTOR_WORDS,
  ChipMenu,
  exportLink,
  JournalList,
  ORIGIN_WORDS,
  PeriodMenu,
  sinceOf,
} from "./JournalView.tsx";
import { fetchProjects } from "./Projects.tsx";
import { repoName, StateSentence } from "./Shell.tsx";
import { chipLink, field, focusRing, ghostButton } from "./ui.ts";

type Option = { slug: string; value: string; label: string };
/** A filter of the page (decision 053 F): its name, the parameter of the address and of the request, and its values. `free` values are taken as they come (a project id, an action). */
type Facet = {
  name: string;
  param: string;
  query: string;
  options: Option[];
  free?: boolean;
};

const optionOf = (f: Facet, slug: string | null) =>
  f.options.find((o) => o.slug === slug);

const fixed = (
  name: string,
  param: string,
  query: string,
  options: [slug: string, value: string, label: string][],
): Facet => ({
  name,
  param,
  query,
  options: options.map(([slug, value, label]) => ({ slug, value, label })),
});

const AUTEUR = fixed("Auteur", "auteur", "actor", [
  ["toi", "human", ACTOR_WORDS.human ?? ""],
  ["claude", "claude", "Claude"],
  ["github", "github", "GitHub"],
  ["cockpit", "system", "Cockpit"],
]);
const RESULTAT = fixed("Résultat", "resultat", "result", [
  ["reussi", "ok", "Réussi"],
  ["refuse", "refused", "Refusé"],
  ["erreur", "error", "Erreur"],
]);
const ORIGINE = fixed("Origine", "origine", "origin", [
  ["interface", "ui", ORIGIN_WORDS.ui ?? ""],
  ["mcp", "mcp", "MCP"],
  ["webhook", "webhook", "Webhook"],
  ["cockpit", "system", "Cockpit"],
]);
const OUTIL: Facet = {
  name: "Outil",
  param: "outil",
  query: "action",
  free: true,
  options: Object.entries(ACTIONS).map(([action, label]) => ({
    slug: action,
    value: action,
    label,
  })),
};

/** The page of the whole journal (S40, decision 053 F): the filters live in the address, so a filtered view survives a reload and can be shared. */
export function Journal() {
  const [params, setParams] = useSearchParams();
  const projects = useQuery({ queryKey: ["projects"], queryFn: fetchProjects });
  const projet: Facet = {
    name: "Projet",
    param: "projet",
    query: "project",
    free: true,
    options: (projects.data ?? []).map((p) => ({
      slug: String(p.id),
      value: String(p.id),
      label: repoName(p.fullName),
    })),
  };
  const facets = [AUTEUR, RESULTAT, projet, OUTIL, ORIGINE];

  const set = (key: string, value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  const filters: Record<string, string> = {};
  for (const f of facets) {
    const slug = params.get(f.param);
    const option = optionOf(f, slug);
    if (option) filters[f.query] = option.value;
    else if (slug && f.free) filters[f.query] = slug;
  }
  const since = sinceOf(params.get("periode"));
  if (since) filters.since = since;
  const q = params.get("q") ?? "";
  if (q) filters.q = q;

  return (
    <main>
      <StateSentence
        title="Tout ce qui s'est passé, par qui."
        rest="Rien ne s'efface ; chaque appel de Claude y est."
        actions={exportLink(filters)}
      />
      <div className="mt-4 flex flex-wrap items-center gap-2 px-[26px]">
        <input
          type="search"
          aria-label="Chercher…"
          placeholder="Chercher…"
          maxLength={100}
          value={q}
          onChange={(e) => set("q", e.target.value)}
          className={`${field} mt-0 w-56`}
        />
        {facets.map((f) => {
          const slug = params.get(f.param);
          const chosen = slug
            ? (optionOf(f, slug)?.label ?? (f.free ? slug : undefined))
            : undefined;
          return chosen ? (
            <span
              key={f.name}
              className={`${chipLink({ isActive: true })} gap-1.5`}
            >
              <span>{chosen}</span>
              <button
                type="button"
                aria-label={`Retirer le filtre ${f.name}`}
                onClick={() => set(f.param, "")}
                className={`rounded-full px-1 ${focusRing}`}
              >
                ×
              </button>
            </span>
          ) : (
            <ChipMenu
              key={f.name}
              label={f.name}
              items={f.options.map((o) => ({
                label: o.label,
                onChoose: () => set(f.param, o.slug),
              }))}
            />
          );
        })}
        <PeriodMenu
          slug={params.get("periode")}
          onChoose={(slug) => set("periode", slug)}
        />
        {(Object.keys(filters).length > 0 || params.has("periode")) && (
          <button
            type="button"
            onClick={() => setParams({}, { replace: true })}
            className={ghostButton}
          >
            Effacer les filtres
          </button>
        )}
      </div>
      <JournalList
        filters={filters}
        row={(entry, open) => (
          <JournalEntry entry={entry} timeOnly onOpen={open} />
        )}
      />
    </main>
  );
}
