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
import { Modal } from "./Modal.tsx";
import { fetchProjects } from "./Projects.tsx";
import { fetchRun } from "./RunPage.tsx";
import { atLeast } from "./roles.ts";
import { useShortcut } from "./Shortcuts.tsx";
import { fetchStory } from "./StoryDecisions.tsx";
import { identify, init } from "./telemetry.ts";
import { fetchTicket, ticketError } from "./tickets.ts";
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

/** The PostHog key, or null: also when the server does not answer, telemetry is never worth an error screen (decision 083 B). */
export async function fetchTelemetry() {
  let key: string | null = null;
  try {
    const res = await client.api.telemetry.$get();
    if (res.ok) key = (await res.json()).key;
  } catch {}
  // Starts telemetry before any screen mounts, so that the first $pageview is not lost; a no-op the next times. Not awaited: the page never waits for the posthog-js chunk.
  void init(key).catch(() => {});
  return key;
}

/** The logged-in account, or null when the server answers 401. */
export async function fetchMe() {
  const res = await client.api.me.$get();
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const me = await res.json();
  // Here, not in an effect: the first $pageview of a load must already carry the account (decision 083 C).
  identify(String(me.id));
  return me;
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

/** A 7 px dot naming a « temps » (the colour budget of 045 C); `live` makes a halo breathe out of the Claude dot (decision 080 H). */
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

/** A new page starts at the top (decision 080 D); Précédent and Suivant keep the browser's scroll, a change of query (a Kanban card) keeps the page where it is. */
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

// `tall`: the rows of the phone's menu are at least 44 px (decision 084 B2).
const navItem =
  (tall: boolean) =>
  ({ isActive }: { isActive: boolean }) =>
    `flex ${tall ? "h-11" : "h-[34px]"} items-center gap-2.5 rounded-[9px] px-2.5 font-semibold ${focusRing} ${isActive ? "bg-raised text-foreground" : "text-muted-foreground hover:text-foreground"}`;
const subItem =
  (tall: boolean) =>
  ({ isActive }: { isActive: boolean }) =>
    `flex ${tall ? "h-11" : "h-[30px]"} items-center gap-2.5 rounded-lg pr-2.5 pl-[22px] text-[13.5px] font-medium ${focusRing} ${isActive ? "bg-raised text-foreground" : "text-muted-foreground hover:text-foreground"}`;
const sidebarLabel =
  "mx-2.5 mt-3.5 mb-1 text-[11px] font-bold uppercase tracking-[.08em] text-dim";

/** What the left column and the phone's menu hold (045 F, 084 B2): search, navigation with counters, the favourite projects and the ones that are not idle, Réglages, the account and the version. `menu` makes the rows 44 px tall; `onNavigate` runs when a row is touched. */
function SidebarContent({
  onSearch,
  menu = false,
  onNavigate,
}: {
  onSearch: () => void;
  menu?: boolean;
  onNavigate?: () => void;
}) {
  const nav = navItem(menu);
  const sub = subItem(menu);
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
    <>
      {!menu && (
        <Link
          to="/"
          className={`mb-3.5 flex items-center gap-2.5 rounded-xl px-2.5 text-base font-bold ${focusRing}`}
        >
          <Logo className="size-5" />
          Cockpit
        </Link>
      )}
      <button
        type="button"
        onClick={onSearch}
        aria-keyshortcuts="Control+K Meta+K"
        className={`mb-3 flex ${menu ? "h-11" : "h-9"} items-center gap-2 rounded-[10px] border border-border bg-sunken px-2.5 text-[13px] text-muted-foreground hover:text-foreground ${focusRing}`}
      >
        <span aria-hidden="true">⌕</span>
        Chercher
        {!menu && <kbd className={`${kbd} ml-auto`}>Ctrl K</kbd>}
      </button>
      <nav aria-label="Navigation principale" className="flex flex-col gap-0.5">
        <NavLink to="/" end className={nav} onClick={onNavigate}>
          Accueil
          {forYou.length > 0 && (
            <>
              {" "}
              <span className={`${badge} ml-auto`}>{forYou.length}</span>
            </>
          )}
        </NavLink>
        <NavLink to="/claude" className={nav} onClick={onNavigate}>
          Claude
        </NavLink>
        <NavLink to="/nuit" className={nav} onClick={onNavigate}>
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
              className={sub}
              onClick={onNavigate}
            >
              <Dot tone={p.id === firstProject ? "you" : "none"} />
              <span className="min-w-0 truncate">{repoName(p.name)}</span>
              {count > 0 && <span className={`${badge} ml-auto`}>{count}</span>}
            </NavLink>
          );
        })}
        <NavLink to="/projets" end className={sub} onClick={onNavigate}>
          Tous les projets
          <span className="ml-auto text-muted-foreground">
            {home?.projects.length}
          </span>
        </NavLink>
        <Link
          to="/projets#importer"
          className={sub({ isActive: false })}
          onClick={onNavigate}
        >
          + Importer un repo
        </Link>
        <p className={sidebarLabel}>Configurer</p>
        <NavLink to="/equipes" className={nav} onClick={onNavigate}>
          Équipes d'agents
        </NavLink>
        <NavLink to="/journal" className={nav} onClick={onNavigate}>
          Journal
        </NavLink>
      </nav>
      <div className="mt-auto flex flex-col gap-0.5 pt-4">
        <NavLink to="/reglages" className={nav} onClick={onNavigate}>
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
              className={`rounded-md hover:text-foreground disabled:opacity-50 ${menu ? "h-11" : ""} ${focusRing}`}
            >
              Se déconnecter
            </button>
          )}
          {health.data && <span>{`Cockpit v${health.data.version}`}</span>}
        </div>
      </div>
    </>
  );
}

