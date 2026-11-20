import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { client } from "./api.ts";
import {
  type Failure,
  FileRow,
  failure,
  message,
  type Plan,
  readPlan,
} from "./ProjectPrepare.tsx";
import { fetchProjects } from "./Projects.tsx";
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

// The seven files of /analyser (decisions 043 M, 047 M, 051 K and 052 K), as the catalog names them.
const ANALYSER_FILES = [
  ".claude/skills/analyser/SKILL.md",
  ".claude/agents/cartographer.md",
  ".claude/agents/rules-analyst.md",
  ".claude/agents/bug-hunter.md",
  ".claude/agents/security-reviewer.md",
  ".claude/agents/architect.md",
  ".claude/agents/upgrade-advisor.md",
];

const storageKey = (projectId: string) => `cockpit.clone.${projectId}`;

export type Step =
  | "map"
  | "bugs"
  | "security"
  | "architecture"
  | "versions"
  | "rules";

/** Decisions 043 L and M and 047 L and M, in the right panel: the link that opens Claude on the clone with /analyser (the map, the rules of some features, or both), and for a repo that lacks the seven files, their addition with the write of decision 026. */
export function AnalyseWindow({
  projectId,
  fullName,
  archived,
  steps = ["map"],
  onClose,
}: {
  projectId: string;
  fullName: string;
  archived: boolean;
  /** The steps checked when the window opens: the one that was asked for (decisions 048 J, 052 J and 085 D). */
  steps?: Step[];
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
  const [map, setMap] = useState(steps.includes("map"));
  const [bugs, setBugs] = useState(steps.includes("bugs"));
  const [security, setSecurity] = useState(steps.includes("security"));
  const [architecture, setArchitecture] = useState(
    steps.includes("architecture"),
  );
  const [versions, setVersions] = useState(steps.includes("versions"));
  const [rules, setRules] = useState(steps.includes("rules"));
  const [features, setFeatures] = useState("");
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  const [problem, setProblem] = useState<Failure | null>(null);
  const [done, setDone] = useState<{
    url: string;
    pullRequest: boolean;
  } | null>(null);
  // The takeover is Pro (decision 077 D): the plan of the project's owner comes with the projects.
  const projects = useQuery({ queryKey: ["projects"], queryFn: fetchProjects });
  const free =
    projects.data?.find((p) => String(p.id) === projectId)?.ownerPlan ===
    "free";
  // Read when the window opens (a POST that writes nothing); an unreadable plan only means no proposal.
  const read = useQuery({
    queryKey: ["analyse-plan", projectId],
    queryFn: () => readPlan(projectId),
    enabled: projects.isSuccess && !free,
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
  const cases = [
    map && "carte",
    bugs && "bugs",
    security && "securite",
    architecture && "architecture",
    versions && "versions",
    rules && "regles",
  ].filter(Boolean);
  const prompt = `/analyser ${cases.join(" ")}${rules ? ` ${features.trim()}` : ""}`;
  // What is missing from the prompt, said next to the button (decision 045 K).
  const lacking =
    cases.length === 0
      ? "Coche au moins une analyse : la carte, les constats ou les règles."
      : rules && !features.trim()
        ? "Indique les fonctionnalités à reprendre pour lancer Claude."
        : null;
  const href = `claude://code/new?folder=${encodeURIComponent(cleanFolder)}&q=${encodeURIComponent(prompt)}`;
  const plan = read.data?.plan;
  const missing = files.some((f) => f.status === "create");
  // Decision 049 G: an old original copy is replaced too.
  const writable = files.some(
    (f) => f.status === "create" || f.status === "update",
  );

  if (free)
    return (
      <Panel
        label="Analyser avec Claude"
        footer={
          <button type="button" className={ghostButton} onClick={onClose}>
            Annuler
          </button>
        }
      >
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-xl leading-snug font-semibold"
        >
          Analyser avec Claude
        </h2>
        <p>La reprise fait partie de l'offre Pro.</p>
        <Link to="/reglages/abonnement" className="underline">
          Abonnement
        </Link>
      </Panel>
    );
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
        <label className="flex items-center gap-2.5 font-semibold">
          <input
            type="checkbox"
            checked={bugs}
            onChange={(e) => setBugs(e.target.checked)}
          />
          Bugs
        </label>
        <label className="flex items-center gap-2.5 font-semibold">
          <input
            type="checkbox"
            checked={security}
            onChange={(e) => setSecurity(e.target.checked)}
          />
          Sécurité
        </label>
        <label className="flex items-center gap-2.5 font-semibold">
          <input
            type="checkbox"
            checked={architecture}
            onChange={(e) => setArchitecture(e.target.checked)}
          />
          Architecture et stack
        </label>
        <label className="flex items-center gap-2.5 font-semibold">
          <input
            type="checkbox"
            checked={versions}
            onChange={(e) => setVersions(e.target.checked)}
          />
          Versions
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
          placeholder="C:\Users\vous\code\mon-repo ou /home/vous/code/mon-repo"
          onChange={(e) => setFolder(e.target.value)}
        />
      </label>
      {!cleanFolder && <p>Indique le dossier du clone pour lancer Claude.</p>}
      {lacking && <p>{lacking}</p>}
      {files.length > 0 && (
        <div>
          {missing && (
            <p className="mb-2">
              Il manque des fichiers de /analyser dans ce repo : ajoute-les
              avant de lancer Claude.
            </p>
          )}
          <ul className={listCard}>
            {files.map((file) => (
              <FileRow key={file.path} file={file} />
            ))}
          </ul>
          {writable && plan && !done && (
            <button
              type="button"
              className={`mt-3 ${button}`}
              disabled={archived || commit.isPending}
              aria-busy={commit.isPending}
              onClick={() => {
                setProblem(null);
                // The plan as received (base commit and signature), reduced to the seven files.
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
