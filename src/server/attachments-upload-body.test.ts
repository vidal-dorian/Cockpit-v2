import { describe, expect, it } from "vitest";
import { MIB, PNG } from "./test-attachments.ts";
import { withProject } from "./test-mcp.ts";
import { makeTicket } from "./test-tickets.ts";

// Slice 11.4, decision 058 C, review finding B2: the body of an upload is not read before the request is judged.
//
// Pinned choices (the decision leaves them open):
// - POST /api/tickets/:id/attachments without a Content-Length (a chunked body) is 411 { error: "Length required" } for ANY such request, with or without a session,
//   answered without reading the body (the stream is not pulled beyond what the request needs to exist).
// - With a Content-Length over the limit (21 MiB, the file and the envelope of the form) it is 413 without reading the body, again before any session check.
// - A Content-Length within the limit goes on as before (no session is then 401). The JSON routes do not change: a small chunked JSON body is still read (201), and a JSON body over 256 KiB is still 413.

const ctxOf = async () => {
  const ctx = await withProject();
  const ticket = await makeTicket(ctx.app, ctx.alice.cookie, ctx.projectId);
  return { ...ctx, ticketId: ticket.id };
};

/** A body of `chunks` chunks of 64 KiB that counts how many were pulled from it. */
function stream(chunks: number) {
  const state = { pulled: 0 };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.pulled >= chunks) return controller.close();
      state.pulled++;
      controller.enqueue(new Uint8Array(64 * 1024));
    },
  });
  return { state, body };
}
const post = (
  app: Awaited<ReturnType<typeof ctxOf>>["app"],
  path: string,
  headers: Record<string, string>,
  body: ReadableStream<Uint8Array>,
) =>
  app.request(path, {
    method: "POST",
    headers,
    body,
    // biome-ignore lint/suspicious/noExplicitAny: `duplex` is required for a stream body and absent from the DOM types
    ...({ duplex: "half" } as any),
  });
const MULTIPART = "multipart/form-data; boundary=x";

describe("058 C (B2): the upload body", () => {
  it("given a chunked upload with a session, when it is posted, then 411 and the body is not read", async () => {
    const { app, alice, ticketId } = await ctxOf();
    const { state, body } = stream(400);

    const res = await post(
      app,
      `/api/tickets/${ticketId}/attachments`,
      { cookie: alice.cookie, "content-type": MULTIPART },
      body,
    );

    expect(res.status).toBe(411);
    expect(state.pulled).toBeLessThanOrEqual(2);
  });

  it("given a chunked upload without session, when it is posted, then 411 too, before authentication", async () => {
    const { app, ticketId } = await ctxOf();
    const { state, body } = stream(400);

    const res = await post(
      app,
      `/api/tickets/${ticketId}/attachments`,
      { "content-type": MULTIPART },
      body,
    );

    expect(res.status).toBe(411);
    expect(state.pulled).toBeLessThanOrEqual(2);
  });

  it("given a Content-Length of 30 MiB, when the upload is posted, then 413 without the body being read, with or without session", async () => {
    const { app, alice, ticketId } = await ctxOf();
    for (const cookie of [alice.cookie, undefined]) {
      const { state, body } = stream(400);

      const res = await post(
        app,
        `/api/tickets/${ticketId}/attachments`,
        {
          ...(cookie ? { cookie } : {}),
          "content-type": MULTIPART,
          "content-length": String(30 * MIB),
        },
        body,
      );

      expect(res.status).toBe(413);
      expect(state.pulled).toBeLessThanOrEqual(2);
    }
  });

  it("given a Content-Length within the limit and no session, when the upload is posted, then 401 as before", async () => {
    const { app, ticketId } = await ctxOf();
    const form = new FormData();
    form.set("file", new File([new Uint8Array(PNG)], "a.png"));

    const res = await app.request(`/api/tickets/${ticketId}/attachments`, {
      method: "POST",
      body: form,
    });

    expect(res.status).toBe(401);
  });

  it("given the JSON routes, when a small chunked body and a 300 KiB body are posted, then the first is read (201) and the second is 413 as before", async () => {
    const { app, alice, projectId } = await ctxOf();
    const small = new Blob([JSON.stringify({ title: "Flux" })]).stream();
    const big = new Blob([
      JSON.stringify({ title: "Gros", descriptionMd: "a".repeat(300 * 1024) }),
    ]).stream();
    const headers = {
      cookie: alice.cookie,
      "content-type": "application/json",
    };

    const ok = await post(
      app,
      `/api/projects/${projectId}/tickets`,
      headers,
      small,
    );
    const refused = await post(
      app,
      `/api/projects/${projectId}/tickets`,
      headers,
      big,
    );

    expect(ok.status).toBe(201);
    expect(refused.status).toBe(413);
  });
});
