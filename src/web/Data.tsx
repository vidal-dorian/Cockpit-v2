import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { client } from "./api.ts";
import { Modal } from "./Modal.tsx";
import { plural } from "./tickets.ts";
import {
  alertBox,
  button,
  dangerButton,
  field,
  listCard,
  primaryButton,
  sectionLabel,
} from "./ui.ts";

export async function fetchData() {
  const res = await client.api.me.data.$get();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const json = (value: unknown) => ({
  init: {
    body: JSON.stringify(value),
    headers: { "content-type": "application/json" },
  },
});

/** « Préparer l'export » (decision 078 B): the file is saved by the browser, nothing is kept here. */
function Export({ login }: { login: string }) {
  const save = useMutation({
    mutationFn: async () => {
      const res = await client.api.me.export.$get();
      if (!res.ok) throw new Error("L'export a échoué, réessaie.");
      const url = URL.createObjectURL(
        new Blob([await res.text()], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `cockpit-${login}-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    },
  });
  return (
    <>
      <button
        type="button"
        className={button}
        disabled={save.isPending}
        onClick={() => save.mutate()}
      >
        Préparer l'export
      </button>
      {save.error && (
        <p role="alert" className={alertBox}>
          {save.error.message}
        </p>
      )}
    </>
  );
}

/** The confirmation window of decision 078 C: what goes, and for whom; the button waits for the exact login. */
function DeleteWindow({
  data,
  onClose,
}: {
  data: Awaited<ReturnType<typeof fetchData>>;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [typed, setTyped] = useState("");
  const erase = useMutation({
    mutationFn: async () => {
      const res = await client.api.me.$delete({}, json({ login: typed }));
      if (!res.ok) throw new Error("La suppression a échoué, réessaie.");
      // The copies of the service worker hold this user's pages (same name as CACHE in public/sw.js).
      await window.caches?.delete("cockpit-v1");
    },
    // The session is gone: « me » answers 401 and the page shows the sign-in.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me"] }),
  });
  return (
    <Modal
      label="Supprimer mon compte"
      onClose={onClose}
      className="w-[min(480px,100%)]"
    >
      <form
        className="flex flex-col gap-3 p-[22px] text-left"
        onSubmit={(e) => {
          e.preventDefault();
          erase.mutate();
        }}
      >
        <h2 className="text-lg font-semibold">Supprimer mon compte ?</h2>
        <p className="text-muted-foreground">
          Seront effacés : tes projets et tout ce qu'ils contiennent, tes
          appartenances aux projets des autres, ton journal, tes jetons, tes
          sessions, tes notifications, tes routines, tes invitations, tes US de
          leur file et de leur nuit et tes réglages. Tes runs sur leurs projets
          restent, anonymisés. Rien ne change sur GitHub.
        </p>
        {data.shared.map((p) => (
          <p key={p.id} className="font-semibold">
            {p.fullName} sera supprimé pour{" "}
            {p.members.map((m) => `@${m}`).join(", ")}.
          </p>
        ))}
        <label>
          Ton login GitHub
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            className={field}
          />
        </label>
        {erase.error && (
          <p role="alert" className={alertBox}>
            {erase.error.message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={button} onClick={onClose}>
            Annuler
          </button>
          <button
            type="submit"
            className={dangerButton}
            disabled={typed !== data.login || erase.isPending}
          >
            Supprimer définitivement
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Réglages › Données (S50, decision 078 A): what Cockpit keeps, the export, the deletion. */
export function Data() {
  const data = useQuery({ queryKey: ["data"], queryFn: fetchData });
  const [asking, setAsking] = useState(false);
  if (data.isPending)
    return <p className="loading text-muted-foreground">Chargement…</p>;
  if (data.isError)
    return (
      <p role="alert" className={alertBox}>
        Impossible de lire tes données : {data.error.message}
      </p>
    );
  const d = data.data;
  const lines = [
    ["Compte", `${d.name ?? d.login} · GitHub @${d.login}`],
    [
      "Projets",
      `${plural(d.projects, "projet", "projets")} · ${plural(d.tickets, "ticket", "tickets")}, ${d.stories} US, ${plural(d.runs, "run", "runs")}, ${plural(d.questions, "question", "questions")}`,
    ],
    [
      "Journal",
      `${plural(d.journal, "entrée", "entrées")} · gardées tant que le compte existe`,
    ],
    [
      "Secrets",
      `${plural(d.tokens, "jeton chiffré", "jetons chiffrés")} · jamais affichés`,
    ],
    ["Code de tes repos", "jamais copié : lu sur GitHub à la demande"],
  ];
  return (
    <div className="grid gap-[22px]">
      <ul className={listCard}>
        {lines.map(([label, text]) => (
          <li key={label} className="flex flex-wrap gap-x-4 px-4 py-3">
            <span className="w-40 font-semibold">{label}</span>
            <span className="text-muted-foreground">{text}</span>
          </li>
        ))}
      </ul>
      <section aria-labelledby="export" className="grid gap-2">
        <h2 id="export" className={sectionLabel}>
          Exporter mes données
        </h2>
        <p className="text-muted-foreground">
          Un fichier JSON avec tout ce qui est listé ci-dessus.
        </p>
        <div>
          <Export login={d.login} />
        </div>
      </section>
      <section aria-labelledby="suppression" className="grid gap-2">
        <h2 id="suppression" className={sectionLabel}>
          Supprimer mon compte
        </h2>
        <p className="text-muted-foreground">
          Tes projets, tickets, US et ton journal sont effacés. Rien ne change
          sur GitHub : tes repos, issues et PR restent.
        </p>
        {d.isAdmin ? (
          <p className="text-muted-foreground">
            Tu administres cette instance : ton compte ne peut pas être supprimé
            ici.
          </p>
        ) : (
          <div>
            <button
              type="button"
              className={dangerButton}
              onClick={() => setAsking(true)}
            >
              Supprimer mon compte…
            </button>
          </div>
        )}
      </section>
      <p className="text-[12.5px] text-muted-foreground">
        Après une suppression, Cockpit garde seulement une empreinte de ton
        compte GitHub et le nombre de repos gratuits utilisés, pour qu'une
        suppression ne redonne pas 3 repos. Demande à l'administrateur de
        l'effacer.
      </p>
      {asking && <DeleteWindow data={d} onClose={() => setAsking(false)} />}
    </div>
  );
}

/** Réglages › Instance (decision 078 F): the administrator erases the fingerprint of a deleted account. */
export function FingerprintErase() {
  const [login, setLogin] = useState("");
  const erase = useMutation({
    mutationFn: async () => {
      const res = await client.api.settings.fingerprints.erase.$post(
        {},
        json({ login }),
      );
      if (res.ok) return "Empreinte effacée.";
      const { error } = (await res.json()) as { error: string };
      if (error === "no_fingerprint") return "Aucune empreinte pour ce compte.";
      throw new Error(
        error === "unknown_login"
          ? "GitHub ne connaît pas ce compte."
          : "L'opération a échoué, réessaie.",
      );
    },
  });
  return (
    <section aria-labelledby="empreinte">
      <h2 id="empreinte" className={sectionLabel}>
        Effacer l'empreinte d'un compte supprimé
      </h2>
      <form
        className="mt-2 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          erase.mutate();
        }}
      >
        <label className="grow">
          @login GitHub
          <input
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            autoComplete="off"
            className={field}
          />
        </label>
        <button
          type="submit"
          disabled={!login.trim() || erase.isPending}
          className={primaryButton}
        >
          Effacer l'empreinte
        </button>
      </form>
      <p role="status" className="mt-2 text-muted-foreground">
        {erase.data}
      </p>
      {erase.error && (
        <p role="alert" className={`mt-3 ${alertBox}`}>
          {erase.error.message}
        </p>
      )}
    </section>
  );
}
