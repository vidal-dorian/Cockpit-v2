// biome-ignore-all lint/suspicious/noThenProperty: "then" is the Then field of a Given/When/Then criterion (decision 017)
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ComponentProps,
  Fragment,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link, useSearchParams } from "react-router";
import { client } from "./api.ts";
import { DevelopWindow } from "./DevelopWindow.tsx";
import { ACTIONS, RESULTS } from "./Journal.tsx";
import { atLeast } from "./roles.ts";
import { Panel } from "./Shell.tsx";
import { useShortcut } from "./Shortcuts.tsx";
import { decisionError, STORY_STATUSES } from "./tickets.ts";
import { toast } from "./toast.tsx";
import {
  alertBox,
  badge,
  button,
  card,
  dangerButton,
  field,
  focusRing,
  ghostButton,
  listCard,
  panelButton,
  panelPrimaryButton,
  sectionLabel,
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
  kind?: string;
  criteria: Criterion[];
  branch: string | null;
  dependsOn: { id: number; iWant: string; status: string }[];
  prNumber?: number | null;
};

// Keys of the criteria of the form: a removed row must not hand its fields to the next one.
let nextKey = 0;
const withKey = (c: Criterion) => ({ ...c, key: nextKey++ });

const GLYPHS: Record<string, string> = { to_validate: "✓", in_review: "⇄" };
const HEADLINES: Record<string, string> = {
  to_validate: "Cette US est-elle bonne pour que Claude la développe ?",
  to_rewrite: "Claude réécrit cette US avec ton commentaire.",
  ready: "Claude peut la développer.",
  in_progress: "Claude la développe.",
  in_review: "Claude a ouvert une pull request.",
  done: "Cette US est terminée.",
};

