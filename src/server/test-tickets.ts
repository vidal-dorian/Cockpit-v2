import { expect } from "vitest";
import type { App } from "./test-mcp.ts";

// Shared by the acceptance tests of slice 11.2 (decision 055): REST helpers over app.request() with a session cookie.

export const json = (cookie: string, method: string, body?: unknown) => ({
  method,
  headers: { cookie, "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const postTicket = (
  app: App,
  cookie: string,
  projectId: number | string,
  body: unknown,
) =>
  app.request(`/api/projects/${projectId}/tickets`, json(cookie, "POST", body));

export const patchTicket = (
  app: App,
  cookie: string,
  id: number | string,
  body: unknown,
) => app.request(`/api/tickets/${id}`, json(cookie, "PATCH", body));

export const getTicket = (app: App, cookie: string, id: number | string) =>
  app.request(`/api/tickets/${id}`, { headers: { cookie } });

export const listTickets = (
  app: App,
  cookie: string,
  projectId: number | string,
) => app.request(`/api/projects/${projectId}/tickets`, { headers: { cookie } });

export type ApiTicket = {
  id: number;
  title: string;
  priority: string;
  tags: string[];
};

/** Creates a ticket through the API and returns it (the creation itself must work for the test to mean anything). */
export async function makeTicket(
  app: App,
  cookie: string,
  projectId: number,
  body: Record<string, unknown> = { title: "Un ticket" },
) {
  const res = await postTicket(app, cookie, projectId, body);
  expect(res.status, "the ticket must be created").toBe(201);
  return ((await res.json()) as { ticket: ApiTicket }).ticket;
}
