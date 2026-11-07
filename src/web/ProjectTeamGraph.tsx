import {
  type Connection,
  type Edge,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useRef } from "react";
import { parseAgent } from "./agent-file.ts";
import type { TeamStep } from "./team-file.ts";
import { focusRing } from "./ui.ts";

const SESSION_MODEL = "Celui de la session";
const COLUMN = 200;
const CARD = 160;

type Agent = { name: string; text: string | null };

/** Decision 031 B: the cards of the team in a React Flow graph, loaded on demand with its styles. */
type CardData = {
  step: TeamStep;
  index: number;
  model: string | null;
  absent: boolean;
  onOpen: () => void;
};
type CardNode = Node<CardData, "card">;

function StepCard({ data }: NodeProps<CardNode>) {
  const { step, index, model, absent, onOpen } = data;
  return (
    <>
      <Handle type="target" position={Position.Left} id="in" />
      <Handle type="source" position={Position.Right} id="out" />
      <Handle type="target" position={Position.Bottom} id="loop-in" />
      <Handle type="source" position={Position.Bottom} id="loop-out" />
      <button
        type="button"
        data-testid={`team-card-${step.agent}`}
        onClick={onOpen}
        className={`flex w-40 flex-col gap-[3px] rounded-xl border border-border-strong bg-card px-3 py-2.5 text-left hover:bg-raised ${focusRing}`}
      >
        <span className="text-[11.5px] text-muted-foreground">
          Étape {index + 1}
        </span>
        <span className="text-[13px] font-semibold">{step.agent}</span>
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

const nodeTypes = { card: StepCard };

const arrow = { type: MarkerType.ArrowClosed, color: "var(--color-dim)" };

function edgesOf(steps: TeamStep[], selected: string | null): Edge[] {
  return steps.flatMap((s, i) => [
    ...(i > 0
      ? [
          {
            id: `next-${s.agent}`,
            source: steps[i - 1]?.agent as string,
            target: s.agent,
            sourceHandle: "out",
            targetHandle: "in",
            markerEnd: arrow,
            selectable: false,
          },
        ]
      : []),
    ...(s.loopTo !== null
      ? [
          {
            id: `loop-${s.agent}`,
            source: s.agent,
            target: s.loopTo,
            sourceHandle: "loop-out",
            targetHandle: "loop-in",
            type: "smoothstep",
            markerEnd: arrow,
            label: `retour au ${s.loopTo} : ${s.until}`,
            labelBgStyle: { fill: "var(--color-card)" },
            labelStyle: {
              fill: "var(--color-muted-foreground)",
              fontSize: 11.5,
            },
            style: { strokeDasharray: "4 4" },
            selected: selected === s.agent,
          },
        ]
      : []),
  ]);
}

export default function StepGraph({
  id,
  steps,
  agents,
  selectedLoop,
  onOpen,
  onLink,
  onSelectLoop,
}: {
  /** Tells apart the SVG ids of two graphs on one page. */
  id: string;
  steps: TeamStep[];
  agents: Agent[];
  selectedLoop: string | null;
  onOpen: (agent: string) => void;
  onLink: (from: string, to: string) => void;
  onSelectLoop: (agent: string | null) => void;
}) {
  // The click handler is read through a ref: a new function each render must not put moved cards back.
  const opener = useRef(onOpen);
  opener.current = onOpen;
  const laidOut = useMemo(
    () =>
      steps.map((step, i): CardNode => {
        const text = agents.find((a) => a.name === step.agent)?.text;
        return {
          id: step.agent,
          type: "card",
          position: { x: i * COLUMN, y: 0 },
          // Known size: React Flow draws the card without waiting for a measure.
          width: CARD,
          height: 96,
          data: {
            step,
            index: i,
            model: (text && parseAgent(text)?.model) || null,
            absent: !agents.some((a) => a.name === step.agent),
            onOpen: () => opener.current(step.agent),
          },
        };
      }),
    [steps, agents],
  );
  // A card moved by hand is only for reading: any change of the draft puts them back in place.
  const [nodes, setNodes, onNodesChange] = useNodesState(laidOut);
  useEffect(() => setNodes(laidOut), [laidOut, setNodes]);
  return (
    // Flat like the mockup: no dots, no zoom controls, the page keeps its scroll; the cards can still be dragged and linked.
    <div className="absolute inset-0 hidden sm:block">
      <ReactFlow
        id={id}
        nodes={nodes}
        edges={edgesOf(steps, selectedLoop)}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onConnect={({ source, target }: Connection) => onLink(source, target)}
        onEdgeClick={(_, edge) =>
          onSelectLoop(edge.id.startsWith("loop-") ? edge.source : null)
        }
        onPaneClick={() => onSelectLoop(null)}
        nodesConnectable
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        panOnDrag={false}
        preventScrolling={false}
        style={{ background: "transparent" }}
        proOptions={{ hideAttribution: true }}
        fitView
        fitViewOptions={{ maxZoom: 1, padding: 0.1 }}
      />
    </div>
  );
}
