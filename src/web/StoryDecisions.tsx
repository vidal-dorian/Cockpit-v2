// biome-ignore-all lint/suspicious/noThenProperty: "then" is the Then field of a Given/When/Then criterion (decision 017)
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type RefObject, useEffect, useRef, useState } from "react";
import { client } from "./api.ts";
import { ACTIONS, RESULTS } from "./Journal.tsx";
import { decisionError } from "./tickets.ts";
import {
  alertBox,
  button,
  card,
  field,
  focusRing,
  primaryButton,
} from "./ui.ts";

type Criterion = { given: string; when: string; then: string };
type DecidedStory = {
  id: number;
  ticketId: number;
  asA: string;
  iWant: string;
  soThat: string;
  notesMd: string;
  status: string;
  criteria: Criterion[];
};

const danger = `min-h-10 rounded-xl bg-destructive px-4 font-semibold text-card disabled:opacity-50 ${focusRing}`;

// Keys of the criteria of the form: a removed row must not hand its fields to the next one.
let nextKey = 0;
const withKey = (c: Criterion) => ({ ...c, key: nextKey++ });

/** The decisions of the user on a story (decision 018 J): which buttons depend on the status, one form or confirmation at a time. */
export function StoryDecisions({
  story,
  projectId,
  archived,
  statusRef,
}: {
  story: DecidedStory;
  projectId: number;
  archived: boolean;
  /** The status of the story on the page (tabIndex -1): where the focus goes when the button that was used is gone. */
  statusRef: RefObject<HTMLElement | null>;
}) {
  const queryClient = useQueryClient();
  const id = String(story.id);
  const [mode, setMode] = useState<"edit" | "sendBack" | "abandon" | null>(
    null,
  );
  const [comment, setComment] = useState("");
  const [form, setForm] = useState(() => draftOf(story));
  // The form, the confirmation or the button used is gone: the focus goes back to a button that exists, or to the status, not to <body>.
  const openers = useRef<Record<string, HTMLButtonElement | null>>({});
  // State, not a ref: Valider leaves `mode` at null, so only a new value runs the effect.
  const [focusAfter, setFocusAfter] = useState<string | null>(null);
  useEffect(() => {
    if (mode !== null || !focusAfter) return;
    (focusAfter === "status"
      ? statusRef.current
      : openers.current[focusAfter]
    )?.focus();
    setFocusAfter(null);
  }, [mode, focusAfter, statusRef]);

  const run = useMutation({
    mutationFn: async (send: () => Promise<Response>) => {
      const res = await send();
      if (!res.ok) throw await decisionError(res);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["story"] }),
        queryClient.invalidateQueries({
          queryKey: ["ticket", String(story.ticketId)],
        }),
        queryClient.invalidateQueries({
          queryKey: ["tickets", String(projectId)],
        }),
        queryClient.invalidateQueries({
          queryKey: ["stories", String(projectId)],
        }),
        queryClient.invalidateQueries({ queryKey: ["story-history", id] }),
      ]);
      // Saving keeps the status, so Modifier stays; any other decision changes it and removes the button that was used.
      setFocusAfter(mode === "edit" ? "edit" : "status");
      setMode(null);
    },
    // Refused because the story changed meanwhile (wrong_status): show its real state.
    onError: () => queryClient.invalidateQueries({ queryKey: ["story"] }),
  });
  const close = () => {
    setFocusAfter(mode);
    setMode(null);
    run.reset();
  };
  const open = (next: "edit" | "sendBack" | "abandon") => {
    run.reset();
    setComment("");
    setForm(draftOf(story));
    setMode(next);
  };
  const opener = (name: string) => (element: HTMLButtonElement | null) => {
    openers.current[name] = element;
  };
  const { status } = story;
  const blank = comment.trim() === "";

  return (
    <div className="mt-4">
      {mode === null && (
        <div className="flex flex-wrap gap-2">
          {(status === "to_validate" || status === "to_rewrite") && (
            <button
              type="button"
              disabled={archived || run.isPending}
              onClick={() => {
                run.reset();
                run.mutate(() =>
                  client.api.stories[":id"].validate.$post({ param: { id } }),
                );
              }}
              className={primaryButton}
            >
              Valider
            </button>
          )}
          {["to_validate", "to_rewrite", "ready"].includes(status) && (
            <button
              ref={opener("edit")}
              type="button"
              disabled={archived}
              onClick={() => open("edit")}
              className={button}
            >
              Modifier
            </button>
          )}
          {status === "to_validate" && (
            <button
              ref={opener("sendBack")}
              type="button"
              disabled={archived}
              onClick={() => open("sendBack")}
              className={button}
            >
              Renvoyer
            </button>
          )}
          {status !== "abandoned" && (
            <button
              ref={opener("abandon")}
              type="button"
              disabled={archived}
              onClick={() => open("abandon")}
              className={button}
            >
              Abandonner
            </button>
          )}
        </div>
      )}
      {mode === "sendBack" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (blank) return;
            run.mutate(() =>
              client.api.stories[":id"]["send-back"].$post({
                param: { id },
                json: { comment },
              }),
            );
          }}
        >
          <label className="block font-semibold">
            Commentaire pour Claude
            <textarea
              // The Renvoyer button is gone: keep the keyboard focus in the form.
              // biome-ignore lint/a11y/noAutofocus: focus moves with the form the user just asked for
              autoFocus
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              rows={4}
              className={field}
            />
          </label>
          <div className="mt-3 flex gap-2">
            <button
              type="submit"
              disabled={blank || run.isPending}
              className={primaryButton}
            >
              Confirmer le renvoi
            </button>
            <button type="button" onClick={close} className={button}>
              Annuler
            </button>
          </div>
        </form>
      )}
      {mode === "abandon" && (
        <>
          <p id="abandon-story-warning">
            Abandonner cette user story ? C'est définitif : elle ne se rouvre
            pas.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={run.isPending}
              onClick={() =>
                run.mutate(() =>
                  client.api.stories[":id"].abandon.$post({ param: { id } }),
                )
              }
              className={danger}
            >
              Confirmer l'abandon
            </button>
            <button
              // A key of its own: without it React would reuse the button of the row above and autoFocus would not run.
              key="cancel-abandon"
              type="button"
              aria-describedby="abandon-story-warning"
              // The Abandonner button is gone: keep the keyboard focus on the safe choice.
              // biome-ignore lint/a11y/noAutofocus: focus moves with the confirmation the user just asked for
              autoFocus
              onClick={close}
              className={button}
            >
              Annuler
            </button>
          </div>
        </>
      )}
      {mode === "edit" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            run.mutate(() =>
              client.api.stories[":id"].$patch({
                param: { id },
                json: {
                  asA: form.asA,
                  iWant: form.iWant,
                  soThat: form.soThat,
                  notesMd: form.notesMd,
                  criteria: form.criteria.map(({ given, when, then }) => ({
                    given,
                    when,
                    then,
                  })),
                },
              }),
            );
          }}
        >
          {(
            [
              ["asA", "En tant que"],
              ["iWant", "Je veux"],
              ["soThat", "Afin de"],
            ] as const
          ).map(([name, text], index) => (
            <label key={name} className="mt-3 block font-semibold">
              {text}
              <input
                // The Modifier button is gone: keep the keyboard focus in the form.
                // biome-ignore lint/a11y/noAutofocus: focus moves with the form the user just asked for
                autoFocus={index === 0}
                value={form[name]}
                onChange={(event) =>
                  setForm({ ...form, [name]: event.target.value })
                }
                className={field}
              />
            </label>
          ))}
          <label className="mt-3 block font-semibold">
            Notes (markdown)
            <textarea
              value={form.notesMd}
              onChange={(event) =>
                setForm({ ...form, notesMd: event.target.value })
              }
              rows={5}
              className={field}
            />
          </label>
          <h3 className="mt-4 font-heading font-bold">Critères</h3>
          <ol className="mt-2 grid gap-2">
            {form.criteria.map((criterion, index) => (
              <li key={criterion.key} className={`${card} p-3`}>
                {(
                  [
                    ["given", "Étant donné"],
                    ["when", "Quand"],
                    ["then", "Alors"],
                  ] as const
                ).map(([name, text]) => (
                  <label key={name} className="block font-semibold">
                    {text}
                    <textarea
                      value={criterion[name]}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          criteria: form.criteria.map((c) =>
                            c === criterion
                              ? { ...c, [name]: event.target.value }
                              : c,
                          ),
                        })
                      }
                      rows={2}
                      className={field}
                    />
                  </label>
                ))}
                <button
                  type="button"
                  // A story keeps at least one criterion.
                  disabled={form.criteria.length === 1}
                  onClick={() =>
                    setForm({
                      ...form,
                      criteria: form.criteria.filter((c) => c !== criterion),
                    })
                  }
                  className={`mt-2 ${button}`}
                >
                  Retirer le critère {index + 1}
                </button>
              </li>
            ))}
          </ol>
          <button
            type="button"
            onClick={() =>
              setForm({
                ...form,
                criteria: [
                  ...form.criteria,
                  withKey({ given: "", when: "", then: "" }),
                ],
              })
            }
            className={`mt-2 ${button}`}
          >
            Ajouter un critère
          </button>
          <div className="mt-3 flex gap-2">
            <button
              type="submit"
              disabled={run.isPending}
              className={primaryButton}
            >
              Enregistrer
            </button>
            <button type="button" onClick={close} className={button}>
              Annuler
            </button>
          </div>
        </form>
      )}
      {run.error && (
        <p role="alert" className={`mt-3 ${alertBox}`}>
          {run.error.message}
        </p>
      )}
    </div>
  );
}

