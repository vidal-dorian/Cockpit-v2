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
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
type Selection = { kind: "step" | "loop"; key: string };

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
        <Handle type="target" position={Position.Left} id="in" />
      )}
      {id !== END && (
        <Handle type="source" position={Position.Right} id="out" />
      )}
      <div className="rounded-full border border-border-strong bg-raised px-3 py-1.5 text-[12.5px] font-semibold">
        {data.text}
      </div>
    </>
  );
}

function StepCard({ data, selected }: NodeProps<CardNode>) {
  const { step, model, absent, onOpen } = data;
  return (
    <>
      <Handle type="target" position={Position.Left} id="in" />
      <Handle type="source" position={Position.Right} id="out" />
      <Handle type="target" position={Position.Bottom} id="loop-in" />
      <Handle type="source" position={Position.Bottom} id="loop-out" />
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
  agents: string[];
  onInsert: (after: string, agent: string) => void;
};

/** A « puis » link; with `after`, the « + » in its middle opens the list of agents to insert (decision 079 D5). */
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
  const [open, setOpen] = useState(false);
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
          <div
            style={{
              transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
            }}
            className="nodrag nopan pointer-events-auto absolute"
          >
            <button
              type="button"
              aria-label={`Intercaler entre ${data.from} et ${data.to}`}
              aria-expanded={open}
              onClick={() => setOpen(!open)}
              className={`grid size-6 place-items-center rounded-full border border-border-strong bg-raised text-sm font-bold hover:bg-raised-hover ${focusRing}`}
            >
              +
            </button>
            {open && (
              <div className="absolute top-7 left-1/2 z-10 flex max-h-56 w-44 -translate-x-1/2 flex-col gap-1 overflow-auto rounded-xl border border-border-strong bg-card p-2">
                <p className="text-[11.5px] text-muted-foreground">
                  Intercaler entre {data.from} et {data.to}
                </p>
                {data.agents.map((agent) => (
                  <button
                    key={agent}
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      data.onInsert(data.after as string, agent);
                    }}
                    className={`rounded-lg px-2 py-1 text-left font-mono text-[12.5px] hover:bg-raised ${focusRing}`}
                  >
                    {agent}
                  </button>
                ))}
              </div>
            )}
          </div>
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
  "--xy-minimap-background-color-default": "var(--color-sunken)",
  "--xy-minimap-node-background-color-default": "var(--color-border-strong)",
  "--xy-minimap-mask-background-color-default":
    "color-mix(in srgb, var(--color-background) 60%, transparent)",
  "--xy-background-pattern-dots-color-default": "var(--color-border-strong)",
  "--xy-edge-label-color-default": "var(--color-muted-foreground)",
} as CSSProperties;

/** Decision 079 D4: the nodes and the links of the team. A group is a column; the block that waits for it comes after. */
function drawing(
  steps: TeamStep[],
  agents: Agent[],
  select: (key: string) => void,
  selected: Selection | null,
  names: string[],
  onInsert: ThenData["onInsert"],
) {
  const groups = groupsOf(steps);
  const rows = Math.max(1, ...groups.map((g) => g.length));
  const middle = ((rows - 1) * ROW) / 2;
  const nodes: (CardNode | BarNode)[] = [];
  const edges: (Edge | BuiltInEdge)[] = [];
  const bar = (id: string, x: number, text: string): BarNode => ({
    id,
    type: "bar",
    position: { x, y: middle + 40 },
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
    then?: { after?: string; to: string },
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
        to: then?.to ?? "",
        after: then?.after,
        agents: names,
        onInsert,
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
  for (const s of steps)
    if (s.loopTo !== null)
      edges.push({
        id: `loop-${keyOf(s)}`,
        source: keyOf(s),
        target: s.loopTo,
        sourceHandle: "loop-out",
        targetHandle: "loop-in",
        type: "smoothstep",
        pathOptions: { offset: 28 },
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
  return { nodes, edges };
}

export default function TeamCanvasGraph({
  id,
  steps,
  agents,
  tidied,
  selected,
  palette,
  onSelect,
  onLink,
  onInsert,
  onAdd,
  onRemoveStep,
  onRemoveLoop,
}: {
  /** Tells apart the SVG ids of two graphs on one page. */
  id: string;
  steps: TeamStep[];
  agents: Agent[];
  /** Changes when « Ranger tout seul » is clicked. */
  tidied: number;
  selected: Selection | null;
  /** The agents of the left column, for the « + » menu of a link. */
  palette: string[];
  onSelect: (selection: Selection | null) => void;
  onLink: (from: string, to: string) => void;
  onInsert: (after: string, agent: string) => void;
  onAdd: (agent: string) => void;
  onRemoveStep: (key: string) => void;
  onRemoveLoop: (key: string) => void;
}) {
  // The handlers are read through a ref: a new function each render must not put moved cards back.
  const handlers = useRef({ onSelect, onInsert });
  handlers.current = { onSelect, onInsert };
  const drawn = useMemo(
    () =>
      drawing(
        steps,
        agents,
        (key) => handlers.current.onSelect({ kind: "step", key }),
        selected,
        palette,
        (after, agent) => handlers.current.onInsert(after, agent),
      ),
    [steps, agents, selected, palette],
  );
  // A card moved by hand is only for reading: any change of the draft, or « Ranger tout seul », puts them back in place.
  const [nodes, setNodes, onNodesChange] = useNodesState(drawn.nodes);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tidied` is the trigger
  useEffect(() => setNodes(drawn.nodes), [drawn.nodes, tidied, setNodes]);
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
        // On a link: inserted there; elsewhere: the last step.
        const link = document
          .elementsFromPoint(e.clientX, e.clientY)
          .map((el) => el.closest(".react-flow__edge"))
          .find((el) => el?.getAttribute("data-id")?.startsWith("next-"));
        const edge = drawn.edges.find(
          (x) => x.id === link?.getAttribute("data-id"),
        );
        const after = (edge?.data as ThenData | undefined)?.after;
        if (after !== undefined) onInsert(after, agent);
        else onAdd(agent);
      }}
    >
      <ReactFlow
        id={id}
        nodes={nodes}
        edges={drawn.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onConnect={({ source, target }: Connection) => {
          if (!source.startsWith(":") && !target.startsWith(":"))
            onLink(source, target);
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
        nodesConnectable
        style={flowColors}
        proOptions={{ hideAttribution: true }}
        fitView
        fitViewOptions={{ maxZoom: 1, padding: 0.1 }}
      >
        <Background variant={BackgroundVariant.Dots} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}
