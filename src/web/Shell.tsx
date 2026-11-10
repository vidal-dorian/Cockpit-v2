import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  Link,
  NavLink,
  useLocation,
  useMatch,
  useNavigationType,
} from "react-router";
import { client } from "./api.ts";
import { uploadAttachment } from "./attachments.ts";
import { type Idea, IdeaPanel } from "./IdeaPanel.tsx";
import { Logo } from "./Logo.tsx";
import { fetchProjects } from "./Projects.tsx";
import { atLeast } from "./roles.ts";
import { useShortcut } from "./Shortcuts.tsx";
import { ticketError } from "./tickets.ts";
import { badge, focusRing, kbd } from "./ui.ts";

// The shell of decision 045 F (sidebar, idea bar) and the pieces every page builds on (state sentence, breadcrumb, right panel, dot).

/** « dorian/GestionProjet » shown as « GestionProjet »: the mockups never show the owner. */
export const repoName = (fullName: string) =>
  fullName.split("/").pop() ?? fullName;

export async function fetchHealth() {
  const res = await client.api.health.$get();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** The logged-in account, or null when the server answers 401. */
export async function fetchMe() {
  const res = await client.api.me.$get();
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchHome() {
  const res = await client.api.home.$get();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** The night of the user and the stories that could join it (decision 044 C). */
export async function fetchNight() {
  const res = await client.api.nights.current.$get();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** What waits for the user (decision 040): the home reads it, and so do the sidebar and the idea bar. */
export function useHome() {
  return useQuery({ queryKey: ["home"], queryFn: fetchHome });
}

const DOT_TONES = {
  idea: "bg-idea",
  you: "bg-you",
  claude: "bg-claude",
  done: "bg-done",
  none: "bg-border-strong",
};

/** A 7 px dot naming a « temps » (the colour budget of 045 C); `live` makes a halo breathe out of the Claude dot (decision 079 H). */
export function Dot({
  tone,
  live = false,
}: {
  tone: keyof typeof DOT_TONES;
  live?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-[7px] flex-none rounded-full ${DOT_TONES[tone]} ${live ? "live-dot" : ""}`}
    />
  );
}

/** The top of every page (045 D): a sentence saying the state. `rest` is part of the h1, in muted weight; `actions` sit on the right; `headingRef` makes the h1 a focus target that outlives the panels of the page. */
export function StateSentence({
  title,
  rest,
  actions,
  headingRef,
}: {
  title: React.ReactNode;
  rest?: React.ReactNode;
  actions?: React.ReactNode;
  headingRef?: React.Ref<HTMLHeadingElement>;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between md:flex-nowrap gap-4 px-[26px] pt-[26px] [nav+&]:pt-1.5 [nav+*>&]:pt-1.5">
      <h1
        ref={headingRef}
        tabIndex={headingRef ? -1 : undefined}
        className="text-[26px] leading-tight font-semibold tracking-[-.01em] focus:outline-none"
      >
        {title}
        {rest && (
          <span className="block font-normal text-muted-foreground">
            {rest}
          </span>
        )}
      </h1>
      {actions}
    </div>
  );
}

/** The muted line above a state sentence: links for the steps with `to`, then the optional repo full name in mono. */
export function Breadcrumb({
  trail,
  repo,
}: {
  trail: { label: string; to?: string }[];
  repo?: string;
}) {
  return (
    <nav
      aria-label="Fil d'Ariane"
      className="flex flex-wrap items-baseline gap-1.5 px-[26px] pt-[22px] text-[13px] text-muted-foreground"
    >
      {trail.map((step, i) => (
        <span key={step.label} className="contents">
          {i > 0 && <span aria-hidden="true">›</span>}
          {step.to ? (
            <Link
              to={step.to}
              className={`rounded-md hover:text-foreground ${focusRing}`}
            >
              {step.label}
            </Link>
          ) : (
            <span>{step.label}</span>
          )}
        </span>
      ))}
      {repo && <span className="font-mono text-[11.5px]">{repo}</span>}
    </nav>
  );
}

/** A new page starts at the top (decision 079 D); Précédent and Suivant keep the browser's scroll, a change of query (a Kanban card) keeps the page where it is. */
export function ScrollToTop() {
  const { pathname } = useLocation();
  const type = useNavigationType();
  // biome-ignore lint/correctness/useExhaustiveDependencies: the pathname is the trigger, not a value read
  useEffect(() => {
    if (type !== "POP") window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

// A square icon button: the caller adds the size.
const squareButton = `grid place-items-center rounded-[10px] border border-border-strong bg-raised text-muted-foreground hover:bg-raised-hover not-disabled:active:scale-[.97] disabled:opacity-40 ${focusRing}`;
const arrowButton = `${squareButton} size-[30px]`;

/**
 * The right panel (380 px, fixed on lg+; `<main>` makes room for it, below lg it follows the content).
 * `label` names it, `badge` is the pill on the left of the header, `counter` adds « i sur n » with Précédent and Suivant (`index` starts at 0, `words` says them otherwise),
 * `meta` is a muted label on the right of the header (S24: « Développer avec Claude »),
 * `footer` is pinned at the bottom (the white button of the panel: `panelPrimaryButton`).
 */
export function Panel({
  label,
  badge: badgeNode,
  counter,
  meta,
  children,
  footer,
  onKeyDown,
}: {
  label: string;
  badge?: React.ReactNode;
  counter?: {
    index: number;
    total: number;
    onPrevious: () => void;
    onNext: () => void;
    /** The words of a counter that is not « i sur n » with Précédent and Suivant: the text before the arrows and the names of the two arrows (« à relire », « Précédente », « Suivante »). */
    words?: { count: string; previous: string; next: string };
  };
  meta?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Keys pressed inside the panel (a shortcut that must not fire from the rest of the page). */
  onKeyDown?: React.KeyboardEventHandler<HTMLElement>;
}) {
  // J and K, like the arrows (decision 073 E).
  // shortcut: every mounted Panel with a counter answers J/K; give the shortcut to the topmost one if two ever show together
  useShortcut(
    "j",
    counter && counter.index < counter.total - 1 ? counter.onNext : undefined,
  );
  useShortcut(
    "k",
    counter && counter.index > 0 ? counter.onPrevious : undefined,
  );
  return (
    <aside
      data-panel
      onKeyDown={onKeyDown}
      aria-label={label}
      className="flex flex-col gap-3.5 border-t border-border bg-sunken p-[22px] lg:fixed lg:inset-y-0 lg:right-0 lg:z-10 lg:w-[380px] lg:overflow-y-auto lg:border-t-0 lg:border-l"
    >
      <div className="flex items-center justify-between gap-2">
        <div>{badgeNode}</div>
        {meta && (
          <span className="text-[13px] text-muted-foreground">{meta}</span>
        )}
        {counter && (
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <span>
              {counter.words?.count ??
                `${counter.index + 1} sur ${counter.total}`}
            </span>
            <button
              type="button"
              aria-label={counter.words?.previous ?? "Précédent"}
              disabled={counter.index === 0}
              onClick={counter.onPrevious}
              className={arrowButton}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label={counter.words?.next ?? "Suivant"}
              disabled={counter.index >= counter.total - 1}
              onClick={counter.onNext}
              className={arrowButton}
            >
              ↓
            </button>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3.5">{children}</div>
      {footer && <div className="mt-4 flex flex-col gap-2">{footer}</div>}
    </aside>
  );
}

const navItem = ({ isActive }: { isActive: boolean }) =>
  `flex h-[34px] items-center gap-2.5 rounded-[9px] px-2.5 font-semibold ${focusRing} ${isActive ? "bg-raised text-foreground" : "text-muted-foreground hover:text-foreground"}`;
const subItem = ({ isActive }: { isActive: boolean }) =>
  `flex h-[30px] items-center gap-2.5 rounded-lg pr-2.5 pl-[22px] text-[13.5px] font-medium ${focusRing} ${isActive ? "bg-raised text-foreground" : "text-muted-foreground hover:text-foreground"}`;
const sidebarLabel =
  "mx-2.5 mt-3.5 mb-1 text-[11px] font-bold uppercase tracking-[.08em] text-dim";

/** The left column of a logged-in user (045 F): search, navigation with counters, the favourite projects and the ones that are not idle, Réglages, the account and the version. */
export function Sidebar({ onSearch }: { onSearch: () => void }) {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe }).data;
  const health = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    retry: false,
  });
  const home = useHome().data;
  const night = useQuery({
    queryKey: ["home", "night"],
    queryFn: fetchNight,
  }).data?.night;
  const logout = useMutation({
    mutationFn: async () => {
      // While the session is still valid, the device stops being this user's: its push subscription goes (decision 072 F).
      const sub = await (
        await navigator.serviceWorker?.getRegistration()
      )?.pushManager.getSubscription();
      if (sub) {
        await client.api.push.subscriptions.$delete({
          json: { endpoint: sub.endpoint },
        });
        // The server row is already gone: a browser that cannot reach its push service must not block the logout.
        await sub.unsubscribe().catch(() => {});
      }
      const res = await client.api.auth.logout.$post();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // The copies of the service worker (same name as CACHE in public/sw.js) hold this user's pages.
      await window.caches?.delete("cockpit-v1");
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["me"] }),
  });

  const forYou = home?.forYou ?? [];
  const firstProject = forYou[0]?.project.id;
  // The favourites first, even idle (decision 073 H), then the active ones that are not.
  const all = home?.projects ?? [];
  const favorites = all.filter((p) => p.favorite);
  const projects = [
    ...favorites,
    ...all.filter((p) => !p.favorite && p.state !== "idle"),
  ];

  return (
    <aside
      aria-label="Barre latérale"
      className="hidden flex-col border-r border-border bg-card px-3 py-4 md:sticky md:flex md:top-0 md:h-screen md:overflow-y-auto"
    >
      <Link
        to="/"
        className={`mb-3.5 flex items-center gap-2.5 rounded-xl px-2.5 text-base font-bold ${focusRing}`}
      >
        <Logo className="size-5" />
        Cockpit
      </Link>
      <button
        type="button"
        onClick={onSearch}
        aria-keyshortcuts="Control+K Meta+K"
        className={`mb-3 flex h-9 items-center gap-2 rounded-[10px] border border-border bg-sunken px-2.5 text-[13px] text-muted-foreground hover:text-foreground ${focusRing}`}
      >
        <span aria-hidden="true">⌕</span>
        Chercher
        <kbd className={`${kbd} ml-auto`}>Ctrl K</kbd>
      </button>
      <nav aria-label="Navigation principale" className="flex flex-col gap-0.5">
        <NavLink to="/" end className={navItem}>
          Accueil
          {forYou.length > 0 && (
            <>
              {" "}
              <span className={`${badge} ml-auto`}>{forYou.length}</span>
            </>
          )}
        </NavLink>
        <NavLink to="/claude" className={navItem}>
          Claude
        </NavLink>
        <NavLink to="/nuit" className={navItem}>
          ☾ Cette nuit
          {night && night.items.length > 0 && (
            <span className={`${badge} ml-auto`}>{night.items.length}</span>
          )}
        </NavLink>
        {projects.length > 0 && (
          <p className={sidebarLabel}>
            {favorites.length > 0 ? "Projets favoris" : "Projets"}
          </p>
        )}
        {projects.map((p) => {
          const count = forYou.filter(
            (item) => item.project.id === p.id,
          ).length;
          return (
            <NavLink
              key={p.id}
              to={`/projets/${p.id}`}
              aria-label={p.name}
              className={subItem}
            >
              <Dot tone={p.id === firstProject ? "you" : "none"} />
              {repoName(p.name)}
              {count > 0 && <span className={`${badge} ml-auto`}>{count}</span>}
            </NavLink>
          );
        })}
        <NavLink to="/projets" end className={subItem}>
          Tous les projets
          <span className="ml-auto text-muted-foreground">
            {home?.projects.length}
          </span>
        </NavLink>
        <Link to="/projets" className={subItem({ isActive: false })}>
          + Importer un repo
        </Link>
        <p className={sidebarLabel}>Configurer</p>
        <NavLink to="/equipes" className={navItem}>
          Équipes d'agents
        </NavLink>
        <NavLink to="/journal" className={navItem}>
          Journal
        </NavLink>
      </nav>
      <div className="mt-auto flex flex-col gap-0.5 pt-4">
        <NavLink to="/reglages" className={navItem}>
          Réglages
        </NavLink>
        {me && (
          <div className="flex items-center gap-2.5 px-2.5 py-1">
            {me.avatarUrl ? (
              <img src={me.avatarUrl} alt="" className="size-6 rounded-full" />
            ) : (
              <span
                aria-hidden="true"
                className="grid size-6 place-items-center rounded-full bg-raised-hover text-xs font-semibold uppercase"
              >
                {(me.name ?? me.login).charAt(0)}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate font-semibold">
              {me.name ?? me.login}
            </span>
          </div>
        )}
        {logout.isError && (
          <p role="alert" className="px-2.5 text-destructive">
            La déconnexion a échoué, réessaie.
          </p>
        )}
        <div className="mt-1 flex items-center justify-between px-2.5 text-[11.5px] text-dim">
          {me && (
            <button
              type="button"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
              aria-busy={logout.isPending}
              className={`rounded-md hover:text-foreground disabled:opacity-50 ${focusRing}`}
            >
              Se déconnecter
            </button>
          )}
          {health.data && <span>{`Cockpit v${health.data.version}`}</span>}
        </div>
      </div>
    </aside>
  );
}

const tab = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-11 flex-1 flex-col items-center justify-center text-[11.5px] font-semibold ${focusRing} ${isActive ? "text-foreground" : "text-muted-foreground"}`;

/** The bar of the phone (decision 071 B), below md: « Idée » opens the panel of the idea bar, so it is absent without a project. */
function PhoneNav({
  onIdea,
  open,
  onNavigate,
}: {
  onIdea?: (opener: HTMLElement) => void;
  open: boolean;
  onNavigate: () => void;
}) {
  return (
    <nav
      aria-label="Navigation du téléphone"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-card md:hidden"
    >
      <NavLink
        to="/"
        end
        className={(state) => tab({ isActive: state.isActive && !open })}
        onClick={onNavigate}
      >
        <span aria-hidden="true">⌂</span>
        Accueil
      </NavLink>
      {onIdea && (
        <button
          type="button"
          aria-expanded={open}
          onClick={(event) => onIdea(event.currentTarget)}
          className={tab({ isActive: open })}
        >
          <span aria-hidden="true">✎</span>
          Idée
        </button>
      )}
      <NavLink
        to="/nuit"
        className={(state) => tab({ isActive: state.isActive && !open })}
        onClick={onNavigate}
      >
        <span aria-hidden="true">☾</span>
        Nuit
      </NavLink>
      <NavLink
        to="/projets"
        end
        className={(state) => tab({ isActive: state.isActive && !open })}
        onClick={onNavigate}
      >
        <span aria-hidden="true">▤</span>
        Projets
      </NavLink>
    </nav>
  );
}

/** The bar at the bottom of the center (045 F): note an idea as a ticket of a project; `n` anywhere focuses it. The bar is hidden without a project and below md, where the phone nav opens the same panel. */
export function IdeaBar({
  ref,
}: {
  /** Opens the panel of the idea from elsewhere (the search window); the argument is what gets the focus back, if any. */
  ref?: React.Ref<(opener: HTMLElement | null) => void>;
}) {
  const queryClient = useQueryClient();
  const home = useHome();
  // An idea is a ticket: only the projects where the role may write one (decision 076 A).
  const roles = useQuery({ queryKey: ["projects"], queryFn: fetchProjects });
  const projects = (home.data?.projects ?? []).filter((p) =>
    atLeast(roles.data?.find((r) => r.id === p.id)?.role, "can_validate"),
  );
  const routeId = useMatch("/projets/:id/*")?.params.id;
  const [title, setTitle] = useState("");
  const [chosen, setChosen] = useState<{ routeId?: string; id: string }>();
  const [done, setDone] = useState<string>();
  // The files a refused upload left out: the ticket exists, its page is where to try again (decision 061 F).
  const [unattached, setUnattached] = useState<{
    id: number;
    names: string[];
  }>();
  // Enter opens the panel of decision 055 D instead of creating the ticket.
  const [open, setOpen] = useState(false);
  // What the panel holds besides the title (the bar's own): it survives « Annuler » and goes with a successful « Noter ».
  const [draft, setDraft] = useState<Partial<Omit<Idea, "title">>>({});
  const input = useRef<HTMLInputElement>(null);

  // The panel replaces the bar: when it closes, the keyboard goes back to the bar.
  // The phone's Idée tab when it opened the panel: the bar is not displayed below md.
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) wasOpen.current = true;
    else if (wasOpen.current) {
      wasOpen.current = false;
      // The opener is not displayed once the window grew past md.
      (opener.current?.checkVisibility?.() === false
        ? input.current
        : (opener.current ?? input.current)
      )?.focus();
      opener.current = null;
    }
  }, [open]);

  const openPanel = (el: HTMLElement | null) => {
    opener.current = el;
    setOpen(true);
  };
  useImperativeHandle(ref, () => openPanel);

  // Below md the open panel covers the page: nothing behind it takes the keyboard.
  const wrapper = useRef<HTMLDivElement>(null);
  // shortcut: inert is decided when the panel opens; resizing across md while it is open leaves it stale, subscribe to matchMedia if that matters
  useEffect(() => {
    if (!open || !window.matchMedia?.("(max-width: 767px)").matches) return;
    const behind = [...(wrapper.current?.parentElement?.children ?? [])].filter(
      (el) =>
        el !== wrapper.current &&
        !el.matches('nav[aria-label="Navigation du téléphone"]'),
    );
    for (const el of behind) el.setAttribute("inert", "");
    return () => {
      for (const el of behind) el.removeAttribute("inert");
    };
  }, [open]);

  useShortcut("n", open ? undefined : () => input.current?.focus());

  const exists = (id?: string) => projects.some((p) => String(p.id) === id);
  // A choice holds for the page it was made on: another project page brings its own project back.
  const picked = chosen?.routeId === routeId ? chosen?.id : undefined;
  const projectId = exists(picked)
    ? (picked as string)
    : exists(routeId)
      ? (routeId as string)
      : String(projects[0]?.id);
  const send = useMutation({
    mutationFn: async ({
      projectId: id,
      title,
      descriptionMd,
      files,
      ...rest
    }: Idea) => {
      const res = await client.api.projects[":id"].tickets.$post({
        param: { id },
        json: {
          title: title.trim(),
          ...(descriptionMd && { descriptionMd }),
          ...rest,
        },
      });
      if (!res.ok) throw await ticketError(res, rest.tags.length > 0);
      const { ticket } = await res.json();
      const names: string[] = [];
      for (const file of files)
        if (await uploadAttachment(ticket.id, file)) names.push(file.name);
      return { id: ticket.id, names };
    },
    onSuccess: ({ id, names }, sent) => {
      setUnattached(names.length > 0 ? { id, names } : undefined);
      setTitle("");
      setDraft({});
      setOpen(false);
      setDone(
        `Idée notée dans ${repoName(projects.find((p) => String(p.id) === sent.projectId)?.name ?? "")}.`,
      );
      for (const queryKey of [
        ["tickets", sent.projectId],
        ["stories", sent.projectId],
        ["home"],
      ])
        queryClient.invalidateQueries({ queryKey });
    },
  });

  return (
    <>
      {/* Once the projects are known: the Idée tab depends on them. */}
      {!home.isPending && (
        <PhoneNav
          onIdea={projects.length > 0 ? openPanel : undefined}
          open={open}
          onNavigate={() => setOpen(false)}
        />
      )}
      {projects.length > 0 && (
        <div
          ref={wrapper}
          // The content fades out as it passes under the bar (decision 079 J); as tall as the margin above, so nothing is covered at rest.
          className="sticky bottom-0 mx-[26px] mt-4 mb-5 before:pointer-events-none before:absolute before:inset-x-0 before:-top-4 before:h-4 before:bg-linear-to-t before:from-background before:content-[''] max-md:bottom-16"
        >
          {send.isError && (
            <p role="alert" className="mb-2 text-destructive">
              {send.error.message}
            </p>
          )}
          {unattached && !send.isError && (
            <p role="alert" className="mb-2 text-destructive">
              {unattached.names.length === 1
                ? "Ce fichier n'a pas été joint"
                : "Ces fichiers n'ont pas été joints"}{" "}
              : {unattached.names.join(", ")}.{" "}
              <Link to={`/tickets/${unattached.id}`} className="underline">
                Ouvrir le ticket
              </Link>
            </p>
          )}
          {done && !send.isError && (
            <p role="status" className="mb-2 text-muted-foreground">
              {done}
            </p>
          )}
          {open && (
            <IdeaPanel
              projects={projects.map((p) => ({
                id: p.id,
                label: repoName(p.name),
              }))}
              idea={{
                descriptionMd: "",
                priority: "normal",
                tags: [],
                files: [],
                ...draft,
                projectId: draft.projectId ?? projectId,
                title,
              }}
              pending={send.isPending}
              onChange={({ title: edited, ...rest }) => {
                if (edited !== undefined) setTitle(edited);
                setDraft({ ...draft, ...rest });
              }}
              onSubmit={(idea) => {
                setUnattached(undefined);
                send.mutate(idea);
              }}
              onCancel={() => {
                setOpen(false);
                send.reset();
              }}
            />
          )}
          <form
            aria-label="Noter une idée"
            // The panel replaces the bar while it is open (S09).
            inert={open}
            onSubmit={(event) => {
              event.preventDefault();
              if (title.trim() !== "") setOpen(true);
            }}
            className="hidden items-center gap-2.5 rounded-[14px] border border-border bg-card py-2.5 pr-3 pl-4 md:flex"
          >
            <span aria-hidden="true" className="text-muted-foreground">
              ✎
            </span>
            <input
              ref={input}
              aria-label="Idée"
              placeholder="Noter une idée…"
              value={title}
              maxLength={200}
              onChange={(event) => {
                setTitle(event.target.value);
                setDone(undefined);
                setUnattached(undefined);
              }}
              className={`field-sizing-content min-w-[7.5rem] max-w-full bg-transparent placeholder:text-dim ${focusRing}`}
            />
            <kbd className={kbd}>N</kbd>
            <span className="ml-auto text-[12.5px] text-muted-foreground">
              pour
            </span>
            <select
              aria-label="Projet"
              value={projectId}
              onChange={(event) =>
                setChosen({ routeId, id: event.target.value })
              }
              className={`max-w-[200px] rounded-[10px] bg-transparent px-2 py-1 font-semibold ${focusRing}`}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id} className="bg-card">
                  {repoName(p.name)}
                </option>
              ))}
            </select>
            <button
              type="submit"
              aria-label="Noter l'idée"
              disabled={title.trim() === ""}
              className={`${squareButton} size-9`}
            >
              ↑
            </button>
          </form>
        </div>
      )}
    </>
  );
}
