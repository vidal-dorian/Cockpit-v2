import { useQuery } from "@tanstack/react-query";
import { client } from "./api.ts";

async function fetchHealth() {
  const res = await client.api.health.$get();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function App() {
  const health = useQuery({ queryKey: ["health"], queryFn: fetchHealth });

  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="font-heading text-4xl font-extrabold">Cockpit</h1>
      <p className="mt-2 text-muted-foreground">
        Le centre de contrôle de tes repos GitHub avec Claude Code.
      </p>

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
