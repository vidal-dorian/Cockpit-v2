import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import {
  BrowserRouter,
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
} from "react-router";
import { Autoriser } from "./Autoriser.tsx";
import { client } from "./api.ts";
import { HomePage, useHome } from "./HomePage.tsx";
import { InstallBanner } from "./InstallBanner.tsx";
import { Journal } from "./Journal.tsx";
import { LoadErrorBoundary } from "./LoadErrorBoundary.tsx";
import { ProjectPage } from "./ProjectPage.tsx";
import { Projects } from "./Projects.tsx";
import { RunPage } from "./RunPage.tsx";
import { Settings } from "./Settings.tsx";
import { ClaimAdmin, Setup } from "./Setup.tsx";
import { alertBox, button, focusRing, primaryButton } from "./ui.ts";
import { useAnyChange } from "./useChanges.ts";
import { Welcome } from "./Welcome.tsx";

// Loaded on first visit: react-markdown stays out of the main bundle.
const TicketPage = lazy(() =>
  import("./TicketPage.tsx").then((m) => ({ default: m.TicketPage })),
);

const StoryPage = lazy(() =>
  import("./StoryPage.tsx").then((m) => ({ default: m.StoryPage })),
);

async function fetchHealth() {
  const res = await client.api.health.$get();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** The logged-in account, or null when the server answers 401. */
async function fetchMe() {
  const res = await client.api.me.$get();
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function LoginError() {
  const params = new URLSearchParams(window.location.search);
  const erreur = params.get("erreur");
  if (erreur === "compte-bloque") {
    return (
      <div role="alert" className={`mt-8 ${alertBox}`}>
        <p>Ton compte a été bloqué par l'administrateur de ce Cockpit.</p>
      </div>
    );
  }
  if (erreur === "connexion-echouee") {
    return (
      <div role="alert" className={`mt-8 ${alertBox}`}>
        <p>La connexion avec GitHub a échoué.</p>
        <a
          href="/api/auth/login"
          className={`mt-3 inline-flex items-center ${button}`}
        >
          Réessayer
        </a>
      </div>
    );
  }
  return null;
}

function Account() {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const logout = useMutation({
    mutationFn: async () => {
      const res = await client.api.auth.logout.$post();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["me"] }),
  });

  if (me.isPending) return <p className="text-muted-foreground">Chargement…</p>;
  if (me.isError) {
    return (
      <div role="alert" className={alertBox}>
        <p>Impossible de lire ton compte : {me.error.message}</p>
        <button
          type="button"
          onClick={() => me.refetch()}
          className={`mt-3 ${button}`}
        >
          Réessayer
        </button>
      </div>
    );
  }
  if (!me.data) {
    return (
      <a href="/api/auth/login" className={primaryButton}>
        Se connecter avec GitHub
      </a>
    );
  }
  return (
    <div className="flex items-center gap-3">
      {me.data.avatarUrl && (
        <img src={me.data.avatarUrl} alt="" className="size-10 rounded-full" />
      )}
      <span className="font-semibold">{me.data.name ?? me.data.login}</span>
      <button
        type="button"
        onClick={() => logout.mutate()}
        disabled={logout.isPending}
        className={button}
      >
        Se déconnecter
      </button>
      {logout.isError && (
        <span role="alert" className="text-destructive">
          La déconnexion a échoué, réessaie.
        </span>
      )}
    </div>
  );
}

function Home() {
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const health = useQuery({ queryKey: ["health"], queryFn: fetchHealth });

  return (
    <main className="mx-auto max-w-[880px] px-4 sm:px-7 py-16">
      <h1 className="font-heading text-4xl font-extrabold">Cockpit</h1>
      <p className="mt-2 text-muted-foreground">
        Le centre de contrôle de tes repos GitHub avec Claude Code.
      </p>
      {/* The page title first, then what waits for you (003), then the account and the server. */}
      {me.data && <HomePage />}

      <LoginError />

      <div className="mt-8" aria-live="polite">
        <Account />
      </div>

      <div className="mt-8" aria-live="polite">
        {health.isPending && (
          <p className="text-muted-foreground">Vérification du serveur…</p>
        )}
        {health.isError && (
          <div role="alert" className={alertBox}>
            <p>Serveur injoignable : {health.error.message}</p>
            <button
              type="button"
              onClick={() => health.refetch()}
              className={`mt-3 ${button}`}
            >
              Réessayer
            </button>
          </div>
        )}
        {health.isSuccess && (
          <p className="inline-block rounded-full bg-done-soft px-3 py-1 font-semibold text-done-text">
            Serveur OK · v{health.data.version}
          </p>
        )}
      </div>
    </main>
  );
}

const navLink = ({ isActive }: { isActive: boolean }) =>
  `inline-flex min-h-10 items-center rounded-full px-4 font-semibold ${focusRing} ${isActive ? "bg-raised text-foreground" : "text-muted-foreground hover:text-foreground"}`;

/** The logo: a circle and two sectors, in tokens (decision 028 D). */
function Logo() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-7"
      aria-hidden="true"
      focusable="false"
    >
      <circle
        cx="12"
        cy="12"
        r="10.5"
        className="fill-none stroke-cream"
        strokeWidth="1.5"
      />
      <path d="M12 12V1.5A10.5 10.5 0 0 1 22.5 12Z" className="fill-primary" />
      <path d="M12 12H1.5A10.5 10.5 0 0 0 12 22.5Z" className="fill-cream" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
  );
}

