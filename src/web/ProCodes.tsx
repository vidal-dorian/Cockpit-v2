import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { client } from "./api.ts";
import { day } from "./SettingsTokens.tsx";
import {
  alertBox,
  button,
  card,
  dangerButton,
  field,
  listCard,
  primaryButton,
  sectionLabel,
} from "./ui.ts";

const STATES = {
  free: "libre",
  used: "utilisé",
  expired: "expiré",
  revoked: "révoqué",
} as const;

const json = (value: unknown) => ({
  init: {
    body: JSON.stringify(value),
    headers: { "content-type": "application/json" },
  },
});

async function fetchCodes() {
  const res = await client.api.settings["pro-codes"].$get();
  if (!res.ok) throw new Error("Impossible de lire les codes Pro.");
  return (await res.json()).codes;
}

/** The end a « Durée » choice means: no end, or the end of the chosen day (UTC). */
const endOf = (lasts: string, date: string) =>
  lasts === "sans fin" ? null : `${date}T23:59:59.999Z`;

/** « Durée » and, for « jusqu'au », « Date de fin ». */
function Duration({
  lasts,
  date,
  onChange,
}: {
  lasts: string;
  date: string;
  onChange: (lasts: string, date: string) => void;
}) {
  return (
    <>
      <label>
        Durée
        <select
          value={lasts}
          onChange={(e) => onChange(e.target.value, date)}
          className={field}
        >
          <option>sans fin</option>
          <option>jusqu'au</option>
        </select>
      </label>
      {lasts === "jusqu'au" && (
        <label>
          Date de fin
          <input
            type="date"
            required
            value={date}
            onChange={(e) => onChange(lasts, e.target.value)}
            className={field}
          />
        </label>
      )}
    </>
  );
}

/** Shown once, like an MCP token (decision 015). */
function NewSecret({ secret, onDone }: { secret: string; onDone: () => void }) {
  const [copy, setCopy] = useState<"idle" | "done" | "failed">("idle");
  return (
    <div className={`mt-4 ${card} p-4`}>
      <p className="font-semibold">
        Voici le code. Tu ne pourras plus le revoir : copie-le maintenant.
      </p>
      <code className="mt-2 block font-mono break-all">{secret}</code>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={button}
          onClick={() =>
            navigator.clipboard.writeText(secret).then(
              () => setCopy("done"),
              () => setCopy("failed"),
            )
          }
        >
          Copier
        </button>
        <button type="button" className={primaryButton} onClick={onDone}>
          J'ai copié le code
        </button>
        <span
          role="status"
          className={copy === "failed" ? "text-destructive" : undefined}
        >
          {copy === "done" && "Copié."}
          {copy === "failed" && "Copie impossible : sélectionne le code."}
        </span>
      </div>
    </div>
  );
}

