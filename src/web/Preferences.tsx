import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { client } from "./api.ts";
import { fetchMe } from "./Shell.tsx";
import { ShortcutList, setSingleKeysOff } from "./Shortcuts.tsx";
import { applyTheme } from "./theme.ts";
import {
  alertBox,
  button,
  card,
  chipLink,
  field,
  focusRing,
  sectionLabel,
} from "./ui.ts";

const SWITCHES = [
  ["question", "Claude pose une question", "avec les réponses en boutons"],
  ["runFailed", "Un run échoue", null],
  [
    "prReady",
    "Une PR est prête à relire",
    "regroupées en une notification par heure",
  ],
  ["nightRecap", "Le récap de la nuit", "à l'heure de fin de la nuit"],
] as const;

const HOURS = Array.from({ length: 24 }, (_, h) => h);

const switchStyle = `relative h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full border border-border-strong bg-raised transition-colors checked:bg-primary before:absolute before:top-0.5 before:left-0.5 before:size-3.5 before:rounded-full before:bg-muted-foreground before:transition-transform checked:before:translate-x-4 checked:before:bg-primary-foreground ${focusRing}`;

async function fetchNotifications() {
  const res = await client.api.me.notifications.$get();
  if (!res.ok) throw new Error("Réponse inattendue du serveur.");
  return res.json();
}

/** Asks the permission, subscribes the browser to the server's VAPID key and sends the subscription (decision 072 D). */
async function enableDevice() {
  if ((await Notification.requestPermission()) !== "granted")
    throw new Error(
      "Les notifications sont refusées : autorise-les dans les réglages du navigateur.",
    );
  const key = await client.api.push.key.$get();
  if (!key.ok) throw new Error("Réponse inattendue du serveur.");
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration)
    throw new Error(
      "Cockpit n'est pas encore prêt pour les notifications : recharge la page.",
    );
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: (await key.json()).publicKey,
  });
  const { endpoint, keys } = subscription.toJSON();
  const res = await client.api.push.subscriptions.$post({
    json: {
      endpoint: endpoint ?? "",
      keys: { p256dh: keys?.p256dh ?? "", auth: keys?.auth ?? "" },
    },
  });
  if (res.status === 409)
    throw new Error("10 appareils au plus : retire-en un.");
  if (!res.ok) throw new Error("L'appareil n'a pas pu être enregistré.");
  return "Cet appareil reçoit maintenant les notifications.";
}

async function sendTest() {
  const res = await client.api.push.test.$post();
  if (res.status === 409)
    throw new Error(
      "Aucun appareil abonné : active d'abord les notifications sur cet appareil.",
    );
  if (!res.ok) throw new Error("La notification n'a pas pu partir.");
  return "Notification envoyée.";
}

/** The device part of the card: the buttons, or what to do first on an iPhone (decision 072 H). */
function Device() {
  const [done, setDone] = useState("");
  const run = useMutation({
    mutationFn: (action: () => Promise<string>) => action(),
    onSuccess: setDone,
    onMutate: () => setDone(""),
  });
  if (!("PushManager" in window) || !("serviceWorker" in navigator))
    return (
      <p className="text-[12.5px] text-muted-foreground">
        {/iPhone|iPad/.test(navigator.userAgent)
          ? "Sur iPhone, ajoute d'abord Cockpit à l'écran d'accueil (Partager, puis Sur l'écran d'accueil), puis ouvre-le depuis là."
          : "Ce navigateur ne sait pas recevoir de notifications."}
      </p>
    );
  return (
    <div className="grid gap-2" aria-live="polite">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={button}
          disabled={run.isPending}
          aria-busy={run.isPending}
          onClick={() => run.mutate(enableDevice)}
        >
          Activer sur cet appareil
        </button>
        <button
          type="button"
          className={button}
          disabled={run.isPending}
          aria-busy={run.isPending}
          onClick={() => run.mutate(sendTest)}
        >
          Envoyer une notification de test
        </button>
      </div>
      {done && <p className="text-[12.5px] text-muted-foreground">{done}</p>}
      {run.isError && (
        <p role="alert" className={alertBox}>
          {run.error.message}
        </p>
      )}
    </div>
  );
}

const THEMES = [
  ["dark", "Sombre"],
  ["light", "Clair"],
  ["system", "Comme le système"],
] as const;

/** The card « Thème » of S47 (decision 073 F, I): the choice is kept on the server and applied at once. */
function Theme() {
  const queryClient = useQueryClient();
  const current = useQuery({ queryKey: ["me"], queryFn: fetchMe }).data?.theme;
  const change = useMutation({
    mutationFn: async (theme: (typeof THEMES)[number][0]) => {
      const res = await client.api.me.theme.$put({ json: { theme } });
      if (!res.ok) throw new Error("Le thème n'a pas pu être enregistré.");
      return (await res.json()).theme;
    },
    onSuccess: (theme) => {
      applyTheme(theme);
      return queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });
  return (
    <section aria-labelledby="theme" className={`${card} px-5 py-[18px]`}>
      <h2 id="theme" className={sectionLabel}>
        Thème
      </h2>
      <div className="mt-4 flex flex-wrap gap-2">
        {THEMES.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={current === value}
            onClick={() => change.mutate(value)}
            className={chipLink({ isActive: current === value })}
          >
            {label}
          </button>
        ))}
      </div>
      {change.isError && (
        <p role="alert" className={`mt-3 ${alertBox}`}>
          {change.error.message}
        </p>
      )}
    </section>
  );
}

