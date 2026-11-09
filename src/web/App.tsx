import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useEffect } from "react";
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
import { Claude } from "./Claude.tsx";
import { Cost } from "./Cost.tsx";
import { HomePage } from "./HomePage.tsx";
import { InstallBanner } from "./InstallBanner.tsx";
import { IssueImport } from "./IssueImport.tsx";
import { Journal } from "./JournalPage.tsx";
import { LoadErrorBoundary } from "./LoadErrorBoundary.tsx";
import { Logo } from "./Logo.tsx";
import { Night } from "./Night.tsx";
import { Plugins } from "./Plugins.tsx";
import { ProjectFromTemplate } from "./ProjectFromTemplate.tsx";
import { ProjectPage } from "./ProjectPage.tsx";
import { Projects } from "./Projects.tsx";
import { RunPage } from "./RunPage.tsx";
import { Settings } from "./Settings.tsx";
import { ClaimAdmin, Setup } from "./Setup.tsx";
import { Dot, fetchHealth, fetchMe, IdeaBar, Sidebar } from "./Shell.tsx";
import { Taches } from "./Taches.tsx";
import {
  alertBox,
  button,
  card,
  cardShape,
  panelPrimaryButton,
  primaryButton,
  sectionLabel,
} from "./ui.ts";
import { useAnyChange } from "./useChanges.ts";
import { Welcome } from "./Welcome.tsx";
import { clock } from "./when.ts";

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
      <div role="alert" className={`max-w-[440px] ${alertBox}`}>
        <p>Ton compte a été bloqué par l'administrateur de ce Cockpit.</p>
      </div>
    );
  }
  if (erreur === "connexion-echouee") {
    return (
      <div role="alert" className={`max-w-[440px] ${alertBox}`}>
        <p>La connexion avec GitHub a échoué.</p>
        <a href="/api/auth/login" className={`mt-3 ${button}`}>
          Réessayer
        </a>
      </div>
    );
  }
  return null;
}

/** Shown on the login screen when the server does not answer; the logged-in shell has the banner below. */
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

/** S56 (decision 072 I): on every page of the shell, with the time of the last answer of /api/health; the page asks again every 10 seconds while it fails. */
function OfflineBanner() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    refetchInterval: (query) =>
      query.state.status === "error" ? 10_000 : false,
  });
  const { refetch } = health;
  // React Query only listens to the window; a page shown again (a tab back, a phone unlocked) asks at once.
  useEffect(() => {
    const ask = () => void refetch();
    document.addEventListener("visibilitychange", ask);
    return () => document.removeEventListener("visibilitychange", ask);
  }, [refetch]);
  if (!health.isError) return null;
  return (
    <div
      role="alert"
      className={`mx-[26px] mt-3 flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${card}`}
    >
      <p>
        Cockpit ne répond plus.{" "}
        {health.dataUpdatedAt
          ? `Ce que tu vois date de ${clock(new Date(health.dataUpdatedAt).toISOString())} ; on réessaie`
          : "On réessaie"}{" "}
        toutes les 10 secondes.
      </p>
      <button type="button" onClick={() => health.refetch()} className={button}>
        Réessayer
      </button>
    </div>
  );
}

function Home() {
  return (
    <main>
      <HomePage />
    </main>
  );
}

