import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { client } from "./api.ts";
import { Logo } from "./Logo.tsx";
import {
  alertBox,
  card,
  field,
  ghostButton,
  listCard,
  panelPrimaryButton,
  primaryButton,
  sectionLabel,
} from "./ui.ts";

const STEPS = ["Code de démarrage", "GitHub App", "Premier compte"] as const;

/** The wizard's frame (S02, S03): the rail of the instance with its three steps on the left, the page on the right. */
function Frame({
  children,
  step,
}: {
  children: React.ReactNode;
  step: number;
}) {
  return (
    <div className="min-h-screen md:grid md:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-0.5 border-b border-border bg-card px-3 py-7 md:border-r md:border-b-0">
        <div className="flex items-center gap-2.5 px-2.5 pb-4 text-base font-bold">
          <Logo className="size-5" />
          Cockpit
        </div>
        <p className={`${sectionLabel} px-2.5 pb-2`}>
          Mise en service · étape {Math.min(step, 3)} sur 3
        </p>
        <ol className="flex flex-col gap-0.5">
          {STEPS.map((name, i) => (
            <li
              key={name}
              aria-current={i + 1 === step ? "step" : undefined}
              className={`flex h-9 items-center gap-2.5 rounded-[9px] px-2.5 text-sm font-semibold ${i + 1 === step ? "bg-raised text-foreground" : "text-muted-foreground"}`}
            >
              <span
                className={`grid size-5 place-items-center rounded-md text-xs font-bold ${i + 1 === step ? "bg-primary text-primary-foreground" : ""}`}
              >
                {i + 1}
              </span>
              {name}
            </li>
          ))}
        </ol>
        <p className="mt-auto px-2.5 text-[12.5px] leading-normal text-muted-foreground">
          Cette page ne s'affiche qu'une fois, à la première mise en route de
          ton instance.
        </p>
      </aside>
      <main className="flex max-w-[720px] flex-col gap-[22px] px-6 py-14 md:px-[72px]">
        {children}
      </main>
    </div>
  );
}

const wizardTitle = "text-[28px] leading-tight font-semibold";
const wizardRest =
  "block text-[28px] leading-tight font-medium text-muted-foreground";

// What the App asks of GitHub and why (decision 012 D); the same list as the manifest of the server.
const PERMISSIONS = [
  [
    "Métadonnées",
    "lecture",
    "GitHub l'impose à toute App : elle liste tes repos.",
  ],
  [
    "Contenu",
    "lecture et écriture",
    "lire ton code et, plus tard, préparer la configuration de Claude Code, toujours après t'avoir montré les changements.",
  ],
  [
    "Issues",
    "lecture et écriture",
    "suivre tes user stories et, plus tard, les créer.",
  ],
  [
    "Pull requests",
    "lecture et écriture",
    "suivre l'avancement des PR de Claude et, si la branche par défaut est protégée, ouvrir une PR au lieu d'y écrire.",
  ],
  [
    "Vérifications et statuts",
    "lecture",
    "savoir si les tests passent, sans que tu ouvres GitHub.",
  ],
  ["Actions", "lecture", "voir où en sont tes workflows."],
] as const;

/** Makes the browser POST the manifest to GitHub, as GitHub's manifest flow requires (a fetch cannot follow its pages). */
function postToGitHub(action: string, manifest: unknown) {
  const form = document.createElement("form");
  form.method = "post";
  form.action = action;
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "manifest";
  input.value = JSON.stringify(manifest);
  form.append(input);
  document.body.append(form);
  form.submit();
}

