import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { NavLink } from "react-router";
import { client } from "./api.ts";
import { ConnectClaude } from "./ConnectClaude.tsx";
import { RoutineSettings } from "./RoutineSettings.tsx";
import { Tokens } from "./SettingsTokens.tsx";
import { Breadcrumb, fetchMe, StateSentence } from "./Shell.tsx";
import {
  alertBox,
  button,
  dangerButton,
  focusRing,
  listCard,
  sectionLabel,
} from "./ui.ts";

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
      <ul className={listCard}>
        {users.data.map((user) => (
          <li
            key={user.id}
            className="flex min-h-[50px] flex-wrap items-center gap-x-4 gap-y-2 px-[18px] py-2"
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
                    className={dangerButton}
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

type SettingsTab = "claude" | "jetons" | "utilisateurs" | "ecriture-us";

// The state sentence of each entry (045 D): what the entry is, not a bare title.
const SENTENCES: Record<SettingsTab, { title: string; rest: string }> = {
  claude: {
    title: "Connecte Claude à Cockpit.",
    rest: "Une seule fois, sur claude.ai ; ça marche ensuite partout.",
  },
  jetons: {
    title: "Les jetons MCP lient un client à ton compte.",
    rest: "Pour un client sans connexion OAuth.",
  },
  "ecriture-us": {
    title: "Une tâche de Claude écrit tes US.",
    rest: "Créée une fois sur claude.ai, lancée par Cockpit.",
  },
  utilisateurs: {
    title: "Voici ceux qui ont accès à ton instance.",
    rest: "Toute personne avec un compte GitHub peut se connecter.",
  },
};

// The left menu of 045 I: only the entries whose slice is built.
const menuItem = ({ isActive }: { isActive: boolean }) =>
  `flex h-8 items-center rounded-[9px] px-2.5 text-sm font-semibold ${focusRing} ${isActive ? "bg-raised text-foreground" : "text-muted-foreground hover:text-foreground"}`;
const subMenuItem = ({ isActive }: { isActive: boolean }) =>
  `${menuItem({ isActive })} pl-[22px] text-[13.5px] font-medium`;

/** Réglages: a menu on the left, one entry per page (decisions 028 H and 045 I); Instance is the administrator's. */
export function Settings({ tab }: { tab: SettingsTab }) {
  // Utilisateurs is the administrator's: wait to know who asks before asking the server for the list.
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe });
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
    <main>
      <Breadcrumb trail={[{ label: "Réglages" }]} />
      <StateSentence
        {...(tab === "utilisateurs" && !me.data?.isAdmin
          ? { title: "L'instance est gérée par son administrateur." }
          : SENTENCES[tab])}
      />
      <div className="grid gap-[22px] px-[26px] pt-5 pb-6 md:grid-cols-[180px_minmax(0,1fr)]">
        <nav aria-label="Réglages" className="flex flex-col gap-0.5">
          <NavLink to="/reglages" end className={menuItem}>
            Connecter Claude
          </NavLink>
          <NavLink to="/reglages/jetons" className={subMenuItem}>
            Jetons MCP
          </NavLink>
          <NavLink to="/reglages/ecriture-us" className={menuItem}>
            Tâches cloud
          </NavLink>
          {me.data?.isAdmin && (
            <NavLink to="/reglages/utilisateurs" className={menuItem}>
              Instance
            </NavLink>
          )}
        </nav>
        <div className="min-w-0">
          {tab === "claude" && <ConnectClaude />}
          {tab === "jetons" && (
            <section aria-labelledby="jetons">
              <Tokens />
            </section>
          )}
          {tab === "utilisateurs" &&
            (me.data?.isAdmin ? (
              <section aria-labelledby="utilisateurs">
                <h2 id="utilisateurs" className={sectionLabel}>
                  Utilisateurs
                </h2>
                <p className="mt-1 text-[12.5px] text-muted-foreground">
                  Toute personne avec un compte GitHub peut se connecter à
                  Cockpit. Un compte bloqué ne peut plus se connecter.
                </p>
                <div className="mt-3" aria-live="polite">
                  <UserList />
                </div>
              </section>
            ) : (
              <p>Cette page est réservée à l'administrateur.</p>
            ))}
          {tab === "ecriture-us" && <RoutineSettings />}
        </div>
      </div>
    </main>
  );
}
