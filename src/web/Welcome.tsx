import { useQuery } from "@tanstack/react-query";
import { Link, Navigate } from "react-router";
import { fetchInstallation } from "./InstallBanner.tsx";
import { focusRing } from "./ui.ts";

/** Where a user lands after their first login when the App is not installed on their account (decision 012 H). */
export function Welcome() {
  const installation = useQuery({
    queryKey: ["installation"],
    queryFn: fetchInstallation,
  });
  // Installed meanwhile (the page was reopened later): nothing to explain.
  if (installation.data?.installed) return <Navigate to="/" replace />;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="font-heading text-3xl font-extrabold">
        Bienvenue dans Cockpit
      </h1>
      <p className="mt-3">
        Pour travailler sur tes repos, Cockpit a besoin d'être installé sur ton
        compte GitHub. Tu choisis sur GitHub les repos qu'il peut voir, et tu
        peux changer ce choix à tout moment.
      </p>
      <p className="mt-3">
        Sans cette installation, ces fonctions ne marchent pas :
      </p>
      <ul className="mt-2 list-disc pl-6">
        <li>l'import de tes repos comme projets ;</li>
        <li>le bilan de santé d'un repo ;</li>
        <li>les issues ;</li>
        <li>le suivi des PR et de la CI ;</li>
        <li>la préparation des repos.</li>
      </ul>
      <p className="mt-3 text-muted-foreground">
        Tu peux quand même te connecter : le Journal reste disponible, et les
        Réglages pour l'administrateur.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        {installation.data && (
          <a
            href={installation.data.installUrl}
            className={`inline-flex min-h-10 items-center rounded-lg bg-primary px-4 font-semibold text-primary-foreground ${focusRing}`}
          >
            Installer Cockpit sur mon compte GitHub
          </a>
        )}
        <Link
          to="/"
          className={`inline-flex min-h-10 items-center rounded-lg border border-border bg-card px-4 font-semibold ${focusRing}`}
        >
          Plus tard
        </Link>
      </div>
      {installation.isError && (
        <p
          role="alert"
          className="mt-4 rounded-xl bg-destructive-soft p-4 text-destructive"
        >
          Impossible de lire l'état de ton installation, recharge la page dans
          un instant.
        </p>
      )}
    </main>
  );
}
