import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useParams,
} from "react-router";
import { Autoriser } from "./Autoriser.tsx";
import { client } from "./api.ts";
import { HomePage } from "./HomePage.tsx";
import { InstallBanner } from "./InstallBanner.tsx";
import { Journal } from "./Journal.tsx";
import { LoadErrorBoundary } from "./LoadErrorBoundary.tsx";
import { ProjectPage } from "./ProjectPage.tsx";
import { Projects } from "./Projects.tsx";
import { RunPage } from "./RunPage.tsx";
import { Settings } from "./Settings.tsx";
import { ClaimAdmin, Setup } from "./Setup.tsx";
import {
  fetchHealth,
  fetchMe,
  IdeaBar,
  Sidebar,
  StateSentence,
} from "./Shell.tsx";
import { alertBox, button, primaryButton } from "./ui.ts";
import { useAnyChange } from "./useChanges.ts";
import { Welcome } from "./Welcome.tsx";

// Loaded on first visit: react-markdown stays out of the main bundle.
const TicketPage = lazy(() =>
  import("./TicketPage.tsx").then((m) => ({ default: m.TicketPage })),
);

const StoryPage = lazy(() =>
  import("./StoryPage.tsx").then((m) => ({ default: m.StoryPage })),
);

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

/** Shown on the home and the login screen when the server does not answer; the version lives in the sidebar. */
function ServerAlert() {
  const health = useQuery({ queryKey: ["health"], queryFn: fetchHealth });
  if (!health.isError) return null;
  return (
    <div role="alert" className={`mx-[26px] mt-[26px] ${alertBox}`}>
      <p>Serveur injoignable : {health.error.message}</p>
      <button
        type="button"
        onClick={() => health.refetch()}
        className={`mt-3 ${button}`}
      >
        Réessayer
      </button>
    </div>
  );
}

function Home() {
  return (
    <main>
      <ServerAlert />
      <HomePage />
    </main>
  );
}

/** The login screen: no shell around it. */
function LoggedOut() {
  return (
    <main className="mx-auto max-w-[880px] px-4 py-16 sm:px-7">
      <h1 className="font-heading text-4xl font-extrabold">Cockpit</h1>
      <p className="mt-2 text-muted-foreground">
        Le centre de contrôle de tes repos GitHub avec Claude Code.
      </p>
      <LoginError />
      <div className="mt-8">
        <a href="/api/auth/login" className={primaryButton}>
          Se connecter avec GitHub
        </a>
      </div>
      <ServerAlert />
    </main>
  );
}

const loading = (
  <p role="status" className="p-4 text-muted-foreground">
    Chargement…
  </p>
);

function NotFound() {
  return (
    <main>
      <StateSentence
        title="Cette page n'existe pas."
        rest="Elle a peut-être été déplacée."
      />
      <div className="px-[26px] pt-6">
        <Link to="/" className={primaryButton}>
          Retour à l'accueil
        </Link>
      </div>
    </main>
  );
}

/** The shell (045 F): the sidebar, then the page and the idea bar at the bottom. */
function Shell() {
  // The one stream of the tab, opened after the page's own: the home, the sidebar and the idea bar read the same query.
  useAnyChange("home");
  return (
    <div className="md:grid md:grid-cols-[224px_minmax(0,1fr)]">
      <Sidebar />
      {/* A page renders its own <main>. */}
      <div className="flex min-h-screen min-w-0 flex-col lg:has-[aside[data-panel]]:pr-[380px]">
        <InstallBanner />
        <div className="flex-1">
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
              path="/projets/:id/agents"
              element={<ProjectPage tab="agents" />}
            />
            <Route
              path="/projets/:id/reglages"
              element={<ProjectPage tab="reglages" />}
            />
            <Route
              path="/projets/:id/ecriture-us"
              element={<RedirectToSettings />}
            />
            <Route
              path="/tickets/:id"
              element={
                <LoadErrorBoundary>
                  <Suspense fallback={loading}>
                    <TicketPage />
                  </Suspense>
                </LoadErrorBoundary>
              }
            />
            <Route
              path="/us/:id"
              element={
                <LoadErrorBoundary>
                  <Suspense fallback={loading}>
                    <StoryPage />
                  </Suspense>
                </LoadErrorBoundary>
              }
            />
            <Route path="/runs/:id" element={<RunPage />} />
            <Route path="/journal" element={<Journal />} />
            <Route path="/reglages" element={<Settings tab="claude" />} />
            <Route
              path="/reglages/jetons"
              element={<Settings tab="jetons" />}
            />
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
            <Route path="*" element={<NotFound />} />
          </Routes>
        </div>
        <IdeaBar />
      </div>
    </div>
  );
}

/** The old address of « Écriture des US » is now the Réglages tab of the project (045 H). */
function RedirectToSettings() {
  const { id } = useParams();
  return <Navigate to={`/projets/${id}/reglages`} replace />;
}

/** The shell for a logged-in user, the login screen otherwise (/autoriser has its own, and says itself when the account cannot be read). */
function Routed() {
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  if (me.data) return <Shell />;
  return (
    <Routes>
      <Route path="/autoriser" element={<Autoriser />} />
      <Route
        path="*"
        element={
          me.isPending ? (
            <p className="p-4 text-muted-foreground">Chargement…</p>
          ) : me.isError ? (
            <div role="alert" className={`m-4 ${alertBox}`}>
              <p>Impossible de lire ton compte : {me.error.message}</p>
              <button
                type="button"
                onClick={() => me.refetch()}
                className={`mt-3 ${button}`}
              >
                Réessayer
              </button>
            </div>
          ) : (
            <LoggedOut />
          )
        }
      />
    </Routes>
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
      <Routed />
    </BrowserRouter>
  );
}
