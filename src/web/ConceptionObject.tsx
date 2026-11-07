import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { client } from "./api.ts";
import type { CodeModule, CodeObject } from "./conception.ts";
import { Panel } from "./Shell.tsx";
import { badge, focusRing, ghostButton, sectionLabel } from "./ui.ts";

/** Decision 043 H: the cited lines and three lines around them, read on GitHub when the panel opens. The route reads its query by hand, so the client does not type it: `$path` gives the address, the answer is typed here. */
async function fetchCode(
  id: string,
  query: { sha: string; path: string; start: string; end: string },
) {
  const path = client.api.projects[":id"].code.$path({ param: { id } });
  const res = await fetch(`${path}?${new URLSearchParams(query)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { firstLine: number; lines: string[] };
}

/** Decision 043 I: the panel of an object, all its fields, where it is defined, its code and the permalink at the commit. */
export function ConceptionObject({
  projectId,
  fullName,
  module,
  object,
  onClose,
}: {
  projectId: string;
  fullName: string;
  module: CodeModule;
  object: CodeObject;
  onClose: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The panel takes the focus when it opens and when another object replaces the first.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the name is the trigger, not a value read.
  useEffect(() => headingRef.current?.focus(), [object.name]);
  const { path, start_line: start, end_line: end } = object.citation;
  const code = useQuery({
    queryKey: ["code", projectId, module.commitSha, path, start, end],
    queryFn: () =>
      fetchCode(projectId, {
        sha: module.commitSha,
        path,
        start: String(start),
        end: String(end),
      }),
    retry: false,
  });
  const lines = start === end ? `ligne ${start}` : `lignes ${start} à ${end}`;
  const anchor = start === end ? `L${start}` : `L${start}-L${end}`;
  return (
    <Panel
      label={`Objet ${object.name}`}
      badge={<span className={badge}>Objet</span>}
    >
      <h2 ref={headingRef} tabIndex={-1} className="text-xl font-semibold">
        {object.name}
      </h2>
      <p className="text-muted-foreground">{object.kind}</p>
      <p className={sectionLabel}>Les champs · {object.fields.length}</p>
      <ul className="font-mono text-[13px]">
        {object.fields.map((f, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: field names can repeat
          <li key={`${i}-${f.name}`}>
            {f.name} <span className="text-muted-foreground">{f.type}</span>
          </li>
        ))}
      </ul>
      <p className={sectionLabel}>Le code</p>
      {code.data && (
        <pre className="overflow-x-auto rounded-xl border border-border bg-sunken py-2.5 font-mono text-xs leading-[1.65]">
          {code.data.lines.map((text, i) => {
            const n = code.data.firstLine + i;
            return (
              <div
                key={n}
                className={`px-3.5 ${
                  n >= start && n <= end
                    ? "bg-raised shadow-[inset_2px_0_0_var(--color-foreground)]"
                    : "text-muted-foreground"
                }`}
              >
                <span className="mr-3 inline-block w-8 text-right text-dim">
                  {n}
                </span>
                {text}
              </div>
            );
          })}
        </pre>
      )}
      {code.isError && (
        <p className="text-muted-foreground">
          Le code n'a pas pu être lu : ouvre-le sur GitHub.
        </p>
      )}
      <p className="text-[12.5px] text-muted-foreground">
        Défini dans <code>{path}</code>, {lines}
      </p>
      <a
        href={`https://github.com/${fullName}/blob/${module.commitSha}/${path.split("/").map(encodeURIComponent).join("/")}#${anchor}`}
        target="_blank"
        rel="noreferrer noopener"
        className={`underline ${focusRing}`}
      >
        Voir sur GitHub ↗
      </a>
      <button type="button" className={ghostButton} onClick={onClose}>
        Fermer
      </button>
    </Panel>
  );
}
