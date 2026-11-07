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

// The three files of decisions 043 M and 047 M, as the catalog names them.
const ANALYSER_FILES = [
  ".claude/skills/analyser/SKILL.md",
  ".claude/agents/cartographer.md",
  ".claude/agents/rules-analyst.md",
];

const storageKey = (projectId: string) => `cockpit.clone.${projectId}`;

/** Decisions 043 L and M and 047 L and M, in the right panel: the link that opens Claude on the clone with /analyser (the map, the rules of some features, or both), and for a repo that lacks the three files, their addition with the write of decision 026. */
export function AnalyseWindow({
  projectId,
  fullName,
  archived,
  initialRules = false,
  onClose,
}: {
  projectId: string;
  fullName: string;
  archived: boolean;
  /** « Règles » checked when the window opens (decision 048 J). */
  initialRules?: boolean;
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
  const [map, setMap] = useState(true);
  const [rules, setRules] = useState(initialRules);
  const [features, setFeatures] = useState("");
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
  const cases = [map && "carte", rules && "regles"].filter(Boolean);
  const prompt = `/analyser ${cases.join(" ")}${rules ? ` ${features.trim()}` : ""}`;
  // What is missing from the prompt, said next to the button (decision 045 K).
  const lacking =
    cases.length === 0
      ? "Coche au moins une analyse : la carte ou les règles."
      : rules && !features.trim()
        ? "Indique les fonctionnalités à reprendre pour lancer Claude."
        : null;
  const href = `claude://code/new?folder=${encodeURIComponent(cleanFolder)}&q=${encodeURIComponent(prompt)}`;
  const plan = read.data?.plan;
  const missing = files.some((f) => f.status === "create");

  return (
    <Panel
      label="Analyser avec Claude"
      footer={
        <>
          <a
            className={`${panelPrimaryButton} aria-disabled:opacity-50`}
            {...(cleanFolder && !lacking
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
            disabled={!!lacking}
            onClick={() =>
              navigator.clipboard
                .writeText(prompt)
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
        Claude lit le repo, dépose la carte du code ou les règles à valider, et
        Cockpit vérifie chaque citation sur GitHub.
      </p>
      <fieldset className="grid gap-2">
        <legend className="sr-only">Ce que Claude analyse</legend>
        <label className="flex items-center gap-2.5 font-semibold">
          <input
            type="checkbox"
            checked={map}
            onChange={(e) => setMap(e.target.checked)}
          />
          Carte
        </label>
        <label className="flex items-center gap-2.5 font-semibold">
          <input
            type="checkbox"
            checked={rules}
            onChange={(e) => setRules(e.target.checked)}
          />
          Règles
        </label>
      </fieldset>
      {rules && (
        <label className="block font-semibold">
          Fonctionnalités à reprendre
          <input
            required
            className={field}
            value={features}
            placeholder="Connexion, Facturation"
            onChange={(e) => setFeatures(e.target.value)}
          />
        </label>
      )}
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
      {lacking && <p>{lacking}</p>}
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
                // The plan as received (base commit and signature), reduced to the three files.
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
