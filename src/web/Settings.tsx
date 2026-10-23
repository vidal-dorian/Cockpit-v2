import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { client } from "./api.ts";
import { focusRing } from "./ui.ts";

const button = `min-h-10 rounded-lg border border-border bg-card px-4 font-semibold ${focusRing}`;

/** A French sentence for a failed answer; the server's codes are not meant to be read. */
function failure(res: Response, byStatus: Record<number, string> = {}) {
  return new Error(
    byStatus[res.status] ??
      (res.status === 403
        ? "Cette page est réservée à l'administrateur."
        : "L'opération a échoué, réessaie."),
  );
}

async function fetchAccounts() {
  const res = await client.api.settings.accounts.$get();
  if (!res.ok) throw failure(res);
  return (await res.json()).accounts;
}

function AddAccount() {
  const queryClient = useQueryClient();
  const [login, setLogin] = useState("");
  const add = useMutation({
    mutationFn: async (value: string) => {
      const res = await client.api.settings.accounts.$post({
        json: { login: value },
      });
      if (!res.ok)
        throw failure(res, {
          400: "Ce login GitHub n'est pas valide.",
          409: "Ce compte est déjà autorisé.",
        });
    },
    onSuccess: () => setLogin(""),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["accounts"] }),
  });

  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        add.mutate(login);
      }}
    >
      <label className="grid gap-1 font-semibold">
        Login GitHub
        <input
          value={login}
          onChange={(event) => setLogin(event.target.value)}
          autoComplete="off"
          className={`min-h-10 rounded-lg border border-border bg-card px-3 font-normal ${focusRing}`}
        />
      </label>
      <button
        type="submit"
        disabled={add.isPending}
        className={`min-h-10 rounded-lg bg-primary px-4 font-semibold text-primary-foreground ${focusRing}`}
      >
        Ajouter
      </button>
      {add.error && (
        <p
          role="alert"
          className="basis-full rounded-xl bg-destructive-soft p-4 text-destructive"
        >
          {add.error.message}
        </p>
      )}
    </form>
  );
}

function AccountList() {
  const queryClient = useQueryClient();
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  // The account waiting for its confirmation: removing ends their sessions, so we ask on the spot (decision 003, rule 4).
  const [confirming, setConfirming] = useState<number | null>(null);
  const revoke = useMutation({
    mutationFn: async (id: number) => {
      const res = await client.api.settings.accounts[":id"].$delete({
        param: { id: String(id) },
      });
      if (!res.ok) throw failure(res);
    },
    onSettled: () => {
      setConfirming(null);
      return queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
  });

  if (accounts.isPending)
    return <p className="text-muted-foreground">Chargement…</p>;
  if (accounts.isError) {
    return (
      <p
        role="alert"
        className="rounded-xl bg-destructive-soft p-4 text-destructive"
      >
        {accounts.error.message}
      </p>
    );
  }
  return (
    <>
      {accounts.data.length === 0 ? (
        <p className="text-muted-foreground">
          Aucun compte autorisé pour l'instant : toi seul peux te connecter.
        </p>
      ) : (
        <ul className="grid gap-2">
          {accounts.data.map((account) => (
            <li
              key={account.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-card p-4"
            >
              <span className="font-semibold">{account.login}</span>
              <span className="flex gap-2 sm:ml-auto">
                {confirming === account.id ? (
                  <>
                    <span className="basis-full">
                      Retirer ce compte ? Ses sessions ouvertes sont fermées.
                    </span>
                    <button
                      type="button"
                      onClick={() => revoke.mutate(account.id)}
                      disabled={revoke.isPending}
                      className={`min-h-10 rounded-lg bg-destructive-soft px-4 font-semibold text-destructive ${focusRing}`}
                    >
                      Confirmer le retrait
                    </button>
                    <button
                      type="button"
                      // The Retirer button is gone: keep the keyboard focus on the safe choice.
                      // biome-ignore lint/a11y/noAutofocus: focus moves with the confirmation the user just asked for
                      autoFocus
                      onClick={() => setConfirming(null)}
                      className={button}
                    >
                      Annuler
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirming(account.id)}
                    className={button}
                  >
                    Retirer
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {revoke.error && (
        <p
          role="alert"
          className="mt-3 rounded-xl bg-destructive-soft p-4 text-destructive"
        >
          {revoke.error.message}
        </p>
      )}
    </>
  );
}

export function Settings() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="font-heading text-3xl font-extrabold">Réglages</h1>
      <section className="mt-6" aria-labelledby="comptes">
        <h2 id="comptes" className="font-heading text-xl font-bold">
          Comptes autorisés
        </h2>
        <p className="mt-1 text-muted-foreground">
          Ces comptes GitHub peuvent se connecter à Cockpit, en plus des
          administrateurs.
        </p>
        <h3 className="mt-4 font-semibold">Ajouter un compte</h3>
        <AddAccount />
        <div className="mt-6" aria-live="polite">
          <AccountList />
        </div>
      </section>
    </main>
  );
}
