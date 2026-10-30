import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { client } from "./api.ts";
import { ProjectKanban } from "./ProjectKanban.tsx";
import { ProjectRoutine } from "./ProjectRoutine.tsx";
import { fetchProjects } from "./Projects.tsx";
import { ProjectTickets } from "./ProjectTickets.tsx";
import { focusRing } from "./ui.ts";

/** The lines of the health check, or why there are none (decision 013); null when the server answers 401. */
async function fetchHealth(id: string) {
  const res = await client.api.projects[":id"].health.$get({ param: { id } });
  if (res.status === 401) return null;
  if (res.status === 404) return "not_found" as const;
  if (res.status === 409) return "unreachable" as const;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).lines;
}

const LABELS: Record<string, string> = {
  claude_md: "CLAUDE.md",
  ci: "CI",
  mcp: "Serveur MCP de Cockpit",
  agents: "Agents et skill de développement",
  webhook: "Webhook de Cockpit",
};

// One sentence per red line, by "key.detail"; the codes of the server are never shown.
const EXPLANATIONS: Record<string, string> = {
  "claude_md.missing":
    "Ajoute un fichier CLAUDE.md à la racine du repo (ou dans .claude/) pour expliquer le projet à Claude.",
  "ci.missing":
    "Aucun workflow dans .github/workflows : ajoute un fichier .yml qui lance tes tests.",
  "mcp.invalid_json": "Le fichier .mcp.json n'est pas un JSON valide.",
  "mcp.secret_in_clear":
    "Le .mcp.json contient un secret en clair pour Cockpit : utilise une référence à une variable d'environnement.",
  "agents.missing":
    "Il manque au moins un des agents test-writer, developer, reviewer, ou la skill dev-us, dans le dossier .claude/.",
  "webhook.wrong_url":
    "L'adresse du webhook de l'App sur GitHub n'est pas celle de Cockpit, ou le webhook est désactivé : corrige-la dans les réglages de l'App.",
  "webhook.last_delivery_failed":
    "La dernière livraison du webhook a échoué : regarde les livraisons récentes dans les réglages de l'App sur GitHub.",
  "webhook.unknown":
    "Impossible de lire le webhook sur GitHub pour l'instant, réessaie dans un instant.",
};

const button = `min-h-10 rounded-lg border border-border bg-card px-4 font-semibold ${focusRing}`;
const alertBox = "rounded-xl bg-destructive-soft p-4 text-destructive";

export function ProjectPage() {
  const { id = "" } = useParams();
  const projects = useQuery({ queryKey: ["projects"], queryFn: fetchProjects });
  // No retry and no refetch on focus: the alert has its own Réessayer, "Revérifier" reads again, and each read costs several GitHub calls.
  const health = useQuery({
    queryKey: ["health", id],
    queryFn: () => fetchHealth(id),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const project = projects.data?.find((p) => String(p.id) === id);
  const notFound = health.data === "not_found";

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link to="/projets" className={`underline ${focusRing}`}>
        ← Projets
      </Link>
      <h1 className="mt-4 font-heading text-3xl font-extrabold">
        {notFound ? "Projet introuvable" : (project?.fullName ?? "Projet")}
      </h1>
      {!notFound && (
        <section className="mt-6" aria-labelledby="bilan">
          <h2 id="bilan" className="font-heading text-xl font-bold">
            Bilan de santé
          </h2>
          <div className="mt-3" aria-live="polite">
            {health.isPending && (
              <p className="text-muted-foreground">Chargement…</p>
            )}
            {health.isError && (
              <div role="alert" className={alertBox}>
                <p>
                  Impossible de lire le bilan : GitHub ne répond pas comme
                  prévu.
                </p>
                <button
                  type="button"
                  onClick={() => health.refetch()}
                  className={`mt-3 ${button}`}
                >
                  Réessayer
                </button>
              </div>
            )}
            {health.data === null && (
              <a
                href="/api/auth/login"
                className={`inline-flex min-h-10 items-center rounded-lg bg-primary px-4 font-semibold text-primary-foreground ${focusRing}`}
              >
                Se connecter avec GitHub
              </a>
            )}
            {health.data === "unreachable" && (
              <p role="alert" className={alertBox}>
                L'App Cockpit ne voit plus ce repo : vérifie sur GitHub qu'elle
                y a encore accès.
              </p>
            )}
            {Array.isArray(health.data) && (
              <>
                <ul className="grid gap-2">
                  {health.data.map((line) => (
                    <li key={line.key} className="rounded-xl bg-card p-4">
                      <div className="flex items-center gap-x-4">
                        <span className="font-semibold">
                          {LABELS[line.key]}
                        </span>
                        <span
                          className={`rounded-full px-3 py-1 font-semibold sm:ml-auto ${line.ok ? "bg-done-soft text-done-text" : "bg-destructive-soft text-destructive"}`}
                        >
                          {line.ok ? "OK" : "À corriger"}
                        </span>
                      </div>
                      {!line.ok && (
                        <p className="mt-2 text-muted-foreground">
                          {EXPLANATIONS[`${line.key}.${line.detail}`]}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => health.refetch()}
                  disabled={health.isFetching}
                  className={`mt-3 ${button}`}
                >
                  Revérifier
                </button>
              </>
            )}
          </div>
        </section>
      )}
      {!notFound && <ProjectKanban projectId={id} />}
      {!notFound && <ProjectTickets projectId={id} />}
      {!notFound && <ProjectRoutine projectId={id} />}
    </main>
  );
}
