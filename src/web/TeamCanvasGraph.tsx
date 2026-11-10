import {
  Background,
  BackgroundVariant,
  BaseEdge,
  type BuiltInEdge,
  type Connection,
  Controls,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  getSmoothStepPath,
  Handle,
  MarkerType,
  MiniMap,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  type ReactFlowInstance,
  useConnection,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { type CSSProperties, useEffect, useMemo, useRef } from "react";
import { parseAgent } from "./agent-file.ts";
import {
  DRAG_TYPE,
  groupsOf,
  keyOf,
  stepLabel,
  type TeamStep,
} from "./team-file.ts";
import { focusRing } from "./ui.ts";

const SESSION_MODEL = "Celui de la session";
const COLUMN = 220;
const ROW = 130;
const CARD = 160;
const START = ":start";
const END = ":end";

type Agent = { name: string; text: string | null };
type Selection = { kind: "step" | "loop" | "link"; key: string };

/** Where an agent is dropped: on a link, on a card, or between the groups. */
type Drop = { after: string } | { parallelTo: string } | { group: number };

// A handle that only anchors an edge: invisible, and nothing starts or ends there.
const anchor = { opacity: 0 } as const;
// A handle over the whole card: a link starts and ends anywhere on it (React Flow « easy connect »).
const wholeCard = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  transform: "none",
  borderRadius: 12,
  opacity: 0,
} as const;

type CardData = {
  step: TeamStep;
  model: string | null;
  absent: boolean;
  onOpen: () => void;
};
type CardNode = Node<CardData, "card">;
type BarNode = Node<{ text: string }, "bar">;

/** Decision 079 D4: « ▶ Début », « ■ Fin » and the block that waits for a group. */
function Bar({ data, id }: NodeProps<BarNode>) {
  return (
    <>
      {id !== START && (
        <Handle
          type="target"
          position={Position.Left}
          id="in"
          isConnectable={false}
          style={anchor}
        />
      )}
      {id !== END && (
        <Handle
          type="source"
          position={Position.Right}
          id="out"
          isConnectable={false}
          style={anchor}
        />
      )}
      <div className="rounded-full border border-border-strong bg-raised px-3 py-1.5 text-[12.5px] font-semibold">
        {data.text}
      </div>
    </>
  );
}

function StepCard({ data, selected }: NodeProps<CardNode>) {
  const { step, model, absent, onOpen } = data;
  const { inProgress } = useConnection();
  return (
    <>
      {(
        [
          ["target", Position.Left, "in"],
          ["source", Position.Right, "out"],
          ["target", Position.Bottom, "loop-in"],
          ["source", Position.Bottom, "loop-out"],
        ] as const
      ).map(([type, position, id]) => (
        <Handle
          key={id}
          type={type}
          position={position}
          id={id}
          isConnectable={false}
          style={anchor}
        />
      ))}
      <Handle type="target" position={Position.Top} id="to" style={wholeCard} />
      {!inProgress && (
        <Handle
          type="source"
          position={Position.Top}
          id="from"
          style={wholeCard}
        />
      )}
      <button
        type="button"
        data-testid={`team-card-${keyOf(step)}`}
        onClick={onOpen}
        className={`flex w-40 flex-col gap-[3px] rounded-xl border bg-card px-3 py-2.5 text-left hover:bg-raised ${selected ? "border-foreground" : "border-border-strong"} ${focusRing}`}
      >
        <span className="text-[13px] font-semibold">{stepLabel(step)}</span>
        <span className="line-clamp-2 text-[11.5px] text-muted-foreground">
          {step.does}
        </span>
        <span className="text-[11.5px] text-dim">
          {absent ? "Agent absent du repo" : (model ?? SESSION_MODEL)}
        </span>
      </button>
    </>
  );
}

type ThenData = {
  /** The step after which « + » inserts; absent on a link that takes no « + ». */
  after?: string;
  from: string;
  to: string;
  onPick: () => void;
};

