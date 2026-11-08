/** The short title of decision 005 D, so the window and the queue (057 C) propose the same branch: lower case, no accents, dashes, 40 characters at most. */
export const proposedBranch = (story: { id: number; iWant: string }) => {
  const slug = story.iWant
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `us/${story.id}${slug && `-${slug}`}`;
};
