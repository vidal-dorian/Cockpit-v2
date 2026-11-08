// Attachments of a ticket (decision 058): the size and type words and the calls the ticket page and the idea bar share.

export type Attachment = {
  id: number;
  name: string;
  mediaType: string;
  size: number;
};

const MO = 1024 * 1024;

/** « 500 o », « 84 Ko », « 1,2 Mo » (a Mo is 1 048 576 bytes, a « ,0 » is dropped). */
export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < MO) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / MO).toFixed(1).replace(".", ",").replace(",0", "")} Mo`;
}

/** The icon of a type: an image, a PDF, or a text. */
export const iconOf = (mediaType: string) =>
  mediaType.startsWith("image/")
    ? "🖼"
    : mediaType === "application/pdf"
      ? "📄"
      : "📝";

const IMAGES = ["png", "jpg", "jpeg", "webp", "gif"];
const OTHERS = ["pdf", "txt", "md", "csv", "json"];

/** The refusals of decision 058 B, worded for the user. */
const SENTENCES: Record<string, string> = {
  unsupported_type:
    "Ce type de fichier n'est pas accepté : images, PDF ou texte.",
  too_large: "Ce fichier dépasse 20 Mo (5 Mo pour une image).",
  too_many: "Ce ticket a déjà 20 pièces jointes.",
  invalid_name: "Ce nom de fichier n'est pas valide.",
  project_archived: "Ce projet est archivé : ses tickets ne changent plus.",
};
export const refusal = (code?: string) =>
  SENTENCES[code ?? ""] ?? "L'envoi a échoué, réessaie.";

/** The client-side check of a chosen file, on its extension and size; the server checks the content. Returns a refusal code. */
export function checkFile(file: { name: string; size: number }) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const image = IMAGES.includes(extension);
  if (!image && !OTHERS.includes(extension)) return "unsupported_type";
  return file.size > (image ? 5 : 20) * MO ? "too_large" : undefined;
}

/** The attachments of a ticket, oldest first. */
export async function fetchAttachments(ticketId: number | string) {
  const res = await fetch(`/api/tickets/${ticketId}/attachments`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { attachments: Attachment[] }).attachments;
}

/** Sends one file as multipart (the browser sets the Content-Type with its boundary). Returns the refusal sentence, or undefined when it is attached. */
export async function uploadAttachment(ticketId: number | string, file: File) {
  const form = new FormData();
  form.append("file", file);
  try {
    const res = await fetch(`/api/tickets/${ticketId}/attachments`, {
      method: "POST",
      body: form,
    });
    if (res.ok) return undefined;
    const body: unknown = await res.json().catch(() => null);
    return refusal((body as { error?: string } | null)?.error);
  } catch {
    return refusal();
  }
}