/** The story with its ticket and project, "not_found" when the user cannot reach it, or null when the server answers 401. */
export async function fetchStory(id: string) {
  const res = await client.api.stories[":id"].$get({ param: { id } });
  if (res.status === 401) return null;
  if (res.status === 404) return "not_found" as const;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** The decisions of the user on a story (decision 018 J), in the right panel: which buttons depend on the status, one form or confirmation at a time. */
export function StoryDecisions({
  story,
  project,
  archived,
  statusRef,
  toDecide = [],
  counter,
  onDone,
  children,
}: {
  story: DecidedStory;
  project: {
    id: number;
    fullName: string;
    defaultBranch?: string;
    role?: string;
  };
  archived: boolean;
  /** The status of the story on the page (tabIndex -1): where the focus goes when the button that was used is gone. */
  statusRef: RefObject<HTMLElement | null>;
  /** The rules of a takeover story that are still to decide (decision 047 K): the story cannot be validated before. */
  toDecide?: { id: number; summary: string }[];
  /** « i sur n » of the column the story is in, with Précédent and Suivant (decision 085 B). */
  counter?: ComponentProps<typeof Panel>["counter"];
  /** Called once Valider, Renvoyer or Abandonner succeeded: the queue opens the next story (decision 085 B). */
  onDone?: (decidedId: number) => void;
  /** What the panel shows under its headline (the pull request of a story in review). */
  children?: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const id = String(story.id);
  const [mode, setMode] = useState<
    "edit" | "sendBack" | "abandon" | "develop" | null
  >(null);
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

  // The panel stays mounted from one story of the queue to the next (decision 085 B): its state starts over with each story.
  const [shownId, setShownId] = useState(story.id);
  if (shownId !== story.id) {
    setShownId(story.id);
    setMode(null);
    setComment("");
    setForm(draftOf(story));
  }

  const run = useMutation({
    mutationFn: async (send: () => Promise<Response>) => {
      const res = await send();
      if (!res.ok) throw await decisionError(res);
      // The story decided: the panel may show another one when the answer comes back.
      return story.id;
    },
    onSuccess: async (decidedId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["story"] }),
        queryClient.invalidateQueries({
          queryKey: ["ticket", String(story.ticketId)],
        }),
        queryClient.invalidateQueries({
          queryKey: ["tickets", String(project.id)],
        }),
        queryClient.invalidateQueries({
          queryKey: ["stories", String(project.id)],
        }),
        queryClient.invalidateQueries({ queryKey: ["story-history", id] }),
      ]);
      // Saving keeps the status, so Modifier stays; any other decision changes it and removes the button that was used.
      setFocusAfter(mode === "edit" ? "edit" : "status");
      setMode(null);
      // Saving stays on the story; the three decisions move on.
      if (mode !== "edit") onDone?.(decidedId);
    },
    // Refused because the story changed meanwhile (wrong_status): show its real state.
    onError: () => queryClient.invalidateQueries({ queryKey: ["story"] }),
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new story clears the error of the last decision
  useEffect(() => run.reset(), [story.id]);
  const close = () => {
    setFocusAfter(mode);
    setMode(null);
    run.reset();
  };
  const open = (next: "edit" | "sendBack" | "abandon" | "develop") => {
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
  // Claude cannot rewrite a takeover story and its narrative is not edited: only its rules are corrected, on the takeover screen.
  const takeover = story.kind === "takeover";
  // The buttons of a gesture the role does not allow are not shown (decision 076 G).
  const mayValidate = atLeast(project.role, "can_validate");
  const canDevelop =
    ["ready", "in_review"].includes(status) &&
    !archived &&
    atLeast(project.role, "can_launch");
  // « Relancer » of a run asks for the window with ?developper (decision 085 D); the parameter is spent once it opened.
  const [params, setParams] = useSearchParams();
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the parameter and the right to develop decide
  useEffect(() => {
    if (!params.has("developper") || !canDevelop) return;
    params.delete("developper");
    setParams(params, { replace: true });
    open("develop");
  }, [params, canDevelop]);
  const prLink =
    status === "in_review" && story.prNumber != null
      ? `https://github.com/${project.fullName}/pull/${story.prNumber}`
      : null;

  const canValidate = !archived && !run.isPending && toDecide.length === 0;
  const validate = () => {
    run.reset();
    run.mutate(
      () => client.api.stories[":id"].validate.$post({ param: { id } }),
      { onSuccess: () => toast("User story validée.") },
    );
  };
  // Only where the button is, and works (decision 073 E).
  useShortcut(
    "v",
    mode === null &&
      mayValidate &&
      (status === "to_validate" || status === "to_rewrite") &&
      canValidate
      ? validate
      : undefined,
  );

  if (mode === "develop")
    return <DevelopWindow story={story} project={project} onClose={close} />;
  if (status === "abandoned") return null;

  return (
    <Panel
      label="Décision sur la user story"
      counter={counter}
      badge={
        <span className={badge}>
          {GLYPHS[status]}{" "}
          <span className="inline-block first-letter:uppercase">
            {STORY_STATUSES[status] ?? status}
          </span>
        </span>
      }
      footer={
        mode === null && (
          <>
            {mayValidate &&
              (status === "to_validate" || status === "to_rewrite") && (
                <button
                  type="button"
                  disabled={!canValidate}
                  aria-busy={run.isPending}
                  aria-keyshortcuts="V"
                  aria-describedby={
                    toDecide.length > 0 ? "to-decide" : undefined
                  }
                  onClick={validate}
                  className={panelPrimaryButton}
                >
                  Valider
                </button>
              )}
            {prLink && (
              <a href={prLink} className={panelPrimaryButton}>
                Relire sur GitHub ↗
              </a>
            )}
            {canDevelop && (
              <button
                ref={opener("develop")}
                type="button"
                onClick={() => open("develop")}
                className={prLink ? panelButton : panelPrimaryButton}
              >
                Développer avec Claude
              </button>
            )}
            <div className="grid grid-flow-col auto-cols-fr gap-2.5">
              {mayValidate &&
                ["to_validate", "to_rewrite", "ready"].includes(status) &&
                !takeover && (
                  <button
                    ref={opener("edit")}
                    type="button"
                    disabled={archived}
                    onClick={() => open("edit")}
                    className={panelButton}
                  >
                    Modifier
                  </button>
                )}
              {mayValidate && status === "to_validate" && !takeover && (
                <button
                  ref={opener("sendBack")}
                  type="button"
                  disabled={archived}
                  onClick={() => open("sendBack")}
                  className={panelButton}
                >
                  Renvoyer à Claude
                </button>
              )}
            </div>
            {mayValidate && (
              <button
                ref={opener("abandon")}
                type="button"
                disabled={archived}
                onClick={() => open("abandon")}
                className={ghostButton}
              >
                Abandonner
              </button>
            )}
          </>
        )
      }
    >
      {mode === null && (
        <>
          {/* In review, the title of the pull request (in the children) is the headline. */}
          {!prLink && (
            <h2 className="text-lg leading-[1.35] font-semibold">
              {HEADLINES[status]}
            </h2>
          )}
          {toDecide.length > 0 &&
            ["to_validate", "to_rewrite"].includes(status) && (
              <p id="to-decide" className="text-muted-foreground">
                {toDecide.length === 1
                  ? "1 règle à trancher"
                  : `${toDecide.length} règles à trancher`}{" "}
                :{" "}
                {toDecide.map((rule, index) => (
                  <Fragment key={rule.id}>
                    {index > 0 && " · "}
                    <Link
                      to={`/projets/${project.id}/conception/regles?regle=${rule.id}`}
                      className={`underline ${focusRing}`}
                    >
                      {rule.summary}
                    </Link>
                  </Fragment>
                ))}
              </p>
            )}
          {status === "to_validate" && (
            <>
              <p className={sectionLabel}>Après validation</p>
              <p className="text-[13px] leading-normal text-muted-foreground">
                L'US est publiée sur GitHub, et Claude peut la développer.
              </p>
            </>
          )}
          {takeover &&
            ["to_validate", "to_rewrite", "ready"].includes(status) && (
              <p className="text-muted-foreground">
                Les règles se corrigent dans l'onglet{" "}
                <Link
                  to={`/projets/${project.id}/conception/regles`}
                  className={`underline ${focusRing}`}
                >
                  Règles
                </Link>
                .
              </p>
            )}
          {children}
        </>
      )}
      {mode === "sendBack" && (
        <form
          className="flex flex-1 flex-col gap-3.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (blank) return;
            run.mutate(
              () =>
                client.api.stories[":id"]["send-back"].$post({
                  param: { id },
                  json: { comment },
                }),
              { onSuccess: () => toast("Renvoyée à Claude.") },
            );
          }}
        >
          <h2 className="text-lg leading-[1.35] font-semibold">
            Qu'est-ce que Claude doit changer ?
          </h2>
          <p className="text-[13px] text-muted-foreground">
            Il réécrira l'US avec ton commentaire, puis elle reviendra ici.
          </p>
          <label className="block">
            <span className="sr-only">Commentaire pour Claude</span>
            <textarea
              // The Renvoyer button is gone: keep the keyboard focus in the form.
              // biome-ignore lint/a11y/noAutofocus: focus moves with the form the user just asked for
              autoFocus
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              rows={6}
              className={`${field} mt-0 leading-relaxed`}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Obligatoire · {comment.length} caractère{comment.length > 1 && "s"}
          </p>
          <div className="mt-auto flex flex-col gap-2">
            <button
              type="submit"
              disabled={blank || run.isPending}
              aria-busy={run.isPending}
              className={panelPrimaryButton}
            >
              Renvoyer à Claude
            </button>
            <button type="button" onClick={close} className={ghostButton}>
              Annuler
            </button>
          </div>
        </form>
      )}
      {mode === "abandon" && (
        <>
          <h2 className="text-lg leading-[1.35] font-semibold">
            Abandonner cette user story ?
          </h2>
          <p id="abandon-story-warning">
            Abandonner cette user story ? C'est définitif : elle ne se rouvre
            pas.
          </p>
          <div className="mt-auto flex flex-col gap-2">
            <button
              type="button"
              disabled={run.isPending}
              aria-busy={run.isPending}
              onClick={() =>
                run.mutate(
                  () =>
                    client.api.stories[":id"].abandon.$post({ param: { id } }),
                  { onSuccess: () => toast("User story abandonnée.") },
                )
              }
              className={dangerButton}
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
          className="flex flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            run.mutate(
              () =>
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
              { onSuccess: () => toast("User story enregistrée.") },
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
          <h3 className={`mt-4 ${sectionLabel}`}>Critères</h3>
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
          <div className="mt-auto flex flex-col gap-2 pt-4">
            <button
              type="submit"
              disabled={run.isPending}
              aria-busy={run.isPending}
              className={panelPrimaryButton}
            >
              Enregistrer
            </button>
            <button type="button" onClick={close} className={ghostButton}>
              Annuler
            </button>
          </div>
        </form>
      )}
      {run.error && (
        <p role="alert" className={alertBox}>
          {run.error.message}
        </p>
      )}
    </Panel>
  );
}

