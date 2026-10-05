import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const REF_LINE = sep === "\\"
  ? /^@((?:[\\/]|~[\\/]|\.{1,2}[\\/]|[A-Za-z]:[\\/]|\\\\).+?)[ \t]*$/u
  : /^@((?:\/|~\/|\.{1,2}\/).+?)[ \t]*$/u;

function resolveRef(sourcePath: string, input: string): string {
  const homeRelative = input.startsWith("~/") ||
    (sep === "\\" && input.startsWith("~\\"));
  const expanded = homeRelative ? resolve(homedir(), input.slice(2)) : input;
  return isAbsolute(expanded)
    ? expanded
    : resolve(dirname(sourcePath), expanded);
}

function contains(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" ||
    (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

async function expand(
  sourcePath: string,
  content: string,
  stack: string[],
  getRoot: () => Promise<string>,
  allowTarget: (target: string) => Promise<void>,
): Promise<string> {
  let result = "";
  let fence: { marker: "`" | "~"; length: number } | undefined;

  for (const match of content.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/gu)) {
    const chunk = match[0];
    if (!chunk) break;
    const eol = chunk.match(/\r\n$|\r$|\n$/u)?.[0] ?? "";
    const line = eol ? chunk.slice(0, -eol.length) : chunk;

    if (fence) {
      result += chunk;
      const closing = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/u);
      if (
        closing && closing[1]![0] === fence.marker &&
        closing[1]!.length >= fence.length
      ) fence = undefined;
      continue;
    }

    const reference = line.match(REF_LINE);
    if (reference) {
      const input = reference[1]!;
      let canonical: string;
      let included: string;
      try {
        const target = resolveRef(sourcePath, input);
        canonical = await realpath(target);
        const info = await stat(canonical);
        if (!info.isFile()) throw new Error("not a regular file");
        await allowTarget(canonical);
        if (stack.includes(canonical) || canonical === await getRoot()) {
          throw new Error(`pi-ref: reference cycle at ${canonical}`);
        }
        const bytes = await readFile(canonical);
        if (bytes.includes(0)) throw new Error("binary file contains NUL");
        included = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.startsWith("pi-ref:")) throw error;
        throw new Error(
          `pi-ref: could not read ${JSON.stringify(input)} referenced from ${JSON.stringify(sourcePath)}: ${message}`,
          { cause: error },
        );
      }

      const expanded = await expand(
        resolveRef(sourcePath, input),
        included,
        [...stack, canonical],
        getRoot,
        allowTarget,
      );
      result += expanded;
      if (eol && !/[\r\n]$/u.test(expanded)) result += eol;
      continue;
    }

    result += chunk;
    const opening = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
    if (opening && (opening[1]![0] === "~" || !opening[2]!.includes("`"))) {
      fence = { marker: opening[1]![0] as "`" | "~", length: opening[1]!.length };
    }
  }

  return result;
}

export default function piRef(pi: ExtensionAPI): void {
  const approvedExternalRoots = new Set<string>();
  pi.on("session_start", () => approvedExternalRoots.clear());

  pi.on("before_agent_start", async (event, ctx) => {
    try {
      const cwd = event.systemPromptOptions.cwd;
      const expanded: string[] = [];

      for (const file of event.systemPromptOptions.contextFiles) {
        const sourcePath = isAbsolute(file.path)
          ? file.path
          : resolve(cwd, file.path);
        let boundary: Promise<string | undefined> | undefined;
        const getBoundary = () => boundary ??= realpath(dirname(sourcePath)).catch(() => undefined);
        let root: Promise<string> | undefined;
        const getRoot = () => root ??= realpath(sourcePath).catch(() => sourcePath);
        const allowTarget = async (target: string) => {
          const canonicalBoundary = await getBoundary();
          if (canonicalBoundary && contains(canonicalBoundary, target)) return;
          const rootKey = await getRoot();
          if (approvedExternalRoots.has(rootKey)) return;
          if (!ctx.hasUI) {
            throw new Error(
              `pi-ref: external reference requires interactive approval: ${target}`,
            );
          }
          const approved = await ctx.ui.confirm(
            "External context reference",
            `pi-ref wants to read files outside:\n\n${canonicalBoundary ?? dirname(sourcePath)}\n\nFirst external reference:\n${target}\n\nAllow external references from this context file for this session?`,
          );
          if (!approved) throw new Error(`pi-ref: external reference denied: ${target}`);
          approvedExternalRoots.add(rootKey);
        };

        expanded.push(
          await expand(sourcePath, file.content, [], getRoot, allowTarget),
        );
      }

      for (let i = 0; i < expanded.length; i++) {
        event.systemPromptOptions.contextFiles[i]!.content = expanded[i]!;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      event.systemPromptOptions.sections["pi-ref-error"] =
        `Reference expansion failed; referenced context was not loaded.\n${message}`;
      throw error;
    }
  });
}
