import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { client } from "./api.ts";
import {
  type Failure,
  FileRow,
  failure,
  message,
  type Plan,
  readPlan,
} from "./ProjectPrepare.tsx";
import { Panel } from "./Shell.tsx";
import {
  alertBox,
  button,
  field,
  ghostButton,
  listCard,
  panelButton,
  panelPrimaryButton,
} from "./ui.ts";

// The two files of decision 043 M, as the catalog names them.
const ANALYSER_FILES = [
  ".claude/skills/analyser/SKILL.md",
  ".claude/agents/cartographer.md",
];
const PROMPT = "/analyser";

const storageKey = (projectId: string) => `cockpit.clone.${projectId}`;

/** Decision 043 L and M, in the right panel: the link that opens Claude on the clone with /analyser, and for a repo that lacks the two files, their addition with the write of decision 026. */
export function AnalyseWindow({
  projectId,
  fullName,
  archived,
  onClose,
}: {
  projectId: string;
  fullName: string;
  archived: boolean;
  onClose: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  const [folder, setFolder] = useState(() => {
    try {
      return window.localStorage.getItem(storageKey(projectId)) ?? "";
    } catch {
      return "";
    }
  });
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  const [problem, setProblem] = useState<Failure | null>(null);
  const [done, setDone] = useState<{
    url: string;
    pullRequest: boolean;
  } | null>(null);
  // Read when the window opens (a POST that writes nothing); an unreadable plan only means no proposal.
  const read = useQuery({
    queryKey: ["analyse-plan", projectId],
    queryFn: () => readPlan(projectId),
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const files = (read.data?.plan?.files ?? []).filter((f) =>
    ANALYSER_FILES.includes(f.path),
  );
  const commit = useMutation({
    mutationFn: async (sent: Plan) => {
      const res = await client.api.projects[":id"].prepare.apply.$post(
        { param: { id: projectId } },
        {
          init: {
            body: JSON.stringify({ plan: sent }),
            headers: { "content-type": "application/json" },
          },
        },
      );
      return res.ok
        ? { done: await res.json() }
        : { failure: await failure(res) };
    },
    onSuccess: (answer) => {
      if (answer.failure) {
        setProblem(answer.failure);
        if (answer.failure.code === "repo_changed") read.refetch();
        return;
      }
      const { commitSha, pullRequest } = answer.done;
      setDone({
        url:
          pullRequest?.url ??
          `https://github.com/${fullName}/commit/${commitSha}`,
        pullRequest: !!pullRequest,
      });
    },
    onError: () => setProblem({ code: "", status: 0 }),
  });

  const cleanFolder = folder
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .trim();
  const href = `claude://code/new?folder=${encodeURIComponent(cleanFolder)}&q=${encodeURIComponent(PROMPT)}`;
  const plan = read.data?.plan;
  const missing = files.some((f) => f.status === "create");

  return (
    <Panel
      label="Analyser avec Claude"
      footer={
        <>
          <a
            className={`${panelPrimaryButton} aria-disabled:opacity-50`}
            {...(cleanFolder
              ? {
                  href,
                  onClick: () => {
                    try {
                      window.localStorage.setItem(
                        storageKey(projectId),
                        cleanFolder,
                      );
                    } catch {}
                  },
                }
              : { "aria-disabled": true, role: "link" })}
          >
            <span>Ouvrir Claude</span>
          </a>
          <button
            type="button"
            className={panelButton}
            onClick={() =>
              navigator.clipboard
                .writeText(PROMPT)
                .then(() => setCopied("yes"))
                .catch(() => setCopied("no"))
            }
          >
            Copier le prompt
          </button>
          {copied === "yes" && (
            <span role="status" className="text-center text-muted-foreground">
              Copié
            </span>
          )}
          {copied === "no" && (
            <span role="status" className="text-center text-destructive">
              Copie impossible
            </span>
          )}
          <button type="button" className={ghostButton} onClick={onClose}>
            Annuler
          </button>
        </>
      }
    >
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="text-xl leading-snug font-semibold"
      >
        Analyser avec Claude
      </h2>
      <p className="text-muted-foreground">
        Claude lit le repo, dépose la carte du code, et Cockpit vérifie chaque
        citation sur GitHub.
      </p>
      <label className="block font-semibold">
        Dossier du clone
        <input
          required
          className={field}
          value={folder}
          placeholder="C:\Users\dorian\code\mon-repo ou /home/dorian/code/mon-repo"
          onChange={(e) => setFolder(e.target.value)}
        />
      </label>
      {!cleanFolder && <p>Indique le dossier du clone pour lancer Claude.</p>}
      {files.length > 0 && (
        <div>
          {missing && (
            <p className="mb-2">
              Ce repo n'a pas encore /analyser : ajoute-le avant de lancer
              Claude.
            </p>
          )}
          <ul className={listCard}>
            {files.map((file) => (
              <FileRow key={file.path} file={file} />
            ))}
          </ul>
          {missing && plan && !done && (
            <button
              type="button"
              className={`mt-3 ${button}`}
              disabled={archived || commit.isPending}
              onClick={() => {
                setProblem(null);
                // The plan as received (base commit and signature), reduced to the two files.
                commit.mutate({ ...plan, files });
              }}
            >
              Ajouter /analyser au repo
            </button>
          )}
        </div>
      )}
      {problem && (
        <div role="alert" className={alertBox}>
          <p>{message(problem)}</p>
        </div>
      )}
      {done && (
        <p>
          {done.pullRequest
            ? "La branche par défaut est protégée : une pull request est ouverte"
            : "C'est fait"}
          .{" "}
          <a href={done.url} className="underline">
            {done.pullRequest ? "Voir la pull request" : "Voir le commit"}
          </a>
        </p>
      )}
    </Panel>
  );
}
