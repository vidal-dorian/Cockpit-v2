import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { client } from "./api.ts";
import { focusRing } from "./ui.ts";

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
    "suivre l'avancement des PR de Claude et, si la branche principale est protégée, ouvrir une PR au lieu d'y écrire.",
  ],
  [
    "Vérifications et statuts",
    "lecture",
    "savoir si les tests passent, sans que tu ouvres GitHub.",
  ],
  ["Actions", "lecture", "voir où en sont tes workflows."],
] as const;

const field = `mt-1 block min-h-10 w-full rounded-lg border border-border bg-card px-3 ${focusRing}`;

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
export function Setup({ detectedUrl }: { detectedUrl: string }) {
  const [code, setCode] = useState("");
  const [publicUrl, setPublicUrl] = useState(detectedUrl);
  const start = useMutation({
    mutationFn: async () => {
      const res = await client.api.setup.start.$post({
        json: { code: code.trim(), publicUrl: publicUrl.trim() },
      });
      if (res.status === 403) throw new Error("Code de démarrage incorrect.");
      if (res.status === 400) {
        // The server's 400 is already a French sentence.
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(
          body?.error || "L'adresse publique n'est pas une adresse web valide.",
        );
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
      ? "La création de l'App GitHub a échoué. Vérifie l'adresse publique, puis réessaie."
      : null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="font-heading text-4xl font-extrabold">
        Installer Cockpit
      </h1>
      <p className="mt-2 text-muted-foreground">
        Cockpit va créer sa propre App GitHub, avec ton accord. Il n'y a rien à
        copier à la main.
      </p>

      {message && (
        <p
          role="alert"
          className="mt-8 rounded-xl bg-destructive-soft p-4 text-destructive"
        >
          {message}
        </p>
      )}

      <form
        className="mt-8 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          start.mutate();
        }}
      >
        <div>
          <label htmlFor="setup-code" className="font-semibold">
            Code de démarrage
          </label>
          <p id="setup-code-help" className="text-muted-foreground">
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
            className={field}
          />
        </div>
        <div>
          <label htmlFor="setup-url" className="font-semibold">
            Adresse publique
          </label>
          <p id="setup-url-help" className="text-muted-foreground">
            Celle que Cockpit a détectée. Corrige-la si ce n'est pas l'adresse
            où tu ouvres Cockpit.
          </p>
          <input
            id="setup-url"
            type="url"
            value={publicUrl}
            onChange={(event) => setPublicUrl(event.target.value)}
            aria-describedby="setup-url-help"
            autoComplete="off"
            required
            className={field}
          />
        </div>

        <section aria-labelledby="setup-permissions">
          <h2 id="setup-permissions" className="font-heading text-xl font-bold">
            Ce que l'App demandera
          </h2>
          <ul className="mt-2 space-y-2 rounded-xl bg-card p-4">
            {PERMISSIONS.map(([name, access, why]) => (
              <li key={name}>
                <strong>{name}</strong> ({access}) : {why}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-muted-foreground">
            GitHub t'affichera ces droits sur sa page d'enregistrement. Clique
            sur « Create GitHub App » pour accepter : Cockpit récupère alors
            l'App et te connecte. Sans cet accord, Cockpit ne fonctionne pour
            personne.
          </p>
        </section>

        <button
          type="submit"
          disabled={start.isPending}
          className={`inline-flex min-h-10 items-center rounded-lg bg-primary px-4 font-semibold text-primary-foreground ${focusRing}`}
        >
          Créer l'App GitHub
        </button>
      </form>
    </main>
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
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="font-heading text-4xl font-extrabold">
        Récupérer l'administration
      </h1>
      <p className="mt-2 text-muted-foreground">
        L'App GitHub existe, mais personne n'est encore administrateur. Entre le
        code de démarrage affiché dans les logs du serveur, puis connecte-toi
        avec GitHub : tu deviendras administrateur.
      </p>
      {claim.isError && (
        <p
          role="alert"
          className="mt-8 rounded-xl bg-destructive-soft p-4 text-destructive"
        >
          {claim.error.message}
        </p>
      )}
      <form
        className="mt-8 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          claim.mutate();
        }}
      >
        <div>
          <label htmlFor="claim-code" className="font-semibold">
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
            className={field}
          />
        </div>
        <button
          type="submit"
          disabled={claim.isPending}
          className={`inline-flex min-h-10 items-center rounded-lg bg-primary px-4 font-semibold text-primary-foreground ${focusRing}`}
        >
          Devenir administrateur
        </button>
      </form>
    </main>
  );
}