/** The top bar (decision 028 D): logo, main navigation, and for a logged-in user Réglages and the account's avatar or initial. */
function TopBar() {
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const account = me.data;
  // A failed read is no counter, not an error of the bar.
  // The one stream of the tab: the home page reads the same query.
  useAnyChange("home", !!account);
  const waiting = useHome(!!account).data?.forYou.length;
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-7">
        <Link
          to="/"
          className={`inline-flex items-center gap-2 rounded-xl font-heading text-lg font-extrabold ${focusRing}`}
        >
          <Logo />
          Cockpit
        </Link>
        <nav aria-label="Navigation principale" className="flex gap-1">
          <NavLink to="/" end className={navLink}>
            Accueil{waiting ? ` ${waiting}` : ""}
          </NavLink>
          <NavLink to="/projets" className={navLink}>
            Projets
          </NavLink>
          <NavLink to="/journal" className={navLink}>
            Journal
          </NavLink>
        </nav>
        {account && (
          <div className="ml-auto flex items-center gap-2">
            <NavLink
              to="/reglages"
              aria-label="Réglages"
              className={({ isActive }) =>
                `inline-flex size-10 items-center justify-center rounded-full ${focusRing} ${isActive ? "bg-raised text-foreground" : "text-muted-foreground hover:bg-raised hover:text-foreground"}`
              }
            >
              <SettingsIcon />
            </NavLink>
            {account.avatarUrl ? (
              <img
                src={account.avatarUrl}
                alt=""
                className="size-9 rounded-full"
              />
            ) : (
              <span
                aria-hidden="true"
                className="inline-flex size-9 items-center justify-center rounded-full bg-you-soft font-semibold text-you-text uppercase"
              >
                {(account.name ?? account.login).charAt(0)}
              </span>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

/** Whether the wizard has run, and the address the visitor used (decision 012). */
async function fetchSetupStatus() {
  const res = await client.api.setup.status.$get();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function App() {
  const setup = useQuery({ queryKey: ["setup"], queryFn: fetchSetupStatus });

  if (setup.isPending)
    return <p className="p-4 text-muted-foreground">Chargement…</p>;
  if (setup.isError) {
    return (
      <div role="alert" className={`m-4 ${alertBox}`}>
        <p>Serveur injoignable : {setup.error.message}</p>
        <button
          type="button"
          onClick={() => setup.refetch()}
          className={`mt-3 ${button}`}
        >
          Réessayer
        </button>
      </div>
    );
  }
  // Every page waits for the GitHub App: none of them works without it.
  if (!setup.data.configured) return <Setup />;
  if (setup.data.hasAdmin === false) return <ClaimAdmin />;

  return (
    <BrowserRouter>
      <TopBar />
      <InstallBanner />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/projets" element={<Projects />} />
        <Route path="/projets/:id" element={<ProjectPage tab="kanban" />} />
        <Route
          path="/projets/:id/tickets"
          element={<ProjectPage tab="tickets" />}
        />
        <Route
          path="/projets/:id/sante"
          element={<ProjectPage tab="sante" />}
        />
        <Route
          path="/projets/:id/ecriture-us"
          element={<ProjectPage tab="ecriture-us" />}
        />
        <Route
          path="/projets/:id/agents"
          element={<ProjectPage tab="agents" />}
        />
        <Route
          path="/tickets/:id"
          element={
            <LoadErrorBoundary>
              <Suspense
                fallback={
                  <p role="status" className="p-4 text-muted-foreground">
                    Chargement…
                  </p>
                }
              >
                <TicketPage />
              </Suspense>
            </LoadErrorBoundary>
          }
        />
        <Route
          path="/us/:id"
          element={
            <LoadErrorBoundary>
              <Suspense
                fallback={
                  <p role="status" className="p-4 text-muted-foreground">
                    Chargement…
                  </p>
                }
              >
                <StoryPage />
              </Suspense>
            </LoadErrorBoundary>
          }
        />
        <Route path="/runs/:id" element={<RunPage />} />
        <Route path="/journal" element={<Journal />} />
        <Route path="/reglages" element={<Settings tab="claude" />} />
        <Route path="/reglages/jetons" element={<Settings tab="jetons" />} />
        <Route
          path="/reglages/utilisateurs"
          element={<Settings tab="utilisateurs" />}
        />
        <Route
          path="/reglages/ecriture-us"
          element={<Settings tab="ecriture-us" />}
        />
        <Route path="/bienvenue" element={<Welcome />} />
        <Route path="/autoriser" element={<Autoriser />} />
        {/* The wizard's address: once it is done, nothing to show there. */}
        <Route path="/installation" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
