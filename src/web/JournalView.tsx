import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { type Entry, fetchHistory } from "./Journal.tsx";
import { Panel } from "./Shell.tsx";
import {
  alertBox,
  badge,
  button,
  chipLink,
  focusRing,
  listCard,
  primaryButton,
  sectionLabel,
} from "./ui.ts";

// What the Journal page and the Historique tab of a project share (decision 053): the periods, the chip menu, the list by day and the panel of an entry.

export const ACTOR_WORDS: Record<string, string> = {
  human: "Toi",
  claude: "Claude",
  github: "GitHub",
  system: "Cockpit",
};
export const ORIGIN_WORDS: Record<string, string> = {
  ui: "Interface",
  mcp: "MCP",
  webhook: "Webhook",
  system: "Cockpit",
};
const RESULT_WORDS: Record<string, string> = {
  ok: "réussi",
  refused: "refusé",
  error: "erreur",
};

/** The periods of decision 053 E: the slug of the address, the label and the start in the browser's local time (Tout has none). */
export const PERIODS: {
  slug: string;
  label: string;
  start?: (now: Date) => Date;
}[] = [
  {
    slug: "aujourdhui",
    label: "Aujourd'hui",
    start: (n) => new Date(n.getFullYear(), n.getMonth(), n.getDate()),
  },
  {
    slug: "semaine",
    label: "Cette semaine",
    // Monday, so a Sunday belongs to the week that began six days before.
    start: (n) =>
      new Date(
        n.getFullYear(),
        n.getMonth(),
        n.getDate() - ((n.getDay() + 6) % 7),
      ),
  },
  {
    slug: "mois",
    label: "Ce mois-ci",
    start: (n) => new Date(n.getFullYear(), n.getMonth(), 1),
  },
  { slug: "", label: "Tout" },
];

/** The `since` parameter of a period slug, or nothing for Tout. */
export const sinceOf = (slug: string | null) =>
  PERIODS.find((p) => p.slug === slug)
    ?.start?.(new Date())
    .toISOString();

/** The CSV of the same filters (decision 053 H). */
export const exportHref = (filters: Record<string, string>) => {
  const query = new URLSearchParams(filters).toString();
  return `/api/history/export${query ? `?${query}` : ""}`;
};

export const exportLink = (filters: Record<string, string>) => (
  <a href={exportHref(filters)} className={button}>
    Exporter
  </a>
);

