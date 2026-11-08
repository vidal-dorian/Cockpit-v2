import { getDocumentProxy } from "unpdf";

// Runs in a child process (pdf-text.ts): pdf.js can use unbounded memory and time on a hostile file.
// Page by page, stopping once `limit` characters are collected.
// The server gone (killed outside Docker, where nothing kills its children): stop, never run on without a budget.
process.once("disconnect", () => process.exit(1));
process.once("message", async (message) => {
  const { data, limit } = message as { data: Uint8Array; limit: number };
  try {
    // verbosity 0: no pdf.js warning in the logs.
    const doc = await getDocumentProxy(data, { verbosity: 0 });
    let text = "";
    for (let n = 1; n <= doc.numPages && text.length <= limit; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      for (const item of content.items)
        if ("str" in item) text += item.str + (item.hasEOL ? "\n" : "");
      text += "\n";
    }
    process.send?.({ text }, () => process.exit(0));
  } catch {
    process.send?.({ failed: true }, () => process.exit(0));
  }
});
