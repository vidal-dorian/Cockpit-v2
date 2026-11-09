/** The key under which the theme is kept in the browser, which the script of index.html reads before the first render. */
export const THEME_KEY = "cockpit-theme";

/** Shows a theme (decision 073 F): `data-theme` on <html> picks the tokens of styles.css; the copy in localStorage spares a dark flash at the next load. */
export function applyTheme(theme: string) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage blocked: the server's copy still applies at every load.
  }
}