/** The login screen (S01): no shell around it. */
function LoggedOut() {
  return (
    <main className="grid min-h-screen md:grid-cols-2">
      <div className="flex flex-col gap-7 px-8 py-14 md:px-16">
        <div className="flex items-center gap-2.5">
          <Logo className="size-5" />
          <h1 className="text-lg font-bold">Cockpit</h1>
        </div>
        <p className="mt-[120px] text-[40px] leading-[1.15] font-semibold tracking-[-.02em]">
          Tes repos, Claude et toi,
          <span className="block font-medium text-muted-foreground">
            au même endroit.
          </span>
        </p>
        <p className="max-w-[440px] text-[15px] leading-relaxed text-muted-foreground">
          Cockpit te dit en une seconde ce qui t'attend et ce que fait Claude,
          sur tous tes projets GitHub.
        </p>
        <LoginError />
        <div className="flex max-w-[360px] flex-col gap-2.5">
          <a href="/api/auth/login" className={panelPrimaryButton}>
            Se connecter avec GitHub
          </a>
          <p className="text-[12.5px] text-muted-foreground">
            Cockpit ne voit que les repos que tu lui ouvres. Tu peux tout
            retirer depuis GitHub.
          </p>
        </div>
        <ServerAlert />
      </div>
      <div className="hidden place-items-center border-l border-border bg-card md:grid">
        <div className={`w-[420px] ${cardShape} bg-sunken px-[30px] py-7`}>
          <p className={sectionLabel}>La boucle de Cockpit</p>
          <ul className="mt-4 flex flex-col gap-3">
            {LOOP.map(([tone, title, rest]) => (
              <li key={title} className="flex items-center gap-3">
                <Dot tone={tone} />
                <b>{title}</b>
                <span className="text-muted-foreground">{rest}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}

/** The four « temps » of the loop, as the login screen tells them. */
const LOOP = [
  ["idea", "Une idée naît", "tu la notes en une ligne"],
  ["you", "Tu décides", "tu valides ce que Claude a écrit"],
  ["claude", "Claude développe", "avec ses tests, jusqu'à la PR"],
  ["done", "C'est terminé", "tu relis, tu merges"],
] as const;

const loading = (
  <p role="status" className="p-4 text-muted-foreground">
    Chargement…
  </p>
);

function NotFound() {
  return (
    <main className="grid min-h-[70vh] place-items-center px-[26px]">
      <div className="flex max-w-[440px] flex-col items-center gap-3 text-center">
        <span className="font-mono text-[13px] text-muted-foreground">404</span>
        <h1 className="text-[26px] font-semibold">Cette page n'existe pas.</h1>
        <p className="leading-[1.55] text-muted-foreground">
          Elle a peut-être été déplacée.
        </p>
        <Link to="/" className={`mt-1.5 ${primaryButton}`}>
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
      <div className="flex min-h-screen min-w-0 flex-col pb-16 md:pb-0 lg:has-[aside[data-panel]]:pr-[380px]">
        <OfflineBanner />
        <InstallBanner />
        <div className="flex-1">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/projets" element={<Projects />} />
            <Route path="/projets/nouveau" element={<ProjectFromTemplate />} />
            <Route path="/projets/:id" element={<ProjectPage tab="kanban" />} />
            <Route
              path="/projets/:id/tickets"
              element={<ProjectPage tab="tickets" />}
            />
            <Route
              path="/projets/:id/tickets/importer"
              element={<IssueImport />}
            />
            <Route
              path="/projets/:id/conception"
              element={<ProjectPage tab="conception" />}
            />
            <Route
              path="/projets/:id/conception/regles"
              element={<ProjectPage tab="conception" view="rules" />}
            />
            <Route
              path="/projets/:id/conception/constats"
              element={<ProjectPage tab="conception" view="findings" />}
            />
            <Route
              path="/projets/:id/conception/fonctionnalites"
              element={<ProjectPage tab="conception" view="features" />}
            />
            <Route
              path="/projets/:id/sante"
              element={<ProjectPage tab="sante" />}
            />
            <Route
              path="/projets/:id/agents"
              element={<ProjectPage tab="agents" />}
            />
            <Route path="/projets/:id/ci" element={<ProjectPage tab="ci" />} />
            <Route
              path="/projets/:id/historique"
              element={<ProjectPage tab="historique" />}
            />
            <Route
              path="/projets/:id/historique/livre"
              element={<ProjectPage tab="historique" view="delivered" />}
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
            <Route path="/claude" element={<Claude />} />
            <Route path="/nuit" element={<Night />} />
            <Route path="/claude/taches" element={<Taches />} />
            <Route path="/claude/cout" element={<Cost />} />
            <Route path="/equipes/commun" element={<Plugins />} />
            <Route path="/journal" element={<Journal />} />
            <Route path="/reglages" element={<Settings tab="claude" />} />
            <Route
              path="/reglages/jetons"
              element={<Navigate to="/reglages" replace />}
            />
            <Route
              path="/reglages/utilisateurs"
              element={<Settings tab="utilisateurs" />}
            />
            <Route
              path="/reglages/preferences"
              element={<Settings tab="preferences" />}
            />
            <Route
              path="/reglages/taches-cloud"
              element={<Settings tab="taches-cloud" />}
            />
            <Route
              path="/reglages/ecriture-us"
              element={<Navigate to="/reglages/taches-cloud" replace />}
            />
            <Route path="/bienvenue" element={<Welcome />} />
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

/** The shell for a logged-in user, the login screen otherwise. /autoriser (S05) is a card of its own, with or without a session: it says itself when the account cannot be read. */
function Routed() {
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  return (
    <Routes>
      <Route path="/autoriser" element={<Autoriser />} />
      <Route
        path="*"
        element={
          me.data ? (
            <Shell />
          ) : me.isPending ? (
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
