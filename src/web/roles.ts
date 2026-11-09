/** The roles of a member on a project, as the page says them (decision 076 A), each with the rights of the one before it. */
export const ROLE_LABELS = {
  read_only: "lecture seule",
  can_validate: "peut valider",
  can_launch: "peut valider et lancer",
  owner: "propriétaire",
} as const;
export type Role = keyof typeof ROLE_LABELS;

/** Whether the role allows a gesture that needs `min`; a project that does not say its role is the viewer's own. */
export const atLeast = (role: string | undefined, min: Role) =>
  Object.keys(ROLE_LABELS).indexOf(role ?? "owner") >=
  Object.keys(ROLE_LABELS).indexOf(min);

export const ROLE_REFUSAL = "Ton rôle sur ce projet ne le permet pas.";
const PLAN_REFUSAL =
  "Ce projet est en lecture seule : l'abonnement Gratuit de son propriétaire ne le permet plus.";

/** The error of a refused write: the sentence of the role when the server says so, `fallback` otherwise. */
export async function refusedError(res: Response, fallback: string) {
  const body = (await res
    .clone()
    .json()
    .catch(() => null)) as {
    error?: string;
  } | null;
  return new Error(roleRefusal(res.status, body?.error) ?? fallback);
}

/** The sentence of a refusal 403 `role` of the server (decision 076 G); null for any other answer. */
export const roleRefusal = (status: number, error: unknown) =>
  status === 403 && error === "role"
    ? ROLE_REFUSAL
    : status === 403 && error === "plan"
      ? PLAN_REFUSAL
      : null;
