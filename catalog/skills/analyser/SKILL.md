---
name: analyser
description: Map the code of the current repository in Cockpit: the modules, their runtimes and their business objects. Use when the user asks to analyse the repository, or sends a message like "/analyser".
---

# Analyse the repository

You draw the map of the code of the project: its modules, their runtimes, and their objects with fields and links, each backed by a citation that Cockpit checks on GitHub. You write nothing to the repository.

The Cockpit tools are named `mcp__cockpit__<tool>`. If they are not available, the `cockpit` MCP server is not connected: tell the user and stop.

## Before you start

If a check fails, stop and say why. Change nothing.

1. **The folder.** The current folder must be the repository of the project: compare `git remote get-url origin` with the `full_name` of the project (step 2 of "Workflow").
2. **The working tree.** `git status --porcelain` must print nothing, and `HEAD` must be pushed (`git fetch origin`, then `git branch -r --contains HEAD` must list a branch): Cockpit reads the files on GitHub at the commit you cite.

## Workflow

1. **The project.** Call `mcp__cockpit__list_projects` and take the one whose `full_name` is this repository's. Refuse an archived project.
2. **Its rules.** Call `mcp__cockpit__get_project` with its `project_id`: the `claude_md` tells the vocabulary and what the code base does.
3. **The map.** Launch the `cartographer` agent with the `project_id` and the rules. It reads the repository at the commit of `HEAD` and calls `mcp__cockpit__submit_code_map`. When Cockpit refuses a call, the refusal names the faulty location: the agent fixes it and sends the call again.
4. **Report.** Tell the user which modules were mapped and how many objects each has, and that the map is in the « Conception » tab of the project in Cockpit. If the agent stopped on a refusal, give it as it is.
