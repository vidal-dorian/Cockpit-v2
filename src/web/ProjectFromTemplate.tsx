import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { client } from "./api.ts";
import { LABELS } from "./ProjectPage.tsx";
import { StateSentence } from "./Shell.tsx";
import {
  alertBox,
  button,
  card,
  field,
  focusRing,
  primaryButton,
  sectionLabel,
  urgentBadge,
} from "./ui.ts";

const GITHUB_DOWN =
  "GitHub ne répond pas comme prévu, réessaie dans un instant.";
const NO_PERMISSION =
  "Cockpit n'a pas encore le droit de créer des repos. Approuve la nouvelle permission sur GitHub.";
// The characters GitHub accepts (decision 068 C); the server judges again.
const VALID_NAME = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;

/** The templates of the user's installation, or null when the server answers 401. */
async function fetchTemplates() {
  const res = await client.api.templates.$get();
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** The sentence for the code the server sent the user back with (decision 068 D, E, G). */
function ReturnAlert({ installUrl }: { installUrl: string }) {
  const [params, setParams] = useSearchParams();
  const code = params.get("erreur");
  if (code === "hors-installation")
    return (
      <div role="alert" className={alertBox}>
        <p>Le repo est créé. Ouvre-le à Cockpit sur GitHub, puis importe-le.</p>
        <p className="mt-3 flex gap-2">
          <a href={installUrl} className={button}>
            Ouvrir l'installation sur GitHub
          </a>
          <Link to="/projets#importer" className={button}>
            Importer
          </Link>
        </p>
      </div>
    );
  const text = {
    "github-injoignable": GITHUB_DOWN,
    "creee-non-importee":
      "Le repo est peut-être créé sur GitHub ; importe-le depuis « Importer un repo ».",
    "demande-expiree": "Recommence la création.",
    annulee: "La création est annulée.",
    quota:
      "Ton abonnement Gratuit couvre 3 repos, archivés compris. Passe à Pro pour en ajouter.",
    refusee: `GitHub a refusé la création : ${(params.get("raison") ?? "").slice(0, 200)}`,
  }[code ?? ""] as string | undefined;
  return text ? (
    <div role="alert" className={alertBox}>
      <p>{text}</p>
      {code === "github-injoignable" && (
        <button
          type="button"
          onClick={() => setParams({})}
          className={`mt-3 ${button}`}
        >
          Réessayer
        </button>
      )}
      {code === "creee-non-importee" && (
        <Link to="/projets#importer" className={`mt-3 ${button}`}>
          Importer un repo
        </Link>
      )}
    </div>
  ) : null;
}

export function ProjectFromTemplate() {
  const templates = useQuery({
    queryKey: ["templates"],
    queryFn: fetchTemplates,
  });
  const [chosen, setChosen] = useState<string>();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setPrivate] = useState(true);
  const [owner, setOwner] = useState<string>();
  // The name is only read on GitHub once the typing has stopped.
  const [typed, setTyped] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setTyped(name), 400);
    return () => clearTimeout(timer);
  }, [name]);
  const ownerName = owner ?? templates.data?.owners[0] ?? "";
  const judged = typed === name && VALID_NAME.test(name);
  const availability = useQuery({
    queryKey: ["template-name", ownerName, typed],
    queryFn: async () => {
      const res = await client.api.templates.name.$get({
        query: { owner: ownerName, name: typed },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { available: boolean };
    },
    enabled: judged && ownerName !== "",
  });
  const create = useMutation({
    mutationFn: async (json: {
      template: string;
      owner: string;
      name: string;
      description: string;
      private: boolean;
    }) => {
      const res = await client.api.projects["from-template"].$post({ json });
      if (res.ok)
        return window.location.assign((await res.json()).authorizeUrl);
      const { error } = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(
        error === "name_taken"
          ? "Ce nom est déjà pris."
          : error === "not_a_template"
            ? "Ce repo n'est plus un modèle."
            : res.status === 502
              ? GITHUB_DOWN
              : `Impossible de créer le projet (HTTP ${res.status}).`,
      );
    },
  });

  if (templates.isPending)
    return <p className="mx-[26px] mt-6 text-muted-foreground">Chargement…</p>;
  if (templates.isError)
    return (
      <div role="alert" className={`m-[26px] ${alertBox}`}>
        <p>Impossible de lire tes modèles : {templates.error.message}</p>
        <button
          type="button"
          onClick={() => templates.refetch()}
          className={`mt-3 ${button}`}
        >
          Réessayer
        </button>
      </div>
    );
  if (templates.data === null)
    return (
      <a href="/api/auth/login" className={`m-[26px] ${primaryButton}`}>
        Se connecter avec GitHub
      </a>
    );
  const { installed, installUrl, owners, permission } = templates.data;
  const list = templates.data.templates;
  const template =
    list.find((t) => t.fullName === chosen) ?? (list[0] as (typeof list)[0]);
  const canCreate =
    availability.data?.available === true &&
    judged &&
    permission.repositoryCreation;
  const state = !name
    ? null
    : !VALID_NAME.test(name)
      ? "Lettres, chiffres, point, tiret et tiret bas, 100 au plus."
      : availability.isError
        ? "Impossible de vérifier ce nom, réessaie dans un instant."
        : !judged || availability.isPending
          ? "Vérification…"
          : availability.data?.available
            ? "Disponible."
            : "Ce nom est déjà pris.";

  return (
    <main className="pb-6">
      <StateSentence
        title="Un nouveau projet, déjà prêt pour Claude."
        rest="Cockpit crée le repo à partir de ton modèle."
      />
      <div className="mx-[26px] mt-5 grid gap-4">
        <ReturnAlert installUrl={installUrl} />
        {list.length === 0 ? (
          <p className="text-muted-foreground">
            {installed ? (
              "Tu n'as pas encore de repo modèle. Coche « Template repository » dans les réglages d'un repo sur GitHub, puis reviens."
            ) : (
              <a href={installUrl} className={`underline ${focusRing}`}>
                Installer l'App sur mes repos
              </a>
            )}
          </p>
        ) : (
          <form
            className="grid gap-6 lg:grid-cols-[1fr_320px]"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate({
                template: template.fullName,
                owner: ownerName,
                name,
                description,
                private: isPrivate,
              });
            }}
          >
            <div className="grid content-start gap-4">
              <div>
                <label htmlFor="repo-name" className={sectionLabel}>
                  Nom du repo
                </label>
                <div className="flex items-center gap-2">
                  {owners.length > 1 ? (
                    <select
                      aria-label="Propriétaire"
                      value={ownerName}
                      onChange={(event) => setOwner(event.target.value)}
                      className={field}
                    >
                      {owners.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="mt-1">{ownerName}/</span>
                  )}
                  <input
                    id="repo-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className={field}
                  />
                </div>
                {state && (
                  <p className="mt-1 text-[12.5px] text-muted-foreground">
                    {state}
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="repo-description" className={sectionLabel}>
                  Description
                </label>
                <input
                  id="repo-description"
                  value={description}
                  maxLength={350}
                  onChange={(event) => setDescription(event.target.value)}
                  className={field}
                />
              </div>
              <div role="radiogroup" aria-label="Modèle" className="grid gap-2">
                <p className={sectionLabel}>Modèle</p>
                {list.map((t) => (
                  <label
                    key={t.githubRepoId}
                    className={`${card} flex cursor-pointer items-start gap-2 p-3 has-[:checked]:border-foreground`}
                  >
                    <input
                      type="radio"
                      name="template"
                      checked={t.fullName === template.fullName}
                      onChange={() => setChosen(t.fullName)}
                      className="mt-1"
                    />
                    <span>
                      <span className="block font-semibold">
                        {t.fullName.split("/")[1]}
                      </span>
                      <span className="block font-mono text-[11.5px] text-muted-foreground">
                        {t.fullName}
                      </span>
                      <span className="block text-[12.5px] text-muted-foreground">
                        {t.lines.filter((l) => l.ok).length} lignes vertes sur{" "}
                        {t.lines.length}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <div
                role="radiogroup"
                aria-label="Visibilité"
                className="flex gap-4"
              >
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="visibility"
                    checked={isPrivate}
                    onChange={() => setPrivate(true)}
                  />
                  Privé
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="visibility"
                    checked={!isPrivate}
                    onChange={() => setPrivate(false)}
                  />
                  Public
                </label>
              </div>
            </div>
            <div className="grid content-start gap-3">
              <aside className={`${card} p-4`}>
                <h2 className={`mb-2 ${sectionLabel}`}>
                  Le bilan sera vert d'emblée
                </h2>
                <ul className="grid gap-2">
                  {template.lines.map((line) => (
                    <li key={line.key} className="flex items-center gap-2">
                      <span aria-hidden="true" className="w-4 text-dim">
                        {line.ok ? "✓" : "✕"}
                      </span>
                      <span className="flex-1">{LABELS[line.key]}</span>
                      {!line.ok && (
                        <span className={urgentBadge}>À corriger</span>
                      )}
                    </li>
                  ))}
                </ul>
                {template.lines.some((l) => !l.ok) && (
                  <>
                    <p className="mt-3 text-[12.5px] text-muted-foreground">
                      Ce modèle n'est pas tout vert : prépare-le d'abord pour
                      Claude.
                    </p>
                    <Link
                      to="/projets"
                      className={`mt-2 underline ${focusRing}`}
                    >
                      Gérer mes modèles
                    </Link>
                  </>
                )}
              </aside>
              {!permission.repositoryCreation && (
                <p className="text-[12.5px] text-muted-foreground">
                  <span>{NO_PERMISSION}</span>{" "}
                  <a
                    href={permission.installationUrl}
                    className={`underline ${focusRing}`}
                  >
                    Ouvrir GitHub
                  </a>
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={!canCreate || create.isPending}
                  className={primaryButton}
                >
                  Créer le projet
                </button>
                <Link to="/projets" className={button}>
                  Annuler
                </Link>
              </div>
              {create.error && (
                <div role="alert" className={alertBox}>
                  <p>{create.error.message}</p>
                  {create.error.message === GITHUB_DOWN && (
                    <button
                      type="button"
                      onClick={() => create.mutate(create.variables)}
                      className={`mt-3 ${button}`}
                    >
                      Réessayer
                    </button>
                  )}
                </div>
              )}
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
