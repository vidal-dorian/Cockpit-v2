import {
  Background,
  type Connection,
  Controls,
  type Edge,
  Handle,
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
import { card, focusRing } from "./ui.ts";

const SESSION_MODEL = "Celui de la session";
const COLUMN = 280;

type Agent = { name: string; text: string | null };

/** Decision 031 B: the cards of the team in a React Flow graph, loaded on demand with its styles. */
type CardData = {
  step: TeamStep;
  model: string | null;
  absent: boolean;
  onOpen: () => void;
};
type CardNode = Node<CardData, "card">;

function StepCard({ data }: NodeProps<CardNode>) {
  const { step, model, absent, onOpen } = data;
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
        className={`${card} block w-60 p-3 text-left ${focusRing}`}
      >
        <span className="block font-mono font-semibold">{step.agent}</span>
        <span className="block text-sm text-muted-foreground">
          {absent ? "Agent absent du repo" : (model ?? SESSION_MODEL)}
        </span>
        <span className="mt-1 block text-sm">{step.does}</span>
      </button>
    </>
  );
}

const nodeTypes = { card: StepCard };

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
            label: "puis",
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
            label: `boucle : ${s.until}`,
            style: { strokeDasharray: "6 4" },
            selected: selected === s.agent,
          },
        ]
      : []),
  ]);
}

export default function StepGraph({
  steps,
  agents,
  selectedLoop,
  onOpen,
  onLink,
  onSelectLoop,
}: {
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
          width: 240,
          height: 110,
          data: {
            step,
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
    <div className="mt-3 hidden h-72 sm:block">
      <ReactFlow
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
        fitView
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
