import { useEffect } from "react";
import { Modal } from "./Modal.tsx";
import { button, kbd, sectionLabel } from "./ui.ts";

const OFF_KEY = "cockpit-single-key-shortcuts-off";

/** WCAG 2.1.4: the browser's copy of the user's preference (kept on the server, decision 073 F), read at each key press. */
export function singleKeysOff() {
  try {
    return localStorage.getItem(OFF_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSingleKeysOff(off: boolean) {
  try {
    if (off) localStorage.setItem(OFF_KEY, "1");
    else localStorage.removeItem(OFF_KEY);
  } catch {
    // Storage blocked: the shortcuts stay as they were.
  }
}

/** Runs `action` when `key` is pressed alone, like `N` and `R` (decision 073 E): never with Ctrl, Cmd or Alt, never in a field, never when Préférences turned them off. No action, no shortcut. */
export function useShortcut(
  key: string,
  action: ((event: KeyboardEvent) => void) | undefined,
) {
  useEffect(() => {
    if (!action) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== key || singleKeysOff()) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement;
      // An open window keeps the page behind it out of reach, wherever the browser put the focus.
      if (
        target.isContentEditable ||
        target.closest("input, textarea, select") ||
        document.querySelector("dialog[open]")
      )
        return;
      event.preventDefault();
      action(event);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });
}

const SHORTCUTS = [
  ["Chercher", ["Ctrl K"]],
  ["Noter une idée", ["N"]],
  ["Élément suivant, précédent", ["J", "K"]],
  ["Valider", ["V"]],
  ["Reprise : modifier, signaler un bug, passer", ["M", "B", "P"]],
  ["Accueil : relire en série", ["R"]],
  ["Répondre à Claude (réponses proposées)", ["1", "2"]],
] as const;

/** The list of the shortcuts, in the card of Préférences and in the window of `?`. */
export function ShortcutList() {
  return (
    <ul className="grid gap-1.5">
      {SHORTCUTS.map(([name, keys]) => (
        <li key={name} className="flex items-center justify-between gap-3">
          {name}
          <span className="flex gap-1">
            {keys.map((key) => (
              <kbd key={key} className={kbd}>
                {key}
              </kbd>
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The window of `?` (decision 073 E). */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal label="Raccourcis clavier" onClose={onClose} className="w-[420px]">
      <div className="grid gap-4 p-5">
        <h2 className={sectionLabel}>Raccourcis clavier</h2>
        <ShortcutList />
        <button type="button" onClick={onClose} className={button}>
          Fermer
        </button>
      </div>
    </Modal>
  );
}
