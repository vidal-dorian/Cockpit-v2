import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { client } from "./api.ts";
import { focusRing } from "./ui.ts";

const field = `mt-1 block w-full rounded-lg border border-border bg-card px-3 py-2 ${focusRing}`;
const button = `min-h-10 rounded-lg border border-border bg-card px-4 font-semibold ${focusRing}`;

// The server's refusals, in French; its codes are not meant to be read.
const REFUSALS: Record<string, string> = {
  too_many_tokens: "Tu as déjà 20 jetons actifs : révoques-en un d'abord.",
  already_revoked: "Ce jeton est déjà révoqué.",
};

/** A French sentence for a failed answer. */
async function failure(res: Response) {
  const body: { error?: string } | null = await res.json().catch(() => null);
  return new Error(
    (res.status === 409 && body?.error && REFUSALS[body.error]) ||
      (res.status === 400
        ? "Le nom du jeton doit faire de 1 à 100 caractères."
        : "L'opération a échoué, réessaie."),
  );
}

async function fetchTokens() {
  const res = await client.api.me.tokens.$get();
  if (!res.ok) throw await failure(res);
  return (await res.json()).tokens;
}

const day = (iso: string) => new Date(iso).toLocaleDateString("fr-FR");

const errorBox = "rounded-xl bg-destructive-soft p-4 text-destructive";

/** Shown once: the secret lives in this component's state only, never in the query cache or the URL (decision 015). */
function NewSecret({ secret, onDone }: { secret: string; onDone: () => void }) {
  const [copy, setCopy] = useState<"idle" | "done" | "failed">("idle");
  return (
    <div className="mt-4 rounded-xl bg-card p-4">
      <p className="font-semibold">
        Voici ton jeton. Tu ne pourras plus le revoir : copie-le maintenant.
      </p>
      <input
        readOnly
        aria-label="Jeton"
        value={secret}
        // The form is gone: keep the keyboard focus on what the user must copy.
        // biome-ignore lint/a11y/noAutofocus: focus moves with the secret the user just asked for
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        className={`${field} font-mono`}
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() =>
            navigator.clipboard.writeText(secret).then(
              () => setCopy("done"),
              () => setCopy("failed"),
            )
          }
          className={button}
        >
          Copier
        </button>
        <button
          type="button"
          onClick={onDone}
          className={`min-h-10 rounded-lg bg-primary px-4 font-semibold text-primary-foreground ${focusRing}`}
        >
          J'ai copié le jeton
        </button>
        {/* Always there: a live region announces what changes inside it. */}
        <span
          role="status"
          className={copy === "failed" ? "text-destructive" : undefined}
        >
          {copy === "done" && "Copié."}
          {copy === "failed" &&
            "Copie impossible : sélectionne le jeton à la main."}
        </span>
      </div>
    </div>
  );
}

