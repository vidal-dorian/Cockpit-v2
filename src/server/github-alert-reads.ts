import { z } from "zod";
import { type GitHubApp, PAGE_SIZE } from "./github-shared.ts";

// Decision 052 D: what is read of an alert of GitHub, named field by field. zod drops the rest, so the `secret` of a secret scanning alert never goes any further.
// `state` is absent from a secret scanning webhook and null for a code scanning alert of a pull request: the webhook handler judges it itself.
export const alertBase = {
  number: z.number().int(),
  state: z.string().nullish(),
};
export const dependabotAlert = z.object({
  ...alertBase,
  dependency: z.object({ manifest_path: z.string().optional() }),
  security_advisory: z.object({
    ghsa_id: z.string(),
    cve_id: z.string().nullish(),
    summary: z.string(),
    severity: z.string(),
  }),
  security_vulnerability: z.object({
    package: z.object({ ecosystem: z.string(), name: z.string() }),
    vulnerable_version_range: z.string().nullish(),
    first_patched_version: z.object({ identifier: z.string() }).nullish(),
  }),
});
export const codeScanningAlert = z.object({
  ...alertBase,
  rule: z.object({
    id: z.string().nullish(),
    name: z.string().nullish(),
    severity: z.string().nullish(),
    security_severity_level: z.string().nullish(),
    description: z.string().nullish(),
  }),
  tool: z.object({ name: z.string().nullish() }).nullish(),
  most_recent_instance: z
    .object({
      ref: z.string().nullish(),
      commit_sha: z.string().nullish(),
      message: z.object({ text: z.string().nullish() }).nullish(),
      location: z
        .object({
          path: z.string().nullish(),
          start_line: z.number().int().nullish(),
          end_line: z.number().int().nullish(),
        })
        .nullish(),
    })
    .nullish(),
});
export const secretScanningAlert = z.object({
  ...alertBase,
  secret_type: z.string(),
  secret_type_display_name: z.string().nullish(),
});
export const ALERT_TOOLS = {
  dependabot: { path: "dependabot", schema: dependabotAlert },
  code_scanning: { path: "code-scanning", schema: codeScanningAlert },
  secret_scanning: { path: "secret-scanning", schema: secretScanningAlert },
} as const;
export type AlertTool = keyof typeof ALERT_TOOLS;
export const locationsSchema = z.array(
  z.object({
    type: z.string(),
    details: z.record(z.string(), z.unknown()).default({}),
  }),
);
export const commitLocationSchema = z.object({
  path: z.string(),
  start_line: z.number().int().min(1),
  end_line: z.number().int().min(1),
  commit_sha: z.string(),
});
export const MAX_ALERT_PAGES = 10;

/** The alert reads of the App (decision 052). */
export function githubAlerts(app: GitHubApp) {
  return {
    // shortcut: Dependabot's `page` parameter is being closed down in favour of `before` / `after` cursors, upgrade the Dependabot read when GitHub removes it.
    /** The open alerts of a tool, as the installation, 100 per page and ten pages at most (decision 052 C). `disabled` when GitHub answers 403 or 404 (the tool is not on for this repo); `complete` is false when the last page was full, so more may exist. Other errors are left to the caller. */
    async readAlerts<T extends AlertTool>(
      installationId: number,
      fullName: string,
      tool: T,
    ) {
      const [owner, repo] = fullName.split("/") as [string, string];
      const octokit = await app.getInstallationOctokit(installationId);
      const { path, schema } = ALERT_TOOLS[tool];
      const alerts: z.infer<(typeof ALERT_TOOLS)[T]["schema"]>[] = [];
      for (let page = 1; page <= MAX_ALERT_PAGES; page++) {
        let data: unknown;
        try {
          ({ data } = await octokit.request(
            `GET /repos/{owner}/{repo}/${path}/alerts`,
            {
              owner,
              repo,
              state: "open",
              per_page: PAGE_SIZE,
              page,
              // GitHub then does not even send the value of a secret.
              ...(tool === "secret_scanning" && { hide_secret: true }),
            },
          ));
        } catch (error) {
          const status = (error as { status?: number }).status;
          if (status === 403 || status === 404)
            return { disabled: true as const };
          throw error;
        }
        const found = z.array(schema).parse(data) as typeof alerts;
        alerts.push(...found);
        if (found.length < PAGE_SIZE)
          return { alerts, complete: true as const };
      }
      return { alerts, complete: false as const };
    },

    /** The first place in a commit where a secret scanning alert found its secret (decision 052 D), null when it has none. Never the secret itself. Errors are left to the caller. */
    async readSecretLocation(
      installationId: number,
      fullName: string,
      number: number,
    ) {
      const [owner, repo] = fullName.split("/") as [string, string];
      const octokit = await app.getInstallationOctokit(installationId);
      const { data } = await octokit.request(
        "GET /repos/{owner}/{repo}/secret-scanning/alerts/{alert_number}/locations",
        { owner, repo, alert_number: number },
      );
      for (const location of locationsSchema.parse(data)) {
        const found = commitLocationSchema.safeParse(location.details);
        if (location.type === "commit" && found.success)
          return {
            path: found.data.path,
            startLine: found.data.start_line,
            endLine: found.data.end_line,
            commitSha: found.data.commit_sha,
          };
      }
      return null;
    },
  };
}
