import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { client } from "./api.ts";
import { Logo } from "./Logo.tsx";
import { alertBox, card, field, primaryButton, sectionLabel } from "./ui.ts";

/** The wizard's frame (S02, S03): the rail of the instance on the left, the page on the right. */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen md:grid md:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-[18px] border-b border-border bg-card px-8 py-10 md:border-r md:border-b-0">
        <div className="flex items-center gap-2.5 text-base font-bold">
          <Logo className="h-7 w-auto" />
          Cockpit
        </div>
        <p className={sectionLabel}>Mise en service</p>
        <p className="mt-auto text-[12.5px] leading-normal text-muted-foreground">
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
const wizardRest = "mt-1.5 block text-base font-medium text-muted-foreground";

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

  return (
    <Frame>
      <div>
        <h1 className={wizardTitle}>Installer Cockpit</h1>
        <p className={wizardRest}>
          Cockpit va créer sa propre App GitHub, avec ton accord. Il n'y a rien
          à copier à la main.
        </p>
      </div>

      {message && (
        <p role="alert" className={alertBox}>
          {message}
        </p>
      )}

      <form
        className="space-y-[22px]"
        onSubmit={(event) => {
          event.preventDefault();
          start.mutate();
        }}
      >
        <div>
          <label htmlFor="setup-code" className="text-[13px] font-semibold">
            Code de démarrage
          </label>
          <p
            id="setup-code-help"
            className="text-[12.5px] text-muted-foreground"
          >
            Affiché dans les logs du serveur au premier lancement.
          </p>
          <input
            id="setup-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            aria-describedby="setup-code-help"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
            className={`${field} font-mono`}
          />
        </div>

        <section aria-labelledby="setup-permissions">
          <h2 id="setup-permissions" className={sectionLabel}>
            Ce que l'App demandera
          </h2>
          <ul className={`mt-2 space-y-2 ${card} px-[18px] py-4`}>
            {PERMISSIONS.map(([name, access, why]) => (
              <li key={name}>
                <strong>{name}</strong> ({access}) : {why}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12.5px] leading-normal text-muted-foreground">
            GitHub t'affichera ces droits sur sa page d'enregistrement. Clique
            sur « Create GitHub App » pour accepter : Cockpit récupère alors
            l'App et te connecte. Sans cet accord, Cockpit ne fonctionne pour
            personne.
          </p>
        </section>

        <button
          type="submit"
          disabled={start.isPending}
          className={primaryButton}
        >
          Créer l'App GitHub
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
    <Frame>
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
