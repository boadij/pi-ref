import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import piRef from "../extensions/index.ts";

function extension() {
  const handlers = {};
  piRef({ on: (name, handler) => (handlers[name] = handler) });
  return handlers;
}

function event(cwd, contextFiles) {
  return {
    systemPromptOptions: { cwd, contextFiles, sections: {} },
  };
}

async function temp(t) {
  const dir = await mkdtemp(join(tmpdir(), "pi-ref-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("composes references recursively without changing literal text", async (t) => {
  const root = await temp(t);
  await mkdir(join(root, "rules"));
  await mkdir(join(root, "Rules With Spaces"));
  await mkdir(join(root, "nested"));
  await writeFile(join(root, "rules/one.md"), "one start\n@../nested/three.md\none end");
  await writeFile(join(root, "nested/three.md"), "three\r\n");
  await writeFile(join(root, "Rules With Spaces/two.md"), "two");
  await writeFile(join(root, "absolute.txt"), "absolute");
  await writeFile(join(root, "ignored.md"), "should stay ignored");

  const source = [
    "# Project\r\n",
    "@./rules/one.md\r\n",
    "@./Rules With Spaces/two.md\r\n",
    `@${join(root, "absolute.txt")}\r\n`,
    "@./rules/one.md\r\n",
    "```text\r\n",
    "@./ignored.md\r\n",
    "```\r\n",
    "Read @./ignored.md\r\n",
    "- @./ignored.md\r\n",
  ].join("");
  const path = "AGENTS.override.md";
  const input = event(root, [{ path, content: source }]);
  const result = await extension().before_agent_start(input, { hasUI: true });

  assert.equal(result, undefined);
  assert.equal(input.systemPromptOptions.contextFiles[0].path, path);
  assert.equal(input.systemPromptOptions.contextFiles[0].content, [
    "# Project\r\n",
    "one start\nthree\r\none end\r\n",
    "two\r\n",
    "absolute\r\n",
    "one start\nthree\r\none end\r\n",
    "```text\r\n",
    "@./ignored.md\r\n",
    "```\r\n",
    "Read @./ignored.md\r\n",
    "- @./ignored.md\r\n",
  ].join(""));
});

test("detects cycles and leaves every context file unchanged", async (t) => {
  const root = await temp(t);
  await writeFile(join(root, "a.md"), "@./b.md\n");
  await writeFile(join(root, "b.md"), "@./a.md\n");
  await writeFile(join(root, "safe.md"), "expanded");
  const files = [
    { path: "safe-root.md", content: "@./safe.md" },
    { path: "a.md", content: "@./b.md\n" },
  ];
  const input = event(root, files);

  await assert.rejects(
    extension().before_agent_start(input, { hasUI: true }),
    /reference cycle/,
  );
  assert.deepEqual(files.map((file) => file.content), ["@./safe.md", "@./b.md\n"]);
  assert.match(input.systemPromptOptions.sections["pi-ref-error"], /referenced context was not loaded/);
});

test("approves external files once per context root and session", async (t) => {
  const base = await temp(t);
  const root = join(base, "root");
  const outside = join(base, "outside");
  await mkdir(root);
  await mkdir(outside);
  await writeFile(join(root, "local.md"), "local");
  await writeFile(join(outside, "external.md"), "external\n@./nested.md");
  await writeFile(join(outside, "nested.md"), "nested");
  const external = "../outside/external.md";
  const handlers = extension();
  let prompts = 0;
  const ctx = { hasUI: true, ui: { confirm: async () => (prompts++, true) } };
  const input = event(root, [{
    path: "AGENTS.md",
    content: `@./local.md\n@${external}\n@${external}\n`,
  }]);

  await handlers.before_agent_start(input, ctx);
  assert.equal(prompts, 1);
  assert.equal(input.systemPromptOptions.contextFiles[0].content, "local\nexternal\nnested\nexternal\nnested\n");

  handlers.session_start();
  const next = event(root, [{ path: "AGENTS.md", content: `@${external}` }]);
  await handlers.before_agent_start(next, ctx);
  assert.equal(prompts, 2);

  let deniedPrompts = 0;
  const denied = event(root, [{ path: "AGENTS.md", content: `@${external}` }]);
  await assert.rejects(
    extension().before_agent_start(denied, {
      hasUI: true,
      ui: { confirm: async () => (deniedPrompts++, false) },
    }),
    /external reference denied/,
  );
  assert.equal(deniedPrompts, 1);
  assert.equal(denied.systemPromptOptions.contextFiles[0].content, `@${external}`);
});

test("permits local headless references but rejects external ones", async (t) => {
  const base = await temp(t);
  const root = join(base, "root");
  await mkdir(root);
  await writeFile(join(root, "local.md"), "local");
  const handlers = extension();
  const local = event(root, [{ path: "AGENTS.md", content: "@./local.md" }]);
  await handlers.before_agent_start(local, { hasUI: false });
  assert.equal(local.systemPromptOptions.contextFiles[0].content, "local");

  const outside = join(base, "external.md");
  await writeFile(outside, "external");
  await symlink(outside, join(root, "escape.md"));
  const external = event(root, [{ path: "AGENTS.md", content: "@./escape.md" }]);
  await assert.rejects(
    handlers.before_agent_start(external, { hasUI: false }),
    /external reference requires interactive approval/,
  );
});

test("rejects NUL-containing files", async (t) => {
  const root = await temp(t);
  await writeFile(join(root, "binary.dat"), Buffer.from([0x61, 0, 0x62]));
  const input = event(root, [{ path: "AGENTS.md", content: "@./binary.dat" }]);
  await assert.rejects(
    extension().before_agent_start(input, { hasUI: true }),
    /binary file contains NUL/,
  );
  assert.equal(input.systemPromptOptions.contextFiles[0].content, "@./binary.dat");
});

test("leaves virtual context without active references untouched", async (t) => {
  const root = await temp(t);
  const path = join(root, "missing", "virtual.md");
  const content = "```text\n@./not-a-reference.md\n```\n";
  const input = event(root, [{ path, content }]);

  await extension().before_agent_start(input, { hasUI: false });

  assert.equal(input.systemPromptOptions.contextFiles[0].content, content);
  assert.equal(input.systemPromptOptions.sections["pi-ref-error"], undefined);
});
