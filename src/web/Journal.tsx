import { useQuery } from "@tanstack/react-query";
import { client } from "./api.ts";
import { focusRing } from "./ui.ts";

/** The caller's entries, or null when the server answers 401. */
async function fetchHistory() {
  const res = await client.api.history.$get();
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).entries;
}

const ACTIONS: Record<string, string> = {
  login: "Connexion",
  logout: "Déconnexion",
};
const ORIGINS: Record<string, string> = { ui: "Interface" };
// The word always comes with the color, so the result never relies on color alone (decision 003).
const RESULTS: Record<string, { label: string; style: string }> = {
  ok: { label: "Réussie", style: "bg-done-soft text-done-text" },
  refused: { label: "Refusée", style: "bg-destructive-soft text-destructive" },
  error: { label: "Erreur", style: "bg-destructive-soft text-destructive" },
};

export function Journal() {
  const entries = useQuery({ queryKey: ["history"], queryFn: fetchHistory });

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="font-heading text-3xl font-extrabold">Journal</h1>
      <div className="mt-6" aria-live="polite">
        {entries.isPending && (
          <p className="text-muted-foreground">Chargement…</p>
        )}
        {entries.isError && (
          <div
            role="alert"
            className="rounded-xl bg-destructive-soft p-4 text-destructive"
          >
            <p>Impossible de lire le journal : {entries.error.message}</p>
            <button
              type="button"
              onClick={() => entries.refetch()}
              className={`mt-3 min-h-10 rounded-lg bg-card px-4 font-semibold text-foreground ${focusRing}`}
            >
              Réessayer
            </button>
          </div>
        )}
        {entries.isSuccess && entries.data === null && (
          <a
            href="/api/auth/login"
            className={`inline-flex min-h-10 items-center rounded-lg bg-primary px-4 font-semibold text-primary-foreground ${focusRing}`}
          >
            Se connecter avec GitHub
          </a>
        )}
        {entries.isSuccess && entries.data?.length === 0 && (
          <p className="text-muted-foreground">Aucune entrée pour l'instant.</p>
        )}
        {entries.isSuccess && entries.data && entries.data.length > 0 && (
          <ul className="grid gap-2">
            {entries.data.map((entry) => {
              const result = RESULTS[entry.result];
              return (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-card p-4"
                >
                  <span className="font-semibold">
                    {ACTIONS[entry.action] ?? entry.action}
                  </span>
                  <span
                    className={`rounded-full px-3 py-1 font-semibold ${result?.style ?? ""}`}
                  >
                    {result?.label ?? entry.result}
                  </span>
                  <span className="text-muted-foreground">
                    {ORIGINS[entry.origin] ?? entry.origin}
                  </span>
                  <time
                    dateTime={entry.at}
                    className="text-muted-foreground sm:ml-auto"
                  >
                    {new Date(entry.at).toLocaleString("fr-FR")}
                  </time>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
