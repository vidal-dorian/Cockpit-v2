import { parentPort, workerData } from "node:worker_threads";
import { getDocumentProxy } from "unpdf";

// Runs in a worker thread (pdf-text.ts): pdf.js can use unbounded memory and time on a hostile file.
// Page by page, stopping once `limit` characters are collected.
const { data, limit } = workerData as { data: Uint8Array; limit: number };
try {
  const doc = await getDocumentProxy(data);
  let text = "";
  for (let n = 1; n <= doc.numPages && text.length <= limit; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    for (const item of content.items)
      if ("str" in item) text += item.str + (item.hasEOL ? "\n" : "");
    text += "\n";
  }
  parentPort?.postMessage({ text });
} catch {
  parentPort?.postMessage({ failed: true });
}
