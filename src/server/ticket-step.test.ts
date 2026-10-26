import { describe, expect, it } from "vitest";
import { ticketStep } from "./tickets.ts";

// Slice 4.3 (decisions 002 "Étape d'un ticket" and 017 I): the step is computed by one pure function from the
// ticket and the statuses of its stories, the first rule that applies wins.

const ticket = (abandonedAt: Date | null = null) => ({
  id: 1,
  projectId: 1,
  title: "Un ticket",
  descriptionMd: "",
  abandonedAt,
  createdAt: new Date(),
  updatedAt: new Date(),
});

type Status =
  | "to_validate"
  | "to_rewrite"
  | "ready"
  | "in_progress"
  | "in_review"
  | "done"
  | "abandoned";
const step = (statuses: Status[], abandonedAt: Date | null = null) =>
  ticketStep(ticket(abandonedAt), statuses);

describe("ticketStep, the rules of decision 002 in their order", () => {
  it("rule 1: given abandoned_at is set, when the step is computed, then abandoned, whatever the stories say", () => {
    expect(step([], new Date())).toBe("abandoned");
    expect(step(["in_progress", "to_validate"], new Date())).toBe("abandoned");
  });

  it("rule 1: given every story is abandoned (and there is at least one), when the step is computed, then abandoned", () => {
    expect(step(["abandoned"])).toBe("abandoned");
    expect(step(["abandoned", "abandoned"])).toBe("abandoned");
  });

  it("rule 2: given no story and abandoned_at empty, when the step is computed, then new", () => {
    expect(step([])).toBe("new");
  });

  it.each<Status>(["in_progress", "in_review"])(
    "rule 3: given a %s story among others, when the step is computed, then in_progress, before to_validate",
    (status) => {
      expect(step([status])).toBe("in_progress");
      expect(step(["to_validate", status, "ready"])).toBe("in_progress");
      expect(step(["to_rewrite", status])).toBe("in_progress");
    },
  );

  it.each<Status>(["to_validate", "to_rewrite"])(
    "rule 4: given a %s story and no story under way, when the step is computed, then to_validate",
    (status) => {
      expect(step([status])).toBe("to_validate");
      expect(step(["ready", status, "done"])).toBe("to_validate");
      expect(step([status, "abandoned"])).toBe("to_validate");
    },
  );

  it("rule 5: given stories all done or abandoned with at least one done, when the step is computed, then done", () => {
    expect(step(["done"])).toBe("done");
    expect(step(["done", "abandoned"])).toBe("done");
    expect(step(["abandoned", "done", "done"])).toBe("done");
  });

  it("rule 6: given one done story and one ready story, when the step is computed, then in_progress, not validated (the work has begun)", () => {
    expect(step(["done", "ready"])).toBe("in_progress");
    expect(step(["ready", "done", "abandoned"])).toBe("in_progress");
  });

  it("rule 7: given every non-abandoned story is ready, when the step is computed, then validated", () => {
    expect(step(["ready"])).toBe("validated");
    expect(step(["ready", "ready"])).toBe("validated");
    expect(step(["ready", "abandoned"])).toBe("validated");
  });
});
