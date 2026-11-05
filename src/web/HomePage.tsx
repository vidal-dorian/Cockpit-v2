import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { AnswerForm } from "./AnswerForm.tsx";
import { client } from "./api.ts";
import { REASONS } from "./RunVerdict.tsx";
import { alertBox, card, focusRing } from "./ui.ts";
import { useAnyChange } from "./useChanges.ts";

async function fetchHome() {
  const res = await client.api.home.$get();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** What waits for the user (decision 040), shared by the page and the counter of the top bar; read again on every change of the stream. */
export function useHome(enabled: boolean) {
  useAnyChange("home", enabled);
  return useQuery({ queryKey: ["home"], queryFn: fetchHome, enabled });
}

type Home = Awaited<ReturnType<typeof fetchHome>>;

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

const PASTILLES = {
  for_you: ["À toi", "bg-you-soft text-you-text"],
  claude: ["Claude travaille", "bg-claude-soft text-claude-text"],
  idle: ["Rien en cours", "bg-done-soft text-done-text"],
} as const;

const link = `font-semibold underline ${focusRing}`;

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="font-heading text-xl font-bold">{title}</h2>
      {children}
    </section>
  );
}

function Story({
  iWant,
  project,
}: {
  iWant: string;
  project: { name: string };
}) {
  return (
    <>
      <span className="font-semibold">{iWant}</span>
      <span className="text-muted-foreground"> · {project.name}</span>
    </>
  );
}

function ForYouItem({ item }: { item: Home["forYou"][number] }) {
  switch (item.kind) {
    case "answer":
      return (
        <>
          <p className="whitespace-pre-wrap font-semibold">{item.question}</p>
          <p>
            <Story {...item} />
          </p>
          <AnswerForm
            id={item.questionId}
            suggestedAnswers={item.suggestedAnswers}
            queryKey={["home"]}
          />
        </>
      );
    case "validate":
      return (
        <Link to={`/us/${item.storyId}`} className={link}>
          <Story {...item} />
        </Link>
      );
    case "review":
      return (
        <>
          <p>
            <Story {...item} />
          </p>
          <p>
            {item.prCiState ? CI_WORDS[item.prCiState] : "Aucune CI"} ·{" "}
            <a
              href={`https://github.com/${item.project.name}/pull/${item.prNumber}`}
              className={link}
            >
              Relire la PR #{item.prNumber}
            </a>{" "}
            ·{" "}
            <Link to={`/us/${item.storyId}`} className={link}>
              Voir l'US
            </Link>
          </p>
        </>
      );
    case "check":
      return (
        <>
          <Link to={`/runs/${item.runId}`} className={link}>
            <Story {...item} />
          </Link>
          <ul className="list-disc pl-5">
            {item.reasons.map((code) => (
              <li key={code}>{REASON_TEXTS[code] ?? code}</li>
            ))}
          </ul>
        </>
      );
  }
}

/** The home of a logged-in user (decision 040): what waits for them, what Claude does, the projects. */
export function HomePage() {
  const home = useHome(true);
  if (home.isPending)
    return <p className="mt-8 text-muted-foreground">Chargement…</p>;
  if (home.isError)
    return (
      <div role="alert" className={`mt-8 ${alertBox}`}>
        <p>Impossible de lire l'accueil.</p>
      </div>
    );
  const { forYou, claudeWorks, projects } = home.data;
  return (
    <>
      <Section title="À toi de jouer">
        {forYou.length === 0 ? (
          <p className="mt-2 text-muted-foreground">Rien ne t'attend.</p>
        ) : (
          <ul className="mt-2 grid gap-2">
            {forYou.map((item) => (
              <li
                key={`${item.kind}-${item.kind === "answer" ? item.questionId : item.storyId}`}
                className={`${card} p-3`}
              >
                <ForYouItem item={item} />
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Claude travaille">
        {claudeWorks.length === 0 ? (
          <p className="mt-2 text-muted-foreground">
            Claude ne travaille sur rien.
          </p>
        ) : (
          <ul className="mt-2 grid gap-2">
            {claudeWorks.map((work) => (
              <li key={work.runId}>
                <Link
                  to={`/runs/${work.runId}`}
                  className={`${card} block p-3 ${focusRing}`}
                >
                  <Story {...work} />
                  <span className="text-muted-foreground">
                    {" "}
                    · {work.step ?? "Démarrage"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Projets">
        {projects.length === 0 ? (
          <p className="mt-2">
            Aucun projet.{" "}
            <Link to="/projets" className={link}>
              Importer un projet
            </Link>
          </p>
        ) : (
          <ul className="mt-2 grid gap-2">
            {projects.map((p) => (
              <li
                key={p.id}
                className={`${card} flex items-center justify-between gap-3 p-3`}
              >
                <span className="font-semibold">{p.name}</span>
                <span
                  className={`rounded-full px-3 py-1 font-semibold ${PASTILLES[p.state][1]}`}
                >
                  {PASTILLES[p.state][0]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
