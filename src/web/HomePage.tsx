import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { AnswerForm } from "./AnswerForm.tsx";
import { client } from "./api.ts";
import { fetchInstallation } from "./InstallBanner.tsx";
import { fetchHistory, JournalEntry, objectPath } from "./Journal.tsx";
import { NightMorning } from "./NightMorning.tsx";
import { fetchProjects } from "./Projects.tsx";
import { WhyAsked } from "./RunQuestions.tsx";
import { REASONS } from "./RunVerdict.tsx";
import { atLeast } from "./roles.ts";
import {
  Dot,
  fetchNight,
  Panel,
  repoName,
  StateSentence,
  useHome,
} from "./Shell.tsx";
import { useShortcut } from "./Shortcuts.tsx";
import { StoryBody } from "./StoryBody.tsx";
import { fetchStory, StoryDecisions } from "./StoryDecisions.tsx";
import { decisionError } from "./tickets.ts";
import {
  alertBox,
  badge,
  button,
  card,
  focusRing,
  kbd,
  listCard,
  panelButton,
  panelPrimaryButton,
  sectionLabel,
  urgentBadge,
} from "./ui.ts";
import { elapsed } from "./when.ts";

type Item = NonNullable<ReturnType<typeof useHome>["data"]>["forYou"][number];

// The item has no counts: the run page's « 2 critères en échec » becomes a plain sentence.
const REASON_TEXTS: Record<string, string> = {
  ...REASONS,
  criteria_failed: "Des critères sont en échec",
  criteria_not_reported: "Des critères ne sont pas signalés",
};

const CI_WORDS = {
  failure: "La CI échoue",
  pending: "La CI tourne encore",
  success: "La CI est verte",
};

const link = `font-semibold underline ${focusRing}`;
const rowAction = button;
const rowLink = `font-semibold text-muted-foreground hover:text-foreground ${focusRing}`;

const KINDS = {
  answer: {
    glyph: "✦",
    badge: "Question de Claude",
    group: "Questions",
    hint: "",
  },
  validate: {
    glyph: "✓",
    badge: "À valider",
    group: "À valider",
    hint: "Claude ne peut pas les développer avant",
  },
  review: {
    glyph: "⇄",
    badge: "À relire",
    group: "À relire",
    hint: "tes PR sur GitHub",
  },
  relaunch_exhausted: {
    glyph: "✕",
    badge: "Relances épuisées",
    group: "Relances épuisées",
    hint: "la CI échoue encore",
  },
  check: {
    glyph: "!",
    badge: "À vérifier",
    group: "À vérifier",
    hint: "le verdict de Claude",
  },
};

const prUrl = (
  item: Extract<Item, { kind: "review" | "relaunch_exhausted" }>,
) => `https://github.com/${item.project.name}/pull/${item.prNumber}`;

const title = (item: Item) =>
  item.kind === "answer" ? item.question : item.iWant;

/** « Question de Claude · Run 3 · hello »: what the item is, then where. The row of « 2 · Ensuite » drops the kind, its group says it. */
function subLine(item: Item, withKind = true) {
  const project = repoName(item.project.name);
  switch (item.kind) {
    case "answer":
      return `Question de Claude · Run ${item.runId} · ${project}${item.askedAt ? ` · il attend depuis ${elapsed(item.askedAt)}` : ""}`;
    case "validate":
      return withKind
        ? `À valider · ${project}`
        : `${item.criteriaCount} ${plural(item.criteriaCount, "critère", "critères")} · ${project}`;
    case "review": {
      const ci = item.prCiState ? CI_WORDS[item.prCiState] : "Aucune CI";
      return withKind
        ? `À relire · PR #${item.prNumber} · ${ci} · ${project}`
        : `${ci} · ${project}`;
    }
    case "relaunch_exhausted":
      return `Relances épuisées : la CI échoue encore après 3 essais · PR #${item.prNumber} · ${project}`;
    case "check":
      return `Run ${item.runId} · ${project}`;
  }
}

