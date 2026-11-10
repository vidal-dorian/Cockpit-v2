import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { client } from "./api.ts";
import { DiffList } from "./DiffList.tsx";
import { diffLines } from "./diff.ts";
import {
  type Done,
  DoneBox,
  type Failure,
  failure,
  message,
} from "./ProjectPrepare.tsx";
import { plural } from "./tickets.ts";
import {
  alertBox,
  button,
  card,
  focusRing,
  ghostButton,
  listCard,
  primaryButton,
  row,
  sectionLabel,
} from "./ui.ts";
import { ago } from "./when.ts";

const LANGUAGES = {
  node: "Node",
  python: "Python",
  go: "Go",
  rust: "Rust",
};
// The server refuses any other path (decision 067 E).
const WORKFLOW_FILE = /^\.github\/workflows\/[a-z0-9][a-z0-9-]*\.ya?ml$/;
const NO_APP_RIGHT =
  "Ajoute la permission Workflows en écriture à l'App GitHub de Cockpit, puis approuve-la.";
const NO_RIGHT =
  "Cockpit n'a pas encore le droit d'écrire les workflows. Approuve la nouvelle permission sur GitHub.";

export async function fetchWorkflows(id: string) {
  const res = await client.api.projects[":id"].workflows.$get({
    param: { id },
  });
  if (!res.ok) return { failure: await failure(res) };
  return { data: await res.json() };
}
type Workflows = NonNullable<
  Awaited<ReturnType<typeof fetchWorkflows>>["data"]
>;
type Workflow = Workflows["workflows"][number];

const failing = (w: Workflow) =>
  `${w.name} échoue depuis ${plural(w.failingSince, "exécution", "exécutions")}.`;

/** Decision 067 A: the sentence of the page; the workflow that has failed the longest comes under the first red one when it is another. */
export function ciSentence(workflows: Workflow[]) {
  const red = workflows.filter((w) => w.failingSince > 0);
  const [first] = red;
  if (!first)
    return {
      title: !workflows.length
        ? "Pas encore de CI."
        : workflows.every((w) => w.lastRun === null)
          ? "Pas encore d'exécution."
          : "La CI passe.",
      rest: undefined,
    };
  const longest = red.reduce((a, b) =>
    b.failingSince > a.failingSince ? b : a,
  );
  return {
    title: failing(first),
    rest: longest === first ? undefined : failing(longest),
  };
}

/** One workflow of S15: its mark, what it did lately and, when it is red, « Demander à Claude » (decision 067 G). */
function WorkflowLine({
  workflow: w,
  projectId,
  archived,
}: {
  workflow: Workflow;
  projectId: string;
  archived: boolean;
}) {
  const ask = useMutation({
    mutationFn: async () => {
      const res = await client.api.projects[":id"].workflows.ask.$post({
        param: { id: projectId },
        json: { path: w.path },
      });
      return res.ok
        ? { launched: await res.json() }
        : { failure: await failure(res) };
    },
  });
  const red = w.failingSince > 0;
  const problem =
    ask.data?.failure ?? (ask.isError ? { code: "", status: 0 } : undefined);
  return (
    <li className={row}>
      <span
        aria-hidden="true"
        className={`w-6 font-semibold ${red ? "text-destructive" : "text-muted-foreground"}`}
      >
        {red ? "✕" : "✓"}
      </span>
      <span className="min-w-0 grow">
        <b className="block font-semibold">
          {w.path.split("/").pop()} · {w.name}
        </b>
        <span className="block text-[12.5px] text-muted-foreground">
          {red
            ? `échoue depuis ${plural(w.failingSince, "exécution", "exécutions")}`
            : w.lastRun && w.averageSeconds !== null
              ? `sur ${w.event} · ${Math.max(1, Math.round(w.averageSeconds / 60))} min en moyenne`
              : "Pas encore d'exécution"}
        </span>
      </span>
      {red && WORKFLOW_FILE.test(w.path) && (
        <button
          type="button"
          disabled={archived || ask.isPending || ask.isSuccess}
          aria-busy={ask.isPending}
          onClick={() => ask.mutate()}
          className={button}
        >
          Demander à Claude
        </button>
      )}
      {w.lastRun && (
        <a
          href={w.lastRun.url}
          target="_blank"
          rel="noreferrer noopener"
          className={`ml-3 text-[12.5px] text-muted-foreground underline ${focusRing}`}
        >
          {ago(w.lastRun.at)}
        </a>
      )}
      {ask.data?.launched && (
        <p role="status" className="mt-2 basis-full text-[12.5px]">
          Lancé dans le cloud.{" "}
          {ask.data.launched.sessionUrl && (
            <a
              href={ask.data.launched.sessionUrl}
              target="_blank"
              rel="noreferrer noopener"
              className={`underline ${focusRing}`}
            >
              Voir la session ↗
            </a>
          )}
        </p>
      )}
      {problem && (
        <div role="alert" className={`mt-2 basis-full ${alertBox}`}>
          <p>{message(problem)}</p>
        </div>
      )}
    </li>
  );
}

