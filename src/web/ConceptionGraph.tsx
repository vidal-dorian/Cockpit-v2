import dagre from "@dagrejs/dagre";
import {
  type Edge,
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import {
  CARD_FIELDS,
  type CodeModule,
  type CodeObject,
  linkLabel,
} from "./conception.ts";
import { focusRing } from "./ui.ts";

const WIDTH = 200;
const HEADER = 48;
const ROW = 16;
const FOOTER = 20;

type CardNode = Node<
  { object: CodeObject; selected: boolean; onOpen: () => void },
  "card"
>;

const heightOf = (object: CodeObject) =>
  HEADER +
  Math.min(object.fields.length, CARD_FIELDS) * ROW +
  (object.fields.length > CARD_FIELDS ? FOOTER : 0);

function ObjectCard({
  data: { object, selected, onOpen },
}: NodeProps<CardNode>) {
  const more = object.fields.length - CARD_FIELDS;
  return (
    <>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <button
        type="button"
        data-object={object.name}
        onClick={onOpen}
        aria-current={selected || undefined}
        className={`block w-[200px] rounded-xl border px-3 py-2.5 text-left ${selected ? "border-foreground bg-raised" : "border-border-strong bg-card hover:bg-raised"} ${focusRing}`}
      >
        <span className="block text-[13px] font-semibold">{object.name}</span>
        <span className="block text-xs text-dim">{object.kind}</span>
        {object.fields.slice(0, CARD_FIELDS).map((f, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: field names can repeat
            key={`${i}-${f.name}`}
            className="block truncate font-mono text-[10.5px] text-muted-foreground"
          >
            {f.name}
          </span>
        ))}
        {more > 0 && (
          <span className="block text-[10.5px] text-dim">+ {more} champs</span>
        )}
      </button>
    </>
  );
}

const nodeTypes = { card: ObjectCard };

/** Decision 043 I: one card per object, the links named, placed by dagre from left to right. */
export default function ConceptionGraph({
  module,
  selected,
  onOpen,
}: {
  module: CodeModule;
  selected?: string;
  onOpen: (name: string) => void;
}) {
  const { nodes, edges } = useMemo(() => {
    const { objects, links } = module.data;
    const graph = new dagre.graphlib.Graph();
    graph.setGraph({ rankdir: "LR", nodesep: 30, ranksep: 90 });
    graph.setDefaultEdgeLabel(() => ({}));
    for (const o of objects)
      graph.setNode(o.name, { width: WIDTH, height: heightOf(o) });
    for (const l of links) graph.setEdge(l.from, l.to);
    dagre.layout(graph);
    return {
      nodes: objects.map((object): CardNode => {
        const { x, y } = graph.node(object.name);
        const height = heightOf(object);
        return {
          id: object.name,
          type: "card",
          // dagre gives the centre, React Flow wants the top left corner.
          position: { x: x - WIDTH / 2, y: y - height / 2 },
          width: WIDTH,
          height,
          data: {
            object,
            selected: object.name === selected,
            onOpen: () => onOpen(object.name),
          },
        };
      }),
      edges: links.map(
        (l, i): Edge => ({
          id: `${i}-${l.from}-${l.kind}-${l.to}`,
          source: l.from,
          target: l.to,
          label: linkLabel(l),
        }),
      ),
    };
  }, [module, selected, onOpen]);
  return (
    <div className="h-full">
      <ReactFlow
        id={`conception-${module.path}`}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesConnectable={false}
        nodesDraggable={false}
        nodesFocusable={false}
        zoomOnScroll={false}
        preventScrolling={false}
        style={{ background: "transparent" }}
        proOptions={{ hideAttribution: true }}
        fitView
        fitViewOptions={{ padding: 0.15 }}
      />
    </div>
  );
}
