import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useMemo, useState } from "react";
import { Link } from "react-router";
import { parseSkill, type SkillFields, writeSkill } from "./agent-file.ts";
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
  chipLink,
  dangerButton,
  field,
  focusRing,
  ghostButton,
  listCard,
  primaryButton,
  sectionLabel,
} from "./ui.ts";

/** The value of `?fichier=` for each chip other than Agents (decision 065 D). */
export const FILES = ["claude-md", "regles", "skills", "mcp"] as const;
export type ClaudeFile = (typeof FILES)[number];

// The skills the catalogue keeps up to date: the server refuses them (decision 065 B).
const CATALOG_SKILLS = ["dev-us", "write-us", "analyser"];
const NAME = /^[a-z0-9][a-z0-9-]*$/;
// The name must fit `.claude/skills/<name>/SKILL.md` in 255 characters (decision 026 D); a rule's path is shorter.
const MAX_NAME = 231;
const validName = (name: string, taken: string[]) =>
  NAME.test(name) && name.length <= MAX_NAME && !taken.includes(name);

type Kind = "claude_md" | "rule" | "skill" | "mcp_json";
/** What is open: `before` is the text read (null for an addition), `name` is absent for CLAUDE.md, .mcp.json and a new skill. */
type Open = { kind: Kind; name?: string; before: string | null };
type Sent = Open & { after: string | null };
type Commit = (after: string | null) => void;

export async function fetchClaudeConfig(id: string) {
  const res = await client.api.projects[":id"]["claude-config"].$get({
    param: { id },
  });
  if (!res.ok) return { failure: await failure(res) };
  return { data: await res.json() };
}

/** The sentence beside the button of a refusal (decision 065 G): the server's codes are never shown. */
function refusal(problem: Failure) {
  if (problem.code === "repo_changed")
    return "Ce fichier a changé sur GitHub entre-temps. Recharge la page pour repartir de la version de GitHub.";
  if (problem.code === "invalid_json")
    return "Ce JSON n'est pas valide : corrige-le avant de faire le commit.";
  if (problem.code === "secret_in_clear")
    return `${problem.at} doit être une référence comme \${GITHUB_TOKEN} : un secret n'est jamais écrit dans un repo.`;
  return message(problem);
}