/** « Faire le commit » of the starter and of a proposal: grey while the installation lacks the permission `workflows` (decision 067 D). */
function CommitButton({
  allowed,
  installationUrl,
  appMissing,
  disabled,
  busy,
  onClick,
  children,
}: {
  allowed: boolean;
  installationUrl: string;
  /** The App itself lacks the permission: the link is the App's settings, not the installation's. */
  appMissing: boolean;
  disabled: boolean;
  /** The commit is on its way (decision 081 A). */
  busy: boolean;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled || !allowed}
          aria-busy={busy}
          onClick={onClick}
          className={primaryButton}
        >
          Faire le commit
        </button>
        {children}
      </div>
      {!allowed && (
        <p className="mt-2 text-[12.5px] text-muted-foreground">
          {appMissing ? NO_APP_RIGHT : NO_RIGHT}{" "}
          <a
            href={installationUrl}
            target="_blank"
            rel="noreferrer noopener"
            className={`underline ${focusRing}`}
          >
            {appMissing
              ? "Ouvrir les réglages de l'App ↗"
              : "Ouvrir l'installation sur GitHub ↗"}
          </a>
        </p>
      )}
    </>
  );
}

function Proposal({
  proposal,
  ...commit
}: {
  proposal: NonNullable<Workflows["proposal"]>;
} & Omit<Parameters<typeof CommitButton>[0], "children"> & {
    onIgnore: () => void;
  }) {
  const lines = useMemo(
    () => diffLines(proposal.before ?? "", proposal.content),
    [proposal],
  );
  return (
    <section aria-labelledby="ci-proposal" className="px-[26px] pt-5">
      <h2 id="ci-proposal" className={`mb-2 ${sectionLabel}`}>
        Ce que Claude propose{" "}
        <span className="font-normal normal-case tracking-normal">
          · un changement à la fois
        </span>
      </h2>
      <div className={`${card} p-4`}>
        <div className="flex flex-wrap items-center gap-x-3">
          <b>{proposal.reason}</b>
          <span className="ml-auto font-mono text-[12.5px] text-muted-foreground">
            {proposal.path}
          </span>
        </div>
        <div className="mt-2.5">
          {lines ? (
            <DiffList lines={lines} />
          ) : (
            <pre className="overflow-x-auto whitespace-pre-wrap text-sm">
              {proposal.content}
            </pre>
          )}
        </div>
        <CommitButton {...commit}>
          <button
            type="button"
            disabled={commit.disabled}
            aria-busy={commit.busy}
            onClick={commit.onIgnore}
            className={ghostButton}
          >
            Ignorer
          </button>
          <span className="text-[12.5px] text-muted-foreground">
            Cockpit ne modifie un workflow qu'avec ton accord.
          </span>
        </CommitButton>
      </div>
    </section>
  );
}

