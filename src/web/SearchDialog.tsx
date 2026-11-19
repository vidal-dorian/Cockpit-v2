import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { useNavigate } from "react-router";
import { client } from "./api.ts";
import { Modal } from "./Modal.tsx";
import { repoName, useHome } from "./Shell.tsx";
import { RUN_STATUSES, STEPS, STORY_STATUSES } from "./tickets.ts";
import { alertBox, focusRing, kbd } from "./ui.ts";

// The window of S08 (decision 073 B, C, D).

const FILTERS = [
  "Tout",
  "User stories",
  "Tickets",
  "Runs",
  "Projets",
  "Actions",
] as const;

const PAGES = [
  ["Accueil", "/"],
  ["Claude", "/claude"],
  ["Cette nuit", "/nuit"],
  ["Tous les projets", "/projets"],
  ["Équipes d'agents", "/equipes"],
  ["Journal", "/journal"],
  ["Réglages", "/reglages"],
  ["Préférences", "/reglages/preferences"],
] as const;

type Option = {
  group: (typeof FILTERS)[number];
  title: string;
  detail: string;
  /** Absent on « Noter une idée », which opens a panel instead of a page. */
  to?: string;
  /** The title the panel opens with. */
  idea?: string;
  keys?: string;
};

async function fetchSearch(q: string) {
  const res = await client.api.search.$get({ query: { q } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** The words found, underlined. */
function Highlight({ text, words }: { text: string; words: string[] }) {
  if (words.length === 0) return text;
  const pattern = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // A capturing split puts the matches at the odd places.
  return text.split(new RegExp(`(${pattern.join("|")})`, "i")).map((part, i) =>
    i % 2 === 1 ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: the pieces of a string have no other identity
      <u key={i}>{part}</u>
    ) : (
      part
    ),
  );
}

/** `Ctrl K`: the search window. `onIdea` opens the panel of « Noter une idée » with a title; it is absent when the page cannot note one. */
export function SearchDialog({
  onClose,
  onIdea,
}: {
  onClose: () => void;
  onIdea?: (title: string) => void;
}) {
  const navigate = useNavigate();
  const names = new Map(useHome().data?.projects.map((p) => [p.id, p.name]));
  const project = (id: number) => repoName(names.get(id) ?? "");
  const [text, setText] = useState("");
  const [typed, setTyped] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("Tout");
  const [at, setAt] = useState(0);
  const listId = useId();

  // The search leaves 200 ms after the last keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setTyped(text.trim()), 200);
    return () => clearTimeout(timer);
  }, [text]);
  const search = useQuery({
    queryKey: ["search", typed],
    queryFn: () => fetchSearch(typed),
    // The server wants 2 characters at least.
    enabled: typed.length >= 2,
  });
  const found = search.data;

  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const options: Option[] = [
    ...(found?.stories ?? []).map((s) => ({
      group: "User stories" as const,
      title: `US ${s.id} · ${s.title}`,
      detail: `${project(s.projectId)} · ${STORY_STATUSES[s.status] ?? s.status}`,
      to: `/us/${s.id}`,
    })),
    ...(found?.tickets ?? []).map((t) => ({
      group: "Tickets" as const,
      title: t.title,
      detail: `${project(t.projectId)} · ${STEPS[t.step] ?? t.step}`,
      to: `/tickets/${t.id}`,
    })),
    ...(found?.runs ?? []).map((r) => ({
      group: "Runs" as const,
      title: `Run ${r.id}`,
      detail: `${project(r.projectId)} · US ${r.storyId} · ${RUN_STATUSES[r.status] ?? r.status}`,
      to: `/runs/${r.id}`,
    })),
    ...(found?.projects ?? []).map((p) => ({
      group: "Projets" as const,
      title: p.fullName,
      detail: "Projet",
      to: `/projets/${p.id}`,
    })),
    // What was typed can be noted whatever it finds (decision 084 C), once the results are in so that they stay first.
    ...(onIdea && typed.length >= 2 && !search.isFetching
      ? [
          {
            group: "Actions" as const,
            title: `Noter « ${typed} »`,
            detail: "comme idée, dans le projet de ton choix",
            idea: typed,
          },
        ]
      : []),
    ...[
      ...(onIdea
        ? [
            {
              title: "Noter une idée",
              detail: "dans le projet de ton choix",
              keys: "N",
              idea: "",
            },
          ]
        : []),
      ...PAGES.map(([title, to]) => ({ title, detail: "Aller à", to })),
    ]
      .filter((a) => words.every((w) => a.title.toLowerCase().includes(w)))
      .map((a) => ({ group: "Actions" as const, ...a })),
  ].filter((o) => filter === "Tout" || o.group === filter);
  const chosen = options[Math.min(at, options.length - 1)];

  const open = (option: Option | undefined, newTab: boolean) => {
    if (!option) return;
    if (option.to && newTab)
      return void window.open(option.to, "_blank", "noopener");
    onClose();
    if (option.to) navigate(option.to);
    else onIdea?.(option.idea ?? "");
  };

  return (
    <Modal
      label="Chercher"
      onClose={onClose}
      className="mt-[12vh] mb-auto w-[620px] max-w-[calc(100%-2rem)] max-md:mt-0"
    >
      <div className="flex items-center gap-3 border-b border-border px-5 py-3.5">
        <span aria-hidden="true" className="text-muted-foreground">
          ⌕
        </span>
        <input
          role="combobox"
          aria-label="Chercher"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={
            chosen && `${listId}-${options.indexOf(chosen)}`
          }
          value={text}
          maxLength={200}
          onChange={(event) => {
            setText(event.target.value);
            setAt(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              open(chosen, event.ctrlKey || event.metaKey);
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const by = event.key === "ArrowDown" ? 1 : -1;
              setAt(Math.max(0, Math.min(options.length - 1, at + by)));
            }
          }}
          className={`min-w-0 flex-1 bg-transparent text-base placeholder:text-dim ${focusRing}`}
        />
        <kbd className={kbd}>Échap</kbd>
      </div>
      <div className="flex flex-wrap gap-2 border-b border-border px-5 py-3">
        {FILTERS.map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={filter === name}
            onClick={() => {
              setFilter(name);
              setAt(0);
            }}
            className={`h-7 rounded-full border px-3 text-[12.5px] font-semibold ${focusRing} ${filter === name ? "border-foreground bg-raised text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
          >
            {name}
          </button>
        ))}
      </div>
      <div
        role="listbox"
        id={listId}
        aria-label="Résultats"
        className="max-h-[50vh] overflow-y-auto max-md:max-h-none"
      >
        {search.isError && (
          <p role="alert" className={`m-3 ${alertBox}`}>
            La recherche a échoué, réessaie.
          </p>
        )}
        {options.length === 0 && !search.isError && (
          <p className="px-5 py-6 text-muted-foreground">Rien trouvé.</p>
        )}
        {options.map((option, i) => (
          <div key={`${option.group}-${option.to ?? option.title}`}>
            {options[i - 1]?.group !== option.group && (
              <h3 className="px-5 pt-3 pb-1.5 text-[13px] text-muted-foreground">
                {option.group}
              </h3>
            )}
            {/* The keyboard acts from the field (aria-activedescendant): the options are not tab stops. */}
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: see above */}
            <div
              role="option"
              tabIndex={-1}
              id={`${listId}-${i}`}
              aria-selected={option === chosen}
              onClick={(event) => open(option, event.ctrlKey || event.metaKey)}
              className={`flex cursor-pointer items-center gap-3 border-l-2 px-5 py-2 ${option === chosen ? "border-foreground bg-raised" : "border-transparent"}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">
                  <Highlight text={option.title} words={words} />
                </span>
                <span className="block truncate text-[12.5px] text-muted-foreground">
                  {option.detail}
                </span>
              </span>
              {option.keys && <kbd className={kbd}>{option.keys}</kbd>}
            </div>
          </div>
        ))}
      </div>
      <p className="flex flex-wrap gap-x-4 border-t border-border px-5 py-3 text-[12px] text-muted-foreground max-md:hidden">
        <span>
          <kbd className={kbd}>↑</kbd> <kbd className={kbd}>↓</kbd> choisir
        </span>
        <span>
          <kbd className={kbd}>Entrée</kbd> ouvrir
        </span>
        <span>
          <kbd className={kbd}>Ctrl Entrée</kbd> ouvrir dans un nouvel onglet
        </span>
      </p>
    </Modal>
  );
}
