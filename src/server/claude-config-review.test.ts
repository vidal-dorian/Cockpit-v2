// biome-ignore-all lint/suspicious/noTemplateCurlyInString: ${MCP_URL} is a reference, the data under test
import { describe, expect, it } from "vitest";
import { mcpRefusal } from "./health.ts";

// Review of slice 12.1 (decision 065 C): what is present but not an object cannot be judged, so it is refused at its own path.

describe("mcpRefusal on values that are not objects", () => {
  it.each([
    [{ mcpServers: { a: { env: ["TOKEN=ghp_x"] } } }, "mcpServers.a.env"],
    [
      { mcpServers: { a: { headers: "Authorization: Bearer ghp_x" } } },
      "mcpServers.a.headers",
    ],
    [{ mcpServers: [{ url: "https://x.test" }] }, "mcpServers"],
    [{ mcpServers: { a: "ghp_x" } }, "mcpServers.a"],
    [
      { mcpServers: { a: { url: "https://bob:ghp_x@exa mple.com/mcp" } } },
      "mcpServers.a.url",
    ],
  ])("given %j, then secret_in_clear at %s", (json, at) => {
    expect(mcpRefusal(JSON.stringify(json))).toEqual({
      error: "secret_in_clear",
      at,
    });
  });

  it("given no mcpServers or servers without headers and env, then it is accepted", () => {
    expect(mcpRefusal("{}")).toBeNull();
    expect(mcpRefusal('{"mcpServers":{"a":{"url":"${MCP_URL}"}}}')).toBeNull();
    expect(mcpRefusal('{"mcpServers":{"a":{"command":"x"}}}')).toBeNull();
  });
});
