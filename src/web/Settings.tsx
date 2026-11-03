import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { NavLink } from "react-router";
import { client } from "./api.ts";
import { ConnectClaude } from "./ConnectClaude.tsx";
import { RoutineSettings } from "./RoutineSettings.tsx";
import { Tokens } from "./SettingsTokens.tsx";
import { alertBox, button, card, focusRing, tabLink } from "./ui.ts";

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
      <p role="alert" className={alertBox}>
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
            className={`flex flex-wrap items-center gap-x-4 gap-y-2 ${card} p-4`}
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
                    className={`min-h-10 rounded-xl bg-destructive-soft px-4 font-semibold text-destructive ${focusRing}`}
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
        <p role="alert" className={`mt-3 ${alertBox}`}>
          {change.error.message}
        </p>
      )}
    </>
  );
}

export type SettingsTab = "claude" | "jetons" | "utilisateurs" | "ecriture-us";

/** Réglages in four tabs (decision 028 H); Utilisateurs is the administrator's. */
export function Settings({ tab }: { tab: SettingsTab }) {
  // Utilisateurs is the administrator's: wait to know who asks before asking the server for the list.
  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const res = await client.api.me.$get();
      if (res.status === 401) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });
  if (me.isPending)
    return <p className="p-4 text-muted-foreground">Chargement…</p>;
  if (me.isError)
    return (
      <div role="alert" className={`m-4 ${alertBox}`}>
        <p>Impossible de lire ton compte : {me.error.message}</p>
        <button
          type="button"
          onClick={() => me.refetch()}
          className={`mt-3 ${button}`}
        >
          Réessayer
        </button>
      </div>
    );
  return (
    <main className="mx-auto max-w-[880px] px-4 py-8 sm:px-7">
      <h1 className="font-heading text-3xl font-extrabold">Réglages</h1>
      <nav
        aria-label="Réglages"
        className="mt-4 flex flex-wrap gap-x-2 border-b border-border"
      >
        <NavLink to="/reglages" end className={tabLink}>
          Connecter Claude
        </NavLink>
        <NavLink to="/reglages/jetons" className={tabLink}>
          Jetons MCP
        </NavLink>
        {me.data?.isAdmin && (
          <NavLink to="/reglages/utilisateurs" className={tabLink}>
            Utilisateurs
          </NavLink>
        )}
        <NavLink to="/reglages/ecriture-us" className={tabLink}>
          Écriture automatique des US
        </NavLink>
      </nav>
      <div className="mt-8">
        {tab === "claude" && <ConnectClaude />}
        {tab === "jetons" && (
          <section aria-labelledby="jetons">
            <Tokens />
          </section>
        )}
        {tab === "utilisateurs" &&
          (me.data?.isAdmin ? (
            <section aria-labelledby="utilisateurs">
              <h2 id="utilisateurs" className="font-heading text-xl font-bold">
                Utilisateurs
              </h2>
              <p className="mt-1 text-muted-foreground">
                Toute personne avec un compte GitHub peut se connecter à
                Cockpit. Un compte bloqué ne peut plus se connecter.
              </p>
              <div className="mt-4" aria-live="polite">
                <UserList />
              </div>
            </section>
          ) : (
            <p>Cette page est réservée à l'administrateur.</p>
          ))}
        {tab === "ecriture-us" && <RoutineSettings />}
      </div>
    </main>
  );
}
