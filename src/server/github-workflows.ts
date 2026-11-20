import {
  type GitHubApp,
  PAGE_SIZE,
  workflowRunsSchema,
  workflowsSchema,
} from "./github-shared.ts";

/** The GitHub Actions workflows of a repo. */
export function githubWorkflows(app: GitHubApp) {
  return {
    // shortcut: the first 100 workflows only, a repo with more shows its first ones; page it if it ever matters.
    /** The workflows of the repo and, for each, its 10 newest runs on a branch, newest first (decision 067 B). Errors are left to the caller. */
    async readWorkflowRuns(
      installationId: number,
      fullName: string,
      branch: string,
    ) {
      const [owner, repo] = fullName.split("/") as [string, string];
      const octokit = await app.getInstallationOctokit(installationId);
      const { data } = await octokit.request(
        "GET /repos/{owner}/{repo}/actions/workflows",
        { owner, repo, per_page: PAGE_SIZE },
      );
      return Promise.all(
        workflowsSchema
          .parse(data)
          .workflows.filter(
            (w) =>
              w.state === "active" && w.path.startsWith(".github/workflows/"),
          )
          .map(async (w) => {
            const { data: runs } = await octokit.request(
              "GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs",
              { owner, repo, workflow_id: w.id, branch, per_page: 10 },
            );
            return {
              path: w.path,
              name: w.name,
              runs: workflowRunsSchema.parse(runs).workflow_runs,
            };
          }),
      );
    },
  };
}
