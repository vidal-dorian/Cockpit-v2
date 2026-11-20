import type { z } from "zod";
import {
  branchesSchema,
  CHANGELOG_PULL_PAGES,
  checkRunsSchema,
  type GitHubApp,
  isNotFound,
  mergedPullsSchema,
  noWorkflowsPermission,
  PAGE_SIZE,
  PULL_FILES_MAX_PAGES,
  pullFilesSchema,
  pullHeadSchema,
  pullRequestSchema,
  pullStateSchema,
  type RepoWriteRefusal,
  reviewsSchema,
  shaSchema,
  type TimedOctokit,
} from "./github-shared.ts";

/** Commits `entries` on top of `head` and advances the default branch without force, once; when it is protected, the commit goes to a branch `cockpit/<7>` and a pull request listing `paths` is opened (decision 026 G). Shared by `applyRepoWrite` and `applyRepoChanges`. */
export const commitToHead = async (
  {
    octokit,
    owner,
    name,
  }: {
    octokit: InstanceType<typeof TimedOctokit>;
    owner: string;
    name: string;
  },
  head: { branch: string; sha: string },
  entries: {
    path: string;
    mode: "100644";
    type: "blob";
    content?: string;
    sha?: null;
  }[],
  message: string,
): Promise<
  | { commitSha: string; pullRequest?: { number: number; url: string } }
  | RepoWriteRefusal
> => {
  const paths = entries.map((entry) => entry.path);
  const { data: base } = await octokit.request(
    "GET /repos/{owner}/{repo}/git/commits/{commit_sha}",
    { owner, repo: name, commit_sha: head.sha },
  );
  const { data: tree } = await octokit.request(
    "POST /repos/{owner}/{repo}/git/trees",
    {
      owner,
      repo: name,
      base_tree: shaSchema.parse(base.tree).sha,
      tree: entries,
    },
  );
  const { data: commit } = await octokit.request(
    "POST /repos/{owner}/{repo}/git/commits",
    {
      owner,
      repo: name,
      message,
      tree: shaSchema.parse(tree).sha,
      parents: [head.sha],
    },
  );
  const commitSha = shaSchema.parse(commit).sha;
  try {
    await octokit.request(
      // The branch is in the URL itself, each segment encoded: a {ref} would encode its slashes, and a raw `#` or `{` would change the URL.
      `PATCH /repos/{owner}/{repo}/git/refs/heads/${head.branch.split("/").map(encodeURIComponent).join("/")}`,
      { owner, repo: name, sha: commitSha, force: false },
    );
  } catch (error) {
    const { status, message: reason } = error as {
      status?: number;
      message: string;
    };
    // The App lacks `workflows` and the commit touches .github/workflows (decision 067 D): a pull request would be refused the same way.
    if (noWorkflowsPermission(error)) return { refused: "workflows_forbidden" };
    // Both the texts of a protected branch and of a ruleset; 403 or 422 depending on the rule (decision 026 G).
    if (
      (status === 403 || status === 422) &&
      /protected branch|rule violation/i.test(reason)
    ) {
      const branch = `cockpit/${commitSha.slice(0, 7)}`;
      try {
        await octokit.request("POST /repos/{owner}/{repo}/git/refs", {
          owner,
          repo: name,
          ref: `refs/heads/${branch}`,
          sha: commitSha,
        });
      } catch (refError) {
        if (noWorkflowsPermission(refError))
          return { refused: "workflows_forbidden" };
        throw refError;
      }
      let data: unknown;
      try {
        ({ data } = await octokit.request("POST /repos/{owner}/{repo}/pulls", {
          owner,
          repo: name,
          head: branch,
          base: head.branch,
          title: message,
          body: `${paths.map((path) => `- ${path}`).join("\n")}\n\nOuverte par Cockpit`,
        }));
      } catch (pullError) {
        // Best effort: a branch left behind is harmless, and the refusal below matters more. After a timeout GitHub may have opened the pull request anyway: deleting the branch closes it, which beats a duplicate on the next try.
        await octokit
          // The branch is in the URL itself: a {ref} would have its slash encoded.
          .request(`DELETE /repos/{owner}/{repo}/git/refs/heads/${branch}`, {
            owner,
            repo: name,
          })
          .catch((deleteError) =>
            console.error(`Could not delete branch ${branch}`, deleteError),
          );
        const { status: pullStatus, message: pullReason } = pullError as {
          status?: number;
          message: string;
        };
        // The App lacks Pull requests: write; any other 403 (a rate limit) is not a refusal.
        if (
          pullStatus === 403 &&
          /not accessible by integration/i.test(pullReason)
        )
          return { refused: "pull_request_forbidden" };
        throw pullError;
      }
      // Parsed once the pull request exists: a parse error must not delete its branch.
      const pull = pullRequestSchema.parse(data);
      return {
        commitSha,
        pullRequest: { number: pull.number, url: pull.html_url },
      };
    }
    // GitHub refuses what is not a fast forward: someone pushed meanwhile, and we do not retry.
    if (status === 422 && /fast.forward/i.test(reason))
      return { refused: "repo_changed" };
    throw error;
  }
  return { commitSha };
};

