import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { client } from "./api.ts";
import { ImportedFrom } from "./IssueImport.tsx";
import {
  fetchSchedule,
  RunNowButton,
  writingSentence,
} from "./ProjectRoutine.tsx";
import { fetchProjects } from "./Projects.tsx";
import { atLeast } from "./roles.ts";
import { SafeMarkdown } from "./SafeMarkdown.tsx";
import { Breadcrumb, StateSentence, useHome } from "./Shell.tsx";
import { TicketStoryPanel } from "./StoryCardPanel.tsx";
import { TagField } from "./TagField.tsx";
import { TicketAttachments } from "./TicketAttachments.tsx";
import {
  decisionError,
  fetchTicket,
  fetchTickets,
  isPlainClick,
  PRIORITIES,
  STEPS,
  STORY_STATUSES,
  ticketError,
  withPending,
} from "./tickets.ts";
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
  primaryButton,
  sectionLabel,
} from "./ui.ts";

type Loaded = Exclude<
  Awaited<ReturnType<typeof fetchTicket>>,
  null | "not_found"
>;

const inlineLink = `underline ${focusRing}`;

/** The second line of a story row: what Claude does, or its criteria and what it waits for; the run and the stories it depends on are links (decision 084 C). */
function StoryDetail({ story }: { story: Loaded["stories"][number] }) {
  const criteria = `${story.criteriaCount} ${story.criteriaCount === 1 ? "critère" : "critères"}`;
  return (
    <>
      {story.status === "in_progress" && story.runId != null ? (
        <>
          Claude développe ·{" "}
          <Link to={`/runs/${story.runId}`} className={inlineLink}>
            Run {story.runId}
          </Link>
        </>
      ) : (
        criteria
      )}
      {story.dependsOn.length > 0 && " · dépend de l'"}
      {story.dependsOn.map((d, i) => (
        <span key={d}>
          {i > 0 && ", "}
          <Link to={`/us/${d}`} className={inlineLink}>
            US {d}
          </Link>
        </span>
      ))}
    </>
  );
}

/** The rest of the state sentence: what Claude wrote, and what waits for the user. */
function storiesSentence(ticket: Loaded["ticket"], stories: Loaded["stories"]) {
  if (ticket.abandonedAt) return "Ce ticket est abandonné.";
  if (stories.length === 0) return "Claude n'a pas encore écrit de user story.";
  const waiting = stories.filter((s) => s.status === "to_validate").length;
  return `${stories.length} user ${stories.length === 1 ? "story écrite" : "stories écrites"} par Claude${waiting > 0 ? ` · ${waiting} ${waiting === 1 ? "attend" : "attendent"} ta validation` : ""}.`;
}

