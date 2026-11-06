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
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useRef } from "react";
import { parseAgent } from "./agent-file.ts";
import { DRAGGED_AGENT, type TeamStep } from "./team-file.ts";
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
  onMove: (direction: "up" | "down") => void;
  onRemove: () => void;
};
type CardNode = Node<CardData, "card">;

function StepCard({ data }: NodeProps<CardNode>) {
  const { step, model, absent, onOpen, onMove, onRemove } = data;
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
        // Decision 042 A: the keys are handled here, and stop here so React Flow never sees them.
        onKeyDown={(e) => {
          const direction =
            e.altKey && e.key === "ArrowLeft"
              ? "up"
              : e.altKey && e.key === "ArrowRight"
                ? "down"
                : null;
          if (direction) onMove(direction);
          else if (e.key === "Enter") onOpen();
          else if (e.key === "Delete") onRemove();
          else return;
          e.preventDefault(); // Enter would also click the button
          e.stopPropagation();
        }}
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

/** Refits the view when steps are added, removed or reordered (not on drags or other renders). */
function RefitOnSteps({ key_ }: { key_: string }) {
  const { fitView } = useReactFlow();
  // biome-ignore lint/correctness/useExhaustiveDependencies: key_ is the trigger
  useEffect(() => {
    // After the frame in which the nodes are set and drawn.
    const frame = requestAnimationFrame(() => fitView());
    return () => cancelAnimationFrame(frame);
  }, [key_, fitView]);
  return null;
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
  id,
  steps,
  agents,
  selectedLoop,
  onOpen,
  onLink,
  onSelectLoop,
  onMove,
  onRemove,
  onDropAgent,
}: {
  /** Tells apart the SVG ids of two graphs on one page. */
  id: string;
  steps: TeamStep[];
  agents: Agent[];
  selectedLoop: string | null;
  onOpen: (agent: string) => void;
  onLink: (from: string, to: string) => void;
  onSelectLoop: (agent: string | null) => void;
  onMove: (agent: string, direction: "up" | "down") => void;
  onRemove: (agent: string) => void;
  /** An agent dragged from the right column and dropped on the graph. */
  onDropAgent: (agent: string) => void;
}) {
  // The handlers are read through a ref: a new function each render must not put moved cards back.
  const handlers = useRef({ onOpen, onMove, onRemove });
  handlers.current = { onOpen, onMove, onRemove };
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
            onOpen: () => handlers.current.onOpen(step.agent),
            onMove: (direction) =>
              handlers.current.onMove(step.agent, direction),
            onRemove: () => handlers.current.onRemove(step.agent),
          },
        };
      }),
    [steps, agents],
  );
  // A card moved by hand is only for reading: any change of the draft puts them back in place.
  const [nodes, setNodes, onNodesChange] = useNodesState(laidOut);
  useEffect(() => setNodes(laidOut), [laidOut, setNodes]);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a mouse-only drop target; « Ajouter à l'équipe » is the keyboard way (decision 042 C)
    <div
      className="mt-3 h-72"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DRAGGED_AGENT)) e.preventDefault();
      }}
      onDrop={(e) => {
        const agent = e.dataTransfer.getData(DRAGGED_AGENT);
        if (agent) onDropAgent(agent);
      }}
    >
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
        // Delete and Backspace are the cards' own (a card removes its step); React Flow must not delete a node or a loop behind our back, nor move a selected node with the arrows.
        deleteKeyCode={null}
        disableKeyboardA11y
        fitView
        minZoom={0.2}
      >
        <RefitOnSteps key_={steps.map((s) => s.agent).join("|")} />
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
