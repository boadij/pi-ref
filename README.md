# pi-ref

Expand explicit local file references in the context and skill files Pi already loads.

## Usage

Put whole-line references in a Pi context file such as `AGENTS.md`:

```md
# AGENTS.md

@./rules/coding.md
@../../shared/company.md
```

Pi chooses which context files and skills exist; pi-ref expands references inside them. `@` references are pi-ref syntax, not part of the AGENTS.md or Agent Skills standards. References resolve relative to the file that declares them.

## Skills

You can use the same syntax in a discovered skill's `SKILL.md`:

```md
---
name: example
description: Example instructions
---

# Instructions

@./references/rules.md
```

References expand when Pi loads that skill, either through `/skill:name` or a complete `read` of its discovered skill file. Partial or truncated `read` results are unchanged; shell and custom readers are not intercepted. Prefer `Read references/rules.md` when the model should load a supporting file later instead of including it immediately.

## Paths

Relative (`@./rules.md`), parent (`@../shared.md`), absolute (`@/path/to/rules.md`), and home-relative (`@~/agent-rules/rules.md`) paths are supported. On Windows, use native paths such as `@.\rules.md`, `@C:\shared\rules.md`, `@\rooted\rules.md`, or `@\\server\share\rules.md`.

Paths may contain spaces. References must start at column zero and occupy the whole line. Indented, inline, and fenced references remain literal.

## Recursive references

Referenced files may include references of their own. Cycles are rejected; duplicate references are included each time. Imported files are reread when the containing context or skill is loaded, so edits are used without reloading the extension.

```md
@./rules/backend.md
```

`rules/backend.md` may itself contain `@../shared/types.md`. Nested references resolve relative to the imported file that contains them, not the root context or skill file.

## External files

References resolving outside the directory containing a root context or skill file require approval in Pi's interactive UI. Approval applies to that root file's imports for the current session; it resets when the session starts. Symlinks are checked by canonical path. Headless runs reject external references instead of silently permitting them; references within the context directory still work.

Installing pi-ref lets instructions request reads of other local files. Review those instructions, and approve external reads only when intended.

## Install

```sh
pi install npm:pi-ref
```

Or install directly from GitHub:

```sh
pi install git:github.com/boadij/pi-ref
```

## Development

```sh
npm test
npm pack --dry-run
```

## License

Apache-2.0