const draftOf = (story: DecidedStory) => ({
  asA: story.asA,
  iWant: story.iWant,
  soThat: story.soThat,
  notesMd: story.notesMd,
  criteria: story.criteria.map(withKey),
});

export async function fetchStoryHistory(id: number) {
  const res = await client.api.stories[":id"].history.$get({
    param: { id: String(id) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).entries;
}

/** The latest successful validation of a story in its history: who validated it and when (null when it was never validated). */
export function useStoryValidation(id: number) {
  return useQuery({
    queryKey: ["story-history", String(id), "validation"],
    queryFn: async () =>
      (await fetchStoryHistory(id)).find(
        (e) => e.action === "validate_story" && e.result === "ok",
      ) ?? null,
  });
}

/** The entries of the user about this story, read when the section is opened (decision 018 I). */
export function StoryHistory({ id }: { id: number }) {
  const [opened, setOpened] = useState(false);
  const entries = useQuery({
    queryKey: ["story-history", String(id)],
    enabled: opened,
    queryFn: () => fetchStoryHistory(id),
  });

  return (
    <details
      className="px-[26px] pt-[22px]"
      onToggle={(event) => setOpened(event.currentTarget.open)}
    >
      <summary className={`${sectionLabel} ${focusRing}`}>Historique</summary>
      {entries.isPending && opened && (
        <p className="loading mt-2 text-muted-foreground">Chargement…</p>
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
        <ul className={`mt-2 ${listCard}`}>
          {entries.data.map((entry) => (
            <li
              key={entry.id}
              className="flex min-h-[50px] flex-wrap items-center gap-x-3 px-4 py-2"
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
                className="text-[12.5px] text-muted-foreground sm:ml-auto"
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