/** The start-up wizard: shown instead of the whole app until the GitHub App exists (decision 012). */
export function Setup() {
  const [code, setCode] = useState("");
  const start = useMutation({
    mutationFn: async () => {
      const res = await client.api.setup.start.$post({
        json: { code: code.trim() },
      });
      if (res.status === 403) throw new Error("Code de démarrage incorrect.");
      if (res.status === 400) {
        // The server's 400 is already a French sentence.
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error || "La demande n'est pas valide.");
      }
      if (!res.ok) throw new Error(`Le serveur a répondu ${res.status}.`);
      const { action, manifest } = await res.json();
      postToGitHub(action, manifest);
    },
  });
  const failed =
    new URLSearchParams(window.location.search).get("erreur") ===
    "setup-echoue";
  const message = start.isError
    ? start.error.message
    : failed
      ? "La création de l'App GitHub a échoué. Réessaie."
      : null;
  // Step 2 shows the permissions; a refusal sends back to step 1, where the code and the address are.
  const [step, setStep] = useState<1 | 2>(1);
  // Read from the cache of App.tsx (same key): the wizard only shows what the server detected.
  const detected = useQueryClient().getQueryData<{ detectedUrl?: string }>([
    "setup",
  ])?.detectedUrl;

  if (step === 2)
    return (
      <Frame step={2}>
        <h1 className={wizardTitle}>
          Cockpit va créer sa GitHub App.
          <span className={wizardRest}>
            Un clic sur GitHub, puis tu reviens ici tout seul.
          </span>
        </h1>
        <section aria-labelledby="setup-permissions">
          <h2 id="setup-permissions" className="sr-only">
            Ce que l'App demandera
          </h2>
          <ul className={listCard}>
            {PERMISSIONS.map(([name, access, why]) => (
              <li
                key={name}
                className="flex min-h-[50px] items-center gap-3 px-[18px] py-2"
              >
                <span className="min-w-0 grow">
                  <b className="block font-semibold">{name}</b>
                  <span className="block text-[12.5px] text-muted-foreground">
                    {why}
                  </span>
                </span>
                <span className="rounded-[5px] bg-raised px-2 py-1 text-xs font-semibold whitespace-nowrap text-muted-foreground">
                  {access}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12.5px] leading-normal text-muted-foreground">
            GitHub t'affichera ces droits sur sa page d'enregistrement. Clique
            sur « Create GitHub App » pour accepter : Cockpit récupère alors
            l'App et te connecte. Les secrets de l'App sont chiffrés dans la
            base avec la clé de ton instance.
          </p>
        </section>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={start.isPending}
            onClick={() => {
              setStep(1);
              start.mutate();
            }}
            className={`${panelPrimaryButton} w-auto!`}
          >
            Créer l'App sur GitHub ↗
          </button>
          <button
            type="button"
            onClick={() => setStep(1)}
            className={`${ghostButton} h-[42px] text-sm`}
          >
            Retour
          </button>
        </div>
      </Frame>
    );

  return (
    <Frame step={1}>
      <h1 className={wizardTitle}>
        Colle le code de démarrage.
        <span className={wizardRest}>
          Il est écrit dans les journaux du serveur, au premier lancement.
        </span>
      </h1>

      {message && (
        <p role="alert" className={alertBox}>
          {message}
        </p>
      )}

      <form
        className="space-y-[22px]"
        onSubmit={(event) => {
          event.preventDefault();
          start.reset();
          setStep(2);
        }}
      >
        <div>
          <label htmlFor="setup-code" className="text-[13px] font-semibold">
            Code de démarrage
          </label>
          <input
            id="setup-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            aria-describedby="setup-code-help"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
            className={`${field} h-[38px] font-mono text-[12.5px]`}
          />
          <p
            id="setup-code-help"
            className="mt-1.5 text-[12.5px] text-muted-foreground"
          >
            Il prouve que c'est toi qui as installé cette instance.
          </p>
        </div>
        {detected && (
          <p className={`flex items-center gap-2.5 ${card} px-4 py-3`}>
            <span aria-hidden="true" className="text-dim">
              ✓
            </span>
            <span>
              Adresse détectée :{" "}
              <span className="font-mono text-[11.5px] text-foreground">
                {detected}
              </span>
            </span>
            <span className="ml-auto text-[12.5px] text-muted-foreground">
              rien à recopier
            </span>
          </p>
        )}
        <p className="text-[12.5px] leading-normal text-muted-foreground">
          Ouvre Cockpit par son adresse en https:// : claude.ai l'exige pour le
          connecteur. Elle servira à créer la GitHub App.
        </p>
        <button
          type="submit"
          // A start request is already on its way (sent from step 2): no second one.
          disabled={start.isPending}
          className={`${panelPrimaryButton} w-auto!`}
        >
          Continuer
        </button>
      </form>
    </Frame>
  );
}

/** The App exists but nobody is administrator (the person who ran the wizard never logged in): the setup code gives the right back. */
export function ClaimAdmin() {
  const [code, setCode] = useState("");
  const claim = useMutation({
    mutationFn: async () => {
      const res = await client.api.setup.claim.$post({
        json: { code: code.trim() },
      });
      if (res.status === 403) throw new Error("Code de démarrage incorrect.");
      if (!res.ok) throw new Error(`Le serveur a répondu ${res.status}.`);
      window.location.assign((await res.json()).next);
    },
  });

  return (
    <Frame step={3}>
      <div>
        <h1 className={wizardTitle}>Récupérer l'administration</h1>
        <p className={wizardRest}>
          L'App GitHub existe, mais personne n'est encore administrateur. Entre
          le code de démarrage affiché dans les logs du serveur, puis
          connecte-toi avec GitHub : tu deviendras administrateur.
        </p>
      </div>
      {claim.isError && (
        <p role="alert" className={alertBox}>
          {claim.error.message}
        </p>
      )}
      <form
        className="space-y-[22px]"
        onSubmit={(event) => {
          event.preventDefault();
          claim.mutate();
        }}
      >
        <div>
          <label htmlFor="claim-code" className="text-[13px] font-semibold">
            Code de démarrage
          </label>
          <input
            id="claim-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
            className={`${field} font-mono`}
          />
        </div>
        <button
          type="submit"
          disabled={claim.isPending}
          className={primaryButton}
        >
          Devenir administrateur
        </button>
      </form>
    </Frame>
  );
}
