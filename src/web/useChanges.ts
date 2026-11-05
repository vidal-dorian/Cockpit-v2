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