/** The card « Codes Pro » of Réglages › Instance (decision 077 I), administrator only. */
export function ProCodes() {
  const queryClient = useQueryClient();
  const codes = useQuery({ queryKey: ["pro-codes"], queryFn: fetchCodes });
  const [note, setNote] = useState("");
  const [lasts, setLasts] = useState("sans fin");
  const [date, setDate] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [editLasts, setEditLasts] = useState("sans fin");
  const [editDate, setEditDate] = useState("");
  const [confirming, setConfirming] = useState<number | null>(null);
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["pro-codes"] });
  const fail = () => {
    throw new Error("L'opération a échoué, réessaie.");
  };

  const create = useMutation({
    mutationFn: async () => {
      const res = await client.api.settings["pro-codes"].$post(
        {},
        json({ note, until: endOf(lasts, date) }),
      );
      if (!res.ok) return fail();
      // Kept in state only, never in the query cache.
      setSecret((await res.json()).secret);
      setNote("");
    },
    onSettled: refresh,
  });
  const change = useMutation({
    mutationFn: async (id: number) => {
      const res = await client.api.settings["pro-codes"][":id"].$patch(
        { param: { id: String(id) } },
        json({ until: endOf(editLasts, editDate) }),
      );
      if (!res.ok) fail();
      setEditing(null);
    },
    onSettled: refresh,
  });
  const revoke = useMutation({
    mutationFn: async (id: number) => {
      const res = await client.api.settings["pro-codes"][":id"].revoke.$post({
        param: { id: String(id) },
      });
      if (!res.ok) fail();
    },
    onSettled: () => {
      setConfirming(null);
      return refresh();
    },
  });
  const error = create.error ?? change.error ?? revoke.error;

  return (
    <section aria-labelledby="codes-pro">
      <h2 id="codes-pro" className={sectionLabel}>
        Codes Pro
      </h2>
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        Un code donne Pro à une seule personne. Un code jamais saisi expire 30
        jours après sa création.
      </p>
      {secret ? (
        <NewSecret secret={secret} onDone={() => setSecret(null)} />
      ) : (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <label className="grow">
            Note
            <input
              value={note}
              maxLength={80}
              placeholder="pour Karim"
              onChange={(e) => setNote(e.target.value)}
              className={field}
            />
          </label>
          <Duration
            lasts={lasts}
            date={date}
            onChange={(l, d) => {
              setLasts(l);
              setDate(d);
            }}
          />
          <button
            type="submit"
            disabled={!note.trim() || create.isPending}
            className={primaryButton}
          >
            Générer un code
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className={`mt-3 ${alertBox}`}>
          {error.message}
        </p>
      )}
      <div className="mt-3" aria-live="polite">
        {codes.isPending && (
          <p className="loading text-muted-foreground">Chargement…</p>
        )}
        {codes.isError && (
          <p role="alert" className={alertBox}>
            {codes.error.message}
          </p>
        )}
        {codes.data && codes.data.length > 0 && (
          <ul className={listCard}>
            {codes.data.map((c) => (
              <li
                key={c.id}
                className="flex min-h-[50px] flex-wrap items-center gap-x-3 gap-y-2 px-[18px] py-2"
              >
                <span className="min-w-0 grow">
                  <span className="block font-semibold">{c.note}</span>
                  <span className="block text-[12.5px] text-muted-foreground">
                    <span>{STATES[c.state]}</span>
                    {c.login && ` · @${c.login}`}
                    {` · ${c.until ? `jusqu'au ${day(c.until)}` : "sans fin"}`}
                    {` · créé le ${day(c.createdAt)}`}
                  </span>
                </span>
                {editing === c.id ? (
                  <form
                    className="flex flex-wrap items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      change.mutate(c.id);
                    }}
                  >
                    <Duration
                      lasts={editLasts}
                      date={editDate}
                      onChange={(l, d) => {
                        setEditLasts(l);
                        setEditDate(d);
                      }}
                    />
                    <button type="submit" className={primaryButton}>
                      Enregistrer
                    </button>
                    <button
                      type="button"
                      className={button}
                      onClick={() => setEditing(null)}
                    >
                      Annuler
                    </button>
                  </form>
                ) : confirming === c.id ? (
                  <>
                    <span className="basis-full">
                      Révoquer ce code ? Le compte lié repasse à Gratuit.
                    </span>
                    <button
                      type="button"
                      className={dangerButton}
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(c.id)}
                    >
                      Confirmer la révocation
                    </button>
                    <button
                      type="button"
                      className={button}
                      onClick={() => setConfirming(null)}
                    >
                      Annuler
                    </button>
                  </>
                ) : (
                  <span className="flex gap-2 sm:ml-auto">
                    {c.state === "used" && (
                      <button
                        type="button"
                        className={button}
                        onClick={() => {
                          setEditing(c.id);
                          setEditLasts("sans fin");
                          setEditDate("");
                        }}
                      >
                        Modifier la durée
                      </button>
                    )}
                    {(c.state === "free" || c.state === "used") && (
                      <button
                        type="button"
                        className={button}
                        onClick={() => setConfirming(c.id)}
                      >
                        Révoquer
                      </button>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
