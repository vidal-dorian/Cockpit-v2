---
name: dev-us
description: Develop one user story of Cockpit from start to pull request. Use when the user asks to develop a story, or sends a message like "/dev-us 42 --branch us/42-short-title".
---

# Develop a user story

The message is `/dev-us <story_id> [--branch <name>]`, then an optional extra prompt that you follow too. You build the story on its own branch, with the agents of the repository, and open a pull request. You never merge it.

The Cockpit tools are named `mcp__cockpit__<tool>`. If they are not available, the `cockpit` MCP server is not connected: tell the user and stop.

## Before you start

If a check fails, stop and say why. Change nothing.

1. **The folder.** The current folder must be the repository of the story's project: compare `git remote get-url origin` with the `full_name` of the project (step 2).
2. **The story.** Call `mcp__cockpit__get_user_story` with the `story_id`. Refuse a story whose status is not `ready`: only a story the user validated is developed. Tell the user its status. Also refuse an archived project. Read the narrative, the notes, every criterion and the `depends_on` stories (a dependency that is not done is worth a warning, not a stop).
3. **The working tree.** `git status --porcelain` must print nothing: the working tree must be clean.
4. **The default branch.** Take `default_branch` from the project, then `git fetch origin` and bring that branch up to date (fast-forward only).

## The branch

- With `--branch <name>`: if the branch exists on `origin`, check it out and update it (`git pull --ff-only`): the story is resumed. Otherwise create it from the default branch and push it with `git push -u origin <name>`.
- Without `--branch`: name it `us/<story_id>-<short-title>`, the title taken from `i_want`: lower case, no accents, words joined by dashes, 40 characters at most. Create it and push it the same way.

## Develop

Read `CLAUDE.md` first: it holds the commands and the conventions. Then, never starting a step before the previous one is done:

If `.claude/team.md` exists, follow it: its front matter lists the `steps`, each one naming an `agent` of `.claude/agents/` and saying what it `does`. Run the steps in order; a step with `loop_to` and `until` sends you back to that step until the condition holds. Without that file, the default steps are these three, in this order:

1. **test-writer** writes the acceptance tests from the criteria. They must fail, for the right reason.
2. **developer** implements until those tests pass, without touching them.
3. **reviewer** reviews the diff with a fresh context. Blocking findings go back to the developer, then to a new review, until the verdict is **ready**.

Give each agent the story, its criteria and the notes. Commit as you go, in small commits that follow the conventions of the repository.

## Finish

1. Run **all the tests**, the lint and the type check of the repository (the commands are in `CLAUDE.md`). Everything must pass: fix, never skip or disable.
2. Push the branch.
3. Open the pull request against the default branch (`gh pr create`), in the language of the repository's conventions: a title that says what the story does, a body that lists each criterion with the test that proves it, anything left undone, and the line `Closes #<issue>`, where `<issue>` is the GitHub issue of the story (find it with `gh issue list --search "<i_want>"`; if you cannot tell which one it is, ask the user).
4. Tell the user the link of the pull request, and what you are unsure about.

## Never

- Never merge the pull request, never push to the default branch, never force-push.
- Never change an acceptance test to make it pass: if a test is wrong, stop and tell the user.
- Never put secrets or personal data in a commit, a pull request or a message.