const menuItemsOf = (box: HTMLElement | null) => [
  ...(box?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
];

/** A chip that opens a menu of items; the menu closes when one is chosen, on Escape and on a click elsewhere. The first item takes the focus, the arrows move between items, and the focus goes back to the chip. */
export function ChipMenu({
  label,
  items,
}: {
  label: string;
  items: { key?: string; label: string; onChoose: () => void }[];
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const chip = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    menuItemsOf(box.current)[0]?.focus();
    const away = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      chip.current?.focus();
    }
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!open || !step) return;
    e.preventDefault();
    const all = menuItemsOf(box.current);
    all[all.indexOf(document.activeElement as HTMLElement) + step]?.focus();
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the keys of the menu items are handled here, the buttons are the controls.
    <div ref={box} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={chip}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={chipLink({ isActive: false })}
      >
        {label}
        <span aria-hidden="true" className="ml-1">
          ▾
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 z-20 mt-1 max-h-72 min-w-44 overflow-y-auto rounded-[10px] border border-border-strong bg-raised p-1"
        >
          {items.map((item) => (
            <button
              key={item.key ?? item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                chip.current?.focus();
                item.onChoose();
              }}
              className={`block w-full rounded-md px-3 py-1.5 text-left text-[13px] hover:bg-raised-hover ${focusRing}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The period chip: a menu named after the current period. */
export function PeriodMenu({
  slug,
  onChoose,
}: {
  slug: string | null;
  onChoose: (slug: string) => void;
}) {
  return (
    <ChipMenu
      label={PERIODS.find((p) => p.slug === slug)?.label ?? "Tout"}
      items={PERIODS.map((p) => ({
        label: p.label,
        onChoose: () => onChoose(p.slug),
      }))}
    />
  );
}

const dayLabel = (at: string) => {
  const day = (d: Date) => d.toLocaleDateString("fr-FR");
  const date = new Date(at);
  const now = new Date();
  if (day(date) === day(now)) return "Aujourd'hui";
  if (day(date) === day(new Date(now.getTime() - 86_400_000))) return "Hier";
  return day(date);
};
const clock = (at: string) =>
  new Date(at).toLocaleTimeString("fr-FR", {
    hour: "numeric",
    minute: "2-digit",
  });

function EntryPanel({
  entry,
  counter,
  onRetry,
}: {
  entry: Entry;
  counter?: { index: number; entries: Entry[]; onOpen: (id: number) => void };
  onRetry: (retry: { id: number; at: string; result: string }) => void;
}) {
  const when = new Date(entry.at);
  const retry = "retry" in entry ? entry.retry : null;
  const fields: [string, ReactNode][] = [
    [
      "Quand",
      `${when.toLocaleDateString("fr-FR")} ${when.toLocaleTimeString("fr-FR")}`,
    ],
    ["Acteur", ACTOR_WORDS[entry.actor] ?? entry.actor],
    ["Origine", ORIGIN_WORDS[entry.origin] ?? entry.origin],
    ["Projet", entry.project ?? "—"],
    [
      "Résultat",
      [
        RESULT_WORDS[entry.result] ?? entry.result,
        "detail" in entry && entry.detail?.reason,
      ]
        .filter(Boolean)
        .join(" · "),
    ],
    [
      "Arguments",
      <pre
        key="args"
        className="overflow-x-auto rounded-lg bg-card p-3 font-mono text-[12.5px]"
      >
        {JSON.stringify("args" in entry ? entry.args : {}, null, 2)}
      </pre>,
    ],
  ];
  return (
    <Panel
      label="Entrée du journal"
      badge={<span className={badge}>Entrée du journal</span>}
      counter={
        counter && {
          index: counter.index,
          total: counter.entries.length,
          onPrevious: () =>
            counter.onOpen(counter.entries[counter.index - 1]?.id ?? entry.id),
          onNext: () =>
            counter.onOpen(counter.entries[counter.index + 1]?.id ?? entry.id),
        }
      }
    >
      <h2 className="text-lg font-semibold break-words">
        {entry.action} {RESULT_WORDS[entry.result] ?? entry.result}
      </h2>
      <dl className="flex flex-col gap-3 text-[13.5px]">
        {fields.map(([name, value]) => (
          <div key={name}>
            <dt className={sectionLabel}>{name}</dt>
            <dd className="mt-1 break-words">{value}</dd>
          </div>
        ))}
      </dl>
      {retry && (
        <button
          type="button"
          onClick={() => onRetry(retry)}
          className={`${button} h-auto py-2 text-left whitespace-normal`}
        >
          {entry.actor === "human" ? "Tu as" : `${ACTOR_WORDS[entry.actor]} a`}{" "}
          réessayé à {clock(retry.at)} : {RESULT_WORDS[retry.result]}.
        </button>
      )}
    </Panel>
  );
}

/**
 * The entries of the journal under `filters`, by day with a counter, « Afficher plus » (decision 028 F) and the panel of the open entry (053 G).
 * `row` draws a row; the one it is given opens the entry.
 */
export function JournalList({
  filters,
  row,
}: {
  filters: Record<string, string>;
  row: (entry: Entry, open: () => void) => ReactNode;
}) {
  const pages = useInfiniteQuery({
    queryKey: ["history", filters],
    queryFn: ({ pageParam }) => fetchHistory(pageParam, filters),
    initialPageParam: undefined as number | undefined,
    // The previous rows and an open panel stay while a new filter or search loads.
    placeholderData: keepPreviousData,
    // The next page starts after the last entry shown (decision 028 F).
    getNextPageParam: (last) =>
      last?.hasMore ? last.entries.at(-1)?.id : undefined,
  });
  const entries = pages.data?.pages.flatMap((page) => page?.entries ?? []);
  const [openId, setOpenId] = useState<number | null>(null);
  // A retry the filters hide: shown from `retry` (same actor, action and project as the refusal, decision 053 D D), without its arguments.
  const [hidden, setHidden] = useState<Entry | null>(null);
  const openEntry = (id: number) => {
    setHidden(null);
    setOpenId(id);
  };
  const index = entries?.findIndex((e) => e.id === openId) ?? -1;
  const open = entries?.[index];

  // biome-ignore lint/correctness/useExhaustiveDependencies: `openEntry` only sets state.
  useEffect(() => {
    if (!entries || index < 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const step =
        event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
      const target = event.target as HTMLElement;
      const next = entries[index + step]?.id;
      if (!step || target.closest("input, textarea, select, [role=menu]"))
        return;
      event.preventDefault();
      if (next !== undefined) openEntry(next);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [entries, index]);

  // Grouped by day from the dates already read, in the order of the journal.
  const grouped = new Map<string, Entry[]>();
  for (const entry of entries ?? []) {
    const day = dayLabel(entry.at);
    grouped.set(day, [...(grouped.get(day) ?? []), entry]);
  }
  const signedOut = pages.data?.pages[0] === null;

  return (
    <>
      <div className="mt-5 px-[26px] pb-8" aria-live="polite">
        {pages.isPending && (
          <p className="text-muted-foreground">Chargement…</p>
        )}
        {pages.isError && !pages.data && (
          <div role="alert" className={alertBox}>
            <p>Impossible de lire le journal : {pages.error.message}</p>
            <button
              type="button"
              onClick={() => pages.refetch()}
              className={`mt-3 ${button}`}
            >
              Réessayer
            </button>
          </div>
        )}
        {signedOut && (
          <a href="/api/auth/login" className={primaryButton}>
            Se connecter avec GitHub
          </a>
        )}
        {pages.isSuccess && entries?.length === 0 && !signedOut && (
          <p className="text-muted-foreground">
            {Object.keys(filters).length > 0
              ? "Aucune entrée pour ces filtres."
              : "Aucune entrée pour l'instant."}
          </p>
        )}
        {entries && entries.length > 0 && (
          <>
            <h2 className="sr-only">Journal</h2>
            {[...grouped].map(([day, rows]) => (
              <section key={day} className="mb-5" aria-label={day}>
                <div className="mb-2 flex items-center gap-2">
                  <h3 className={sectionLabel}>{day}</h3>
                  <span className="text-[12.5px] text-muted-foreground">
                    · {rows.length} {rows.length === 1 ? "entrée" : "entrées"}
                  </span>
                </div>
                <ul className={listCard}>
                  {rows.map((entry) => (
                    <Fragment key={entry.id}>
                      {row(entry, () => openEntry(entry.id))}
                    </Fragment>
                  ))}
                </ul>
              </section>
            ))}
            {pages.isFetchNextPageError && (
              <div role="alert" className={`mt-3 ${alertBox}`}>
                <p>Impossible de lire la suite du journal.</p>
                <button
                  type="button"
                  onClick={() => pages.fetchNextPage()}
                  className={`mt-3 ${button}`}
                >
                  Réessayer
                </button>
              </div>
            )}
            {pages.hasNextPage && !pages.isFetchNextPageError && (
              <button
                type="button"
                onClick={() => pages.fetchNextPage()}
                disabled={pages.isFetchingNextPage}
                className={`mt-3 ${button}`}
              >
                {pages.isFetchingNextPage ? "Chargement…" : "Afficher plus"}
              </button>
            )}
          </>
        )}
      </div>
      {open && entries && (
        <EntryPanel
          entry={hidden ?? open}
          counter={hidden ? undefined : { index, entries, onOpen: openEntry }}
          onRetry={(retry) =>
            entries.some((e) => e.id === retry.id)
              ? openEntry(retry.id)
              : setHidden({
                  ...open,
                  ...retry,
                  result: retry.result as Entry["result"],
                  detail: null,
                  args: {},
                  retry: null,
                })
          }
        />
      )}
    </>
  );
}
