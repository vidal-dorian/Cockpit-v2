import { App } from "@octokit/app";
import { githubAlerts } from "./github-alert-reads.ts";
import { githubIssues } from "./github-issues.ts";
import { githubPulls } from "./github-pulls.ts";
import { githubRepos } from "./github-repos.ts";
import { type GitHubAppConfig, TimedOctokit } from "./github-shared.ts";
import { githubWorkflows } from "./github-workflows.ts";
import type { ReadInstance } from "./instance.ts";

export * from "./github-alert-reads.ts";
export * from "./github-shared.ts";

/** Talks to GitHub with the identity of the App only, never a user's token (decision 011). Errors are left to the caller. */
export function githubClient(config: GitHubAppConfig) {
  const app = new App({
    Octokit: TimedOctokit,
    appId: config.githubAppId,
    privateKey: config.githubAppPrivateKey,
  });
  return {
    ...githubRepos(app),
    ...githubAlerts(app),
    ...githubPulls(app),
    ...githubIssues(app),
    ...githubWorkflows(app),
  };
}

/** The settings page of the App on GitHub. */
export const appSettingsUrl = (slug: string) =>
  `https://github.com/settings/apps/${slug}`;

/** The client, the App's install and settings pages and the instance's public URL, null before the wizard has run. The client is built once and keeps its installation tokens; the public URL is read each time. */
export function githubReader(readInstance: ReadInstance) {
  let built:
    | {
        github: ReturnType<typeof githubClient>;
        installUrl: string;
        appSettingsUrl: string;
      }
    | undefined;
  return async () => {
    const settings = await readInstance();
    if (!settings) return null;
    built ??= {
      github: githubClient({
        githubAppId: settings.githubAppId,
        githubAppSlug: settings.githubAppSlug,
        githubAppPrivateKey: settings.githubPrivateKey,
      }),
      installUrl: `https://github.com/apps/${settings.githubAppSlug}/installations/new`,
      appSettingsUrl: appSettingsUrl(settings.githubAppSlug),
    };
    return { ...built, publicUrl: settings.publicUrl };
  };
}

export type ReadGitHub = ReturnType<typeof githubReader>;