/** The title of a row: « US 43 · … » for a story to validate, « PR #44 · … » for a pull request. */
function rowTitle(item: Item) {
  if (item.kind === "validate") return `US ${item.storyId} · ${item.iWant}`;
  if (item.kind === "review") return `PR #${item.prNumber} · ${item.iWant}`;
  return title(item);
}

const itemKey = (item: Item) =>
  `${item.kind}-${item.kind === "answer" ? item.questionId : item.storyId}`;

function Section({
  label,
  hint,
  action,
  children,
}: {
  label: React.ReactNode;
  hint?: string;
  /** A link on the right of the heading (« Tous les runs »). */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="px-[26px] pt-[22px]">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="flex items-center gap-2">
          {label}
          {hint && (
            <span className="text-[12.5px] font-normal text-muted-foreground">
              · {hint}
            </span>
          )}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The actions of a row of « 2 · Ensuite »: the links of the item, or the panel for a question. */
function RowActions({
  item,
  open,
  validate,
  validating,
  mayValidate,
}: {
  item: Item;
  open: () => void;
  validate: () => void;
  validating: boolean;
  mayValidate: boolean;
}) {
  switch (item.kind) {
    case "answer":
      return (
        <button type="button" onClick={open} className={rowAction}>
          Répondre
        </button>
      );
    case "validate":
      return (
        <>
          {mayValidate && (
            <button
              type="button"
              onClick={validate}
              disabled={validating}
              aria-busy={validating}
              className={rowAction}
            >
              Valider
            </button>
          )}
          <Link to={`/us/${item.storyId}`} className={rowLink}>
            Ouvrir
          </Link>
        </>
      );
    case "review":
      return (
        <>
          <a href={prUrl(item)} className={rowAction}>
            Relire la PR #{item.prNumber}
          </a>
          <Link to={`/us/${item.storyId}`} className={rowLink}>
            Ouvrir
          </Link>
        </>
      );
    case "relaunch_exhausted":
      return (
        <>
          <a href={prUrl(item)} className={rowAction}>
            Voir la PR #{item.prNumber}
          </a>
          <Link to={`/us/${item.storyId}`} className={rowLink}>
            Ouvrir l'US
          </Link>
        </>
      );
    case "check":
      return (
        <Link to={`/runs/${item.runId}`} className={rowAction}>
          Ouvrir le run
        </Link>
      );
  }
}

/** The panel of the item at `index`: what it is, and the way to deal with it. */
type PanelProps = {
  item: Item;
  index: number;
  total: number;
  onMove: (index: number) => void;
  onSent: () => void;
  focusHeading: boolean;
  onFocused: (focusHeading: boolean) => void;
};

function ItemPanel({
  item,
  index,
  total,
  onMove,
  onSent,
  focusHeading,
  onFocused,
}: PanelProps) {
  const kind = KINDS[item.kind];
  const heading = useRef<HTMLHeadingElement>(null);
  // « Répondre » of « 2 · Ensuite » opens the item here: the keyboard follows it.
  useEffect(() => {
    if (!focusHeading) return;
    heading.current?.focus();
    onFocused(false); // once: a later panel must not take the focus
  }, [focusHeading, onFocused]);
  const urgent = index === 0;
  let footer: React.ReactNode;
  if (item.kind === "answer")
    footer = (
      <>
        <button
          type="button"
          disabled={index >= total - 1}
          onClick={() => onMove(index + 1)}
          className={panelButton}
        >
          Plus tard
        </button>
        <p className="text-center text-[13px] text-muted-foreground">
          Claude reste en pause
        </p>
      </>
    );
  else if (item.kind === "validate")
    footer = (
      <Link to={`/us/${item.storyId}`} className={panelPrimaryButton}>
        Ouvrir l'US
      </Link>
    );
  else if (item.kind === "review")
    footer = (
      <>
        <a href={prUrl(item)} className={panelPrimaryButton}>
          Relire la PR #{item.prNumber}
        </a>
        <Link to={`/us/${item.storyId}`} className={panelButton}>
          Ouvrir l'US
        </Link>
      </>
    );
  else if (item.kind === "relaunch_exhausted")
    footer = (
      <>
        <a href={prUrl(item)} className={panelPrimaryButton}>
          Voir la PR #{item.prNumber}
        </a>
        <Link to={`/us/${item.storyId}`} className={panelButton}>
          Ouvrir l'US
        </Link>
      </>
    );
  else
    footer = (
      <Link to={`/runs/${item.runId}`} className={panelPrimaryButton}>
        Ouvrir le run
      </Link>
    );
  return (
    <Panel
      label={kind.badge}
      badge={
        <span className={urgent ? urgentBadge : badge}>
          {kind.glyph} {kind.badge}
        </span>
      }
      counter={{
        index,
        total,
        onPrevious: () => onMove(index - 1),
        onNext: () => onMove(index + 1),
      }}
      footer={footer}
    >
      <h2
        ref={heading}
        tabIndex={-1}
        className="text-xl leading-snug font-semibold break-words whitespace-pre-wrap focus:outline-none"
      >
        {title(item)}
      </h2>
      <p className="text-muted-foreground">
        {repoName(item.project.name)}
        {item.kind === "review" &&
          ` · ${item.prCiState ? CI_WORDS[item.prCiState] : "Aucune CI"}`}
      </p>
      {item.kind === "answer" && (
        <WhyAsked context={item.context}>{where(item)}</WhyAsked>
      )}
      {item.kind === "answer" && !item.context && where(item)}
      {item.kind === "check" && (
        <ul className="list-disc pl-5">
          {item.reasons.map((code) => (
            <li key={code}>{REASON_TEXTS[code] ?? code}</li>
          ))}
        </ul>
      )}
      {item.kind === "answer" && (
        <>
          <p className={sectionLabel}>Choisis une réponse</p>
          <AnswerForm
            id={item.questionId}
            suggestedAnswers={item.suggestedAnswers}
            label="Répondre et passer au suivant"
            queryKey={["home"]}
            onSent={onSent}
          />
        </>
      )}
    </Panel>
  );
}

/** The panel of a story to validate (decision 084 A, I): its narrative and criteria with the decisions of its page; the simple panel while the story is not read. */
function ValidatePanel(
  props: PanelProps & { item: Extract<Item, { kind: "validate" }> },
) {
  const { item, index, total, onMove, onSent, focusHeading, onFocused } = props;
  const queryClient = useQueryClient();
  const statusRef = useRef<HTMLParagraphElement>(null);
  const found = useQuery({
    queryKey: ["story", String(item.storyId)],
    queryFn: () => fetchStory(String(item.storyId)),
  });
  const read = found.data && found.data !== "not_found" ? found.data : null;
  useEffect(() => {
    if (!focusHeading || !read) return;
    statusRef.current?.focus();
    onFocused(false);
  }, [focusHeading, read, onFocused]);
  if (found.isPending) return null;
  if (!read) return <ItemPanel {...props} />;
  const { story, project } = read;
  return (
    <StoryDecisions
      story={story}
      project={project}
      archived={project.archived}
      statusRef={statusRef}
      counter={{
        index,
        total,
        onPrevious: () => onMove(index - 1),
        onNext: () => onMove(index + 1),
      }}
      // The home drops the story: the same place now holds the next one.
      // The focused status unmounts with it: the focus goes to the next panel, or to the h1.
      onDone={async () => {
        await queryClient.invalidateQueries({ queryKey: ["home"] });
        if (total > 1) onFocused(true);
        else onSent();
      }}
      toDecide={story.criteria.flatMap((c) =>
        c.takeoverState === "pending"
          ? [{ id: c.id, summary: c.summary ?? "" }]
          : [],
      )}
    >
      <p ref={statusRef} tabIndex={-1} className="text-[12.5px]">
        US {story.id} ·{" "}
        <Link to={`/us/${story.id}`} className={link}>
          Ouvrir l'US
        </Link>
      </p>
      <StoryBody found={read} />
    </StoryDecisions>
  );
}

const PanelOf = (props: PanelProps) =>
  props.item.kind === "validate" ? (
    <ValidatePanel {...props} item={props.item} />
  ) : (
    <ItemPanel {...props} />
  );

/** « US 42 · étape developer · Run 17 ↗ »: where a question comes from (decision 069 E). */
const where = (item: Extract<Item, { kind: "answer" }>) => (
  <p className="text-[12.5px] text-muted-foreground">
    <Link to={`/us/${item.storyId}`} className={link}>
      US {item.storyId}
    </Link>
    {item.agent && ` · étape ${item.agent}`}
    {" · "}
    <Link to={`/runs/${item.runId}`} className={link}>
      Run {item.runId} ↗
    </Link>
  </p>
);

/** A row of « 2 · Ensuite »; « Valider » of a story to validate acts in place (POST /api/stories/:id/validate), a refusal shows next to the row. */
function Row({ item, open }: { item: Item; open: () => void }) {
  const queryClient = useQueryClient();
  const roles = useQuery({ queryKey: ["projects"], queryFn: fetchProjects });
  const mayValidate = atLeast(
    roles.data?.find((r) => r.id === item.project.id)?.role,
    "can_validate",
  );
  const [rulesPending, setRulesPending] = useState(false);
  const validate = useMutation({
    meta: { done: "User story validée." },
    mutationFn: async (id: number) => {
      const res = await client.api.stories[":id"].validate.$post({
        param: { id: String(id) },
      });
      if (!res.ok) {
        const body = (await res
          .clone()
          .json()
          .catch(() => null)) as { error?: string } | null;
        setRulesPending(body?.error === "rules_pending");
        throw await decisionError(res);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["home"] }),
  });
  const since =
    item.kind === "answer"
      ? item.askedAt
      : "updatedAt" in item
        ? item.updatedAt
        : undefined;
  return (
    <div className="grid min-h-[50px] grid-cols-[24px_minmax(0,1fr)_auto_auto] items-center gap-3 px-[18px]">
      <span
        aria-hidden="true"
        className="text-center text-[13px] font-bold text-dim"
      >
        {item.kind === "review" && item.prCiState === "failure"
          ? "✕"
          : KINDS[item.kind].glyph}
      </span>
      <span className="min-w-0">
        <button
          type="button"
          onClick={open}
          className={`block max-w-full truncate text-left font-semibold ${focusRing}`}
        >
          {rowTitle(item)}
        </button>
        <span className="block text-[12.5px] text-muted-foreground">
          {subLine(item, false)}
        </span>
        {validate.isError && (
          <span role="alert" className="block text-[12.5px] text-destructive">
            {validate.error.message}
            {rulesPending && (
              <>
                {" "}
                <Link
                  to={`/projets/${item.project.id}/conception/regles`}
                  className={link}
                >
                  Trancher dans l'écran de reprise
                </Link>
              </>
            )}
          </span>
        )}
      </span>
      <span className="flex items-center gap-3.5">
        <RowActions
          item={item}
          open={open}
          validate={() =>
            item.kind === "validate" && validate.mutate(item.storyId)
          }
          validating={validate.isPending}
          mayValidate={mayValidate}
        />
      </span>
      <span className="hidden min-w-10 sm:block text-right text-[12.5px] text-muted-foreground">
        {since && elapsed(since)}
      </span>
    </div>
  );
}

/** « Relire en série » (decision 070 H, I): opens the PR to review one after the other, in a new tab; the R key does the same. */
function ReviewSeries({
  reviews,
}: {
  reviews: Extract<Item, { kind: "review" }>[];
}) {
  // The stories already opened in the series: a merged PR that leaves the list does not shift it.
  const [seen, setSeen] = useState<number[]>([]);
  const next = reviews.find((r) => !seen.includes(r.storyId));
  const go = () => {
    const target = next ?? reviews[0];
    if (!target) return;
    window.open(prUrl(target), "_blank", "noopener");
    const now = [...(next ? seen : []), target.storyId];
    setSeen(reviews.every((r) => now.includes(r.storyId)) ? [] : now);
  };
  // A held key repeats: one press opens one PR.
  useShortcut("r", (event) => {
    if (!event.repeat) go();
  });
  return (
    <button
      type="button"
      aria-keyshortcuts="R"
      onClick={go}
      className={`ml-auto ${button}`}
    >
      {next && seen.length > 0
        ? `PR suivante · #${next.prNumber}`
        : "Relire en série"}{" "}
      <kbd className={kbd}>R</kbd>
    </button>
  );
}

/** Steps 1 to 7 of S06: what each says, a hint while it is not done, and where « Faire » leads. */
const GUIDE = [
  {
    key: "install",
    title: "Ouvrir des repos à Cockpit",
    hint: "installe l'App GitHub sur ton compte",
  },
  {
    key: "project",
    title: "Importer un premier projet",
    hint: "choisis un repo parmi ceux ouverts",
  },
  {
    key: "claude",
    title: "Connecter Claude",
    hint: "pour qu'il lise et écrive dans Cockpit",
  },
  {
    key: "prepare",
    title: "Préparer un repo pour Claude",
    hint: "ajoute /dev-us et les agents en un commit",
  },
  {
    key: "idea",
    title: "Noter une première idée",
    hint: "Claude en fera des user stories",
  },
  {
    key: "validate",
    title: "Valider une user story",
    hint: "elle devient prête à développer",
  },
  {
    key: "develop",
    title: "Développer avec Claude",
    hint: "jusqu'à la première PR",
  },
] as const;

type Guide = NonNullable<
  NonNullable<ReturnType<typeof useHome>["data"]>["onboarding"]
>;

/** The getting-started guide (decision 075 C): seven steps, the first one left carries « Faire ». Step 1 is `installed` of GET /api/installation, shown not done when that fails. */
function OnboardingGuide({
  guide,
  installed,
  onIdea,
}: {
  guide: Guide;
  installed: boolean;
  onIdea: (opener: HTMLElement) => void;
}) {
  const queryClient = useQueryClient();
  const hide = useMutation({
    mutationFn: async () => {
      const res = await client.api.me.onboarding.hide.$post();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["home"] }),
  });
  const rows = [
    { done: installed, detail: null, projectId: null, storyId: null },
    ...guide.steps,
  ];
  const count = rows.filter((r) => r.done).length;
  const next = rows.findIndex((r) => !r.done);
  const target = (i: number, r: (typeof rows)[number]) => {
    const key = GUIDE[i]?.key;
    if (key === "install") return "/bienvenue";
    if (key === "claude") return "/reglages";
    // « Préparer pour Claude » is on the Santé tab of the project.
    if (key === "prepare")
      return r.projectId ? `/projets/${r.projectId}/sante` : "/projets";
    if (key === "validate" || key === "develop")
      return r.storyId ? `/us/${r.storyId}` : "/projets";
    return "/projets";
  };
  return (
    <section className="px-[26px] pt-[22px]">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="flex items-center gap-2">
          <span className={sectionLabel}>Mise en route</span>
          <span className="text-[12.5px] font-normal text-muted-foreground">
            · {count} sur 7
          </span>
        </h2>
        <button
          type="button"
          onClick={() => hide.mutate()}
          disabled={hide.isPending}
          aria-busy={hide.isPending}
          className={`ml-auto text-[12.5px] text-muted-foreground hover:text-foreground ${focusRing}`}
        >
          Masquer ce guide
        </button>
      </div>
      {hide.isError && (
        <p role="alert" className="mb-2 text-[12.5px] text-destructive">
          Le guide n'a pas pu être masqué, réessaie.
        </p>
      )}
      <ol className={listCard}>
        {rows.map((r, i) => (
          <li
            key={GUIDE[i]?.key}
            className={`grid min-h-[50px] grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3 px-[18px] ${r.done ? "text-muted-foreground" : ""}`}
          >
            <span
              aria-hidden="true"
              className="text-center text-[13px] font-bold text-dim"
            >
              {r.done ? "✓" : i + 1}
            </span>
            <span className="min-w-0">
              <b className="block truncate font-semibold">
                {GUIDE[i]?.title}
                {r.done && <span className="sr-only"> : fait</span>}
              </b>
              <span className="block text-[12.5px] text-muted-foreground">
                {r.done ? r.detail : GUIDE[i]?.hint}
              </span>
            </span>
            {i === next &&
              (GUIDE[i]?.key === "idea" && r.projectId !== null ? (
                // The idea bar is hidden below md: this opens its panel, which needs an active project.
                <button
                  type="button"
                  onClick={(e) => onIdea(e.currentTarget)}
                  className={rowAction}
                >
                  Faire
                </button>
              ) : (
                <Link to={target(i, r)} className={rowAction}>
                  Faire
                </Link>
              ))}
          </li>
        ))}
      </ol>
      <p className={`${sectionLabel} mt-[22px] mb-2`}>Pourquoi cet ordre</p>
      <p className={`${listCard} px-[18px] py-3.5 text-muted-foreground`}>
        Claude ne peut développer que dans un repo préparé, et seulement une
        user story que tu as validée. Chaque étape débloque la suivante.
      </p>
    </section>
  );
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** The home of a logged-in user (045 D): the state in a sentence, what to do now, then next, what Claude does, the latest events; the first item is open in the right panel. */
export function HomePage({
  onIdea,
}: {
  onIdea: (opener: HTMLElement) => void;
}) {
  const home = useHome();
  // The same key as the shell's banner: one request for both.
  const installation = useQuery({
    queryKey: ["installation"],
    queryFn: fetchInstallation,
  });
  // The same key as the sidebar's: one request for both.
  const night = useQuery({ queryKey: ["home", "night"], queryFn: fetchNight });
  // The answered card goes away, and its section with the last one: the h1 stays, so the keyboard focus lands there.
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The open item is the one the user chose, found again by its key when the list changes under them; `at` is where to land when it is gone.
  const [opened, setOpened] = useState<{ key?: string; at: number }>({ at: 0 });
  const [fromRow, setFromRow] = useState(false);
  if (home.isPending)
    return (
      <p className="loading px-[26px] pt-[26px] text-muted-foreground">
        Chargement…
      </p>
    );
  if (home.isError)
    return (
      <div role="alert" className={`mx-[26px] mt-[26px] ${alertBox}`}>
        <p>Impossible de lire l'accueil.</p>
        <button
          type="button"
          onClick={() => home.refetch()}
          className={`mt-3 ${button}`}
        >
          Réessayer
        </button>
      </div>
    );
  const { forYou, claudeWorks } = home.data;
  const [first, ...others] = forYou;
  const blocked = forYou.filter((item) => item.kind === "answer").length;
  const w = claudeWorks.length;
  const claude =
    w === 0
      ? "Claude ne travaille sur rien."
      : `Claude travaille sur ${w} ${plural(w, "run", "runs")}, tout va bien.`;
  // Not before step 1 is known (or has failed once: React Query retries for seconds), so the guide and its sentence do not flip.
  const guide =
    installation.isPending && installation.failureCount === 0
      ? null
      : home.data.onboarding;
  const left = guide
    ? 7 -
      guide.steps.filter((s) => s.done).length -
      (installation.data?.installed ? 1 : 0)
    : 0;
  const sentence =
    blocked > 0
      ? {
          title: `Claude est bloqué sur ${blocked} ${plural(blocked, "run", "runs")}.`,
          rest: "Le reste peut attendre.",
        }
      : forYou.length > 0
        ? {
            title: plural(
              forYou.length,
              "1 chose t'attend.",
              `${forYou.length} choses t'attendent.`,
            ),
            rest: claude,
          }
        : guide
          ? {
              title: `${left === 1 ? "Plus qu'une étape" : `Plus que ${left} étapes`} avant ta première PR.`,
              rest: "Chacune se coche toute seule quand elle est faite.",
            }
          : { title: "Rien ne t'attend.", rest: claude };
  const found = forYou.findIndex((item) => itemKey(item) === opened.key);
  const shown = found >= 0 ? found : Math.min(opened.at, forYou.length - 1);
  // Remember what is displayed (also by default, or after a fallback), so the next change of the list finds it again.
  const shownKey = forYou[shown] && itemKey(forYou[shown]);
  if (shownKey && (opened.key !== shownKey || opened.at !== shown))
    setOpened({ key: shownKey, at: shown });
  const open = (at: number, row = false) => {
    const target = forYou[at];
    if (target) setOpened({ key: itemKey(target), at });
    setFromRow(row);
  };
  const reviews = forYou.filter((item) => item.kind === "review");
  const groups: { kind: Item["kind"]; rows: { item: Item; at: number }[] }[] =
    [];
  others.forEach((item, i) => {
    const row = { item, at: i + 1 };
    const group = groups.find((g) => g.kind === item.kind);
    if (group) group.rows.push(row);
    else groups.push({ kind: item.kind, rows: [row] });
  });

  return (
    <>
      <StateSentence {...sentence} headingRef={headingRef} />
      {!guide && forYou.length === 0 && home.data.projects.length === 0 && (
        <p className="px-[26px] pt-3">
          <Link to="/projets" className={rowAction}>
            Importer un repo
          </Link>
        </p>
      )}
      {guide && (
        <OnboardingGuide
          guide={guide}
          installed={installation.data?.installed === true}
          onIdea={onIdea}
        />
      )}
      {home.data.night && (
        <NightMorning
          night={home.data.night}
          questions={blocked}
          onQuestions={() =>
            open(
              forYou.findIndex((item) => item.kind === "answer"),
              true,
            )
          }
        />
      )}
      {forYou.length === 0 &&
        night.data &&
        !night.data.night &&
        night.data.ready.length > 0 && (
          <div
            className={`mx-[26px] mt-[22px] flex flex-wrap items-center justify-between gap-3 px-[18px] py-4 ${card}`}
          >
            <p>
              ☾ Cette nuit · {night.data.ready.length}{" "}
              {plural(
                night.data.ready.length,
                "user story prête",
                "user stories prêtes",
              )}{" "}
              à programmer
            </p>
            <Link to="/nuit" className={rowAction}>
              Préparer la nuit
            </Link>
          </div>
        )}
      {first && (
        <Section
          label={
            <span className="text-[11.5px] font-bold uppercase tracking-[.08em] text-you-text">
              1 · Maintenant
            </span>
          }
          hint={
            first.kind === "answer" ? "ce qui bloque Claude" : "ce qui t'attend"
          }
        >
          <div className="grid hidden lg:grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3.5 rounded-[14px] border border-you-line bg-you-ground px-[18px] py-4">
            <span
              aria-hidden="true"
              className="grid size-9 place-items-center rounded-[10px] bg-you-soft font-bold text-you-text"
            >
              ✦
            </span>
            <span className="min-w-0">
              <button
                type="button"
                onClick={() => open(0, true)}
                className={`block max-w-full text-left text-[15px] font-semibold ${focusRing}`}
              >
                {rowTitle(first)}
              </button>
              <span className="text-[12.5px] text-muted-foreground">
                {subLine(first)}
              </span>
              {first.kind === "relaunch_exhausted" && (
                <>
                  <a href={prUrl(first)} className={`block ${link}`}>
                    Voir la PR #{first.prNumber}
                  </a>
                  <Link to={`/us/${first.storyId}`} className={`block ${link}`}>
                    Ouvrir l'US
                  </Link>
                </>
              )}
            </span>
            <span className="hidden text-[12.5px] text-muted-foreground lg:block">
              ouverte à droite →
            </span>
          </div>
        </Section>
      )}
      {first && (
        <PanelOf
          key={itemKey(forYou[shown] ?? first)}
          item={forYou[shown] ?? first}
          index={shown}
          total={forYou.length}
          onMove={open}
          onSent={() => {
            setFromRow(false);
            headingRef.current?.focus();
          }}
          focusHeading={fromRow}
          onFocused={setFromRow}
        />
      )}
      {others.length > 0 && (
        <Section
          label={<span className={sectionLabel}>2 · Ensuite</span>}
          hint="sans urgence, dans cet ordre"
        >
          <div className={listCard}>
            {groups.map(({ kind, rows }) => (
              <div key={kind} className="divide-y divide-border">
                <p className="flex min-h-9 items-center gap-2.5 px-[18px] text-[12.5px] font-semibold text-muted-foreground">
                  {KINDS[kind].group}
                  <span className={badge}>{rows.length}</span>
                  {KINDS[kind].hint && (
                    <span className="font-medium">· {KINDS[kind].hint}</span>
                  )}
                  {kind === "review" && reviews.length > 1 && (
                    <ReviewSeries reviews={reviews} />
                  )}
                </p>
                {rows.map(({ item, at }) => (
                  <Row
                    key={itemKey(item)}
                    item={item}
                    open={() => open(at, true)}
                  />
                ))}
              </div>
            ))}
          </div>
        </Section>
      )}
      {w > 0 && (
        <Section
          action={
            <Link
              to="/claude"
              className={`ml-auto text-[12.5px] text-muted-foreground hover:text-foreground ${focusRing}`}
            >
              Tous les runs
            </Link>
          }
          label={
            <>
              <Dot tone="claude" live />
              <span className={sectionLabel}>Claude en ce moment</span>
            </>
          }
        >
          <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {claudeWorks.map((work) => {
              const waiting =
                first?.kind === "answer" && first.runId === work.runId;
              return (
                <li key={work.runId} className="min-w-0">
                  <Link
                    to={`/runs/${work.runId}`}
                    className={`flex flex-col gap-1.5 rounded-xl border bg-card px-[13px] py-[11px] ${focusRing} ${waiting ? "border-you-line" : "border-border"}`}
                  >
                    <b className="truncate text-[13px] font-semibold">
                      Run {work.runId} · {repoName(work.project.name)}
                    </b>
                    <small
                      className={`text-xs ${waiting ? "text-you-text" : "text-muted-foreground"}`}
                    >
                      {waiting
                        ? "en pause · attend ta réponse"
                        : (work.step ?? "Démarrage")}
                    </small>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
      <Recent />
    </>
  );
}

/** The 5 latest entries of the Journal; its own query, so it never blocks the rest of the home. */
function Recent() {
  const history = useQuery({
    queryKey: ["home", "history"],
    queryFn: () => fetchHistory(undefined),
  });
  const entries = history.data?.entries.slice(0, 5);
  if (history.isPending) return null;
  return (
    <Section label={<span className={sectionLabel}>Dernièrement</span>}>
      {history.isError ? (
        <>
          <p className="mt-2 text-muted-foreground">
            Impossible de lire le journal.
          </p>
          <button
            type="button"
            onClick={() => history.refetch()}
            className={`mt-2 ${button}`}
          >
            Réessayer
          </button>
        </>
      ) : entries?.length === 0 ? (
        <p className="mt-2 text-muted-foreground">
          Rien de fait pour l'instant.
        </p>
      ) : (
        entries && (
          <>
            <ul className="mt-2 grid gap-2">
              {entries.map((entry) => (
                <JournalEntry
                  key={entry.id}
                  entry={entry}
                  to={objectPath(entry)}
                />
              ))}
            </ul>
            <p className="mt-2">
              <Link to="/journal" className={link}>
                Voir tout le journal
              </Link>
            </p>
          </>
        )
      )}
    </Section>
  );
}
