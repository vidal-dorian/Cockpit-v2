import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { NavLink } from "react-router";
import { client } from "./api.ts";
import { ConnectClaude, fetchConnect } from "./ConnectClaude.tsx";
import { Data, FingerprintErase } from "./Data.tsx";
import { LauncherSettings } from "./LauncherSettings.tsx";
import { fetchMembers, Members } from "./Members.tsx";
import { Preferences } from "./Preferences.tsx";
import { ProCodes } from "./ProCodes.tsx";
import { fetchRoutine, RoutineSettings } from "./RoutineSettings.tsx";
import { day, Tokens } from "./SettingsTokens.tsx";
import {
  Breadcrumb,
  fetchMe,
  fetchTelemetry,
  StateSentence,
} from "./Shell.tsx";
import { fetchPlan, planSentence, Subscription } from "./Subscription.tsx";
import { plural } from "./tickets.ts";
import { toast } from "./toast.tsx";
import {
  alertBox,
  button,
  dangerButton,
  focusRing,
  listCard,
  sectionLabel,
} from "./ui.ts";
import { ago } from "./when.ts";

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
    return <p className="loading text-muted-foreground">Chargement…</p>;
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
            className="flex min-h-[50px] flex-wrap items-center gap-x-3 gap-y-2 px-[18px] py-2"
          >
            <span aria-hidden="true" className="w-6 text-center text-dim">
              ●
            </span>
            <span className="min-w-0 grow">
              <span className="block font-semibold">{user.login}</span>
              <span className="block text-[12.5px] text-muted-foreground">
                {user.isAdmin ? (
                  <span>Administrateur</span>
                ) : (
                  `inscrit le ${day(user.createdAt)}`
                )}
                {" · "}
                {user.lastLoginAt
                  ? `connecté ${ago(user.lastLoginAt)}`
                  : "jamais connecté"}
                {` · ${plural(user.projects, "projet", "projets")}`}
                {user.blockedAt && (
                  <>
                    {" · "}
                    <span className="text-destructive">Bloqué</span>
                  </>
                )}
              </span>
            </span>
            <span className="flex gap-2 sm:ml-auto">
              {user.isAdmin ? null : user.blockedAt ? (
                <button
                  type="button"
                  onClick={() =>
                    change.mutate(
                      { id: user.id, block: false },
                      { onSuccess: () => toast("Compte débloqué.") },
                    )
                  }
                  disabled={change.isPending}
                  aria-busy={change.isPending}
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
                    onClick={() =>
                      change.mutate(
                        { id: user.id, block: true },
                        { onSuccess: () => toast("Compte bloqué.") },
                      )
                    }
                    disabled={change.isPending}
                    aria-busy={change.isPending}
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

type SettingsTab =
  | "claude"
  | "utilisateurs"
  | "taches-cloud"
  | "preferences"
  | "membres"
  | "abonnement"
  | "donnees";

// The state sentence of each entry (045 D): what the entry is, not a bare title.
const SENTENCES: Record<SettingsTab, { title: string; rest?: string }> = {
  claude: {
    title: "Connecte Claude à Cockpit.",
    rest: "Une seule fois, sur claude.ai ; ça marche ensuite partout.",
  },
  "taches-cloud": {
    title: "Des tâches de Claude écrivent tes US et développent dans le cloud.",
    rest: "Créées une fois sur claude.ai, lancées par Cockpit.",
  },
  preferences: { title: "Préférences" },
  membres: {
    title: "Personne ne voit tes projets.",
    rest: "Invite quelqu'un sur un de tes projets.",
  },
  abonnement: { title: "Ton abonnement" },
  donnees: {
    title: "Ce que Cockpit garde sur toi.",
    rest: "Et comment tout effacer.",
  },
  utilisateurs: {
    title: "Voici ceux qui ont accès à ton instance.",
    rest: "Toute personne avec un compte GitHub peut se connecter.",
  },
};

/** The state sentence of the entry: told from the data when the page has it, the static one while it loads. */
function useSentence(tab: SettingsTab, isAdmin: boolean) {
  const on = (t: SettingsTab) => tab === t;
  const connect = useQuery({
    queryKey: ["connect"],
    queryFn: fetchConnect,
    enabled: on("claude"),
  });
  const routine = useQuery({
    queryKey: ["routine"],
    queryFn: fetchRoutine,
    enabled: on("taches-cloud"),
  });
  const users = useQuery({
    queryKey: ["users"],
    queryFn: fetchUsers,
    enabled: on("utilisateurs") && isAdmin,
  });
  const members = useQuery({
    queryKey: ["members"],
    queryFn: fetchMembers,
    enabled: on("membres"),
  });
  const plan = useQuery({
    queryKey: ["plan"],
    queryFn: fetchPlan,
    enabled: on("abonnement"),
  });
  if (tab === "abonnement" && plan.data) return planSentence(plan.data);
  if (tab === "utilisateurs" && !isAdmin)
    return { title: "L'instance est gérée par son administrateur." };
  if (tab === "claude" && connect.data?.connected && connect.data.connectedAt)
    return {
      title: "Claude est connecté à Cockpit.",
      rest: `Depuis ${connect.data.client}, le ${day(connect.data.connectedAt)}.`,
    };
  if (tab === "taches-cloud" && routine.data?.connected)
    return routine.data.needsReconnect
      ? {
          title: "La tâche de Claude est à reconnecter.",
          rest: "claude.ai a refusé son jeton.",
        }
      : {
          title: "La tâche de Claude est reliée.",
          rest: "Elle écrit tes US, lancée par Cockpit.",
        };
  if (tab === "membres" && members.data) {
    // Decision 076 F: the people, not their lines: one who is on two projects counts once.
    const people = new Set(members.data.members.map((m) => m.userId)).size;
    if (people > 0)
      return {
        title: `${people} ${people === 1 ? "personne voit" : "personnes voient"} tes projets partagés.`,
        rest:
          people === 1
            ? "Elle ne voit que ce que tu lui partages."
            : "Chacune ne voit que ce que tu lui partages.",
      };
  }
  if (tab === "utilisateurs" && users.data)
    return {
      title: SENTENCES.utilisateurs.title,
      rest: `${users.data.length} compte${users.data.length > 1 ? "s" : ""} · inscription ouverte à tout compte GitHub.`,
    };
  return SENTENCES[tab];
}

// The left menu of 045 I: only the entries whose slice is built.
const menuItem = ({ isActive }: { isActive: boolean }) =>
  `flex h-8 items-center rounded-[9px] px-2.5 text-sm font-semibold ${focusRing} ${isActive ? "bg-raised text-foreground" : "text-muted-foreground hover:text-foreground"}`;
/** Réglages: a menu on the left, one entry per page (decisions 028 H and 045 I); Instance is the administrator's. */
export function Settings({ tab }: { tab: SettingsTab }) {
  // Utilisateurs is the administrator's: wait to know who asks before asking the server for the list.
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const sentence = useSentence(tab, me.data?.isAdmin === true);
  const telemetry = useQuery({
    queryKey: ["telemetry"],
    queryFn: fetchTelemetry,
  });
  if (me.isPending)
    return <p className="loading p-4 text-muted-foreground">Chargement…</p>;
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
      <StateSentence {...sentence} />
      <div className="grid gap-[22px] px-[26px] pt-5 pb-6 md:grid-cols-[180px_minmax(0,1fr)]">
        <nav aria-label="Réglages" className="flex flex-col gap-0.5">
          <NavLink to="/reglages" end className={menuItem}>
            Connecter Claude
          </NavLink>
          <NavLink to="/reglages/taches-cloud" className={menuItem}>
            Tâches cloud
          </NavLink>
          <NavLink to="/reglages/preferences" className={menuItem}>
            Préférences
          </NavLink>
          <NavLink to="/reglages/membres" className={menuItem}>
            Membres
          </NavLink>
          <NavLink to="/reglages/abonnement" className={menuItem}>
            Abonnement
          </NavLink>
          <NavLink to="/reglages/donnees" className={menuItem}>
            Données
          </NavLink>
          {me.data?.isAdmin && (
            <NavLink to="/reglages/utilisateurs" className={menuItem}>
              Instance
            </NavLink>
          )}
        </nav>
        <div className="min-w-0">
          {tab === "claude" && (
            <div className="grid gap-[22px]">
              <ConnectClaude />
              <section aria-labelledby="jetons">
                <Tokens />
              </section>
            </div>
          )}
          {tab === "utilisateurs" &&
            (me.data?.isAdmin ? (
              <div className="grid gap-[22px]">
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
                <ProCodes />
                <FingerprintErase />
              </div>
            ) : (
              <p>Cette page est réservée à l'administrateur.</p>
            ))}
          {tab === "abonnement" && <Subscription />}
          {tab === "donnees" && <Data />}
          {tab === "preferences" && <Preferences />}
          {tab === "membres" && <Members />}
          {tab === "taches-cloud" && (
            <div className="grid gap-[22px]">
              <RoutineSettings />
              <LauncherSettings />
            </div>
          )}
        </div>
      </div>
      {telemetry.data && (
        <p className="px-[26px] pb-6 text-[12.5px] text-muted-foreground">
          Cockpit envoie à PostHog (serveurs dans l'Union européenne) les écrans
          ouverts, les actions faites et les erreurs rencontrées, sans le
          contenu de vos projets.
        </p>
      )}
    </main>
  );
}
