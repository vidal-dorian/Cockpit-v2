import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { client } from "./api.ts";
import { Logo } from "./Logo.tsx";
import { ROLE_LABELS } from "./roles.ts";
import { fetchMe } from "./Shell.tsx";
import { alertBox, card, panelPrimaryButton } from "./ui.ts";

const GONE = "Ce lien d'invitation n'est plus valable. Demande-en un nouveau.";

// What the return from GitHub says when it did not end on the project (decision 076 E).
const RETURNS: Record<string, string> = {
  "lien-invalide": GONE,
  annulee:
    "L'autorisation GitHub a été annulée : rouvre ce lien pour réessayer.",
  "github-injoignable": "GitHub ne répond pas : rouvre ce lien dans un moment.",
};

/** The page of an invitation link (decision 076 E): a card of its own, like /autoriser, with or without a session. */
export function Invitation() {
  const { secret = "" } = useParams();
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const invitation = useQuery({
    queryKey: ["invitation", secret],
    enabled: !!me.data,
    retry: false,
    queryFn: async () => {
      const res = await client.api.invitations[":secret"].$get({
        param: { secret },
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()).invitation;
    },
  });
  const accept = useMutation({
    meta: { done: "Invitation acceptée." },
    mutationFn: async () => {
      const res = await client.api.invitations[":secret"].accept.$post({
        param: { secret },
      });
      if (res.status === 404) throw new Error(GONE);
      if (!res.ok) throw new Error("L'opération a échoué, réessaie.");
      // GitHub checks that the invitee can read the repo, then comes back through the login's callback.
      window.location.assign((await res.json()).authorizeUrl);
    },
  });
  const erreur = new URLSearchParams(window.location.search).get("erreur");
  const found = invitation.data;

  return (
    <main className="grid min-h-screen place-items-center p-4">
      <div className={`w-full max-w-[480px] ${card} p-7`}>
        <div className="flex items-center gap-3 font-bold">
          <Logo className="size-5" />
          Cockpit
        </div>
        <div className="mt-[18px]" aria-live="polite">
          {(me.isPending || (!!me.data && invitation.isPending)) && (
            <p className="loading text-muted-foreground">Chargement…</p>
          )}
          {(me.isError || invitation.isError) && (
            <p role="alert" className={alertBox}>
              Impossible de lire cette invitation. Recharge la page.
            </p>
          )}
          {me.isSuccess && !me.data && (
            <>
              <p>Connecte-toi à Cockpit pour répondre à cette invitation.</p>
              <a
                href={`/api/auth/login?next=${encodeURIComponent(`/invitations/${secret}`)}`}
                className={`mt-3 ${panelPrimaryButton}`}
              >
                Se connecter avec GitHub
              </a>
            </>
          )}
          {invitation.isSuccess && !found && (
            <p role="alert" className={alertBox}>
              {GONE}
            </p>
          )}
          {found && (
            <>
              <h1 className="text-[22px] leading-[1.3] font-semibold">
                <b>@{found.owner}</b> t'invite sur <b>{found.fullName}</b>, rôle
                : {ROLE_LABELS[found.role]}.
              </h1>
              {erreur === "sans-acces" && (
                <p role="alert" className={`mt-4 ${alertBox}`}>
                  Tu n'as pas accès à {found.fullName} sur GitHub. Demande à @
                  {found.owner} de t'y ajouter comme collaborateur, puis rouvre
                  ce lien.
                </p>
              )}
              {erreur && RETURNS[erreur] && (
                <p role="alert" className={`mt-4 ${alertBox}`}>
                  {RETURNS[erreur]}
                </p>
              )}
              <button
                type="button"
                onClick={() => accept.mutate()}
                disabled={accept.isPending || accept.isSuccess}
                aria-busy={accept.isPending}
                className={`mt-4 ${panelPrimaryButton}`}
              >
                Accepter
              </button>
              {accept.isError && (
                <p role="alert" className={`mt-3 ${alertBox}`}>
                  {accept.error.message}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
