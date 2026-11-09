import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { client } from "./api.ts";
import { ROLE_LABELS, type Role, roleRefusal } from "./roles.ts";
import { plural } from "./tickets.ts";
import {
  alertBox,
  button,
  chipLink,
  dangerButton,
  field,
  listCard,
  primaryButton,
  sectionLabel,
} from "./ui.ts";
import { ago } from "./when.ts";

type Invitable = Exclude<Role, "owner">;
const INVITABLE: Invitable[] = ["read_only", "can_validate", "can_launch"];

/** What the owner sees of the people on her projects (decision 076 F). */
export async function fetchMembers() {
  const res = await client.api.members.$get();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const sendJson = (value: unknown) => ({
  body: JSON.stringify(value),
  headers: { "content-type": "application/json" },
});

/** The French sentence of a refused invitation; the codes of the server are not meant to be read. */
async function inviteError(res: Response, login: string) {
  const error = ((await res.json().catch(() => null)) as { error?: string })
    ?.error;
  const known: Record<string, string> = {
    unknown_login: `GitHub ne connaît pas @${login}.`,
    already_member: `@${login} est déjà membre de ce projet.`,
    already_invited: `@${login} est déjà invité sur ce projet : renvoie-lui un lien depuis la liste.`,
    project_archived: "Ce projet est archivé : on n'y invite plus personne.",
    self: "C'est toi : tu es déjà propriétaire de ce projet.",
  };
  return new Error(
    roleRefusal(res.status, error) ??
      (error && known[error]) ??
      "L'opération a échoué, réessaie.",
  );
}

function RoleSelect({
  value,
  onChange,
}: {
  value: Invitable;
  onChange: (role: Invitable) => void;
}) {
  return (
    <select
      aria-label="Rôle"
      value={value}
      onChange={(event) => onChange(event.target.value as Invitable)}
      className={`${field} mt-0 w-auto`}
    >
      {INVITABLE.map((role) => (
        <option key={role} value={role}>
          {ROLE_LABELS[role]}
        </option>
      ))}
    </select>
  );
}

/** The link of an invitation, shown once: the server keeps only its hash. */
function InviteLink({ url }: { url: string }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <code className="min-w-0 break-all font-mono text-[12.5px]">{url}</code>
      <button
        type="button"
        onClick={() => navigator.clipboard.writeText(url)}
        className={button}
      >
        Copier
      </button>
      <p className="basis-full text-xs text-muted-foreground">
        Envoie-le toi-même : il ne sera plus montré, et vaut 7 jours.
      </p>
    </div>
  );
}

