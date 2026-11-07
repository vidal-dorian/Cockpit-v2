import dagre from "@dagrejs/dagre";
import {
  Background,
  type Edge,
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import { useNavigate } from "react-router";
import {
  type Features,
  objectHref,
  objectsOf,
  ruleHref,
  stateWord,
} from "./features.ts";
import { card, focusRing, sectionLabel } from "./ui.ts";

const WIDTH = 200;
const HEIGHT = 64;
const GAP = 70;
const TITLES = ["Acteurs", "Fonctionnalités", "Règles", "Objets"];

type Item = Node<
  {
    title: string;
    sub?: string;
    // « En clair » (what touches the chosen feature) or muted.
    clear: boolean;
    chosen?: boolean;
    unmapped?: boolean;
    onClick?: () => void;
  },
  "item"
>;
type Title = Node<{ title: string }, "title">;

function ItemNode({ data }: NodeProps<Item>) {
  const { title, sub, clear, chosen, unmapped, onClick } = data;
  const shape = `${card} block h-16 w-[200px] px-3 py-2 text-left ${clear ? "" : "opacity-40"} ${chosen ? "border-foreground bg-raised" : ""} ${unmapped ? "border-dashed border-border-strong text-dim" : ""}`;
  const body = (
    <>
      <span className="line-clamp-2 text-[13px] leading-tight font-semibold">
        {title}
      </span>
      {sub && <span className="block text-[11.5px] text-dim">{sub}</span>}
    </>
  );
  return (
    <>
      <Handle type="target" position={Position.Left} />
      <Handle type="target" id="peer" position={Position.Right} />
      <Handle type="source" position={Position.Right} />
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className={`${shape} hover:border-border-strong hover:bg-raised ${focusRing}`}
        >
          {body}
        </button>
      ) : (
        <div className={shape}>{body}</div>
      )}
    </>
  );
}

const nodeTypes = {
  item: ItemNode,
  title: ({ data }: NodeProps<Title>) => (
    <p className={sectionLabel}>{data.title}</p>
  ),
};

/** Decision 048 F and G: four fixed columns (actors, features, rules, objects), the order inside each by dagre, what touches the chosen feature in clear and the rest muted; each click as in the list. */
export default function FeaturesGraph({
  projectId,
  data,
  chosenId,
  onChoose,
  onAnalyse,
}: {
  projectId: string;
  data: Features;
  chosenId: number;
  onChoose: (id: number) => void;
  onAnalyse: () => void;
}) {
  const navigate = useNavigate();
  const { nodes, edges } = useMemo(() => {
    const { features, links } = data;
    const chosen = features.find((f) => f.id === chosenId);
    const key = (actor: string) => actor.toLowerCase();
    const touched = new Set(chosen ? objectsOf(chosen).map((o) => o.name) : []);
    const items = new Map<string, { column: number; node: Item["data"] }>();
    const ends: [string, string, boolean][] = [];
    for (const f of features) {
      const isChosen = f.id === chosenId;
      items.set(`f${f.id}`, {
        column: 1,
        node: {
          title: f.title,
          clear: isChosen,
          chosen: isChosen,
          onClick: () => onChoose(f.id),
        },
      });
      for (const actor of f.actors) {
        const clear = !!chosen?.actors.some((a) => key(a) === key(actor));
        // The first spelling names the node.
        if (!items.has(`a${key(actor)}`))
          items.set(`a${key(actor)}`, {
            column: 0,
            node: { title: actor, clear },
          });
        ends.push([`a${key(actor)}`, `f${f.id}`, clear && isChosen]);
      }
      for (const r of f.rules) {
        items.set(`r${r.id}`, {
          column: 2,
          node: {
            title: r.summary,
            sub: stateWord(r),
            clear: isChosen,
            onClick: () => navigate(ruleHref(projectId, r)),
          },
        });
        ends.push([`f${f.id}`, `r${r.id}`, isChosen]);
        for (const o of r.objects) {
          items.set(`o${o.name}`, {
            column: 3,
            node: {
              title: o.name,
              sub: o.inMap ? undefined : "non cartographié",
              clear: touched.has(o.name),
              unmapped: !o.inMap,
              onClick: o.inMap
                ? () => navigate(objectHref(projectId, o.name))
                : onAnalyse,
            },
          });
          ends.push([`r${r.id}`, `o${o.name}`, isChosen]);
        }
      }
    }
    // The links between objects stay out of the layout: they would add columns.
    const graph = new dagre.graphlib.Graph();
    graph.setGraph({ rankdir: "LR", nodesep: 16, ranksep: GAP });
    graph.setDefaultEdgeLabel(() => ({}));
    for (const id of items.keys())
      graph.setNode(id, { width: WIDTH, height: HEIGHT });
    for (const [from, to] of ends) graph.setEdge(from, to);
    dagre.layout(graph);
    const objectLinks = links.map((l): [string, string, boolean] => [
      `o${l.from}`,
      `o${l.to}`,
      touched.has(l.from) && touched.has(l.to),
    ]);
    return {
      nodes: [
        ...TITLES.map(
          (title, column): Title => ({
            id: `t${column}`,
            type: "title",
            position: { x: column * (WIDTH + GAP), y: 0 },
            data: { title },
            draggable: false,
            selectable: false,
            focusable: false,
          }),
        ),
        ...[...items].map(([id, { column, node }]): Item => {
          const { y } = graph.node(id);
          return {
            id,
            type: "item",
            position: { x: column * (WIDTH + GAP), y: y - HEIGHT / 2 + 36 },
            width: WIDTH,
            height: HEIGHT,
            data: node,
          };
        }),
      ],
      edges: [...ends, ...objectLinks].map(
        ([source, target, clear], i): Edge => ({
          id: `${i}-${source}-${target}`,
          source,
          target,
          // An object link enters by the right side: it would curve back across the column.
          targetHandle: i >= ends.length ? "peer" : undefined,
          style: clear ? undefined : { opacity: 0.25 },
        }),
      ),
    };
  }, [data, chosenId, projectId, navigate, onChoose, onAnalyse]);
  return (
    <div className="h-[420px]">
      <ReactFlow
        id="features"
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesConnectable={false}
        nodesDraggable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        fitView
      >
        <Background />
      </ReactFlow>
    </div>
  );
}