/** The card « Notifications sur le téléphone » of S47 (decision 072 D): four switches, the quiet hours and the device. */
function Notifications() {
  const queryClient = useQueryClient();
  const prefs = useQuery({
    queryKey: ["notifications"],
    queryFn: fetchNotifications,
  });
  const change = useMutation({
    mutationFn: async (json: Partial<NonNullable<typeof prefs.data>>) => {
      const res = await client.api.me.notifications.$put({ json });
      if (!res.ok) throw new Error("Le réglage n'a pas pu être enregistré.");
      return res.json();
    },
    onSuccess: (data) => queryClient.setQueryData(["notifications"], data),
  });
  const data = prefs.data;

  return (
    <section
      aria-labelledby="notifications"
      className={`${card} px-5 py-[18px]`}
    >
      <h2 id="notifications" className={sectionLabel}>
        Notifications sur le téléphone
      </h2>
      {prefs.isPending && (
        <p className="loading mt-3 text-muted-foreground">Chargement…</p>
      )}
      {prefs.isError && (
        <p role="alert" className={`mt-3 ${alertBox}`}>
          Impossible de lire tes réglages. Recharge la page.
        </p>
      )}
      {data && (
        <div className="mt-4 grid gap-4">
          <div className="grid gap-3.5">
            {SWITCHES.map(([key, label, hint]) => (
              <label key={key} className="flex items-center gap-3">
                <input
                  type="checkbox"
                  role="switch"
                  aria-checked={data[key]}
                  className={switchStyle}
                  checked={data[key]}
                  onChange={(e) => change.mutate({ [key]: e.target.checked })}
                />
                <span>
                  <span className="block font-semibold">{label}</span>
                  {hint && (
                    <span className="block text-[12.5px] text-muted-foreground">
                      {hint}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
          <div className="grid max-w-[360px] grid-cols-2 gap-3">
            {(
              [
                ["quietStartHour", "Début du silence"],
                ["quietEndHour", "Fin du silence"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="text-[12.5px] text-muted-foreground">
                {label}
                <select
                  className={field}
                  value={data[key]}
                  onChange={(e) => change.mutate({ [key]: +e.target.value })}
                >
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      {h} h
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <p className="text-[12.5px] text-muted-foreground">
            {data.quietStartHour === data.quietEndHour
              ? "Pas de silence."
              : `Silence de ${data.quietStartHour} h à ${data.quietEndHour} h, sauf le récap de la nuit.`}{" "}
            Les heures sont celles de ta nuit.
          </p>
          {change.isError && (
            <p role="alert" className={alertBox}>
              {change.error.message}
            </p>
          )}
          <Device />
        </div>
      )}
    </section>
  );
}

/** The card « Guide de mise en route »: brings back the guide hidden with « Masquer ce guide » (decision 075 E). */
function Guide() {
  const queryClient = useQueryClient();
  const show = useMutation({
    mutationFn: async () => {
      const res = await client.api.me.onboarding.show.$post();
      if (!res.ok) throw new Error("Le guide n'a pas pu être réaffiché.");
    },
    meta: { done: "Le guide est de retour sur l'accueil." },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["home"] }),
  });
  return (
    <section aria-labelledby="guide" className={`${card} px-5 py-[18px]`}>
      <h2 id="guide" className={sectionLabel}>
        Guide de mise en route
      </h2>
      <button
        type="button"
        className={`mt-4 ${button}`}
        disabled={show.isPending}
        aria-busy={show.isPending}
        onClick={() => show.mutate()}
      >
        Réafficher le guide de mise en route
      </button>
      {show.isError && (
        <p role="alert" className={`mt-3 ${alertBox}`}>
          {show.error.message}
        </p>
      )}
    </section>
  );
}

/** The cards of S47: notifications, « Guide de mise en route », « Thème » and « Raccourcis clavier » (decision 073 I). */
export function Preferences() {
  const queryClient = useQueryClient();
  const off = useQuery({ queryKey: ["me"], queryFn: fetchMe }).data
    ?.singleKeyShortcutsOff;
  // The server's value is the truth (decision 073 F): show the new one at once, put the old one back if the save fails.
  const show = (value: boolean) => {
    setSingleKeysOff(value);
    queryClient.setQueryData(
      ["me"],
      (me: Awaited<ReturnType<typeof fetchMe>>) =>
        me && { ...me, singleKeyShortcutsOff: value },
    );
  };
  const save = useMutation({
    mutationFn: async (value: boolean) => {
      const res = await client.api.me["single-key-shortcuts"].$put({
        json: { off: value },
      });
      if (!res.ok) throw new Error("Le réglage n'a pas pu être enregistré.");
    },
    onMutate: (value) => show(value),
    onError: (_error, value) => show(!value),
  });
  return (
    <div className="grid gap-4">
      <Notifications />
      <Guide />
      <div className="grid gap-4 md:grid-cols-2">
        <Theme />
        <section
          aria-labelledby="raccourcis"
          className={`${card} px-5 py-[18px]`}
        >
          <h2 id="raccourcis" className={sectionLabel}>
            Raccourcis clavier
          </h2>
          <div className="mt-4">
            <ShortcutList />
          </div>
          <label className="mt-4 flex items-center gap-2">
            <input
              type="checkbox"
              checked={off ?? false}
              onChange={(e) => save.mutate(e.target.checked)}
            />
            Désactiver les raccourcis d'une touche
          </label>
          {save.isError && (
            <p role="alert" className={`mt-3 ${alertBox}`}>
              {save.error.message}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