function TicketView({
  ticket,
  stories,
  mayWrite,
  mayRun,
}: Loaded & { mayWrite: boolean; mayRun: boolean }) {
  const fullName = useHome().data?.projects.find(
    (p) => p.id === ticket.projectId,
  )?.name;
  const projectName = fullName?.split("/").pop();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // The story read in the right panel before it is validated (decision 084 A).
  const [openStory, setOpenStory] = useState<number | null>(null);
  const schedule = useQuery({
    queryKey: ["routine-schedule", String(ticket.projectId)],
    queryFn: () => fetchSchedule(String(ticket.projectId)),
    enabled: mayWrite && stories.length === 0,
  });
  // The tags already used in the project, offered when the ticket is modified.
  const used = useQuery({
    queryKey: ["tickets", String(ticket.projectId)],
    queryFn: () => fetchTickets(String(ticket.projectId)),
  });
  const suggestions = [
    ...new Set((used.data ?? []).flatMap((t) => t.tags ?? [])),
  ];
  // One thing at a time: reading, editing or confirming a deletion or an abandon (decision 003, rule 4).
  // « Modifier » of the panel of the Tickets tab leads here with ?modifier=1 (decision 055 G).
  const [params, setParams] = useSearchParams();
  const [mode, setMode] = useState<"view" | "edit" | "delete" | "abandon">(
    params.get("modifier") === "1" && mayWrite && !ticket.abandonedAt
      ? "edit"
      : "view",
  );
  const [title, setTitle] = useState(ticket.title);
  const [descriptionMd, setDescriptionMd] = useState(ticket.descriptionMd);
  const [priority, setPriority] = useState<keyof typeof PRIORITIES>(
    ticket.priority as keyof typeof PRIORITIES,
  );
  const [tags, setTags] = useState(ticket.tags ?? []);
  const [tagText, setTagText] = useState("");
  const id = String(ticket.id);
  const unfinished = stories.filter(
    (s) => s.status !== "done" && s.status !== "abandoned",
  ).length;
  // The form or the confirmation is gone and so is the button that opened it: the focus goes back to a new one, not to <body>.
  const modifier = useRef<HTMLButtonElement>(null);
  const supprimer = useRef<HTMLButtonElement>(null);
  const abandonner = useRef<HTMLButtonElement>(null);
  // The title stands in when every button is gone, after the abandon.
  const heading = useRef<HTMLHeadingElement>(null);
  const focusAfter = useRef<"edit" | "delete" | "abandon" | "heading" | null>(
    null,
  );
  useEffect(() => {
    if (mode !== "view" || !focusAfter.current) return;
    const targets = {
      edit: modifier,
      delete: supprimer,
      abandon: abandonner,
      heading,
    };
    targets[focusAfter.current].current?.focus();
    focusAfter.current = null;
  }, [mode]);

  const save = useMutation({
    meta: { done: "Ticket enregistré." },
    mutationFn: async () => {
      const sentTags = withPending(tags, tagText);
      const res = await client.api.tickets[":id"].$patch({
        param: { id },
        json: { title, descriptionMd, priority, tags: sentTags },
      });
      if (!res.ok) throw await ticketError(res, sentTags.length > 0);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ticket", id] }),
        queryClient.invalidateQueries({
          queryKey: ["tickets", String(ticket.projectId)],
        }),
        queryClient.invalidateQueries({
          queryKey: ["stories", String(ticket.projectId)],
        }),
      ]);
      focusAfter.current = "edit";
      setMode("view");
      // The form is closed: the address no longer asks for it.
      if (params.has("modifier"))
        setParams(
          (current) => {
            current.delete("modifier");
            return current;
          },
          { replace: true },
        );
    },
  });
  const validate = useMutation({
    meta: { done: "User story validée." },
    mutationFn: async (storyId: number) => {
      const res = await client.api.stories[":id"].validate.$post({
        param: { id: String(storyId) },
      });
      if (!res.ok) throw await decisionError(res);
    },
    // Also after a refusal (wrong_status): show the real state of the ticket.
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ticket", id] }),
        queryClient.invalidateQueries({ queryKey: ["story"] }),
        queryClient.invalidateQueries({
          queryKey: ["tickets", String(ticket.projectId)],
        }),
        queryClient.invalidateQueries({
          queryKey: ["stories", String(ticket.projectId)],
        }),
      ]),
  });
  const remove = useMutation({
    meta: { done: "Ticket supprimé." },
    mutationFn: async () => {
      const res = await client.api.tickets[":id"].$delete({ param: { id } });
      if (!res.ok) throw await ticketError(res);
    },
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: ["ticket", id] });
      await queryClient.invalidateQueries({
        queryKey: ["tickets", String(ticket.projectId)],
      });
      navigate(`/projets/${ticket.projectId}/tickets`);
    },
    // Refused because Claude wrote stories meanwhile: show them, and hide « Supprimer ».
    onError: () => queryClient.invalidateQueries({ queryKey: ["ticket", id] }),
  });
  const abandon = useMutation({
    meta: { done: "Ticket abandonné." },
    mutationFn: async () => {
      const res = await client.api.tickets[":id"].abandon.$post({
        param: { id },
      });
      if (!res.ok) throw await decisionError(res);
    },
    onSuccess: async () => {
      // Its unfinished stories are abandoned with it.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ticket", id] }),
        queryClient.invalidateQueries({ queryKey: ["story"] }),
        queryClient.invalidateQueries({
          queryKey: ["tickets", String(ticket.projectId)],
        }),
        queryClient.invalidateQueries({
          queryKey: ["stories", String(ticket.projectId)],
        }),
      ]);
    },
    // Abandoned meanwhile (another tab): show it.
    onError: () => queryClient.invalidateQueries({ queryKey: ["ticket", id] }),
  });
  // The confirmation closes together with the buttons it leaves, once the page holds the abandoned ticket: not before, or the old buttons would show for a moment.
  useEffect(() => {
    if (!ticket.abandonedAt || mode !== "abandon") return;
    focusAfter.current = "heading";
    setMode("view");
  }, [ticket.abandonedAt, mode]);
  // A previous error does not follow into the next form or confirmation.
  const open = (next: "edit" | "delete" | "abandon") => {
    save.reset();
    remove.reset();
    abandon.reset();
    setMode(next);
  };
  const cancel = () => {
    if (mode !== "view") focusAfter.current = mode;
    setMode("view");
    save.reset();
    remove.reset();
    abandon.reset();
  };

  return (
    <>
      <Breadcrumb
        trail={[
          { label: "Projets", to: "/projets" },
          {
            label: projectName ?? "Projet",
            to: `/projets/${ticket.projectId}`,
          },
          { label: "Tickets", to: `/projets/${ticket.projectId}/tickets` },
        ]}
      />
      {mode === "edit" ? (
        <form
          className="px-[26px] pt-[26px]"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <label className="block font-semibold">
            Titre
            <input
              // The Modifier button is gone: keep the keyboard focus in the form.
              // biome-ignore lint/a11y/noAutofocus: focus moves with the form the user just asked for
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className={field}
            />
          </label>
          <label className="mt-3 block font-semibold">
            Description (markdown)
            <textarea
              value={descriptionMd}
              onChange={(event) => setDescriptionMd(event.target.value)}
              rows={10}
              className={field}
            />
          </label>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <select
              aria-label="Priorité"
              value={priority}
              onChange={(event) =>
                setPriority(event.target.value as keyof typeof PRIORITIES)
              }
              className={`rounded-[10px] border border-border-strong bg-sunken px-2 py-1 ${focusRing}`}
            >
              {Object.entries(PRIORITIES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <TagField
              tags={tags}
              onChange={setTags}
              text={tagText}
              onText={setTagText}
              suggestions={suggestions}
            />
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="submit"
              disabled={save.isPending}
              aria-busy={save.isPending}
              className={primaryButton}
            >
              Enregistrer
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={save.isPending}
              aria-busy={save.isPending}
              className={button}
            >
              Annuler
            </button>
          </div>
          {save.error && (
            <p role="alert" className={`mt-3 ${alertBox}`}>
              {save.error.message}
            </p>
          )}
        </form>
      ) : (
        <>
          {/* The title stands in for the focus when every button is gone, after the abandon. */}
          <div
            ref={heading}
            tabIndex={-1}
            className={`rounded-md ${focusRing}`}
          >
            <StateSentence
              title={ticket.title}
              rest={storiesSentence(ticket, stories)}
              actions={
                // An abandoned ticket is not modified any more (decision 018 D).
                mode === "view" &&
                mayWrite &&
                !ticket.abandonedAt && (
                  <button
                    ref={modifier}
                    type="button"
                    onClick={() => {
                      setTitle(ticket.title);
                      setDescriptionMd(ticket.descriptionMd);
                      setPriority(ticket.priority as keyof typeof PRIORITIES);
                      setTags(ticket.tags ?? []);
                      setTagText("");
                      open("edit");
                    }}
                    className={button}
                  >
                    Modifier
                  </button>
                )
              }
            />
          </div>
          {fullName && ticket.githubIssueNumber != null && (
            <p className="px-[26px] pt-3">
              <ImportedFrom
                fullName={fullName}
                number={ticket.githubIssueNumber}
              />
            </p>
          )}
          {((ticket.tags ?? []).length > 0 || ticket.priority !== "normal") && (
            <div className="flex flex-wrap gap-2 px-[26px] pt-3">
              {ticket.priority !== "normal" && (
                <span className={badge}>
                  priorité {ticket.priority === "high" ? "haute" : "basse"}
                </span>
              )}
              {(ticket.tags ?? []).map((tag) => (
                <span key={tag} className={badge}>
                  {tag}
                </span>
              ))}
            </div>
          )}
          <div className="grid gap-3.5 px-[26px] pt-[22px] lg:grid-cols-[minmax(0,1fr)_280px]">
            <section className={`${card} p-5`}>
              <h2 className={sectionLabel}>Description</h2>
              <div className="mt-2">
                <SafeMarkdown>{ticket.descriptionMd}</SafeMarkdown>
              </div>
            </section>
            <div className="flex h-fit flex-col gap-3.5">
              <dl
                className={`${card} grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 p-5 text-[13.5px]`}
              >
                <dt className="text-muted-foreground">Étape</dt>
                <dd>{STEPS[ticket.step] ?? ticket.step}</dd>
                <dt className="text-muted-foreground">Créé</dt>
                <dd>
                  {new Date(ticket.createdAt).toLocaleDateString("fr-FR")}
                </dd>
              </dl>
              <TicketAttachments
                ticketId={ticket.id}
                projectId={ticket.projectId}
                readOnly={!mayWrite}
              />
            </div>
          </div>
          {stories.length > 0 && (
            <section className="px-[26px] pt-[22px]">
              <h2 className={`mb-2 ${sectionLabel}`}>
                User stories{" "}
                <span className="font-medium tracking-normal text-dim normal-case">
                  dans l'ordre où Claude les a écrites
                </span>
              </h2>
              {!ticket.storiesWrittenAt && (
                <p className="mb-2 text-muted-foreground">
                  Claude n'a pas fini d'écrire les user stories de ce ticket.
                </p>
              )}
              <ol className={listCard}>
                {stories.map((story) => (
                  <li
                    key={story.id}
                    className="grid min-h-[50px] grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-x-2 px-4 py-2"
                  >
                    <span aria-hidden="true" className="text-dim">
                      {story.status === "in_progress"
                        ? "●"
                        : story.status === "done"
                          ? "✓"
                          : "○"}
                    </span>
                    <span className="min-w-0">
                      <Link
                        to={`/us/${story.id}`}
                        onClick={(event) => {
                          if (!isPlainClick(event)) return;
                          event.preventDefault();
                          setOpenStory(story.id);
                        }}
                        className={`block font-semibold ${focusRing}`}
                      >
                        US {story.id} · {story.iWant}
                      </Link>
                      <span className="block text-[12.5px] text-muted-foreground">
                        <StoryDetail story={story} />
                      </span>
                    </span>
                    {story.status === "to_validate" && mayWrite ? (
                      <button
                        type="button"
                        disabled={validate.isPending}
                        aria-busy={validate.isPending}
                        onClick={() => validate.mutate(story.id)}
                        className={button}
                      >
                        Valider
                      </button>
                    ) : (
                      <span className={badge}>
                        {STORY_STATUSES[story.status] ?? story.status}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
              {validate.error && (
                <p role="alert" className={`mt-3 ${alertBox}`}>
                  {validate.error.message}
                </p>
              )}
            </section>
          )}
          {mayRun && stories.length === 0 && !ticket.abandonedAt && (
            <div className="px-[26px] pt-3">
              {writingSentence(schedule.data) && (
                <p className="mb-2 text-muted-foreground">
                  {writingSentence(schedule.data)}
                </p>
              )}
              <RunNowButton
                projectId={String(ticket.projectId)}
                onlyConnected
              />
            </div>
          )}
          {openStory !== null && (
            <TicketStoryPanel
              stories={stories}
              openId={openStory}
              onOpen={setOpenStory}
              back={{ label: "Fermer", onClick: () => setOpenStory(null) }}
            />
          )}
          {mode === "abandon" && (
            <p id="abandon-ticket-warning" className="px-[26px] pt-6">
              Abandonner ce ticket ?{" "}
              {unfinished > 0 &&
                `${unfinished} user ${unfinished === 1 ? "story non terminée sera abandonnée" : "stories non terminées seront abandonnées"} avec lui. `}
              Un ticket abandonné ne se rouvre pas.
            </p>
          )}
          <div className="flex gap-2 px-[26px] pt-6">
            {mode === "view" && (
              <>
                {/* A ticket with stories is never deleted (decision 017 J). */}
                {mayWrite && stories.length === 0 && (
                  <button
                    ref={supprimer}
                    type="button"
                    onClick={() => open("delete")}
                    className={button}
                  >
                    Supprimer
                  </button>
                )}
                {mayWrite && !ticket.abandonedAt && (
                  <button
                    ref={abandonner}
                    type="button"
                    onClick={() => open("abandon")}
                    className={ghostButton}
                  >
                    Abandonner le ticket
                  </button>
                )}
              </>
            )}
            {(mode === "delete" || mode === "abandon") && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    mode === "delete" ? remove.mutate() : abandon.mutate()
                  }
                  disabled={remove.isPending || abandon.isPending}
                  aria-busy={remove.isPending || abandon.isPending}
                  className={dangerButton}
                >
                  {mode === "delete"
                    ? "Confirmer la suppression"
                    : "Confirmer l'abandon"}
                </button>
                <button
                  // A key of its own: without it React would reuse the Supprimer button and never mount this one, so autoFocus would not run.
                  key="cancel-delete"
                  type="button"
                  // A screen reader hears what is lost with the focused choice.
                  aria-describedby={
                    mode === "abandon" ? "abandon-ticket-warning" : undefined
                  }
                  // The button that asked is gone: keep the keyboard focus on the safe choice.
                  // biome-ignore lint/a11y/noAutofocus: focus moves with the confirmation the user just asked for
                  autoFocus
                  onClick={cancel}
                  className={button}
                >
                  Annuler
                </button>
              </>
            )}
          </div>
          {abandon.error && (
            <p role="alert" className={`mx-[26px] mt-3 ${alertBox}`}>
              {abandon.error.message}
            </p>
          )}
          {remove.error && (
            <p role="alert" className={`mx-[26px] mt-3 ${alertBox}`}>
              {remove.error.message}
            </p>
          )}
        </>
      )}
    </>
  );
}

export function TicketPage() {
  const { id = "" } = useParams();
  const ticket = useQuery({
    queryKey: ["ticket", id],
    queryFn: () => fetchTicket(id),
  });
  // Read with the ticket, so that the card never offers « + Ajouter » on an archived project for a moment.
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: fetchProjects,
    retry: false,
  });
  const loaded = ticket.data;
  // Decisions 076 G and 084 D: no gesture offered that the role or the archive would refuse.
  const mayWrite = (projectId: number) => {
    const project = projects.data?.find((p) => p.id === projectId);
    return !project?.archived && atLeast(project?.role, "can_validate");
  };
  // Running the routine now is for the owner (the route asks for it).
  const mayRun = (projectId: number) =>
    mayWrite(projectId) &&
    atLeast(projects.data?.find((p) => p.id === projectId)?.role, "owner");

  return (
    <main className="pb-6">
      <div aria-live="polite">
        {(ticket.isPending || (ticket.data && projects.isPending)) && (
          <p className="loading px-[26px] pt-[26px] text-muted-foreground">
            Chargement…
          </p>
        )}
        {ticket.isError && (
          <div role="alert" className={`mx-[26px] mt-[26px] ${alertBox}`}>
            <p>Impossible de lire le ticket.</p>
            <button
              type="button"
              onClick={() => ticket.refetch()}
              className={`mt-3 ${button}`}
            >
              Réessayer
            </button>
          </div>
        )}
        {ticket.data === null && (
          <div className="px-[26px] pt-[26px]">
            <a href="/api/auth/login" className={primaryButton}>
              Se connecter avec GitHub
            </a>
          </div>
        )}
        {ticket.data === "not_found" && (
          <>
            <Breadcrumb trail={[{ label: "Projets", to: "/projets" }]} />
            <StateSentence
              title="Ticket introuvable."
              rest="Il n'existe pas ou tu n'y as pas accès."
            />
          </>
        )}
        {/* Keyed by id: another ticket starts from a clean state, a save keeps the node (and the focus). */}
        {loaded && loaded !== "not_found" && !projects.isPending && (
          <TicketView
            key={loaded.ticket.id}
            {...loaded}
            mayWrite={mayWrite(loaded.ticket.projectId)}
            mayRun={mayRun(loaded.ticket.projectId)}
          />
        )}
      </div>
    </main>
  );
}
