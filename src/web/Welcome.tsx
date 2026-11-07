import { useQuery } from "@tanstack/react-query";
import { Link, Navigate } from "react-router";
import { fetchInstallation } from "./InstallBanner.tsx";
import { fetchMe, StateSentence } from "./Shell.tsx";
import {
  alertBox,
  card,
  ghostButton,
  primaryButton,
  sectionLabel,
} from "./ui.ts";

const STEPS = [
  [
    "Choisir tes repos sur GitHub",
    "Tous, ou seulement certains. Tu pourras changer d'avis.",
  ],
  [
    "Les importer dans Cockpit",
    "Chaque repo devient un projet avec son bilan de santé.",
  ],
  [
    "Connecter Claude",
    "Pour qu'il écrive les US et rende compte de son travail.",
  ],
];

const NEVER = [
  "Il n'écrit dans un repo qu'après ton clic sur « Faire le commit ».",
  "Il ne merge jamais une PR à ta place.",
  "Il te montre chaque fichier avant de l'écrire dans un repo.",
];

/** Where a user lands after their first login when the App is not installed on their account (decision 012 H). */
export function Welcome() {
  const installation = useQuery({
    queryKey: ["installation"],
    queryFn: fetchInstallation,
  });
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe }).data;
  // Installed meanwhile (the page was reopened later): nothing to explain.
  if (installation.data?.installed) return <Navigate to="/" replace />;

  return (
    <main>
      <StateSentence
        title={`Bienvenue, ${me?.name ?? me?.login ?? "toi"}.`}
        rest="Ouvre à Cockpit les repos qu'il peut voir."
      />
      <section className="px-[26px] pt-5">
        <h2 className="flex items-center gap-2">
          <span className={sectionLabel}>Pour commencer</span>
          <span className="text-[12.5px] font-normal text-muted-foreground">
            · trois étapes, cinq minutes
          </span>
        </h2>
        <div className={`mt-2 ${card} px-[22px] py-5`}>
          <ol className="grid gap-x-8 gap-y-5 md:grid-cols-3">
            {STEPS.map(([step, rest], i) => (
              <li key={step} className="flex flex-col gap-1.5">
                <span
                  aria-hidden="true"
                  className={`grid size-6 place-items-center rounded-[7px] text-xs font-bold ${i === 0 ? "bg-primary text-primary-foreground" : "bg-raised text-muted-foreground"}`}
                >
                  {i + 1}
                </span>
                <b className="font-semibold">{step}</b>
                <span className="text-[13px] text-muted-foreground">
                  {rest}
                </span>
              </li>
            ))}
          </ol>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {installation.data && (
              <a href={installation.data.installUrl} className={primaryButton}>
                Choisir mes repos sur GitHub ↗
              </a>
            )}
            <Link to="/" className={ghostButton}>
              Plus tard
            </Link>
          </div>
          <p className="mt-4 text-[12.5px] text-muted-foreground">
            Sans cette installation, l'import de tes repos comme projets, le
            bilan de santé d'un repo, les issues, le suivi des PR et de la CI et
            la préparation des repos ne marchent pas. Tu peux quand même te
            connecter : le Journal reste disponible, et les Réglages pour
            l'administrateur.
          </p>
        </div>
        {installation.isError && (
          <p role="alert" className={`mt-4 ${alertBox}`}>
            Impossible de lire l'état de ton installation, recharge la page dans
            un instant.
          </p>
        )}
      </section>
      <section className="px-[26px] pt-5">
        <h2 className={sectionLabel}>Ce que Cockpit ne fait jamais</h2>
        <ul className={`mt-2 ${card} flex flex-col gap-2 px-[18px] py-3.5`}>
          {NEVER.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