/** S48 (decision 076 D, F): inviting, then the people and invitations of the owner's projects. */
export function Members() {
  const queryClient = useQueryClient();
  const members = useQuery({ queryKey: ["members"], queryFn: fetchMembers });
  const [login, setLogin] = useState("");
  const [projectId, setProjectId] = useState<number | null>(null);
  const [role, setRole] = useState<Invitable>("can_validate");
  const [link, setLink] = useState<string | null>(null);
  // The row being edited, by project and user; one at a time, with its form in place of the invitation's.
  const [editing, setEditing] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<Invitable>("can_validate");
  const [removing, setRemoving] = useState(false);

  // `done` runs after a success (or a close): an old failure of another gesture is not shown any more.
  const done = () => {
    for (const m of [invite, renew, cancel, change, remove]) m.reset();
    setEditing(null);
    setRemoving(false);
    return queryClient.invalidateQueries({ queryKey: ["members"] });
  };
  const invite = useMutation({
    mutationFn: async () => {
      const clean = login.trim().replace(/^@/, "");
      // The routes read their body by hand (the role is checked first), so the client does not type it: `init` sends it.
      const res = await client.api.projects[":id"].invitations.$post(
        { param: { id: String(projectId) } },
        { init: sendJson({ login: clean, role }) },
      );
      if (!res.ok) throw await inviteError(res, clean);
      setLink((await res.json()).url);
    },
    onSuccess: () => {
      setLogin("");
      return done();
    },
  });
  const renew = useMutation({
    mutationFn: async (id: number) => {
      const res = await client.api.invitations[":id"].renew.$post({
        param: { id: String(id) },
      });
      if (!res.ok) throw await inviteError(res, "");
      setLink((await res.json()).url);
    },
    onSuccess: done,
  });
  const cancel = useMutation({
    mutationFn: async (id: number) => {
      const res = await client.api.invitations[":id"].$delete({
        param: { id: String(id) },
      });
      if (!res.ok) throw await inviteError(res, "");
    },
    onSuccess: done,
  });
  const change = useMutation({
    mutationFn: async (m: { projectId: number; userId: number }) => {
      const res = await client.api.projects[":id"].members[":userId"].$patch(
        { param: { id: String(m.projectId), userId: String(m.userId) } },
        { init: sendJson({ role: editRole }) },
      );
      if (!res.ok) throw await inviteError(res, "");
    },
    onSuccess: done,
  });
  const remove = useMutation({
    mutationFn: async (m: { projectId: number; userId: number }) => {
      const res = await client.api.projects[":id"].members[":userId"].$delete({
        param: { id: String(m.projectId), userId: String(m.userId) },
      });
      if (!res.ok) throw await inviteError(res, "");
    },
    onSuccess: done,
  });

  if (members.isPending)
    return <p className="text-muted-foreground">Chargement…</p>;
  if (members.isError)
    return (
      <p role="alert" className={alertBox}>
        Impossible de lire les membres. Recharge la page.
      </p>
    );
  const { me, projects, members: people, invitations } = members.data;
  const failed =
    invite.error ?? renew.error ?? cancel.error ?? change.error ?? remove.error;

  return (
    <div className="grid gap-[22px]">
      {editing === null && (
        <form
          className={`grid gap-3 ${listCard} p-4`}
          onSubmit={(event) => {
            event.preventDefault();
            setLink(null);
            invite.mutate();
          }}
        >
          <h2 className="font-semibold">Inviter quelqu'un</h2>
          <label className="block max-w-[320px]">
            <span className="sr-only">@login GitHub</span>
            <input
              type="text"
              value={login}
              placeholder="@login GitHub"
              onChange={(event) => setLogin(event.target.value)}
              className={`${field} mt-0`}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={projectId === p.id}
                onClick={() => setProjectId(p.id)}
                className={chipLink({ isActive: projectId === p.id })}
              >
                {projectId === p.id && <span aria-hidden="true">✓ </span>}
                {p.fullName}
              </button>
            ))}
            <RoleSelect value={role} onChange={setRole} />
          </div>
          <div>
            <button
              type="submit"
              disabled={
                invite.isPending || login.trim() === "" || projectId === null
              }
              className={primaryButton}
            >
              Créer le lien d'invitation
            </button>
          </div>
          {link && <InviteLink url={link} />}
        </form>
      )}
      {editing !== null && link && <InviteLink url={link} />}
      {failed && (
        <p role="alert" className={alertBox}>
          {failed.message}
        </p>
      )}
      <section aria-labelledby="membres">
        <h2 id="membres" className={sectionLabel}>
          Membres
        </h2>
        <ul className={`mt-3 ${listCard}`}>
          <li className="flex min-h-[50px] flex-col justify-center px-[18px] py-2">
            <span className="font-semibold">{me.name ?? me.login} · toi</span>
            <span className="text-[12.5px] text-muted-foreground">
              {ROLE_LABELS.owner} · {plural(me.projects, "projet", "projets")}
            </span>
          </li>
          {people.map((m) => {
            const key = `${m.projectId}/${m.userId}`;
            return (
              <li
                key={key}
                className="flex min-h-[50px] flex-wrap items-center gap-x-3 gap-y-2 px-[18px] py-2"
              >
                <span className="min-w-0 grow">
                  <span className="block font-semibold">
                    {m.name ?? m.login}
                  </span>
                  <span className="block text-[12.5px] text-muted-foreground">
                    {m.projectName} · {ROLE_LABELS[m.role]}
                    {m.lastLoginAt && ` · actif ${ago(m.lastLoginAt)}`}
                  </span>
                </span>
                {editing === key ? (
                  <span className="flex flex-wrap gap-2 sm:ml-auto">
                    <RoleSelect value={editRole} onChange={setEditRole} />
                    {removing ? (
                      <button
                        type="button"
                        onClick={() => remove.mutate(m)}
                        disabled={remove.isPending}
                        className={dangerButton}
                      >
                        Confirmer le retrait
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => change.mutate(m)}
                          disabled={change.isPending}
                          className={primaryButton}
                        >
                          Enregistrer
                        </button>
                        <button
                          type="button"
                          onClick={() => setRemoving(true)}
                          className={dangerButton}
                        >
                          Retirer
                        </button>
                      </>
                    )}
                    <button type="button" onClick={done} className={button}>
                      Fermer
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(key);
                      setEditRole(m.role === "owner" ? "can_validate" : m.role);
                      setRemoving(false);
                    }}
                    className={`${button} sm:ml-auto`}
                  >
                    Modifier
                  </button>
                )}
              </li>
            );
          })}
          {invitations.map((i) => (
            <li
              key={`invitation-${i.id}`}
              className="flex min-h-[50px] flex-wrap items-center gap-x-3 gap-y-2 px-[18px] py-2"
            >
              <span className="min-w-0 grow">
                <span className="block font-semibold">@{i.login}</span>
                <span className="block text-[12.5px] text-muted-foreground">
                  {i.projectName} · invitation créée {ago(i.createdAt)}
                </span>
              </span>
              <span className="flex gap-2 sm:ml-auto">
                <button
                  type="button"
                  onClick={() => renew.mutate(i.id)}
                  disabled={renew.isPending}
                  className={button}
                >
                  Nouveau lien
                </button>
                <button
                  type="button"
                  onClick={() => cancel.mutate(i.id)}
                  disabled={cancel.isPending}
                  className={button}
                >
                  Annuler
                </button>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
