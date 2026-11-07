import { useQuery } from "@tanstack/react-query";
import { Link, Navigate } from "react-router";
import { fetchInstallation } from "./InstallBanner.tsx";
import { StateSentence } from "./Shell.tsx";
import {
  alertBox,
  card,
  ghostButton,
  primaryButton,
  sectionLabel,
} from "./ui.ts";

/** Where a user lands after their first login when the App is not installed on their account (decision 012 H). */
export function Welcome() {
  const installation = useQuery({
    queryKey: ["installation"],
    queryFn: fetchInstallation,
  });
  // Installed meanwhile (the page was reopened later): nothing to explain.
  if (installation.data?.installed) return <Navigate to="/" replace />;

  return (
    <main>
      <StateSentence
        title="Bienvenue dans Cockpit"
        rest="Ouvre à Cockpit les repos qu'il peut voir."
      />
      <section className="px-[26px] pt-5">
        <h2 className={sectionLabel}>Pour commencer</h2>
        <div className={`mt-2 ${card} px-[22px] py-5`}>
          <p>
            Pour travailler sur tes repos, Cockpit a besoin d'être installé sur
            ton compte GitHub. Tu choisis sur GitHub les repos qu'il peut voir,
            et tu peux changer ce choix à tout moment.
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
            Tu peux quand même te connecter : le Journal reste disponible, et
            les Réglages pour l'administrateur.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {installation.data && (
              <a href={installation.data.installUrl} className={primaryButton}>
                Installer Cockpit sur mon compte GitHub
              </a>
            )}
            <Link to="/" className={ghostButton}>
              Plus tard
            </Link>
          </div>
        </div>
        {installation.isError && (
          <p role="alert" className={`mt-4 ${alertBox}`}>
            Impossible de lire l'état de ton installation, recharge la page dans
            un instant.
          </p>
        )}
      </section>
    </main>
  );
}
