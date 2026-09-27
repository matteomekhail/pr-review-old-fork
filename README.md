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
- **Keyboard:** Linear-style single keys, VS Code chords, vim motions, and a `/` command menu. `?` lists every shortcut.

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

Vim motions work the same in every pane; the modifier picks the pane.

| Motion | List `⌃` | Middle pane `⌥` | Right pane `⌘` |
| --- | --- | --- | --- |
| Half page down / up | `⌃D` / `⌃U` | `⌥D` / `⌥U` | `⌘D` / `⌘U` |
| Page down / up | `⌃F` / `⌃B` | `⌥F` / `⌥B` | — (use `⌘D` / `⌘U`) |
| Line down / up | `⌃E` / `⌃Y` (or `⌃N` / `⌃P`) | `⌥E` / `⌥Y` (or `⌥J` / `⌥K`) | `⌘E` / `⌘Y` |
| Top / bottom | `⌃G` / `⌃⇧G` | `⌥G` / `⌥⇧G` | `⌘G` / `⌘⇧G` |

`⌘J` / `⌘K` always scroll the diff, whichever pane it's in. The middle pane is the diff in stacked mode and the description in side-by-side mode (`V`). The right pane is the file list in stacked mode and the diff in side-by-side mode.

| Area | Keys |
| --- | --- |
| Queue | `J`/`K` next/prev · `gg`/`G` first/last · `Space`/`⇧Space` page the middle pane |
| Files | `N`/`P` or `]c`/`[c` next/prev file · `X` collapse · `⇧C` collapse all · `S` split/unified |
| Filters | `⌥1` Ready · `⌥2` Small · `⌥3` Recent · `⌥0` All · `⇧S` sort |
| Select | `E` toggle · `⇧J`/`⇧K` extend · `⇧R` all ready · `⌘A` all · `Esc` clear |
| Act | `A` approve · `⌘↵` merge · `⇧A` bulk approve · `⌘⇧↵` bulk merge |
| Layout | `V` side by side · `⌘\` sidebar · `⌘⇧\` list · `⌘I` details · `⌘.` focus |
| General | `/` commands · `?` shortcuts · `F` filter · `R` refresh |

## License

MIT
