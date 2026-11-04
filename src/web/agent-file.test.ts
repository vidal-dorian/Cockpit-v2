import { describe, expect, it } from "vitest";
import { parseAgent, writeAgent } from "./agent-file.ts";

// Slice E2 (decision 030 C): the pure reader and writer of an agent file, `src/web/agent-file.ts`.
//
// Pinned where the decision leaves it open:
// - `parseAgent(text)` is `null` when the header cannot be read, else `{ name, description, tools, model, prompt }`, all strings:
//   a key that is absent reads "" (no tools line = ""; no model line = ""), a value in double quotes is read as the JSON string it is (unquoted),
//   `prompt` is everything after the closing `---` line (after its line break).
// - `writeAgent(text, fields)` returns the text with the fields `{ description, tools, model, prompt }` written (`fields` as `parseAgent` returns them, changed or not):
//   only the line of a key whose value differs from the one read is rewritten, in place; a changed `description` or `tools` is a JSON double-quoted string, a changed `model` is written bare;
//   an empty `model` or `tools` removes the line; a non-empty value of an absent key is appended as the last line of the header; the prompt is replaced only when it differs.
//   Everything else (other keys, their order, comments, blank lines, the prompt) is byte for byte.
// - A header is unreadable when the first line is not `---`, or when a line before the closing `---` is neither `key: value` at column 0, blank, nor a `#` comment.

const TEXT =
  "---\nname: developer\n# kept comment\ndescription: Builds the thing\ndisallowedTools: Write\n\ntools: Read, Grep\nmodel: sonnet\npermissionMode: plan\n---\nYou are the developer.\n\nTwo paragraphs  \n";

describe("decision 030 C: parseAgent", () => {
  it("given a readable file, when it is parsed, then the name, description, tools, model and prompt are read", () => {
    expect(parseAgent(TEXT)).toEqual({
      name: "developer",
      description: "Builds the thing",
      tools: "Read, Grep",
      model: "sonnet",
      prompt: "You are the developer.\n\nTwo paragraphs  \n",
    });
  });

  it("given no tools and no model line, when it is parsed, then they read as empty strings", () => {
    const parsed = parseAgent("---\nname: a\ndescription: d\n---\nP\n");
    expect(parsed).toMatchObject({ tools: "", model: "", prompt: "P\n" });
  });

  it("given values in double quotes, when it is parsed, then they are shown unquoted, with their escapes read", () => {
    const parsed = parseAgent(
      '---\nname: a\ndescription: "Reviews: \\"code\\""\ntools: "Read, Grep"\nmodel: "opus"\n---\nP\n',
    );
    expect(parsed).toMatchObject({
      description: 'Reviews: "code"',
      tools: "Read, Grep",
      model: "opus",
    });
  });

  it.each([
    ["no --- on the first line", "name: a\ndescription: d\n---\nP\n"],
    ["an empty file", ""],
    [
      "a YAML list under tools",
      "---\nname: a\ndescription: d\ntools:\n  - Read\n  - Grep\n---\nP\n",
    ],
    [
      "a list item at column 0",
      "---\nname: a\ndescription: d\n- Read\n---\nP\n",
    ],
    ["a line that is not key: value", "---\nname: a\njust words\n---\nP\n"],
  ])(
    "given %s, when it is parsed, then the header is unreadable (null)",
    (_n, text) => {
      expect(parseAgent(text)).toBeNull();
    },
  );

  it("given blank lines and comments in the header, when it is parsed, then it is readable", () => {
    expect(parseAgent(TEXT)).not.toBeNull();
  });
});

describe("decision 030 C: writeAgent", () => {
  const read = (text: string) => {
    const parsed = parseAgent(text);
    if (!parsed) throw new Error("must be readable");
    const { name: _name, ...fields } = parsed;
    return fields;
  };

  it("given nothing changed, when it is written, then the text is returned byte for byte", () => {
    expect(writeAgent(TEXT, read(TEXT))).toBe(TEXT);
  });

  it("given only the model changed, when it is written, then only the model line differs and the other keys, their order, the comment, the blank line and the prompt stay", () => {
    expect(writeAgent(TEXT, { ...read(TEXT), model: "opus" })).toBe(
      TEXT.replace("model: sonnet", "model: opus"),
    );
  });

  it("given the description changed, when it is written, then it is a JSON double-quoted string on the same line", () => {
    expect(
      writeAgent(TEXT, { ...read(TEXT), description: 'Does: "more"' }),
    ).toBe(
      TEXT.replace(
        "description: Builds the thing",
        `description: ${JSON.stringify('Does: "more"')}`,
      ),
    );
  });

  it("given the tools changed, when it is written, then they are a JSON double-quoted string", () => {
    expect(writeAgent(TEXT, { ...read(TEXT), tools: "Read, Edit" })).toBe(
      TEXT.replace("tools: Read, Grep", 'tools: "Read, Edit"'),
    );
  });

  it("given a value read in double quotes and left alone, when another key changes, then its line keeps its quotes", () => {
    const quoted =
      '---\nname: a\ndescription: "Say \\"hi\\""\nmodel: haiku\n---\nP\n';
    expect(writeAgent(quoted, { ...read(quoted), model: "opus" })).toBe(
      quoted.replace("model: haiku", "model: opus"),
    );
  });

  it("given the model emptied (the session's), when it is written, then the model line is removed", () => {
    expect(writeAgent(TEXT, { ...read(TEXT), model: "" })).toBe(
      TEXT.replace("model: sonnet\n", ""),
    );
  });

  it("given the tools emptied, when it is written, then the tools line is removed", () => {
    expect(writeAgent(TEXT, { ...read(TEXT), tools: "" })).toBe(
      TEXT.replace("tools: Read, Grep\n", ""),
    );
  });

  it("given a model on an agent that had none, when it is written, then a model line is added as the last line of the header", () => {
    const bare = "---\nname: a\ndescription: d\n---\nP\n";
    expect(writeAgent(bare, { ...read(bare), model: "fable" })).toBe(
      "---\nname: a\ndescription: d\nmodel: fable\n---\nP\n",
    );
  });

  it("given the prompt changed, when it is written, then the header is intact and the prompt replaced", () => {
    expect(writeAgent(TEXT, { ...read(TEXT), prompt: "New prompt\n" })).toBe(
      `${TEXT.slice(0, TEXT.indexOf("You are"))}New prompt\n`,
    );
  });

  it("given a model that is not in the list of Claude Code, when it is kept, then the file is untouched", () => {
    const text =
      "---\nname: a\ndescription: d\nmodel: claude-opus-5-5\n---\nP\n";
    expect(writeAgent(text, read(text))).toBe(text);
  });
});