export function Tokens() {
  const queryClient = useQueryClient();
  const tokens = useQuery({ queryKey: ["tokens"], queryFn: fetchTokens });
  const [name, setName] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  // The token waiting for its confirmation: a revoked token never works again, so we ask on the spot (decision 003, rule 4).
  const [confirming, setConfirming] = useState<number | null>(null);
  // The confirmation is gone and so is the button that opened it: the focus goes back to a new one, not to <body>.
  const refocus = useRef<number | null>(null);
  const nameField = useRef<HTMLInputElement>(null);
  // The revoked token's buttons are gone: the focus goes to the section on success, to the error on failure, never to <body>.
  const heading = useRef<HTMLHeadingElement>(null);
  const revokeAlert = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (confirming !== null || refocus.current === null) return;
    document.getElementById(`revoke-${refocus.current}`)?.focus();
    refocus.current = null;
  }, [confirming]);

  const create = useMutation({
    mutationFn: async () => {
      const res = await client.api.me.tokens.$post({ json: { name } });
      if (!res.ok) throw await failure(res);
      // Not returned: a mutation's result stays in TanStack's cache for minutes.
      setSecret((await res.json()).secret);
      setName("");
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["tokens"] }),
  });
  const revoke = useMutation({
    mutationFn: async (id: number) => {
      const res = await client.api.me.tokens[":id"].revoke.$post({
        param: { id: String(id) },
      });
      if (!res.ok) throw await failure(res);
    },
    onSuccess: () => heading.current?.focus(),
    onSettled: () => {
      setConfirming(null);
      return queryClient.invalidateQueries({ queryKey: ["tokens"] });
    },
  });

  const revokeFailed = revoke.isError;
  useEffect(() => {
    if (revokeFailed) revokeAlert.current?.focus();
  }, [revokeFailed]);

  return (
    <>
      <h2
        id="jetons"
        ref={heading}
        tabIndex={-1}
        className={`font-heading text-xl font-bold ${focusRing}`}
      >
        Jetons MCP
      </h2>
      <p className="mt-1 text-muted-foreground">
        Un jeton lie Claude Code à ton compte Cockpit. Place-le dans la variable
        d'environnement <code>COCKPIT_MCP_TOKEN</code> : il n'est affiché qu'une
        fois et Cockpit n'en garde que l'empreinte.
      </p>

      <h3 className="mt-6 font-heading text-lg font-bold">Nouveau jeton</h3>
      {secret ? (
        <NewSecret
          secret={secret}
          onDone={() => {
            setSecret(null);
            // Next tick: the field is rendered again once the secret is gone.
            setTimeout(() => nameField.current?.focus());
          }}
        />
      ) : (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            revoke.reset();
            create.mutate();
          }}
        >
          <label className="grow">
            Nom
            <input
              ref={nameField}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={field}
            />
          </label>
          <button
            type="submit"
            disabled={create.isPending}
            className={`min-h-10 rounded-lg bg-primary px-4 font-semibold text-primary-foreground ${focusRing}`}
          >
            Créer
          </button>
        </form>
      )}
      {create.error && (
        <p role="alert" className={`mt-3 ${errorBox}`}>
          {create.error.message}
        </p>
      )}

      <div className="mt-6" aria-live="polite">
        {tokens.isPending && (
          <p className="text-muted-foreground">Chargement…</p>
        )}
        {tokens.isError && (
          <p role="alert" className={errorBox}>
            {tokens.error.message}
          </p>
        )}
        {tokens.isSuccess && tokens.data.length === 0 && (
          <p className="text-muted-foreground">Aucun jeton actif.</p>
        )}
        {tokens.isSuccess && tokens.data.length > 0 && (
          <ul className="grid gap-2">
            {tokens.data.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-card p-4"
              >
                <span className="font-semibold">{t.name}</span>
                <span className="font-mono">…{t.lastFour}</span>
                <span className="text-muted-foreground">
                  Créé le {day(t.createdAt)}
                </span>
                <span className="text-muted-foreground">
                  {t.lastUsedAt
                    ? `Utilisé le ${day(t.lastUsedAt)}`
                    : "Jamais utilisé"}
                </span>
                <span className="flex gap-2 sm:ml-auto">
                  {confirming === t.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => revoke.mutate(t.id)}
                        disabled={revoke.isPending}
                        className={`min-h-10 rounded-lg bg-destructive-soft px-4 font-semibold text-destructive ${focusRing}`}
                      >
                        Confirmer la révocation
                      </button>
                      <button
                        type="button"
                        // The Révoquer button is gone: keep the keyboard focus on the safe choice.
                        // biome-ignore lint/a11y/noAutofocus: focus moves with the confirmation the user just asked for
                        autoFocus
                        onClick={() => {
                          refocus.current = t.id;
                          setConfirming(null);
                        }}
                        className={button}
                      >
                        Annuler
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      id={`revoke-${t.id}`}
                      onClick={() => setConfirming(t.id)}
                      className={button}
                    >
                      Révoquer
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {revoke.isSuccess && (
          <p role="status" className="mt-3">
            Jeton révoqué.
          </p>
        )}
        {revoke.error && (
          <p
            role="alert"
            ref={revokeAlert}
            tabIndex={-1}
            className={`mt-3 ${errorBox} ${focusRing}`}
          >
            {revoke.error.message}
          </p>
        )}
      </div>
    </>
  );
}
