/** The name of the marketplace Cockpit writes in the plugin repo of a user (decision 066 C). */
export const marketplaceOf = (login: string) =>
  `cockpit-${login.toLowerCase()}`;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether the text of a `.claude/settings.json` enables the shared plugin (decision 066 F). */
export function pluginInstalled(text: string | null, login: string) {
  try {
    const settings = JSON.parse(text ?? "null");
    return (
      isObject(settings) &&
      isObject(settings.enabledPlugins) &&
      settings.enabledPlugins[`commun@${marketplaceOf(login)}`] === true
    );
  } catch {
    return false;
  }
}

/**
 * The text of `.claude/settings.json` once the shared plugin is installed or removed (decision 066 G), computed from the text read (null: no file). Only the two entries of the plugin change; a key left empty goes. Throws when the text is not a JSON object.
 */
export function pluginSettings(
  before: string | null,
  { login, repo }: { login: string; repo: string },
  install: boolean,
) {
  const settings: unknown = before === null ? {} : JSON.parse(before);
  if (!isObject(settings)) throw new Error("Not a JSON object");
  const market = marketplaceOf(login);
  const edit = (key: string, entry: string, value: unknown) => {
    const current = settings[key] ?? {};
    if (!isObject(current)) throw new Error(`${key} is not an object`);
    const entries = { ...current };
    if (install) entries[entry] = value;
    else delete entries[entry];
    if (Object.keys(entries).length > 0) settings[key] = entries;
    else delete settings[key];
  };
  edit("extraKnownMarketplaces", market, {
    source: { source: "github", repo },
  });
  edit("enabledPlugins", `commun@${market}`, true);
  return `${JSON.stringify(settings, null, 2)}\n`;
}
