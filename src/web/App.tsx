import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, NavLink, Route, Routes } from "react-router";
import { client } from "./api.ts";
import { InstallBanner } from "./InstallBanner.tsx";
import { Journal } from "./Journal.tsx";
import { LoadErrorBoundary } from "./LoadErrorBoundary.tsx";
import { ProjectPage } from "./ProjectPage.tsx";
import { Projects } from "./Projects.tsx";
import { Settings } from "./Settings.tsx";
import { ClaimAdmin, Setup } from "./Setup.tsx";
import { focusRing } from "./ui.ts";
import { Welcome } from "./Welcome.tsx";

// Loaded on first visit: react-markdown stays out of the main bundle.
const TicketPage = lazy(() =>
  import("./TicketPage.tsx").then((m) => ({ default: m.TicketPage })),
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
      <div
        role="alert"
        className="mt-8 rounded-xl bg-destructive-soft p-4 text-destructive"
      >
        <p>Ton compte a été bloqué par l'administrateur de ce Cockpit.</p>
      </div>
    );
  }
  if (erreur === "connexion-echouee") {
    return (
      <div
        role="alert"
        className="mt-8 rounded-xl bg-destructive-soft p-4 text-destructive"
      >
        <p>La connexion avec GitHub a échoué.</p>
        <a
          href="/api/auth/login"
          className={`mt-3 inline-flex min-h-10 items-center rounded-lg bg-card px-4 font-semibold text-foreground ${focusRing}`}
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
      <div
        role="alert"
        className="rounded-xl bg-destructive-soft p-4 text-destructive"
      >
        <p>Impossible de lire ton compte : {me.error.message}</p>
        <button
          type="button"
          onClick={() => me.refetch()}
          className={`mt-3 min-h-10 rounded-lg bg-card px-4 font-semibold text-foreground ${focusRing}`}
        >
          Réessayer
        </button>
      </div>
    );
  }
  if (!me.data) {
    return (
      <a
        href="/api/auth/login"
        className={`inline-flex min-h-10 items-center rounded-lg bg-primary px-4 font-semibold text-primary-foreground ${focusRing}`}
      >
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
        className={`min-h-10 rounded-lg border border-border bg-card px-4 font-semibold ${focusRing}`}
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
  const health = useQuery({ queryKey: ["health"], queryFn: fetchHealth });

  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="font-heading text-4xl font-extrabold">Cockpit</h1>
      <p className="mt-2 text-muted-foreground">
        Le centre de contrôle de tes repos GitHub avec Claude Code.
      </p>

      <LoginError />

      <div className="mt-8" aria-live="polite">
        <Account />
      </div>

      <div className="mt-8" aria-live="polite">
        {health.isPending && (
          <p className="text-muted-foreground">Vérification du serveur…</p>
        )}
        {health.isError && (
          <div
            role="alert"
            className="rounded-xl bg-destructive-soft p-4 text-destructive"
          >
            <p>Serveur injoignable : {health.error.message}</p>
            <button
              type="button"
              onClick={() => health.refetch()}
              className="mt-3 min-h-10 rounded-lg bg-card px-4 font-semibold text-foreground"
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
  `inline-flex min-h-10 items-center rounded-lg px-4 font-semibold ${focusRing} ${isActive ? "bg-card" : "text-muted-foreground"}`;

/** The main navigation; Réglages is every logged-in user's (their MCP tokens). */
function Nav() {
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  return (
    <nav aria-label="Navigation principale" className="flex gap-2 px-4 pt-4">
      <NavLink to="/" end className={navLink}>
        Accueil
      </NavLink>
      <NavLink to="/projets" className={navLink}>
        Projets
      </NavLink>
      <NavLink to="/journal" className={navLink}>
        Journal
      </NavLink>
      {me.data && (
        <NavLink to="/reglages" className={navLink}>
          Réglages
        </NavLink>
      )}
    </nav>
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
      <div
        role="alert"
        className="m-4 rounded-xl bg-destructive-soft p-4 text-destructive"
      >
        <p>Serveur injoignable : {setup.error.message}</p>
        <button
          type="button"
          onClick={() => setup.refetch()}
          className={`mt-3 min-h-10 rounded-lg bg-card px-4 font-semibold text-foreground ${focusRing}`}
        >
          Réessayer
        </button>
      </div>
    );
  }
  // Every page waits for the GitHub App: none of them works without it.
  if (!setup.data.configured)
    return <Setup detectedUrl={setup.data.detectedUrl} />;
  if (setup.data.hasAdmin === false) return <ClaimAdmin />;

  return (
    <BrowserRouter>
      <Nav />
      <InstallBanner />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/projets" element={<Projects />} />
        <Route path="/projets/:id" element={<ProjectPage />} />
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
        <Route path="/journal" element={<Journal />} />
        <Route path="/reglages" element={<Settings />} />
        <Route path="/bienvenue" element={<Welcome />} />
        {/* The wizard's address: once it is done, nothing to show there. */}
        <Route path="/installation" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