/** A « puis » link; with `after`, the « + » in its middle selects it: the panel then lists the agents to insert (decision 079 D5). */
function ThenEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps<Edge<ThenData, "next">>) {
  const [path, x, y] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} />
      {data?.after !== undefined && (
        <EdgeLabelRenderer>
          <button
            type="button"
            aria-label={`Intercaler entre ${data.from} et ${data.to}`}
            // The label is in a portal but React bubbles the click to the edge, whose click would clear the selection.
            onClick={(e) => {
              e.stopPropagation();
              data.onPick();
            }}
            style={{
              transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
            }}
            className={`nodrag nopan pointer-events-auto absolute grid size-6 place-items-center rounded-full border border-border-strong bg-raised text-sm font-bold hover:bg-raised-hover ${focusRing}`}
          >
            +
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { card: StepCard, bar: Bar };
const edgeTypes = { next: ThenEdge };
const arrow = { type: MarkerType.ArrowClosed, color: "var(--color-dim)" };

/** The words on a loop (decision 079 D4). */
const loopLabel = (s: TeamStep) =>
  `${
    s.until === "the verdict is ready"
      ? "si bloqué"
      : s.until === "the tests pass"
        ? "si les tests échouent"
        : s.until === "always"
          ? "toujours"
          : s.until
  }${s.max === undefined ? "" : ` · ${s.max} fois au plus`}`;

// The colors of React Flow's own controls and mini-map are the tokens of the page, in both themes.
const flowColors = {
  background: "transparent",
  "--xy-controls-button-background-color-default": "var(--color-raised)",
  "--xy-controls-button-background-color-hover-default":
    "var(--color-raised-hover)",
  "--xy-controls-button-color-default": "var(--color-foreground)",
  "--xy-controls-button-border-color-default": "var(--color-border-strong)",
  "--xy-minimap-background-color-default": "var(--color-raised)",
  "--xy-minimap-node-background-color-default": "var(--color-border-strong)",
  "--xy-minimap-mask-background-color-default":
    "color-mix(in srgb, var(--color-background) 60%, transparent)",
  "--xy-edge-label-color-default": "var(--color-muted-foreground)",
} as CSSProperties;

/** Decision 079 D4: the nodes and the links of the team. A group is a column; the block that waits for it comes after. */
function drawing(
  steps: TeamStep[],
  agents: Agent[],
  select: (key: string) => void,
  selected: Selection | null,
  pick: (after: string) => void,
) {
  const groups = groupsOf(steps);
  const rows = Math.max(1, ...groups.map((g) => g.length));
  const middle = ((rows - 1) * ROW) / 2;
  const nodes: (CardNode | BarNode)[] = [];
  const edges: (Edge | BuiltInEdge)[] = [];
  const bar = (id: string, x: number, text: string): BarNode => ({
    id,
    type: "bar",
    // Centred on the cards (100 high) so the links leave them straight.
    position: { x, y: middle + 35 },
    deletable: false,
    data: { text },
  });
  let x = COLUMN / 2;
  nodes.push(bar(START, 0, "▶ Début"));
  // The node that a link leaves: the step, or the block that waits for its group.
  let out: string[] = [START];
  let outLabel = "Début";
  let last = "";
  const link = (
    id: string,
    source: string,
    target: string,
    then: { after?: string; to: string },
  ) =>
    edges.push({
      id,
      type: "next",
      source,
      target,
      sourceHandle: "out",
      targetHandle: "in",
      markerEnd: arrow,
      selectable: false,
      deletable: false,
      data: {
        from: outLabel,
        to: then.to,
        after: then.after,
        onPick: () => pick(then.after as string),
      },
    });
  for (const [g, group] of groups.entries()) {
    for (const [m, step] of group.entries()) {
      const key = keyOf(step);
      const text = agents.find((a) => a.name === step.agent)?.text;
      nodes.push({
        id: key,
        type: "card",
        position: { x, y: middle - ((group.length - 1) * ROW) / 2 + m * ROW },
        width: CARD,
        height: 100,
        selected: selected?.kind === "step" && selected.key === key,
        data: {
          step,
          model: (text && parseAgent(text)?.model) || null,
          absent: !agents.some((a) => a.name === step.agent),
          onOpen: () => select(key),
        },
      });
      for (const source of out)
        link(`next-${source}-${key}`, source, key, {
          // « + » only where the link ends on the first step of a group, and after a step (not after Début).
          after: m === 0 && last ? last : undefined,
          to: stepLabel(group[0] as TeamStep),
        });
    }
    x += COLUMN;
    const lastStep = group.at(-1) as TeamStep;
    last = keyOf(lastStep);
    if (group.length > 1) {
      const id = `:wait-${g}`;
      nodes.push(
        bar(
          id,
          x - COLUMN / 4,
          group[0]?.wait === "first"
            ? "⑂ Le premier suffit"
            : group.length === 2
              ? "⑂ Attendre les deux"
              : `⑂ Attendre les ${group.length}`,
        ),
      );
      for (const step of group)
        edges.push({
          id: `join-${keyOf(step)}`,
          source: keyOf(step),
          target: id,
          sourceHandle: "out",
          targetHandle: "in",
          markerEnd: arrow,
          selectable: false,
          deletable: false,
        });
      x += COLUMN / 2;
      out = [id];
    } else out = [last];
    outLabel = stepLabel(lastStep);
  }
  nodes.push(bar(END, x, "■ Fin"));
  for (const source of out)
    link(`next-${source}-end`, source, END, { after: last, to: "Fin" });
  // Each loop has its own lane, the longest outermost, so that two loops into one step never share a line.
  const column = (key: string) =>
    groups.findIndex((g) => g.some((t) => keyOf(t) === key));
  const loops = steps
    .filter((s) => s.loopTo !== null)
    .sort(
      (a, b) =>
        column(keyOf(a)) -
        column(a.loopTo as string) -
        (column(keyOf(b)) - column(b.loopTo as string)),
    );
  for (const [rank, s] of loops.entries()) {
    edges.push({
      id: `loop-${keyOf(s)}`,
      source: keyOf(s),
      target: s.loopTo as string,
      sourceHandle: "loop-out",
      targetHandle: "loop-in",
      type: "smoothstep",
      pathOptions: { offset: 28 + 24 * rank },
      markerEnd: arrow,
      label: loopLabel(s),
      labelShowBg: false,
      labelStyle: {
        fill: "var(--color-muted-foreground)",
        fontSize: 11.5,
        transform: "translateY(14px)",
      },
      style: { strokeDasharray: "4 4" },
      selected: selected?.kind === "loop" && selected.key === keyOf(s),
    });
  }
  return { nodes, edges };
}

export default function TeamCanvasGraph({
  id,
  steps,
  agents,
  selected,
  onSelect,
  onLink,
  onDropAt,
  onRemoveStep,
  onRemoveLoop,
}: {
  /** Tells apart the SVG ids of two graphs on one page. */
  id: string;
  steps: TeamStep[];
  agents: Agent[];
  selected: Selection | null;
  onSelect: (selection: Selection | null) => void;
  onLink: (from: string, to: string) => void;
  onDropAt: (drop: Drop, agent: string) => void;
  onRemoveStep: (key: string) => void;
  onRemoveLoop: (key: string) => void;
}) {
  // The handlers are read through a ref: a new function each render must not redraw the graph.
  const handlers = useRef({ onSelect });
  handlers.current = { onSelect };
  const flow = useRef<ReactFlowInstance<CardNode | BarNode> | null>(null);
  const drawn = useMemo(
    () =>
      drawing(
        steps,
        agents,
        (key) => handlers.current.onSelect({ kind: "step", key }),
        selected,
        (key) => handlers.current.onSelect({ kind: "link", key }),
      ),
    [steps, agents, selected],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(drawn.nodes);
  useEffect(() => setNodes(drawn.nodes), [drawn.nodes, setNodes]);
  // A step added or removed can fall off the view: fit it again, after the new nodes are drawn.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the number of steps is the trigger
  useEffect(() => {
    requestAnimationFrame(() =>
      flow.current?.fitView({ maxZoom: 1, padding: 0.1, duration: 200 }),
    );
  }, [steps.length]);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: dropping is a pointer extra, the keyboard adds with the buttons of the left column
    <div
      className="absolute inset-0"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DRAG_TYPE)) e.preventDefault();
      }}
      onDrop={(e) => {
        const agent = e.dataTransfer.getData(DRAG_TYPE);
        if (!agent) return;
        e.preventDefault();
        const under = document.elementsFromPoint(e.clientX, e.clientY);
        // The mini-map sits over the canvas: a drop there aims at nothing.
        if (under.some((el) => el.closest(".react-flow__minimap"))) return;
        // Where it is released: on a link, inserted there; on a card, in parallel with it; elsewhere, between the groups.
        const link = under
          .map((el) => el.closest(".react-flow__edge"))
          .find((el) => el?.getAttribute("data-id")?.startsWith("next-"));
        const edge = drawn.edges.find(
          (x) => x.id === link?.getAttribute("data-id"),
        );
        const after = (edge?.data as ThenData | undefined)?.after;
        const card = under
          .map((el) => el.closest(".react-flow__node")?.getAttribute("data-id"))
          .find((key) => key && !key.startsWith(":"));
        if (after !== undefined) onDropAt({ after }, agent);
        else if (card) onDropAt({ parallelTo: card }, agent);
        else {
          const x = flow.current?.screenToFlowPosition({
            x: e.clientX,
            y: e.clientY,
          }).x;
          const centres = groupsOf(steps).map(
            (g) =>
              (nodes.find((n) => n.id === keyOf(g[0] as TeamStep))?.position
                .x ?? 0) +
              CARD / 2,
          );
          onDropAt(
            { group: centres.filter((c) => c < (x ?? Infinity)).length },
            agent,
          );
        }
      }}
    >
      <ReactFlow
        id={id}
        nodes={nodes}
        edges={drawn.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={(instance) => {
          flow.current = instance;
        }}
        onNodesChange={onNodesChange}
        onConnect={({ source, target }: Connection) => onLink(source, target)}
        onNodeClick={(_, node) => {
          if (node.type === "card") onSelect({ kind: "step", key: node.id });
        }}
        onEdgeClick={(_, edge) =>
          onSelect(
            edge.id.startsWith("loop-")
              ? { kind: "loop", key: edge.source }
              : null,
          )
        }
        onPaneClick={() => onSelect(null)}
        // Suppr removes the selected card or loop.
        onDelete={({ nodes: gone, edges: lost }) => {
          if (gone[0]) onRemoveStep(gone[0].id);
          else if (lost[0]) onRemoveLoop(lost[0].source);
        }}
        deleteKeyCode={["Delete", "Backspace"]}
        nodesDraggable={false}
        nodesConnectable
        connectOnClick={false}
        style={flowColors}
        proOptions={{ hideAttribution: true }}
        fitView
        fitViewOptions={{ maxZoom: 1, padding: 0.1 }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          size={1.5}
          gap={20}
          color="var(--color-dim)"
        />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          className="overflow-hidden rounded-lg border border-border-strong"
          // Small enough not to hide the cards it sits on.
          style={{ width: 128, height: 80 }}
        />
      </ReactFlow>
    </div>
  );
}
