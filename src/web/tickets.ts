/** The step labels of a ticket (decision 002); the codes of the server are never shown. */
export const STEPS: Record<string, string> = { new: "Nouveau" };

/** The French error of a refused create, edit or delete; nothing of what the server said is shown. */
export async function ticketError(res: Response) {
  if (res.status === 400)
    return new Error(
      "Le titre doit faire de 1 à 200 caractères et la description 50 000 au plus.",
    );
  const body: unknown = await res.json().catch(() => null);
  if ((body as { error?: unknown } | null)?.error === "project_archived")
    return new Error("Ce projet est archivé : ses tickets ne changent plus.");
  return new Error("L'opération a échoué, réessaie.");
}
