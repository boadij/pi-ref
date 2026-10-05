# pi-ref

Expand explicit local file references in the context files Pi already loads.

## Usage

Put whole-line references in a Pi context file such as `AGENTS.md`:

```md
# AGENTS.md

@./rules/coding.md
@../../shared/company.md
```

Pi chooses which context files exist; pi-ref expands references inside them. `@` references are pi-ref syntax, not part of the AGENTS.md standard. References resolve relative to the file that declares them.

## Paths

Relative (`@./rules.md`), parent (`@../shared.md`), absolute (`@/path/to/rules.md`), and home-relative (`@~/agent-rules/rules.md`) paths are supported. On Windows, use native paths such as `@.\rules.md`, `@C:\shared\rules.md`, `@\rooted\rules.md`, or `@\\server\share\rules.md`.

Paths may contain spaces. References must start at column zero and occupy the whole line. Indented, inline, and fenced references remain literal.

## Recursive references

Referenced files may include references of their own. Cycles are rejected; duplicate references are included each time. Imported files are reread for each prompt, so edits are used without reloading the extension.

```md
@./rules/backend.md
```

`rules/backend.md` may itself contain `@../shared/types.md`.

## External files

References resolving outside the directory containing a root context file require approval in Pi's interactive UI. Approval applies to that root file's imports for the current session; it resets when the session starts. Symlinks are checked by canonical path. Headless runs reject external references instead of silently permitting them; references within the context directory still work.

Installing pi-ref lets context instructions request reads of other local files. Review those instructions, and approve external reads only when intended.

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
