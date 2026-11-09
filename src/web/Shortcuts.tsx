import { useEffect } from "react";
import { Modal } from "./Modal.tsx";
import { button, kbd, sectionLabel } from "./ui.ts";

/** Runs `action` when `key` is pressed alone, like `N` and `R` (decision 073 E): never with Ctrl, Cmd or Alt, never in a field. No action, no shortcut. */
export function useShortcut(
  key: string,
  action: ((event: KeyboardEvent) => void) | undefined,
) {
  useEffect(() => {
    if (!action) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== key) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (
        target.isContentEditable ||
        target.closest("input, textarea, select, dialog")
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