const draftOf = (story: DecidedStory) => ({
  asA: story.asA,
  iWant: story.iWant,
  soThat: story.soThat,
  notesMd: story.notesMd,
  criteria: story.criteria.map(withKey),
});

/** The entries of the user about this story, read when the section is opened (decision 018 I). */
export function StoryHistory({ id }: { id: number }) {
  const [opened, setOpened] = useState(false);
  const entries = useQuery({
    queryKey: ["story-history", String(id)],
    enabled: opened,
    queryFn: async () => {
      const res = await client.api.stories[":id"].history.$get({
        param: { id: String(id) },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()).entries;
    },
  });

  return (
    <details
      className="mt-6"
      onToggle={(event) => setOpened(event.currentTarget.open)}
    >
      <summary className={`font-heading text-xl font-bold ${focusRing}`}>
        Historique
      </summary>
      {entries.isPending && opened && (
        <p className="mt-2 text-muted-foreground">Chargement…</p>
      )}
      {entries.isError && (
        <p role="alert" className="mt-2 text-destructive">
          Impossible de lire l'historique.
        </p>
      )}
      {entries.data?.length === 0 && (
        <p className="mt-2 text-muted-foreground">Rien pour l'instant.</p>
      )}
      {entries.data && entries.data.length > 0 && (
        <ul className="mt-2 grid gap-2">
          {entries.data.map((entry) => (
            <li
              key={entry.id}
              className={`flex flex-wrap items-baseline gap-x-3 ${card} p-3`}
            >
              <span className="font-semibold">
                {entry.actor === "claude"
                  ? "Claude"
                  : entry.actor === "system"
                    ? "Cockpit"
                    : entry.actor === "github"
                      ? "GitHub"
                      : "Toi"}
              </span>
              <span>{ACTIONS[entry.action] ?? entry.action}</span>
              <span className="text-muted-foreground">
                {RESULTS[entry.result]?.label ?? entry.result}
              </span>
              <time
                dateTime={entry.at}
                className="text-muted-foreground sm:ml-auto"
              >
                {new Date(entry.at).toLocaleString("fr-FR")}
              </time>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
