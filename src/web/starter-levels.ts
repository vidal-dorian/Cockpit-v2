/** The four starter teams (decision 063 B): the id the server knows, the name and the sentence shown, the agents with their model (a server test checks them against `catalog/teams/<id>.md`) and the consumption (decision 072 A). */
export const STARTER_LEVELS = [
  {
    id: "eco" as const,
    name: "Éco",
    sentence: "Le moins cher : pas de relecture.",
    agents: [
      { name: "test-writer", model: "haiku" },
      { name: "developer", model: "sonnet" },
    ],
    use: "faible",
  },
  {
    id: "standard" as const,
    name: "Standard",
    sentence: "L'équipe de base, relue.",
    agents: [
      { name: "test-writer", model: "sonnet" },
      { name: "developer", model: "sonnet" },
      { name: "reviewer", model: "opus" },
    ],
    use: "moyenne",
  },
  {
    id: "premium" as const,
    name: "Premium",
    sentence: "L'équipe de base, et la doc tenue à jour.",
    agents: [
      { name: "test-writer", model: "sonnet" },
      { name: "developer", model: "sonnet" },
      { name: "reviewer", model: "opus" },
      { name: "doc-writer", model: "sonnet" },
      { name: "doc-reviewer", model: "sonnet" },
    ],
    use: "élevée",
  },
  {
    id: "max" as const,
    name: "Max",
    sentence: "Tout au plus puissant, avec une relecture de sécurité.",
    agents: [
      { name: "test-writer", model: "opus" },
      { name: "developer", model: "opus" },
      { name: "reviewer", model: "opus" },
      { name: "security-reviewer", model: "opus" },
      { name: "doc-writer", model: "opus" },
      { name: "doc-reviewer", model: "opus" },
    ],
    use: "très élevée",
  },
];

export type StarterLevel = (typeof STARTER_LEVELS)[number]["id"];