/** Decision 067: the tab « CI / CD », the workflows of the repo, a starter CI when it has none and the change Claude proposes. */
export function ProjectCi({
  projectId,
  fullName,
  archived,
}: {
  projectId: string;
  fullName: string;
  archived: boolean;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["workflows", projectId],
    queryFn: () => fetchWorkflows(projectId),
    retry: false,
  });
  const [result, setResult] = useState<{ done?: Done; problem?: Failure }>({});
  const write = useMutation({
    mutationFn: async (send: () => Promise<Response>) => {
      const res = await send();
      return res.ok
        ? {
            done: (await res.json()) as {
              commitSha?: string;
              pullRequest?: { url: string };
            },
          }
        : { failure: await failure(res) };
    },
    onSuccess: (answer) => {
      if (answer.failure) setResult({ problem: answer.failure });
      else {
        const { commitSha, pullRequest } = answer.done;
        // Ignoring a proposal answers no commit.
        setResult(
          commitSha
            ? {
                done: {
                  url:
                    pullRequest?.url ??
                    `https://github.com/${fullName}/commit/${commitSha}`,
                  pullRequest: pullRequest !== undefined,
                },
              }
            : {},
        );
      }
      return queryClient.invalidateQueries({
        queryKey: ["workflows", projectId],
      });
    },
    onError: () => setResult({ problem: { code: "", status: 0 } }),
  });
  const send = (post: () => Promise<Response>) => {
    setResult({});
    write.mutate(post);
  };
  const failed =
    query.data?.failure ??
    (query.isError ? { code: "", status: 0 } : undefined);
  const data = query.data?.data;
  const rights = {
    allowed: data?.permission.workflows ?? false,
    installationUrl: data?.permission.installationUrl ?? "",
    appMissing: data?.permission.appMissing ?? false,
    disabled: archived || write.isPending,
    busy: write.isPending,
  };
  const { starter, proposal } = data ?? {};
  return (
    <>
      {query.isPending && (
        <p className="loading px-[26px] pt-5 text-muted-foreground">
          Chargement…
        </p>
      )}
      {failed && (
        <div role="alert" className={`mx-[26px] mt-5 ${alertBox}`}>
          <p>{message(failed)}</p>
        </div>
      )}
      {data && ciSentence(data.workflows).rest && (
        <p className="px-[26px] pt-1.5 text-muted-foreground">
          {ciSentence(data.workflows).rest}
        </p>
      )}
      {result.problem && (
        <div role="alert" className={`mx-[26px] mt-5 ${alertBox}`}>
          <p>{message(result.problem)}</p>
        </div>
      )}
      {result.done && (
        <div className="px-[26px]">
          <DoneBox done={result.done} />
        </div>
      )}
      {data && (
        <section aria-labelledby="ci-workflows" className="px-[26px] pt-5">
          <h2 id="ci-workflows" className={`mb-2 ${sectionLabel}`}>
            Les workflows{" "}
            <span className="font-normal normal-case tracking-normal">
              · lus dans .github/workflows
            </span>
          </h2>
          {data.workflows.length > 0 ? (
            <ul className={listCard}>
              {data.workflows.map((w) => (
                <WorkflowLine
                  key={w.path}
                  workflow={w}
                  projectId={projectId}
                  archived={archived}
                />
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">
              Aucun workflow dans ce repo pour l'instant.
            </p>
          )}
        </section>
      )}
      {starter && (
        <section aria-labelledby="ci-starter" className="px-[26px] pt-5">
          <h2 id="ci-starter" className={`mb-2 ${sectionLabel}`}>
            Une CI de départ
          </h2>
          <div className={`${card} p-4`}>
            {starter.language === null ? (
              <p>Cockpit ne reconnaît pas le langage de ce repo.</p>
            ) : (
              <>
                <p>
                  Ce repo est en {LANGUAGES[starter.language]} : voici la CI que
                  Cockpit écrirait dans{" "}
                  <span className="font-mono text-[12.5px]">
                    {starter.path}
                  </span>
                  .
                </p>
                <pre className="mt-2.5 overflow-x-auto rounded-xl border border-border bg-sunken p-3.5 font-mono text-xs leading-[1.65]">
                  {starter.content}
                </pre>
                <CommitButton
                  {...rights}
                  onClick={() => {
                    const language = starter.language;
                    send(() =>
                      client.api.projects[":id"].workflows.starter.apply.$post(
                        { param: { id: projectId } },
                        {
                          init: {
                            body: JSON.stringify({ language }),
                            headers: { "content-type": "application/json" },
                          },
                        },
                      ),
                    );
                  }}
                />
              </>
            )}
          </div>
        </section>
      )}
      {proposal && (
        <Proposal
          proposal={proposal}
          {...rights}
          onClick={() =>
            send(() =>
              client.api["workflow-proposals"][":id"].commit.$post({
                param: { id: String(proposal.id) },
              }),
            )
          }
          onIgnore={() =>
            send(() =>
              client.api["workflow-proposals"][":id"].ignore.$post({
                param: { id: String(proposal.id) },
              }),
            )
          }
        />
      )}
    </>
  );
}