/** The left column of a logged-in user (045 F). */
export function Sidebar({ onSearch }: { onSearch: () => void }) {
  return (
    <aside
      aria-label="Barre latérale"
      className="hidden flex-col border-r border-border bg-card px-3 py-4 md:sticky md:flex md:top-0 md:h-screen md:overflow-y-auto"
    >
      <SidebarContent onSearch={onSearch} />
    </aside>
  );
}

const tab = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-16 flex-1 flex-col items-center justify-center gap-1 text-xs font-semibold ${focusRing} ${isActive ? "text-foreground" : "text-muted-foreground"}`;

/** The 24 px icon of a tab, drawn in the colour of its word. */
function TabIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

// Pages only the menu reaches: its tab is the current one there (decision 084 B4).
const MENU_ONLY = /^\/(claude|equipes|journal|reglages)(\/|$)/;

const NO_KEYBOARD_INPUTS =
  /^(checkbox|radio|button|submit|reset|range|color|file|image|hidden)$/;

function opensKeyboard(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  // The idea panel keeps the bar usable (decision 084 B4).
  if (el.closest("[data-keeps-phone-nav]")) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !NO_KEYBOARD_INPUTS.test(el.type);
  return el.isContentEditable || el.getAttribute("contenteditable") === "true";
}

/** True while a text field has focus. iOS keeps a fixed bottom bar offset by the keyboard height once the keyboard is gone; not rendering the bar meanwhile makes the browser lay it out again at the real bottom (decision 084 B). */
function useTextFieldFocus() {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const onIn = (e: FocusEvent) => setTyping(opensKeyboard(e.target));
    // activeElement is unreliable during focusout: the next target is relatedTarget.
    const onOut = (e: FocusEvent) => setTyping(opensKeyboard(e.relatedTarget));
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, []);
  return typing;
}

/** The bar of the phone (decision 071 B, 084 B), below md: « Idée » opens the panel of the idea bar, so it is absent without a project; « Menu » opens the content of the sidebar full screen. */
function PhoneNav({
  onIdea,
  open,
  onNavigate,
  onSearch,
  morning,
}: {
  onIdea?: (opener: HTMLElement) => void;
  /** The morning block of the home still waits: the Nuit tab says « bilan à lire » (084 B5). */
  morning: boolean;
  open: boolean;
  onNavigate: () => void;
  onSearch: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  const idle = !open && !menuOpen;
  const menuPage = MENU_ONLY.test(pathname);
  const closeMenu = () => setMenuOpen(false);
  const typing = useTextFieldFocus();
  return (
    <>
      {!typing && (
        <nav
          aria-label="Navigation du téléphone"
          className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
        >
          <NavLink
            to="/"
            end
            className={(state) => tab({ isActive: state.isActive && idle })}
            onClick={onNavigate}
          >
            <TabIcon>
              <path d="M3 11l9-8 9 8" />
              <path d="M5 10v10h14V10" />
            </TabIcon>
            Accueil
          </NavLink>
          {onIdea && (
            <button
              type="button"
              aria-expanded={open}
              onClick={(event) => onIdea(event.currentTarget)}
              className={tab({ isActive: open })}
            >
              <TabIcon>
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
              </TabIcon>
              Idée
            </button>
          )}
          <NavLink
            to="/nuit"
            aria-label={morning ? "Nuit, bilan à lire" : undefined}
            className={(state) => tab({ isActive: state.isActive && idle })}
            onClick={onNavigate}
          >
            <span className="relative">
              <TabIcon>
                <path d="M21 13A9 9 0 1111 3a7 7 0 0010 10z" />
              </TabIcon>
              {morning && (
                <span className="absolute -top-0.5 -right-1">
                  <Dot tone="done" />
                </span>
              )}
            </span>
            Nuit
          </NavLink>
          <NavLink
            to="/projets"
            end
            className={(state) => tab({ isActive: state.isActive && idle })}
            onClick={onNavigate}
          >
            <TabIcon>
              <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            </TabIcon>
            Projets
          </NavLink>
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-haspopup="dialog"
            aria-current={menuPage && !menuOpen ? "page" : undefined}
            onClick={() => {
              onNavigate();
              setMenuOpen(true);
            }}
            className={tab({ isActive: menuOpen || (menuPage && !open) })}
          >
            <TabIcon>
              <path d="M4 6h16M4 12h16M4 18h16" />
            </TabIcon>
            Menu
          </button>
        </nav>
      )}
      {menuOpen && (
        <Modal label="Menu" onClose={closeMenu}>
          <div className="flex min-h-full flex-col bg-card px-3 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={closeMenu}
              className={`mb-3 ml-auto h-11 rounded-[10px] px-3.5 font-semibold text-muted-foreground hover:text-foreground ${focusRing}`}
            >
              Fermer
            </button>
            <SidebarContent
              menu
              onNavigate={closeMenu}
              onSearch={() => {
                closeMenu();
                onSearch();
              }}
            />
          </div>
        </Modal>
      )}
    </>
  );
}

/** The bar at the bottom of the center (045 F): note an idea as a ticket of a project; `n` anywhere focuses it. The bar is hidden without a project and below md, where the phone nav opens the same panel. */
export function IdeaBar({
  ref,
  onSearch,
}: {
  /** Opens the panel of the idea from elsewhere (the search window); the first argument is what gets the focus back, if any, the second the title to start with. */
  ref?: React.Ref<(opener: HTMLElement | null, title?: string) => void>;
  /** Opens the search window (the « Chercher » row of the phone's menu). */
  onSearch: () => void;
}) {
  const queryClient = useQueryClient();
  const home = useHome();
  // An idea is a ticket: only the projects where the role may write one (decision 076 A).
  const roles = useQuery({ queryKey: ["projects"], queryFn: fetchProjects });
  const projects = (home.data?.projects ?? []).filter((p) =>
    atLeast(roles.data?.find((r) => r.id === p.id)?.role, "can_validate"),
  );
  // The project of the page shown (decision 085 C): a project page, or the story, ticket or run of one; the queries are the pages' own.
  const story = useMatch("/us/:id")?.params.id;
  const ticket = useMatch("/tickets/:id")?.params.id;
  const run = useMatch("/runs/:id")?.params.id;
  const shownStory = useQuery({
    queryKey: ["story", story],
    queryFn: () => fetchStory(story as string),
    enabled: story !== undefined,
  }).data;
  const shownTicket = useQuery({
    queryKey: ["ticket", ticket],
    queryFn: () => fetchTicket(ticket as string),
    enabled: ticket !== undefined,
  }).data;
  const shownRun = useQuery({
    queryKey: ["run", run],
    queryFn: () => fetchRun(run as string),
    enabled: run !== undefined,
  }).data;
  const shownId = [
    shownStory && shownStory !== "not_found" && shownStory.project.id,
    shownTicket && shownTicket !== "not_found" && shownTicket.ticket.projectId,
    shownRun && shownRun !== "not_found" && shownRun.project.id,
  ].find(Boolean);
  const routeId =
    useMatch("/projets/:id/*")?.params.id ??
    (shownId ? String(shownId) : undefined);
  // The project of the last idea noted, for the pages that show no project.
  const [last, setLast] = useState<string>();
  const [title, setTitle] = useState("");
  const [chosen, setChosen] = useState<{ routeId?: string; id: string }>();
  const [done, setDone] = useState<string>();
  const [created, setCreated] = useState<number>();
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

  const openPanel = (el: HTMLElement | null, text?: string) => {
    opener.current = el;
    if (text) setTitle(text);
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
      : exists(last)
        ? (last as string)
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
      setLast(sent.projectId);
      setCreated(id);
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
          onSearch={onSearch}
          morning={home.data?.night != null}
        />
      )}
      {projects.length > 0 && (
        <div
          ref={wrapper}
          // The content fades out as it passes under the bar (decision 080 J); as tall as the margin above, so nothing is covered at rest.
          className="sticky bottom-0 mx-[26px] mt-4 mb-5 before:pointer-events-none before:absolute before:inset-x-0 before:-top-4 before:h-4 before:bg-linear-to-t before:from-background before:content-[''] max-md:bottom-[calc(4.5rem+env(safe-area-inset-bottom))]"
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
              {done}{" "}
              <Link to={`/tickets/${created}`} className="underline">
                Ouvrir le ticket
              </Link>
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