/** A text, its diff and the commit (decision 065 E); `left` is where the text is typed. */
export function Editor({
  before,
  after,
  valid = true,
  file,
  left,
  archived,
  pending,
  deleteLabel,
  onCommit,
  onReset,
}: {
  before: string | null;
  after: string;
  /** False while what is typed could not be written (a skill without name or description). */
  valid?: boolean;
  file: string;
  left: ReactNode;
  archived: boolean;
  pending: boolean;
  deleteLabel?: string;
  onCommit: Commit;
  onReset: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const lines = useMemo(() => diffLines(before ?? "", after), [before, after]);
  const count = lines?.filter((l) => l.type !== "same").length ?? 0;
  return (
    <div className="mt-3 grid gap-4 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-3.5">{left}</div>
      <div className="flex min-w-0 flex-col gap-2">
        <h3 className={sectionLabel}>Ce qui change</h3>
        {lines ? (
          <DiffList lines={lines} />
        ) : (
          <pre className="overflow-x-auto whitespace-pre-wrap text-sm">
            {after}
          </pre>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 lg:col-span-2">
        <button
          type="button"
          disabled={archived || pending || !valid || after === (before ?? "")}
          aria-busy={pending}
          onClick={() => onCommit(after)}
          className={primaryButton}
        >
          Faire le commit
        </button>
        <button type="button" onClick={onReset} className={ghostButton}>
          Annuler les changements
        </button>
        <span className="text-[12.5px] text-muted-foreground">
          {plural(count, "ligne changée", "lignes changées")} · refusé si {file}{" "}
          a changé sur GitHub entre-temps
        </span>
        {archived && (
          <span className="text-[12.5px]">
            {message({ code: "project_archived", status: 409 })}
          </span>
        )}
        {deleteLabel && before !== null && (
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {confirming ? (
              <>
                <button
                  type="button"
                  disabled={archived || pending}
                  aria-busy={pending}
                  onClick={() => onCommit(null)}
                  className={dangerButton}
                >
                  Confirmer la suppression
                </button>
                <button
                  type="button"
                  // The button that asked is gone: keep the keyboard focus on the safe choice.
                  // biome-ignore lint/a11y/noAutofocus: focus moves with the confirmation the user just asked for
                  autoFocus
                  onClick={() => setConfirming(false)}
                  className={button}
                >
                  Annuler
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={archived || pending}
                aria-busy={pending}
                onClick={() => setConfirming(true)}
                className={ghostButton}
              >
                {deleteLabel}
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

type EditorProps = { archived: boolean; pending: boolean; onCommit: Commit };

function TextEditor({
  before,
  file,
  deleteLabel,
  ...rest
}: EditorProps & {
  before: string | null;
  file: string;
  deleteLabel?: string;
}) {
  const [text, setText] = useState(before ?? "");
  return (
    <Editor
      {...rest}
      before={before}
      after={text}
      file={file}
      deleteLabel={deleteLabel}
      onReset={() => setText(before ?? "")}
      left={
        <div>
          <label
            htmlFor="claude-text"
            className="block text-[13px] font-semibold"
          >
            Ton texte
          </label>
          <textarea
            id="claude-text"
            rows={14}
            className={`${field} font-mono text-[12.5px] leading-[1.6]`}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
      }
    />
  );
}

export function SkillEditor({
  open,
  taken,
  dir = ".claude/skills",
  onCommit,
  ...rest
}: Omit<EditorProps, "onCommit"> & {
  open: Open;
  taken: string[];
  /** Where the skills live, `.claude/skills` in a repo. */
  dir?: string;
  /** The name is the one typed when the skill is new. */
  onCommit: (after: string | null, name: string) => void;
}) {
  const initial = parseSkill(open.before ?? "") ?? {
    description: "",
    tools: "",
    body: "",
  };
  const [name, setName] = useState(open.name ?? "");
  const [fields, setFields] = useState<SkillFields>(initial);
  const set = (key: keyof SkillFields) => (value: string) =>
    setFields((current) => ({ ...current, [key]: value }));
  // Unchanged fields keep the text as it is, so that opening a skill is not a change.
  const after =
    open.before !== null && JSON.stringify(fields) === JSON.stringify(initial)
      ? open.before
      : writeSkill(name, fields);
  const label = "block text-[13px] font-semibold";
  return (
    <Editor
      {...rest}
      before={open.before}
      after={after}
      valid={
        (open.name !== undefined || validName(name, taken)) &&
        fields.description.trim() !== ""
      }
      file={`${dir}/${name || "<nom>"}/SKILL.md`}
      deleteLabel="Supprimer le skill"
      onCommit={(after) => onCommit(after, name)}
      onReset={() => setFields(initial)}
      left={
        <>
          {open.name === undefined && (
            <div>
              <label htmlFor="skill-name" className={label}>
                Nom
              </label>
              <input
                id="skill-name"
                className={field}
                value={name}
                maxLength={MAX_NAME}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          )}
          <div>
            <label htmlFor="skill-description" className={label}>
              Description
            </label>
            <input
              id="skill-description"
              className={field}
              value={fields.description}
              onChange={(e) => set("description")(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="skill-tools" className={label}>
              Outils autorisés
            </label>
            <input
              id="skill-tools"
              className={field}
              value={fields.tools}
              onChange={(e) => set("tools")(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="skill-body" className={label}>
              Consigne
            </label>
            <textarea
              id="skill-body"
              rows={10}
              className={`${field} font-mono text-[12.5px] leading-[1.6]`}
              value={fields.body}
              onChange={(e) => set("body")(e.target.value)}
            />
          </div>
        </>
      }
    />
  );
}

function NewRule({
  taken,
  onContinue,
}: {
  taken: string[];
  onContinue: (name: string) => void;
}) {
  const [name, setName] = useState("");
  return (
    <div className={`${card} mt-4 p-4`}>
      <label htmlFor="rule-name" className="block">
        Nom de la règle
      </label>
      <input
        id="rule-name"
        className={field}
        value={name}
        maxLength={MAX_NAME}
        onChange={(e) => setName(e.target.value)}
      />
      <button
        type="button"
        disabled={!validName(name, taken)}
        onClick={() => onContinue(name)}
        className={`mt-3 ${button}`}
      >
        Continuer
      </button>
    </div>
  );
}

/** Decision 065: the editors of CLAUDE.md, the rules, the skills and .mcp.json, behind the chips of the tab « Agents ». */
export function ProjectClaudeConfig({
  projectId,
  fullName,
  archived,
  fichier,
  config,
}: {
  projectId: string;
  fullName: string;
  archived: boolean;
  fichier: ClaudeFile;
  config: {
    data?: Awaited<ReturnType<typeof fetchClaudeConfig>>;
    isError: boolean;
  };
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<Open | null>(null);
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState<Failure | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [last, setLast] = useState<Sent | null>(null);

  const commit = useMutation({
    mutationFn: async (sent: Sent) => {
      // The route reads its body by hand, so the client does not type it: `init` sends it.
      const res = await client.api.projects[":id"]["claude-config"].apply.$post(
        { param: { id: projectId } },
        {
          init: {
            body: JSON.stringify(sent),
            headers: { "content-type": "application/json" },
          },
        },
      );
      return res.ok
        ? { done: await res.json() }
        : { failure: await failure(res) };
    },
    onSuccess: (answer) => {
      if (answer.failure) return setProblem(answer.failure);
      const { commitSha, pullRequest } = answer.done;
      setDone({
        url:
          pullRequest?.url ??
          `https://github.com/${fullName}/commit/${commitSha}`,
        pullRequest: pullRequest !== undefined,
      });
      // A rule or a skill is left once written; the page reads the repo and the health again.
      setOpen(null);
      queryClient.invalidateQueries({ queryKey: ["health", projectId] });
      return queryClient.invalidateQueries({
        queryKey: ["claude-config", projectId],
      });
    },
    onError: () => setProblem({ code: "", status: 0 }),
  });
  const send = (sent: Sent) => {
    setProblem(null);
    setDone(null);
    setLast(sent);
    commit.mutate(sent);
  };
  const sendTo =
    (target: Open): Commit =>
    (after) =>
      send({ ...target, after });

  const failed =
    config.data?.failure ??
    (config.isError ? { code: "", status: 0 } : undefined);
  const data = config.data?.data;
  const common = { archived, pending: commit.isPending };
  const items = fichier === "regles" ? data?.rules : data?.skills;
  const names = items?.map((i) => i.name) ?? [];
  const list = (kind: "rule" | "skill") => (
    <>
      <ul className={`mt-2 ${listCard}`}>
        {items?.map((item) => (
          <li key={item.name} className="min-h-[50px]">
            <button
              type="button"
              aria-label={`Ouvrir ${item.name}`}
              // A file Cockpit cannot read (symlink, too large) is not rewritten.
              disabled={item.text === ""}
              onClick={() => {
                setProblem(null);
                setDone(null);
                setAdding(false);
                setOpen({ kind, name: item.name, before: item.text });
              }}
              className={`flex min-h-[50px] w-full items-center px-[18px] py-2 text-left font-semibold hover:bg-raised disabled:opacity-50 ${focusRing}`}
            >
              {item.name}
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={archived}
        onClick={() => {
          setOpen(kind === "skill" ? { kind, before: null } : null);
          setAdding(kind === "rule");
        }}
        className={`mt-2 ${button}`}
      >
        {kind === "rule" ? "+ Nouvelle règle" : "+ Nouveau skill"}
      </button>
      {adding && (
        <NewRule
          taken={names}
          onContinue={(name) => {
            setAdding(false);
            setOpen({ kind, name, before: null });
          }}
        />
      )}
    </>
  );
  const unreadable =
    (fichier === "claude-md" && data?.claudeMd === "") ||
    (fichier === "mcp" && data?.mcpJson === "");
  const key = open && `${open.kind}\n${open.name}\n${open.before}`;
  return (
    <section className="mx-[26px] mt-4" aria-label="Ce que Claude lit">
      {!config.data && !config.isError && (
        <p className="loading text-muted-foreground">Chargement…</p>
      )}
      {failed && (
        <div role="alert" className={`mt-3 ${alertBox}`}>
          <p>{message(failed)}</p>
        </div>
      )}
      {problem && (
        <div role="alert" className={`mt-3 ${alertBox}`}>
          <p>{refusal(problem)}</p>
          {problem.settingsUrl && (
            <a href={problem.settingsUrl} className={`underline ${focusRing}`}>
              Réglages de l'App sur GitHub
            </a>
          )}
          {problem.status === 502 && last && (
            <button
              type="button"
              onClick={() => send(last)}
              className={`mt-2 ${button}`}
            >
              Réessayer
            </button>
          )}
        </div>
      )}
      {done && <DoneBox done={done} />}
      {data && unreadable && (
        <p className="mt-3">
          Ce fichier est vide ou ne se lit pas depuis Cockpit (lien symbolique
          ou trop gros) : modifie-le sur GitHub.
        </p>
      )}
      {data && !unreadable && fichier === "claude-md" && (
        <TextEditor
          key={String(data.claudeMd)}
          {...common}
          before={data.claudeMd}
          file="CLAUDE.md"
          onCommit={sendTo({ kind: "claude_md", before: data.claudeMd })}
        />
      )}
      {data && !unreadable && fichier === "mcp" && (
        <TextEditor
          key={String(data.mcpJson)}
          {...common}
          before={data.mcpJson}
          file=".mcp.json"
          onCommit={sendTo({ kind: "mcp_json", before: data.mcpJson })}
        />
      )}
      {data && fichier === "regles" && list("rule")}
      {data && fichier === "skills" && list("skill")}
      {data && open?.kind === "rule" && (
        <TextEditor
          key={key}
          {...common}
          before={open.before}
          file={`.claude/rules/${open.name}.md`}
          deleteLabel="Supprimer la règle"
          onCommit={sendTo(open)}
        />
      )}
      {data &&
        open?.kind === "skill" &&
        (open.before !== null && !parseSkill(open.before) ? (
          <TextEditor
            key={key}
            {...common}
            before={open.before}
            file={`.claude/skills/${open.name}/SKILL.md`}
            deleteLabel="Supprimer le skill"
            onCommit={sendTo(open)}
          />
        ) : (
          <SkillEditor
            key={key}
            {...common}
            open={open}
            taken={[...names, ...CATALOG_SKILLS]}
            onCommit={(after, name) => sendTo({ ...open, name })(after)}
          />
        ))}
    </section>
  );
}

/** The chips of the tab « Agents » (decision 065 D): the open one has `aria-current`, the address keeps it. */
export function ClaudeChips({
  projectId,
  fichier,
  counts,
}: {
  projectId: string;
  fichier: ClaudeFile | null;
  counts: {
    rules: number | undefined;
    skills: number | undefined;
    agents: number | undefined;
  };
}) {
  const chip = (file: ClaudeFile | null, label: string, n?: number) => (
    <Link
      to={`/projets/${projectId}/agents${file ? `?fichier=${file}` : ""}`}
      aria-current={fichier === file ? "true" : undefined}
      className={chipLink({ isActive: fichier === file })}
    >
      {n === undefined ? label : `${label} · ${n}`}
    </Link>
  );
  return (
    <div className="mx-[26px] mt-4 flex flex-wrap gap-2">
      {chip("claude-md", "CLAUDE.md")}
      {chip("regles", "Règles", counts.rules)}
      {chip("skills", "Skills", counts.skills)}
      {chip(null, "Agents", counts.agents)}
      {chip("mcp", ".mcp.json")}
    </div>
  );
}