/** Pull requests and the branches they leave behind. */
export function githubPulls(app: GitHubApp) {
  return {
    /** The head of a pull request, as the installation: null when GitHub answers 404 (decision 035 C). Other errors are left to the caller. */
    async readPullRequest(
      installationId: number,
      fullName: string,
      number: number,
    ) {
      const [owner, repo] = fullName.split("/") as [string, string];
      const octokit = await app.getInstallationOctokit(installationId);
      try {
        const { data } = await octokit.request(
          "GET /repos/{owner}/{repo}/pulls/{pull_number}",
          { owner, repo, pull_number: number },
        );
        const { head } = pullHeadSchema.parse(data);
        return { branch: head.ref, repo: head.repo?.full_name ?? null };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    /** A PR as the follow of decision 038 B needs it: its state, its merge, and the check runs of its head commit and its reviews (oldest first). The three reads all succeed or this throws, so nothing is written on a half read. Shortcut: only the first 100 check runs and 100 reviews, paginate if a PR ever has more. */
    async readPullFollow(
      installationId: number,
      fullName: string,
      number: number,
    ) {
      const [owner, repo] = fullName.split("/") as [string, string];
      const octokit = await app.getInstallationOctokit(installationId);
      const pull = pullStateSchema.parse(
        (
          await octokit.request(
            "GET /repos/{owner}/{repo}/pulls/{pull_number}",
            {
              owner,
              repo,
              pull_number: number,
            },
          )
        ).data,
      );
      const runs = checkRunsSchema.parse(
        (
          await octokit.request(
            "GET /repos/{owner}/{repo}/commits/{ref}/check-runs",
            { owner, repo, ref: pull.head.sha, per_page: 100 },
          )
        ).data,
      );
      const reviews = reviewsSchema.parse(
        (
          await octokit.request(
            "GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
            { owner, repo, pull_number: number, per_page: 100 },
          )
        ).data,
      );
      return {
        open: pull.state === "open",
        merged: pull.merged,
        checkRuns: runs.check_runs,
        reviews: reviews.flatMap((r) =>
          r.user ? [{ login: r.user.login, state: r.state }] : [],
        ),
      };
    },

    /** The paths a PR changes, in GitHub's order, all pages of 100 (decision 050 C). Throws on any GitHub error. */
    async readPullFiles(
      installationId: number,
      fullName: string,
      number: number,
    ) {
      const [owner, repo] = fullName.split("/") as [string, string];
      const octokit = await app.getInstallationOctokit(installationId);
      const paths: string[] = [];
      // shortcut: GitHub serves 3000 files per PR at most, past that the count undercounts; nothing to upgrade to.
      for (let page = 1; page <= PULL_FILES_MAX_PAGES; page++) {
        const files = pullFilesSchema.parse(
          (
            await octokit.request(
              "GET /repos/{owner}/{repo}/pulls/{pull_number}/files",
              { owner, repo, pull_number: number, per_page: PAGE_SIZE, page },
            )
          ).data,
        );
        // A renamed file counts both paths (decision 050 D).
        paths.push(
          ...files.flatMap((f) =>
            f.previous_filename
              ? [f.filename, f.previous_filename]
              : [f.filename],
          ),
        );
        if (files.length < PAGE_SIZE) break;
      }
      return paths;
    },

    /** The PRs merged into `base` (decision 062 A): the closed ones, 100 per page, 3 pages at most, most recently updated first. Shortcut: older PRs are not listed, paginate further if it ever matters. */
    async listMergedPulls(
      installationId: number,
      fullName: string,
      base: string,
    ) {
      const [owner, repo] = fullName.split("/") as [string, string];
      const octokit = await app.getInstallationOctokit(installationId);
      const found: z.infer<typeof mergedPullsSchema> = [];
      for (let page = 1; page <= CHANGELOG_PULL_PAGES; page++) {
        const { data } = await octokit.request(
          "GET /repos/{owner}/{repo}/pulls",
          {
            owner,
            repo,
            state: "closed",
            base,
            sort: "updated",
            direction: "desc",
            per_page: PAGE_SIZE,
            page,
          },
        );
        const pulls = mergedPullsSchema.parse(data);
        found.push(...pulls);
        if (pulls.length < PAGE_SIZE) break;
      }
      return found.filter((p) => p.merged_at !== null);
    },

    /** What decision 062 E checks right before deleting a branch, read live: the PR (merged, last commit), the branch (null when gone) and whether an open PR starts from it. Throws on any GitHub error. */
    async readBranchToDelete(
      installationId: number,
      fullName: string,
      prNumber: number,
      branch: string,
    ) {
      const [owner, repo] = fullName.split("/") as [string, string];
      const octokit = await app.getInstallationOctokit(installationId);
      const pull = mergedPullsSchema.element.parse(
        (
          await octokit.request(
            "GET /repos/{owner}/{repo}/pulls/{pull_number}",
            {
              owner,
              repo,
              pull_number: prNumber,
            },
          )
        ).data,
      );
      // The branch is in the URL itself: a {branch} would have its slash encoded.
      const found = await octokit
        .request(
          `GET /repos/{owner}/{repo}/branches/${branch.split("/").map(encodeURIComponent).join("/")}`,
          { owner, repo },
        )
        .then(({ data }) => branchesSchema.element.parse(data))
        .catch((error) => {
          if (isNotFound(error)) return null;
          throw error;
        });
      const { data: open } = await octokit.request(
        "GET /repos/{owner}/{repo}/pulls",
        { owner, repo, state: "open", head: `${owner}:${branch}`, per_page: 1 },
      );
      return {
        merged: pull.merged_at !== null,
        pullHeadSha: pull.head.sha,
        branch: found && { protected: found.protected, sha: found.commit.sha },
        hasOpenPull: mergedPullsSchema.parse(open).length > 0,
      };
    },

    /** Deletes the branch reference (decision 062 E); the caller has checked that nothing is lost. */
    async deleteBranch(
      installationId: number,
      fullName: string,
      branch: string,
    ) {
      const [owner, repo] = fullName.split("/") as [string, string];
      const octokit = await app.getInstallationOctokit(installationId);
      await octokit.request(
        `DELETE /repos/{owner}/{repo}/git/refs/heads/${branch.split("/").map(encodeURIComponent).join("/")}`,
        { owner, repo },
      );
    },
  };
}
