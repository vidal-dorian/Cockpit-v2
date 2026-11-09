import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { pluginSettings } from "../server/plugin-settings.ts";
import { client } from "./api.ts";
import { AddAgent, AgentForm, type Editing } from "./ProjectAgents.tsx";
import { Editor, SkillEditor } from "./ProjectClaudeConfig.tsx";
import {
  type Done,
  DoneBox,
  type Failure,
  failure,
  message,
} from "./ProjectPrepare.tsx";
import { fetchRepositories } from "./Projects.tsx";
import { fetchMe, StateSentence } from "./Shell.tsx";
import { plural } from "./tickets.ts";
import { alertBox, button, focusRing, listCard, sectionLabel } from "./ui.ts";

const json = { "content-type": "application/json" };

async function fetchPlugins() {
  const res = await client.api.plugins.$get();
  if (!res.ok) return { failure: await failure(res) };
  return { data: await res.json() };
}

async function fetchPluginProjects() {
  const res = await client.api.plugins.projects.$get();
  if (!res.ok) throw await failure(res);
  return (await res.json()).projects;
}

/** What is open: a shared agent (`before` null when new), a shared skill (`name` absent when new) or the settings.json of a project. */
type Open =
  | { kind: "agent"; editing: Editing }
  | { kind: "skill"; name?: string; before: string | null }
  | { kind: "project"; id: number; install: boolean };

