# PR Review

A fast, keyboard-first macOS app for reviewing and merging GitHub pull requests. It shows a PR's description, diff and checks, and lets you merge, with nothing else in the way.

![icon](branding/icon-1024.png)

## Features

- **Queue:** review requested, involved, and created by me, with counts.
- **Smart filters:** Ready (green, mergeable, no changes requested), Small (≤150 lines), Recent (48h). The Smart sort ranks by readiness.
- **Jev readiness (optional):** with `OPENROUTER_API_KEY` set, each PR is scored by [Jev](https://openrouter.ai) on review evidence, open concerns, change risk and scope, taken from its description, reviews and comments. Without a key, it falls back to the built-in rules.
- **Diffs:** [`@pierre/diffs`](https://www.npmjs.com/package/@pierre/diffs), virtualized and syntax-highlighted in web workers. Collapsible files and sticky headers.
- **Layouts:** stacked (description above diff) or side by side (`V`: description left, diff right). Panes resize and hide.
- **Bulk actions:** select with `E` / `⇧J` / `⇧R`, then approve or merge in sequence with per-PR error reporting.
- **Keyboard:** Linear-style single keys, VS Code chords, vim motions, and a `⌘K` command menu. `?` lists every shortcut.

## How it talks to GitHub

All GitHub access goes through your existing [GitHub CLI](https://cli.github.com) login (`gh auth login`). The app never sees or stores a token. The Rust backend exposes a small set of commands that run `gh` with validated arguments.

## Requirements

- macOS, [Bun](https://bun.sh), Rust (stable), and Xcode Command Line Tools.
- `gh` authenticated.
- Optional: `OPENROUTER_API_KEY` in your environment or login shell for Jev readiness scoring.

## Develop

```bash
bun install
bun run tauri dev
```

## Build

```bash
bun run app
open "src-tauri/target/release/bundle/macos/PR Review.app"
```

## Test

```bash
bun run test
bun run typecheck
```

## Keys (highlights)

| Area | Keys |
| --- | --- |
| Queue | `J`/`K` next/prev · `⌃D`/`⌃U` half page · `⌃F`/`⌃B` page · `gg`/`G` first/last |
| Diff | `⌘D`/`⌘U` half page · `Space`/`⇧Space` page · `⌥J`/`⌥K` or `⌃E`/`⌃Y` scroll · `N`/`P` file · `X` collapse |
| Filters | `⌥1` Ready · `⌥2` Small · `⌥3` Recent · `⌥0` All · `⇧S` sort |
| Select | `E` toggle · `⇧J`/`⇧K` extend · `⇧R` all ready · `⌘A` all · `Esc` clear |
| Act | `A` approve · `⌘↵` merge · `⇧A` bulk approve · `⌘⇧↵` bulk merge |
| Layout | `V` side by side · `⌘B` sidebar · `⌘⇧B` list · `⌘I` details · `⌘.` focus |
| General | `⌘K` commands · `?` shortcuts · `/` filter · `R` refresh |

## License

MIT
