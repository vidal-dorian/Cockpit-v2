import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

/** Reloads the query `["run", "12"]` each time the server says `run:12` changed (decision 033 G); `EventSource` reconnects by itself. */
export function useChanges(key: string) {
  const queryClient = useQueryClient();
  useEffect(() => {
    // No stream where the browser has none (and in tests that do not stub it).
    if (typeof EventSource === "undefined") return;
    const source = new EventSource("/api/events");
    source.addEventListener("change", (event) => {
      if ((event as MessageEvent).data === key)
        queryClient.invalidateQueries({ queryKey: key.split(":") });
    });
    return () => source.close();
  }, [key, queryClient]);
}

/** Reloads the query `key` on every change the server tells, whatever the object (decision 040 F); `enabled` false opens no stream. */
export function useAnyChange(key: string, enabled = true) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return;
    const source = new EventSource("/api/events");
    source.addEventListener("change", () =>
      queryClient.invalidateQueries({ queryKey: [key] }),
    );
    // A dead stream means a dead server: the banner learns it without waiting.
    source.onerror = () =>
      queryClient.invalidateQueries({ queryKey: ["health"] });
    return () => source.close();
  }, [key, enabled, queryClient]);
}