/** Decision 066: « Équipes d'agents › Commun », the plugin repo shared by every project, its agents and skills, and the projects that install it. */
export function Plugins() {
  const queryClient = useQueryClient();
  const plugins = useQuery({
    queryKey: ["plugins"],
    queryFn: fetchPlugins,
    retry: false,
  });
  const repo = plugins.data?.data?.repo;
  const projects = useQuery({
    queryKey: ["plugins", "projects"],
    queryFn: fetchPluginProjects,
    enabled: !!repo,
    retry: false,
  });
  const repositories = useQuery({
    queryKey: ["github", "repositories"],
    queryFn: fetchRepositories,
    enabled: repo === null,
  });
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe }).data;
  const [open, setOpen] = useState<Open | null>(null);
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState<Failure | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  const link = useMutation({
    mutationFn: async (fullName: string | null) => {
      const res = await client.api.plugins.repo.$put(
        {},
        { init: { body: JSON.stringify({ fullName }), headers: json } },
      );
      if (!res.ok) setProblem(await failure(res));
    },
    onSuccess: () => {
      setOpen(null);
      return queryClient.invalidateQueries({ queryKey: ["plugins"] });
    },
    onError: () => setProblem({ code: "", status: 0 }),
  });
  // Every write of the page: the commit of an agent, of a skill or of a project's settings.json.
  const commit = useMutation({
    mutationFn: async (send: () => Promise<Response>) => {
      const res = await send();
      return res.ok
        ? { done: await res.json() }
        : { failure: await failure(res) };
    },
    onSuccess: (answer) => {
      if (answer.failure) {
        setProblem(answer.failure);
        if (answer.failure.code !== "repo_changed") return;
      } else {
        const { commitSha, pullRequest } = answer.done;
        setDone({
          url:
            pullRequest?.url ??
            `https://github.com/${projectRepo(open)}/commit/${commitSha}`,
          pullRequest: pullRequest !== undefined,
        });
      }
      setOpen(null);
      return queryClient.invalidateQueries({ queryKey: ["plugins"] });
    },
    onError: () => setProblem({ code: "", status: 0 }),
  });
  const projectRepo = (o: Open | null) =>
    o?.kind === "project"
      ? projects.data?.find((p) => p.id === o.id)?.fullName
      : repo;
  const postFile =
    (kind: "agent" | "skill", name: string, before: string | null) =>
    (after: string | null) => {
      setProblem(null);
      commit.mutate(() =>
        client.api.plugins.apply.$post(
          {},
          {
            init: {
              body: JSON.stringify({ kind, name, before, after }),
              headers: json,
            },
          },
        ),
      );
    };
  const show = (next: Open | null) => {
    setProblem(null);
    setDone(null);
    setAdding(false);
    setOpen(next);
  };

  const failed =
    plugins.data?.failure ??
    (plugins.isError ? { code: "", status: 0 } : undefined);
  const data = plugins.data?.data;
  const list = projects.data ?? [];
  const installed = list.filter((p) => p.installed).length;
  const names = [...(data?.agents ?? []), ...(data?.skills ?? [])];
  const common = { archived: false, pending: commit.isPending };
  const target = open?.kind === "project" ? open : null;
  const project = list.find((p) => p.id === target?.id);
  const after =
    target && project && me && repo
      ? (() => {
          try {
            return pluginSettings(
              project.settings,
              { login: me.login, repo },
              target.install,
            );
          } catch {
            return null;
          }
        })()
      : undefined;
  const items = (
    kind: "agent" | "skill",
    rows: { name: string; text: string }[],
  ) =>
    rows.map(({ name, text }) => (
      <li key={name} className="min-h-[50px]">
        <button
          type="button"
          aria-label={`Ouvrir ${name}`}
          // A file Cockpit cannot read (symlink, too large) is not rewritten.
          disabled={text === ""}
          onClick={() =>
            show(
              kind === "agent"
                ? { kind, editing: { name, before: text, base: text } }
                : { kind, name, before: text },
            )
          }
          className={`flex min-h-[50px] w-full items-center px-[18px] py-2 text-left font-semibold hover:bg-raised disabled:opacity-50 ${focusRing}`}
        >
          {name}
        </button>
      </li>
    ));

  return (
    <main>
      <StateSentence
        title="Ce que tous tes projets partagent."
        rest="Défini une fois, dans ton repo de plugins."
      />
      <div className="grid gap-6 px-[26px] py-6" aria-live="polite">
        {!plugins.data && !plugins.isError && (
          <p className="loading text-muted-foreground">Chargement…</p>
        )}
        {(failed || problem) && (
          <div role="alert" className={alertBox}>
            <p>{message((failed ?? problem) as Failure)}</p>
            {failed?.status === 409 && (
              <button
                type="button"
                disabled={link.isPending}
                onClick={() => link.mutate(null)}
                className={`mt-2 ${button}`}
              >
                Délier
              </button>
            )}
          </div>
        )}
        {done && <DoneBox done={done} />}
        {repo === null && (
          <section aria-labelledby="relier">
            <h2 id="relier" className={sectionLabel}>
              Ton repo de plugins
            </h2>
            <p className="mt-2">
              Crée un repo sur GitHub avec un premier commit (un README suffit),
              ouvre-le à Cockpit, puis relie-le ici.
            </p>
            <ul className={`mt-2 ${listCard}`}>
              {repositories.data?.repositories.map((r) => (
                <li
                  key={r.githubRepoId}
                  className="flex min-h-[50px] items-center justify-between gap-3 px-[18px] py-2"
                >
                  <span className="font-semibold">{r.fullName}</span>
                  <button
                    type="button"
                    disabled={link.isPending}
                    onClick={() => {
                      setProblem(null);
                      link.mutate(r.fullName);
                    }}
                    className={button}
                  >
                    Relier
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {data && repo && (
          <>
            <section aria-labelledby="commun">
              <div className="flex items-center justify-between gap-3">
                <h2 id="commun" className={sectionLabel}>
                  Agents et skills communs · {repo}
                </h2>
                <button
                  type="button"
                  disabled={link.isPending}
                  onClick={() => link.mutate(null)}
                  className={button}
                >
                  Délier
                </button>
              </div>
              <ul className={`mt-2 ${listCard}`}>
                {items("agent", data.agents)}
                {items("skill", data.skills)}
              </ul>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    show(null);
                    setAdding(true);
                  }}
                  className={button}
                >
                  + Nouvel agent commun
                </button>
                <button
                  type="button"
                  onClick={() => show({ kind: "skill", before: null })}
                  className={button}
                >
                  + Nouveau skill commun
                </button>
              </div>
              {adding && (
                <AddAgent
                  taken={data.agents.map((a) => a.name)}
                  catalog={[]}
                  onContinue={(name, base) =>
                    show({
                      kind: "agent",
                      editing: { name, before: null, base },
                    })
                  }
                />
              )}
              {open?.kind === "agent" && (
                <AgentForm
                  key={`${open.editing.name}\n${open.editing.before}`}
                  editing={open.editing}
                  path={`plugins/commun/agents/${open.editing.name}.md`}
                  {...common}
                  onClose={() => show(null)}
                  onCommit={postFile(
                    "agent",
                    open.editing.name,
                    open.editing.before,
                  )}
                />
              )}
              {open?.kind === "skill" && (
                <SkillEditor
                  key={`${open.name}\n${open.before}`}
                  open={open}
                  taken={names.map((n) => n.name)}
                  dir="plugins/commun/skills"
                  {...common}
                  onCommit={(after, name) =>
                    postFile("skill", name, open.before)(after)
                  }
                />
              )}
            </section>
            <section aria-labelledby="projets">
              <h2 id="projets" className={sectionLabel}>
                Tes projets
              </h2>
              {projects.data && (
                <p className="mt-2 text-muted-foreground">
                  installé dans {plural(installed, "projet", "projets")} sur{" "}
                  {list.length}
                </p>
              )}
              {projects.isError && (
                <p role="alert" className={`mt-2 ${alertBox}`}>
                  GitHub ne répond pas comme prévu, réessaie dans un instant.
                </p>
              )}
              <ul className={`mt-2 ${listCard}`}>
                {list.map((p) => (
                  <li
                    key={p.id}
                    className="flex min-h-[50px] items-center justify-between gap-3 px-[18px] py-2"
                  >
                    <span className="font-semibold">{p.fullName}</span>
                    {p.installed && (
                      <span className="text-muted-foreground">installé</span>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        show({
                          kind: "project",
                          id: p.id,
                          install: !p.installed,
                        })
                      }
                      className={button}
                    >
                      {p.installed ? "Retirer" : "Installer"}
                    </button>
                  </li>
                ))}
              </ul>
              {project && after === null && (
                <p role="alert" className={`mt-3 ${alertBox}`}>
                  {message({ code: "invalid_settings", status: 409 })}
                </p>
              )}
              {target && project && after && (
                <Editor
                  {...common}
                  before={project.settings}
                  after={after}
                  file=".claude/settings.json"
                  left={
                    <p>
                      {target.install ? "Installer" : "Retirer"} les agents et
                      skills communs {target.install ? "dans" : "de"}{" "}
                      {project.fullName}.
                    </p>
                  }
                  onReset={() => show(null)}
                  onCommit={() => {
                    setProblem(null);
                    commit.mutate(() =>
                      client.api.projects[":id"].plugins.apply.$post(
                        { param: { id: String(project.id) } },
                        {
                          init: {
                            body: JSON.stringify({
                              install: target.install,
                              before: project.settings,
                            }),
                            headers: json,
                          },
                        },
                      ),
                    );
                  }}
                />
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
