import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router";
import { client } from "./api.ts";
import { Logo } from "./Logo.tsx";
import {
  alertBox,
  card,
  panelButton,
  panelPrimaryButton,
  primaryButton,
  sectionLabel,
} from "./ui.ts";

const CAN = [
  "lire tes projets, tickets et user stories",
  "noter des tickets dans tes projets",
  "écrire et réécrire des user stories, qui t'attendront « à valider »",
  "suivre ses runs et te poser des questions",
  "envoyer la carte du code d'un projet",
];

async function fetchMe() {
  const res = await client.api.me.$get();
  if (res.status === 401) return null;
  if (!res.ok) throw new Error("Réponse inattendue du serveur.");
  return res.json();
}

/** Decision 021 C: where claude.ai (or Claude Code) sends the user to approve the connection. The request is in the query string; the server checks it again at each step. */
export function Autoriser() {
  const { search } = useLocation();
  const params = Object.fromEntries(new URLSearchParams(search));
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const request = useQuery({
    queryKey: ["oauth-request", search],
    enabled: !!me.data,
    retry: false,
    queryFn: async () => {
      const res = await client.api.oauth.request.$get({ query: params });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });
  const decide = useMutation({
    mutationFn: async (decision: "approve" | "deny") => {
      const res = await client.api.oauth.approve.$post({
        json: { ...params, decision },
      });
      if (res.status === 403)
        throw new Error("Ton compte a été bloqué par l'administrateur.");
      if (!res.ok)
        throw new Error(
          "Impossible de terminer la connexion : la demande est invalide ou a expiré. Retourne dans Claude et recommence.",
        );
      // The server built the address from what the client's document lists: the browser goes where it says.
      window.location.assign((await res.json()).redirectUrl);
    },
  });

  return (
    <main className="grid min-h-screen place-items-center p-4">
      <div className={`w-full max-w-[480px] ${card} p-7`}>
        <div className="flex items-center gap-3 font-bold">
          <Logo className="size-5" />
          Cockpit
          {me.data && (
            <span className="ml-auto text-[12.5px] font-normal text-muted-foreground">
              connecté : {me.data.name ?? me.data.login}
            </span>
          )}
        </div>
        <h1 className="mt-[18px] text-[22px] leading-[1.3] font-semibold">
          {request.isSuccess
            ? `${request.data.clientName} demande à accéder à ton Cockpit.`
            : "Autoriser un connecteur"}
        </h1>
        <div className="mt-[18px]" aria-live="polite">
          {me.isPending && (
            <p className="loading text-muted-foreground">Chargement…</p>
          )}
          {me.isError && (
            <p role="alert" className={alertBox}>
              Impossible de lire ton compte. Recharge la page ; si cela
              continue, réessaie plus tard.
            </p>
          )}
          {me.isSuccess && !me.data && (
            <>
              <p>Connecte-toi à Cockpit pour continuer.</p>
              <a
                href={`/api/auth/login?next=${encodeURIComponent(`/autoriser${search}`)}`}
                className={`mt-3 ${primaryButton}`}
              >
                Se connecter avec GitHub
              </a>
            </>
          )}
          {request.isPending && me.data && (
            <p className="loading text-muted-foreground">Chargement…</p>
          )}
          {request.isError && (
            <p role="alert" className={alertBox}>
              Cette demande de connexion est invalide. Retourne dans Claude et
              recommence l'ajout du connecteur.
            </p>
          )}
          {request.isSuccess && (
            <>
              <p className="text-[13.5px] text-muted-foreground">
                Demande venue de{" "}
                <span className="font-mono text-[11.5px] text-foreground">
                  {request.data.returnHost}
                </span>{" "}
                · client vérifié
              </p>
              <p className={`mt-4 ${sectionLabel}`}>Claude pourra</p>
              <ul className="mt-2.5 flex flex-col gap-2.5 text-[13.5px]">
                {CAN.map((line) => (
                  <li key={line} className="flex gap-2.5">
                    <span aria-hidden="true" className="text-dim">
                      ✓
                    </span>
                    {line}
                  </li>
                ))}
              </ul>
              <p className={`mt-4 ${sectionLabel}`}>Claude ne pourra pas</p>
              <p className="mt-2.5 flex gap-2.5 text-[13.5px] text-muted-foreground">
                <span aria-hidden="true" className="text-dim">
                  ✕
                </span>
                valider une US, merger une PR ou changer tes réglages
              </p>
              <p className="mt-4 font-semibold">
                N'autorise que si tu viens de lancer la connexion toi-même.
              </p>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => decide.mutate("approve")}
                  disabled={decide.isPending || decide.isSuccess}
                  aria-busy={decide.isPending}
                  className={`${panelPrimaryButton} flex-1`}
                >
                  Autoriser
                </button>
                <button
                  type="button"
                  onClick={() => decide.mutate("deny")}
                  disabled={decide.isPending || decide.isSuccess}
                  aria-busy={decide.isPending}
                  className={`${panelButton} flex-1`}
                >
                  Refuser
                </button>
              </div>
              <p className="mt-[18px] text-xs text-muted-foreground">
                Chaque appel de Claude est écrit dans le Journal. Tu peux
                retirer cet accès dans Réglages.
              </p>
            </>
          )}
          {decide.isError && (
            <p role="alert" className={`mt-3 ${alertBox}`}>
              {decide.error.message}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
