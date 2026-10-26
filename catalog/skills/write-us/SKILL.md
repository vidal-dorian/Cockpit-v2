---
name: write-us
description: Turn the raw ideas (tickets) noted in Cockpit into small, testable user stories with Given/When/Then acceptance criteria. Use when the user asks to write, split or specify their tickets, or asks what is left to write in Cockpit.
---

# Write the user stories of Cockpit tickets

A ticket is a raw idea. Your job is to split it into user stories that the user will validate in Cockpit. You write them; you never validate them.

The Cockpit tools are named `mcp__cockpit__<tool>`. If they are not available, the `cockpit` MCP server is not connected: tell the user and stop.

## Workflow

1. **Find the work.** Call `mcp__cockpit__list_tickets_needing_us`, with `project_id` when the user named a project (get it from `mcp__cockpit__list_projects`). It returns at most 20 tickets without stories, oldest first; a written ticket leaves the list, so call it again for the next ones. If the user named one ticket by a few words, use `mcp__cockpit__search` instead. If both lists are empty, say so and stop. `stories_to_rewrite` lists stories the user sent back; rewriting them is not possible yet: tell the user and leave them.
2. **Read the rules of the project.** Call `mcp__cockpit__get_project` once per project: its `claude_md` tells you the vocabulary, the conventions and what the code base does. Stories must fit them.
3. **Read the ticket.** The title and `description_md` from step 1 are usually enough; call `mcp__cockpit__get_ticket` if you need more. Read the code only when the idea cannot be split without it.
4. **Split the idea** into small stories that each deliver something on their own and can be developed and tested separately. Write them in the language of the user.
   - `as_a`, `i_want`, `so_that`: short, without the words "As a", "I want", "so that" themselves.
   - `notes_md` (optional): what a developer needs and the story does not say: files, constraints, edge cases, what is out of scope.
   - `criteria`: at least one, at most 20 per story. Each is testable: `given` a starting state, `when` one action, `then` one observable result. Cover the error and empty cases, not only the happy path.
   - `depends_on` (optional): the 1-based positions of earlier stories of the same call that must be done first. The first story you send is position 1. Never point to a later or the same position, and list each position once. Keep dependencies to the strict minimum.
   - Keep `notes_md` short: the whole call must stay under 256 KiB.
   - Between 1 and 20 stories per ticket; if the idea needs more, it is too big: write the first stories and tell the user the rest needs another ticket.
5. **Write them.** Call `mcp__cockpit__create_user_stories` once per ticket with `ticket_id` and all its stories. It is all or nothing, and a ticket is written only once: get the stories right before sending them.
6. **Report.** Tell the user which tickets you wrote and how many stories each has, and that the stories wait for their validation in Cockpit.

## When a call is refused

A refusal starts with `Refused:` and says why. Read it and adapt; do not retry the same call.

- Invalid arguments: it names the faulty field. Fix it and send the whole call again (nothing was created).
- `not found`: the id is wrong or not the user's. Find it again with `mcp__cockpit__list_tickets_needing_us` or `mcp__cockpit__search`.
- The ticket already has stories or is abandoned: skip it and tell the user.
- The project is archived: it is read-only; skip it and tell the user.

An `Error:` answer means the call failed; retry once, then tell the user.

## Never

- Never validate, send back, abandon or edit a story: only the user does, in Cockpit, and no tool lets you.
- Never write stories for a ticket that already has some. To read them, use `mcp__cockpit__get_user_story`.
- Never put secrets or personal data in a story: what you write is stored and shown as is.
