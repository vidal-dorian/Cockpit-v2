import { vi } from "vitest";
import { type RichTicket, rich } from "./test-tickets-full.tsx";

// Shared by the acceptance tests of slice 11.4 (decision 058): the attachments routes over the fake of the tickets.
//
// Pinned (the server tests pin the same shapes): GET /api/tickets/:id/attachments -> { attachments: [{ id, name, mediaType, size, createdAt }] };
// POST /api/tickets/:id/attachments (multipart, field `file`) -> 201 { attachment } or 400 { error: <code> };
// DELETE /api/attachments/:id -> 204; GET /api/projects/:id/tickets gives each ticket `attachmentsCount`.

export type FakeFile = {
  id: number;
  name: string;
  mediaType: string;
  size: number;
  createdAt: string;
};

export const fakeFile = (
  id: number,
  name: string,
  mediaType: string,
  size: number,
): FakeFile => ({
  id,
  name,
  mediaType,
  size,
  createdAt: "2026-10-22T12:00:00.000Z",
});

/** A ticket as the Tickets tab gets it with its attachments counted. */
export const withCount = (
  id: number,
  title: string,
  attachmentsCount: number,
): RichTicket & { attachmentsCount: number } => ({
  ...rich(id, title),
  attachmentsCount,
});

type Options = {
  /** The attachments each ticket (by id) already has. */
  files?: Record<number, FakeFile[]>;
  /** GET /api/projects answers project 5 as archived. */
  archived?: boolean;
  /** GET /api/projects never answers ("pending") or answers this status (an error). */
  projects?: "pending" | number;
  /** A code makes the POST of that file answer 400 with it. */
  refuse?: (file: { name: string; size: number }) => string | undefined;
  /** While set, a POST waits for it before answering. */
  hold?: Promise<void>;
  /** The status of DELETE /api/attachments/:id (204 by default). */
  deleteStatus?: number;
};

export type Upload = {
  ticketId: number;
  name: string;
  size: number;
  field: string;
};

/** Lays the attachments routes over the fetch fake already stubbed. Returns what the page sent. */
export function layerFiles(options: Options = {}) {
  const inner = globalThis.fetch;
  const files = new Map<number, FakeFile[]>(
    Object.entries(options.files ?? {}).map(([id, list]) => [
      Number(id),
      [...list],
    ]),
  );
  const uploads: Upload[] = [];
  const deletes: number[] = [];
  let nextId = 900;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      const path = new URL(raw, "http://localhost").pathname;
      if (options.projects && path === "/api/projects" && method === "GET") {
        if (options.projects === "pending")
          return new Promise<Response>(() => {});
        return Response.json({ error: "x" }, { status: options.projects });
      }
      if (options.archived && path === "/api/projects" && method === "GET")
        return Response.json({
          projects: [
            {
              id: 5,
              fullName: "octocat/hello",
              defaultBranch: "main",
              archived: true,
            },
          ],
        });
      const own = /^\/api\/tickets\/(\d+)\/attachments$/.exec(path);
      if (own && method === "GET")
        return Response.json({ attachments: files.get(Number(own[1])) ?? [] });
      if (own && method === "POST") {
        const form =
          init?.body instanceof FormData
            ? init.body
            : input instanceof Request
              ? await input.clone().formData()
              : undefined;
        const [field, part] = [...(form?.entries() ?? [])][0] ?? [];
        if (!(part instanceof File))
          return Response.json({ error: "Bad request" }, { status: 400 });
        uploads.push({
          ticketId: Number(own[1]),
          name: part.name,
          size: part.size,
          field: String(field),
        });
        await options.hold;
        const code = options.refuse?.({ name: part.name, size: part.size });
        if (code) return Response.json({ error: code }, { status: 400 });
        const added = fakeFile(
          nextId++,
          part.name,
          part.type || "text/plain",
          part.size,
        );
        files.set(Number(own[1]), [
          ...(files.get(Number(own[1])) ?? []),
          added,
        ]);
        return Response.json({ attachment: added }, { status: 201 });
      }
      const one = /^\/api\/attachments\/(\d+)$/.exec(path);
      if (one && method === "DELETE") {
        deletes.push(Number(one[1]));
        if ((options.deleteStatus ?? 204) === 204)
          for (const [ticket, list] of files)
            files.set(
              ticket,
              list.filter((f) => f.id !== Number(one[1])),
            );
        return new Response(null, { status: options.deleteStatus ?? 204 });
      }
      return inner(input, init);
    }),
  );
  return { uploads, deletes, files };
}

/** A real File for fireEvent.change(input, { target: { files } }). */
export const fileOf = (name: string, size = 10, type = "") =>
  new File([new Uint8Array(size)], name, { type });
