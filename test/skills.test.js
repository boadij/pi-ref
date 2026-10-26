import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import piRef from "../extensions/index.ts";

function extension(path, name = "example") {
  const handlers = {};
  piRef({
    on: (event, handler) => (handlers[event] = handler),
    getCommands: () => [{ name: `skill:${name}`, source: "skill", sourceInfo: { path } }],
  });
  return handlers;
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "pi-ref-skill-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, "example");
  await mkdir(join(dir, "references"), { recursive: true });
  const path = join(dir, "SKILL.md");
  await writeFile(path, "---\nname: example\ndescription: Example\n---\n\n@./references/rules.md\n");
  await writeFile(join(dir, "references/rules.md"), "rules\n@./workflow.md\n");
  await writeFile(join(dir, "references/workflow.md"), "workflow\n");
  return { root, dir, path };
}

const ctx = (cwd, hasUI = false, confirm) => ({ cwd, hasUI, ui: { confirm } });
const nativeBlock = (path, body, args = "") => `<skill name="example" location="${path}">\nReferences are relative to ${dirname(path)}.\n\n${body}\n</skill>${args ? `\n\n${args}` : ""}`;
const userEvent = (text) => ({ message: { role: "user", content: [{ type: "text", text }], timestamp: 1 } });
const readEvent = (path, text, extra = {}) => ({
  toolName: "read", input: { path }, isError: false,
  content: [{ type: "text", text }], structuredContent: text, ...extra,
});

test("native /skill invocation expands only the skill body and preserves args", async (t) => {
  const { root, path } = await fixture(t);
  const handlers = extension(path);
  const source = nativeBlock(path, "@./references/rules.md\n```md\n@./literal.md\n```", "Please inspect @./args.md");
  const result = await handlers.message_end(userEvent(source), ctx(root));
  assert.equal(result.message.role, "user");
  assert.equal(result.message.content[0].text, nativeBlock(path, "rules\nworkflow\n```md\n@./literal.md\n```", "Please inspect @./args.md"));
  assert.equal((await handlers.message_end(userEvent("/skill:example"), ctx(root))), undefined);
  assert.equal((await handlers.message_end(userEvent(nativeBlock(join(root, "other", "SKILL.md"), "@./references/rules.md")), ctx(root))), undefined);
});

test("model read expands discovered skill content, not unrelated or partial reads", async (t) => {
  const { root, path } = await fixture(t);
  const handlers = extension(path);
  const original = "---\nname: example\n---\n\n@./references/rules.md\n";
  const result = await handlers.tool_result(readEvent(path, original), ctx(root));
  const expected = "---\nname: example\n---\n\nrules\nworkflow\n";
  assert.equal(result.content[0].text, expected);
  assert.equal(result.structuredContent, expected);
  assert.equal((await handlers.tool_result(readEvent(path, original, { input: { path, offset: 1 } }), ctx(root))), undefined);
  assert.equal((await handlers.tool_result(readEvent(path, original, { details: { truncation: { truncated: true } } }), ctx(root))), undefined);
  assert.equal((await handlers.tool_result(readEvent(join(root, "unrelated.md"), original), ctx(root))), undefined);
  assert.equal((await handlers.tool_result(readEvent(path, original, { isError: true }), ctx(root))), undefined);
});

test("reference failures are explicit, no partial skill content leaks", async (t) => {
  const { root, path } = await fixture(t);
  const handlers = extension(path);
  const body = "@./references/rules.md\n@./missing.md";
  const direct = await handlers.message_end(userEvent(nativeBlock(path, body, "keep args")), ctx(root));
  assert.match(direct.message.content[0].text, /skill reference expansion failed/);
  assert.doesNotMatch(direct.message.content[0].text, /rules\nworkflow/);
  const read = await handlers.tool_result(readEvent(path, body), ctx(root));
  assert.equal(read.isError, true);
  assert.match(read.content[0].text, /could not read/);
  assert.equal(read.structuredContent, read.content[0].text);
});

test("skill imports retain canonical external approval and session boundaries", async (t) => {
  const { root, dir, path } = await fixture(t);
  const outside = join(root, "external.md");
  await writeFile(outside, "private");
  await symlink(outside, join(dir, "references/escape.md"));
  const handlers = extension(path);
  const body = "@./references/escape.md";
  const denied = await handlers.tool_result(readEvent(path, body), ctx(root));
  assert.equal(denied.isError, true);
  assert.match(denied.content[0].text, /external reference requires interactive approval/);
  let approvals = 0;
  const allowed = ctx(root, true, async () => (approvals++, true));
  const first = await handlers.tool_result(readEvent(path, body), allowed);
  assert.equal(first.content[0].text, "private");
  await handlers.tool_result(readEvent(path, body), allowed);
  assert.equal(approvals, 1);
  handlers.session_start();
  await handlers.tool_result(readEvent(path, body), allowed);
  assert.equal(approvals, 2);
});
