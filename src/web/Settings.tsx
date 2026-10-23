import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { client } from "./api.ts";
import { focusRing } from "./ui.ts";

const button = `min-h-10 rounded-lg border border-border bg-card px-4 font-semibold ${focusRing}`;

// The server's refusals, in French; its codes are not meant to be read.
const REFUSALS: Record<string, string> = {
  already_blocked: "Ce compte est déjà bloqué.",
  cannot_block_admin: "Un administrateur ne peut pas être bloqué.",
  not_blocked: "Ce compte n'est pas bloqué.",
};

/** A French sentence for a failed answer. */
async function failure(res: Response) {
  const body: { error?: string } | null = await res.json().catch(() => null);
  return new Error(
    (res.status === 409 && body?.error && REFUSALS[body.error]) ||
      (res.status === 403
        ? "Cette page est réservée à l'administrateur."
        : "L'opération a échoué, réessaie."),
  );
}

async function fetchUsers() {
  const res = await client.api.settings.users.$get();
  if (!res.ok) throw await failure(res);
  return (await res.json()).users;
}

function UserList() {
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: ["users"], queryFn: fetchUsers });
  // The user waiting for their confirmation: blocking ends their sessions, so we ask on the spot (decision 003, rule 4).
  const [confirming, setConfirming] = useState<number | null>(null);
  const change = useMutation({
    mutationFn: async ({ id, block }: { id: number; block: boolean }) => {
      const param = { id: String(id) };
      const res = block
        ? await client.api.settings.users[":id"].block.$post({ param })
        : await client.api.settings.users[":id"].unblock.$post({ param });
      if (!res.ok) throw await failure(res);
    },
    onSettled: () => {
      setConfirming(null);
      return queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });

  if (users.isPending)
    return <p className="text-muted-foreground">Chargement…</p>;
  if (users.isError) {
    return (
      <p
        role="alert"
        className="rounded-xl bg-destructive-soft p-4 text-destructive"
      >
        {users.error.message}
      </p>
    );
  }
  return (
    <>
      <ul className="grid gap-2">
        {users.data.map((user) => (
          <li
            key={user.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-card p-4"
          >
            <span className="font-semibold">{user.login}</span>
            {user.isAdmin && (
              <span className="text-muted-foreground">Administrateur</span>
            )}
            {user.blockedAt && <span className="text-destructive">Bloqué</span>}
            <span className="flex gap-2 sm:ml-auto">
              {user.isAdmin ? null : user.blockedAt ? (
                <button
                  type="button"
                  onClick={() => change.mutate({ id: user.id, block: false })}
                  disabled={change.isPending}
                  className={button}
                >
                  Débloquer
                </button>
              ) : confirming === user.id ? (
                <>
                  <span className="basis-full">
                    Bloquer ce compte ? Ses sessions ouvertes sont fermées.
                  </span>
                  <button
                    type="button"
                    onClick={() => change.mutate({ id: user.id, block: true })}
                    disabled={change.isPending}
                    className={`min-h-10 rounded-lg bg-destructive-soft px-4 font-semibold text-destructive ${focusRing}`}
                  >
                    Confirmer le blocage
                  </button>
                  <button
                    type="button"
                    // The Bloquer button is gone: keep the keyboard focus on the safe choice.
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
                  onClick={() => setConfirming(user.id)}
                  className={button}
                >
                  Bloquer
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {change.error && (
        <p
          role="alert"
          className="mt-3 rounded-xl bg-destructive-soft p-4 text-destructive"
        >
          {change.error.message}
        </p>
      )}
    </>
  );
}

export function Settings() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="font-heading text-3xl font-extrabold">Réglages</h1>
      <section className="mt-6" aria-labelledby="utilisateurs">
        <h2 id="utilisateurs" className="font-heading text-xl font-bold">
          Utilisateurs
        </h2>
        <p className="mt-1 text-muted-foreground">
          Toute personne avec un compte GitHub peut se connecter à Cockpit. Un
          compte bloqué ne peut plus se connecter.
        </p>
        <div className="mt-4" aria-live="polite">
          <UserList />
        </div>
      </section>
    </main>
  );
}
