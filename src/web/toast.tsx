import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

// `meta: { done: "Ticket enregistré." }` on a mutation: the Toaster says it once the mutation succeeds.
declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: { done?: string };
  }
}

/** How long a confirmation stays on screen (decision 081 B). */
export const TOAST_MS = 4000;

type Item = { id: number; text: string };
let items: Item[] = [];
let next = 1;
const listeners = new Set<(items: Item[]) => void>();
const emit = () => {
  for (const listener of listeners) listener(items);
};

/** Says that an action went well (decision 081 B): « Ticket enregistré. », for 4 s, at the bottom of the page. */
export function toast(text: string) {
  const item = { id: next++, text };
  items = [...items, item];
  emit();
  setTimeout(() => {
    items = items.filter((i) => i !== item);
    emit();
  }, TOAST_MS);
}

/** The confirmations of `toast` and of `meta.done`, mounted once by App. The live region stays mounted so that screen readers hear each new line. */
export function Toaster() {
  const [shown, setShown] = useState(items);
  useEffect(() => {
    listeners.add(setShown);
    return () => {
      listeners.delete(setShown);
      // Nobody left to show them: the lines go too (a test's render, a remount).
      if (listeners.size === 0) items = [];
    };
  }, []);
  const mutations = useQueryClient().getMutationCache();
  useEffect(
    () =>
      mutations.subscribe((event) => {
        const done = event.mutation?.meta?.done;
        if (event.type === "updated" && event.action.type === "success" && done)
          toast(done);
      }),
    [mutations],
  );
  return (
    <div
      // Not role="status": the screens' own status lines keep that role to themselves. Above the idea bar, centred on the page column (224 px sidebar).
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 md:bottom-24 md:left-[calc(224px+1rem)]"
    >
      {shown.map((item) => (
        <p
          key={item.id}
          className="toast flex items-center gap-2 rounded-[10px] border border-border-strong bg-raised px-3.5 py-2 text-[13px] font-semibold text-foreground"
        >
          <span aria-hidden="true" className="text-done">
            ✓
          </span>
          {item.text}
        </p>
      ))}
    </div>
  );
}
