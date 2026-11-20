import { z } from "zod";
import {
  type GitHubApp,
  ignoreStatus,
  labelsSchema,
  MAX_PAGES,
  PAGE_SIZE,
} from "./github-shared.ts";

/** The issues of a repo and their labels. */
export function githubIssues(app: GitHubApp) {
  return {
    /** The issues of a repo, open and closed, pull requests left out (decision 057 A). Shortcut: 10 pages of 100 at most, the oldest are not listed. Errors are left to the caller. */
    async listIssues(installationId: number, fullName: string) {
      const [owner, repo] = fullName.split("/") as [string, string];
      const octokit = await app.getInstallationOctokit(installationId);
      const items: unknown[] = [];
      // Paged by hand, as listInstallationRepos.
      for (let page = 1; page <= MAX_PAGES; page++) {
        const { data } = await octokit.request(
          "GET /repos/{owner}/{repo}/issues",
          { owner, repo, state: "all", per_page: PAGE_SIZE, page },
        );
        items.push(...data);
        if (data.length < PAGE_SIZE) break;
      }
      return z
        .array(
          z.object({
            number: z.number().int(),
            title: z.string(),
            body: z.string().nullish(),
            state: z.enum(["open", "closed"]),
            pull_request: z.unknown().optional(),
          }),
        )
        .parse(items)
        .filter((issue) => !issue.pull_request)
        .map(({ pull_request: _, ...issue }) => issue);
    },

    /** Writes the issues of a repo and the labels Cockpit puts on them (decision 020), as the installation. */
    async issues(installationId: number, fullName: string) {
      const [owner, repo] = fullName.split("/") as [string, string];
      const octokit = await app.getInstallationOctokit(installationId);
      return {
        /** Creates the issue with no label (it may not exist in the repo yet) and returns its number and its labels. */
        async create(issue: { title: string; body: string }) {
          const { data } = await octokit.request(
            "POST /repos/{owner}/{repo}/issues",
            { owner, repo, title: issue.title, body: issue.body },
          );
          return z
            .object({ number: z.number().int(), labels: labelsSchema })
            .parse(data);
        },
        /** Returns the names of the labels the issue carries. */
        async update(
          number: number,
          issue: {
            title: string;
            body: string;
            state: "open" | "closed";
            stateReason: "completed" | "not_planned" | null;
          },
        ) {
          const { data } = await octokit.request(
            "PATCH /repos/{owner}/{repo}/issues/{issue_number}",
            {
              owner,
              repo,
              issue_number: number,
              title: issue.title,
              body: issue.body,
              state: issue.state,
              // GitHub reopens with no reason; sending null would be refused.
              ...(issue.stateReason && { state_reason: issue.stateReason }),
            },
          );
          return z.object({ labels: labelsSchema }).parse(data).labels;
        },
        /** Adds the label and returns the names of all the labels of the issue. GitHub refuses (422) a label missing from the repo: it is created (a 422 there is "already exists") and added again. */
        async addLabel(number: number, name: string) {
          const add = () =>
            octokit.request(
              "POST /repos/{owner}/{repo}/issues/{issue_number}/labels",
              { owner, repo, issue_number: number, labels: [name] },
            );
          try {
            return labelsSchema.parse((await add()).data);
          } catch (error) {
            if ((error as { status?: number }).status !== 422) throw error;
          }
          await ignoreStatus(
            422,
            octokit.request("POST /repos/{owner}/{repo}/labels", {
              owner,
              repo,
              name,
            }),
          );
          return labelsSchema.parse((await add()).data);
        },
        /** 404 is "the issue does not carry it". */
        removeLabel: (number: number, name: string) =>
          ignoreStatus(
            404,
            octokit.request(
              "DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}",
              { owner, repo, issue_number: number, name },
            ),
          ),
      };
    },
  };
}
