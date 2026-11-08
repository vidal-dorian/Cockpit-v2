/** The four starter teams (decision 063 B): the id the server knows, the name and the sentence shown. */
export const STARTER_LEVELS = [
  { id: "eco", name: "Éco", sentence: "Le moins cher : pas de relecture." },
  { id: "standard", name: "Standard", sentence: "L'équipe de base, relue." },
  {
    id: "premium",
    name: "Premium",
    sentence: "L'équipe de base, et la doc tenue à jour.",
  },
  {
    id: "max",
    name: "Max",
    sentence: "Tout au plus puissant, avec une relecture de sécurité.",
  },
] as const;

export type StarterLevel = (typeof STARTER_LEVELS)[number]["id"];
