# PR Review

A fast, keyboard-first macOS app for reviewing and merging GitHub pull requests. It shows a PR's description, diff and checks, and lets you merge, with nothing else in the way.

![icon](branding/icon-1024.png)

## Features

- **Queue:** review requested, involved, and created by me, with counts.
- **Smart filters:** Ready (green, mergeable, no changes requested), Small (≤150 lines), Recent (48h). The Smart sort ranks by readiness.
- **Jev readiness (optional):** with `OPENROUTER_API_KEY` set, each PR is scored by [Jev](https://openrouter.ai) on review evidence, open concerns, change risk and scope, taken from its description, reviews and comments. Without a key, it falls back to the built-in rules.
- **Diffs:** [`@pierre/diffs`](https://www.npmjs.com/package/@pierre/diffs), virtualized and syntax-highlighted in web workers. Collapsible files and sticky headers.
- **Devin:** `D` opens the Devin session linked in the PR body or comments; the header button is disabled when there is none.
- **Comments:** long comments are capped with a Show more toggle, so scrolling never gets stuck inside one. `C` opens a comment box on the current PR (drafts are kept per PR); `⌘↵` posts it through `gh`.
- **Layout:** description on the left, diff on the right. Panes resize and hide, and `1`–`3` apply preset proportions.
- **Smart search (Jev):** typing a topic like `frontend` or `billing` also finds PRs that don't contain the word, tagged **Jev** in the list. Literal matches still appear instantly.
- **Smart groups (Jev):** `T` groups related PRs into efforts, such as a run of lib extractions or UI refactors. Groups are ordered by average readiness and each can be collapsed or selected as a whole for bulk merge.
- **Conversation:** PR comments and reviews appear under the description, humans and bots alike (Devin, Perry, GitHub Actions…), with review verdicts highlighted. `⇧B` hides bot comments.
- **Merge queue:** PRs already in a queue show a yellow marker with their position, and queued merges skip the confirmation.
- **Themes:** press `T` for a live-preview picker with 20 IDE themes (Catppuccin Mocha/Macchiato/Frappé/Latte, Tokyo Night, Dracula, One Dark Pro, GitHub Dark/Light, Nord, Gruvbox, Rosé Pine, Solarized, Monokai, Night Owl, Kanagawa, Vesper) or follow macOS. Syntax highlighting in diffs uses the matching editor theme.
- **Bulk actions:** select with `E` / `⇧J` / `⇧R`, then approve or merge in sequence with per-PR error reporting.
- **Keyboard:** Linear-style single keys, VS Code chords, vim motions, and a `⌘K` command menu. `?` lists every shortcut.

## How it talks to GitHub

All GitHub access goes through your existing [GitHub CLI](https://cli.github.com) login (`gh auth login`). The app never sees or stores a token. The Rust backend exposes a small set of commands that run `gh` with validated arguments.

## Install

One step: builds from source and installs to `/Applications` (re-run to update):

```bash
gh repo clone sunwrobert/pr-review /tmp/pr-review-src -- -q && bash /tmp/pr-review-src/scripts/install.sh
```

From a checkout, `bun run install:app` does the same.

## Requirements

- macOS, [Bun](https://bun.sh), Rust (stable), and Xcode Command Line Tools.
- `gh` authenticated.
- Optional: `OPENROUTER_API_KEY` in your environment or login shell for AI readiness scoring, grouping and the Tested filter.

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

`⌘J` scrolls the diff down; `⌘K` opens the command menu and `/` focuses the filter. The middle pane is the description and the right pane is the diff.

| Area | Keys |
| --- | --- |
| Queue | `J`/`K` next/prev · `gg`/`G` first/last · `Space`/`⇧Space` page the middle pane |
| Files | `N`/`P` or `]c`/`[c` next/prev file · `X` collapse · `⇧C` collapse all · `S` split/unified |
| Filters | `⇧T` group related work · `⌥1` Ready · `⌥2` Small · `⌥3` Recent · `⌥4` Attention · `⌥5` Tested · `⌥0` All · `⇧S` sort · `⇧X` fix with agent |
| Select | `⇧V` visual mode (then `J`/`K`) · `E` toggle · `⇧J`/`⇧K` extend · `⇧R` all ready · `⌘A` all · `Esc` clear |
| Act | `⇧X` copy an agent prompt to fix every PR with conflicts or failing checks (or just the selected ones) · `O` open on GitHub (in Chrome) · `A` approve · `⌘↵` merge (all selected when several are checked) · `⇧A` bulk approve · `⌘↵` bulk merge |
| Layout | `T` theme picker · `⌘B` PR list · `1` review · `2` diff focus · `3` read description · `⌘.` focus |
| Lightbox | `I` open first media · `H`/`L` or `J`/`K` or `←`/`→` cycle · `gg`/`G` first/last · `⌃D`/`⌃U` skip half · `Z` zoom · `O` open · `Q`/`Esc` close |
| General | `⌘K` commands · `/` filter · `?` shortcuts · `R` refresh |

## License

MIT
