import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BrowserRouter, NavLink, Route, Routes } from "react-router";
import { client } from "./api.ts";
import { Journal } from "./Journal.tsx";
import { focusRing } from "./ui.ts";

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

// GitHub's login format; anything else in the URL is not shown, so a crafted link cannot write its own sentence.
const GITHUB_LOGIN = /^[a-z\d](?:[a-z\d-]{0,38})$/i;

function LoginError() {
  const params = new URLSearchParams(window.location.search);
  const erreur = params.get("erreur");
  const login = params.get("login");
  if (erreur === "compte-non-autorise") {
    return (
      <div
        role="alert"
        className="mt-8 rounded-xl bg-destructive-soft p-4 text-destructive"
      >
        <p>
          {login && GITHUB_LOGIN.test(login)
            ? `Le compte GitHub ${login}`
            : "Ce compte GitHub"}{" "}
          n'est pas autorisé sur ce Cockpit.
        </p>
        <p className="mt-1">
          Demande à son propriétaire d'ajouter ce login à la liste des comptes
          autorisés.
        </p>
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

export function App() {
  return (
    <BrowserRouter>
      <nav aria-label="Navigation principale" className="flex gap-2 px-4 pt-4">
        <NavLink to="/" end className={navLink}>
          Accueil
        </NavLink>
        <NavLink to="/journal" className={navLink}>
          Journal
        </NavLink>
      </nav>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/journal" element={<Journal />} />
      </Routes>
    </BrowserRouter>
  );
}
