import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Link } from "react-router";
import { CodeView } from "./CodeView.tsx";
import {
  type CodeModule,
  type CodeObject,
  fetchCode,
  permalink,
} from "./conception.ts";
import { ruleHref, useFeatures } from "./features.ts";
import { Panel } from "./Shell.tsx";
import { badge, focusRing, ghostButton, sectionLabel } from "./ui.ts";

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
  // Decision 085 C: the rules that cite this object, linked like on the features screen.
  const touching = [
    ...new Map(
      (useFeatures(projectId).data?.features ?? [])
        .flatMap((f) => f.rules)
        .filter((r) => r.objects.some((o) => o.name === object.name))
        .map((r) => [r.id, r]),
    ).values(),
  ];
  const lines = start === end ? `ligne ${start}` : `lignes ${start} à ${end}`;
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
      {touching.length > 0 && (
        <>
          <p className={sectionLabel}>
            Les règles qui le touchent · {touching.length}
          </p>
          <ul className="grid gap-1">
            {touching.map((r) => (
              <li key={r.id}>
                <Link
                  to={ruleHref(projectId, r)}
                  className={`underline ${focusRing}`}
                >
                  {r.summary}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className={sectionLabel}>Le code</p>
      {code.data && (
        <CodeView
          path={path}
          firstLine={code.data.firstLine}
          lines={code.data.lines}
          start={start}
          end={end}
        />
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
        href={permalink(fullName, module.commitSha, path, start, end)}
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
