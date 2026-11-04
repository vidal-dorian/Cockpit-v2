import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router";
import { client } from "./api.ts";
import { alertBox, button, primaryButton } from "./ui.ts";

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
    <main className="mx-auto max-w-[880px] px-4 sm:px-7 py-8">
      <h1 className="font-heading text-3xl font-extrabold">
        Autoriser un connecteur
      </h1>
      <div className="mt-6" aria-live="polite">
        {me.isPending && <p className="text-muted-foreground">Chargement…</p>}
        {me.isError && (
          <p role="alert" className={alertBox}>
            Impossible de lire ton compte. Recharge la page ; si cela continue,
            réessaie plus tard.
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
          <p className="text-muted-foreground">Chargement…</p>
        )}
        {request.isError && (
          <p role="alert" className={alertBox}>
            Cette demande de connexion est invalide. Retourne dans Claude et
            recommence l'ajout du connecteur.
          </p>
        )}
        {request.isSuccess && (
          <>
            <p className="text-xl font-semibold">
              {request.data.clientName} veut accéder à tes projets Cockpit
            </p>
            <p className="mt-2 text-muted-foreground">
              Après ton choix, ton navigateur retourne vers{" "}
              <strong>{request.data.returnHost}</strong>.
            </p>
            <p className="mt-2 font-semibold">
              N'autorise que si tu viens de lancer la connexion toi-même.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => decide.mutate("approve")}
                disabled={decide.isPending || decide.isSuccess}
                className={primaryButton}
              >
                Autoriser
              </button>
              <button
                type="button"
                onClick={() => decide.mutate("deny")}
                disabled={decide.isPending || decide.isSuccess}
                className={button}
              >
                Refuser
              </button>
            </div>
          </>
        )}
        {decide.isError && (
          <p role="alert" className={`mt-3 ${alertBox}`}>
            {decide.error.message}
          </p>
        )}
      </div>
    </main>
  );
}
