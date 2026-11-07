import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { client } from "./api.ts";
import { day } from "./SettingsTokens.tsx";
import {
  alertBox,
  button,
  card,
  cardShape,
  focusRing,
  primaryButton,
  sectionLabel,
} from "./ui.ts";

async function fetchConnect() {
  const res = await client.api.me.connect.$get();
  if (!res.ok) throw new Error("Réponse inattendue du serveur.");
  return res.json();
}

/** Decision 021 G: Cockpit is added once as a connector of claude.ai, in three steps. */
export function ConnectClaude() {
  const connect = useQuery({ queryKey: ["connect"], queryFn: fetchConnect });
  const [copy, setCopy] = useState<"idle" | "done" | "failed">("idle");

  // The section appears with its content: the address is what it is about.
  if (connect.isPending)
    return <p className="text-muted-foreground">Chargement…</p>;

  return (
    <section aria-labelledby="connecter">
      <h2 id="connecter" className={sectionLabel}>
        Connecter Claude
      </h2>
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        Ajoute Cockpit une seule fois comme connecteur de claude.ai : il marche
        ensuite dans Claude Code, sur le web et sur le téléphone.
      </p>
      <div className="mt-4" aria-live="polite">
        {connect.isError && (
          <p role="alert" className={alertBox}>
            Impossible de lire l'adresse du connecteur. Recharge la page ; si
            cela continue, réessaie plus tard.
          </p>
        )}
        {connect.isSuccess && (
          <>
            {connect.data.connected && connect.data.connectedAt && (
              <p className={`mb-4 ${cardShape} bg-raised p-4 font-semibold`}>
                Connecté depuis {connect.data.client}, le{" "}
                {day(connect.data.connectedAt)}. C'est fait : Claude voit tes
                projets partout, y compris dans les tâches planifiées.
              </p>
            )}
            <ol className="grid gap-3">
              <li className={`${card} px-[18px] py-4`}>
                <p className="font-semibold">1. Copier l'adresse</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    readOnly
                    aria-label="Adresse du connecteur"
                    value={connect.data.mcpUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    className={`min-h-[34px] min-w-0 grow rounded-[10px] border border-border-strong bg-sunken px-3 py-1.5 font-mono text-[13px] ${focusRing}`}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      navigator.clipboard.writeText(connect.data.mcpUrl).then(
                        () => setCopy("done"),
                        () => setCopy("failed"),
                      )
                    }
                    className={button}
                  >
                    Copier l'adresse
                  </button>
                  {/* No role="status": the section is already a live region, and Réglages has one status for the tokens. */}
                  <span
                    className={
                      copy === "failed" ? "text-destructive" : undefined
                    }
                  >
                    {copy === "done" && "Copié."}
                    {copy === "failed" &&
                      "Copie impossible : sélectionne l'adresse à la main."}
                  </span>
                </div>
              </li>
              <li className={`${card} px-[18px] py-4`}>
                <p className="font-semibold">2. Ouvrir claude.ai</p>
                <p className="mt-1">
                  Choisis « Ajouter un connecteur personnalisé », puis colle
                  l'adresse.
                </p>
                <a
                  href="https://claude.ai/customize/connectors"
                  target="_blank"
                  rel="noreferrer noopener"
                  className={`mt-2 ${primaryButton}`}
                >
                  Ouvrir claude.ai
                </a>
              </li>
              <li className={`${card} px-[18px] py-4`}>
                <p className="font-semibold">3. Se connecter</p>
                <p className="mt-1">
                  claude.ai ouvre Cockpit : connecte-toi avec GitHub si besoin,
                  puis clique « Autoriser ».
                </p>
              </li>
            </ol>
            <details className="mt-4">
              <summary className={`cursor-pointer font-semibold ${focusRing}`}>
                Connecter Claude depuis le CLI Claude Code
              </summary>
              <p className="mt-2">
                Dans un terminal, Claude Code fait la même connexion au premier
                usage :
              </p>
              <pre className="mt-2 overflow-x-auto rounded-[14px] border border-border bg-sunken p-3">
                <code>{`claude mcp add --transport http cockpit ${connect.data.mcpUrl}`}</code>
              </pre>
              <p className="mt-2 text-muted-foreground">
                <Link
                  to="/reglages/jetons"
                  className={`underline ${focusRing}`}
                >
                  Les jetons manuels
                </Link>{" "}
                restent possibles. Un fichier <code>.mcp.json</code> qui déclare
                Cockpit masque le connecteur. Les connexions comptent parmi les
                20 jetons actifs : si la connexion échoue, révoque-en un.
              </p>
            </details>
          </>
        )}
      </div>
    </section>
  );
}
