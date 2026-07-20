<p align="center"><img src="assets/logo.png" alt="ScriptBreak" width="560"></p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="License: Apache 2.0"></a>
  <a href="../../releases/latest"><img src="https://img.shields.io/github/v/release/wassermanproductions/scriptbreak?include_prereleases&label=download" alt="Latest release"></a>
  <img src="https://img.shields.io/badge/platforms-macOS%20·%20Windows%20·%20Linux-2f7bf6" alt="Platforms">
  <a href="https://ko-fi.com/samwasserman"><img src="https://img.shields.io/badge/Ko--fi-support%20Sam%20Wasserman-ff5e5b?logo=kofi&logoColor=white" alt="Support Sam Wasserman on Ko-fi"></a>
</p>

# ScriptBreak

A screenplay breakdown app that doesn't phone home. Load a script, get a full
breakdown — scenes, characters, locations, props, shot lists — and export
prompt packs that turn any LLM into your assistant director. No API keys, no
accounts, no cloud — it runs entirely on your machine.

**Created by [Sam Wasserman](https://wassermanproductions.com)** —
writer/director, [Wasserman Productions](https://wassermanproductions.com) ·
[wasserman.ai](https://wasserman.ai).

> ☕ **A little support goes a long way!** ScriptBreak is created and
> maintained by **Sam Wasserman**. If you'd like to help Sam keep creating
> tools for filmmakers, you can support him at
> **[ko-fi.com/samwasserman](https://ko-fi.com/samwasserman)**.
> Donations are optional — but extremely helpful and appreciated.

Part of the [**Wasserman Filmmaker Suite**](https://github.com/wassermanproductions/wassermans-filmmaker-suite), alongside [Blockout](https://github.com/wassermanproductions/blockout),
[Motion Previs Studio](https://github.com/wassermanproductions/motion-previs-studio),
[Master Canvas](https://github.com/wassermanproductions/master-canvas),
[Storyboard Reference Studio](https://github.com/wassermanproductions/storyboard-reference-studio), and
[DaVinci MCP](https://github.com/wassermanproductions/unofficial-davinci-mcp).

## ⬇ Download

**macOS — paste one line, done.** Open Terminal (⌘-Space, type "Terminal")
and paste:

```bash
curl -fsSL https://raw.githubusercontent.com/wassermanproductions/scriptbreak/master/install.sh | bash
```

It detects your Mac (Apple Silicon or Intel), downloads the latest build,
installs it to Applications, and opens it — no warnings, nothing else to do.
([The script](install.sh) is ~30 lines, read it if you like.)

**Windows & Linux — [download the latest release →](../../releases/latest)**

| Platform | File to grab | After downloading |
|---|---|---|
| Windows | `.msi` or `-setup.exe` | If SmartScreen appears, click **More info → Run anyway**. |
| Linux | `.AppImage`, `.deb`, or `.rpm` | For the AppImage: `chmod +x ScriptBreak_*.AppImage`, then run it. |

<details>
<summary><b>Prefer downloading the macOS DMG by hand?</b></summary>

Grab `ScriptBreak_x.x.x_aarch64.dmg` (Apple Silicon M1–M4) or
`ScriptBreak_x.x.x_x64.dmg` (Intel) from the
[Releases](../../releases/latest) page and drag **ScriptBreak** into
**Applications**. Because browser downloads of unsigned apps are quarantined,
macOS will falsely claim the app is "damaged" — paste this into Terminal once
and it opens normally from then on:

```bash
xattr -cr /Applications/ScriptBreak.app
```

(The install script above avoids this entirely — Terminal downloads aren't
quarantined.)
</details>

## Screenshots

**Scene breakdown** — import a script, get scene cards with exact page
counts, cast, day/night, and auto-tagged elements:

![Scene breakdown](docs/screenshots/scenes.png)

**Scene detail & tagging** — script text beside the breakdown; click
auto-detected suggestions or select any words in the text to tag them:

![Scene detail and tagging](docs/screenshots/scene-detail.png)

**Shot lists** — starter coverage per scene, including every shot the writer
explicitly called in the script (`[script]`), all fully editable:

![Shot list](docs/screenshots/shot-list.png)

**Timeline** — the whole film on one strip with character-presence lanes;
color by location, day/night, int/ext, or character:

![Timeline](docs/screenshots/timeline.png)

**Bibles** — character, location, and hero-prop descriptions seeded from the
script itself, injected into every AI prompt for consistency:

![Bibles](docs/screenshots/bibles.png)

**Project Look & style guides** — 13 fields of visual DNA; drop in a mood
book or pitch deck PDF and its framing/camera/lighting notes flow in:

![Project look](docs/screenshots/look.png)

**Exports** — scoped prompt packs, coverage consults, breakdown sheets,
CSVs, or everything at once as a zip:

![Exports](docs/screenshots/export.png)

**Self-executing prompt packs** — paste into any LLM, no API keys:

![Prompt pack](docs/screenshots/prompt-pack.png)

## Features

- **Script breakdown** — parse `.fountain`, `.fdx` (Final Draft), `.pdf`, or
  plain `.txt` screenplays into scenes, sluglines, and a full element
  breakdown. FDX imports use Final Draft's own embedded scene lengths for
  exact page counts; PDF parsing (fully offline — the PDF engine is embedded)
  reconstructs the screenplay from page layout.
- **Auto-breakdown on import** — elements (props, wardrobe, vehicles, VFX,
  background…) tagged from word lists *and* from the CAPS the writer used in
  action lines; character/location bibles seeded from actual intro
  descriptions in the script; starter shot lists that include every shot the
  writer explicitly called (CLOSE ON, INSERT, POV…); look suggestions from
  script analysis. All of it editable, all of it clearable.
- **Projects & drafts** — a local library of projects, multiple drafts per
  project, and draft comparison (scenes added / cut / rewritten, page deltas,
  cast changes).
- **Style guide ingestion** — drop in a mood book or pitch deck PDF and its
  framing / camera / lighting / music / theme notes flow into the Look and
  ride inside every AI export as a binding style guide.
- **Timeline** — the whole film on one strip, scene widths proportional to
  page length, colored by location or day/night, with character-presence
  lanes.
- **Prompt-pack exports** — self-executing `.md` files that carry their own
  instructions, with per-platform dialects for video (Veo, Runway, Kling,
  ComfyUI/Wan, LTX, Seedance) and stills (GPT Image, Nano Banana, Krea,
  Seedream, Midjourney). Paste one into ChatGPT, Claude, Gemini, a local
  model — no integration needed. Scope any export to scene ranges, page
  ranges, or your current filters, or download everything as one zip bundle.
- **Shooting schedule & Day Out of Days** — a draft stripboard that groups
  scenes into shoot days by location, day/night, and int/ext under a
  pages-per-day budget, plus the standard cast **Day Out of Days** grid
  (Start / Work / Hold / Finish per shoot day). Print/PDF or CSV. It's a
  starting point for your 1st AD — cast presence is read from dialogue, so
  silent/background cast aren't detected; verify before scheduling.
- **Zero setup** — no server, no database, no account. Install the app, load a script, and go.

## Why no API keys

Most "AI-powered" tools want you to paste in a key and ship your script to
someone else's server. ScriptBreak doesn't do that, because it doesn't call
any AI at all — it exports **prompt packs** instead.

A prompt pack is a plain Markdown file that bundles your scene/character/shot
data together with the instructions for what to do with it. You paste the
whole file into any LLM you already have access to, and the LLM does the
analysis on its own infrastructure, under whatever account and privacy terms
you already agreed to. ScriptBreak never talks to a model provider, never
holds a key, and never uploads your script anywhere. The export *is* the
integration.

## Quick start

Install the desktop app. On macOS, paste the one-line installer from the
[Download](#-download) section into Terminal. On Windows and Linux, grab the
build for your OS from the [Releases](../../releases) page and install it like
any other app. Then launch ScriptBreak and load a script.

## Building from source

ScriptBreak's desktop wrapper is [Tauri v2](https://v2.tauri.app/). Since the
frontend is a single static file, there's no JS toolchain to install — just
Rust.

```bash
cargo install tauri-cli --version "^2"
cd src-tauri
cargo tauri build
```

That produces a native installer (`.dmg`/`.app`, `.msi`/`.exe`, or
`.deb`/`.AppImage`/`.rpm`) for whatever platform you're building on.

To build for all platforms at once without owning a Mac, a Windows box, and a
Linux machine, push a tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The [release workflow](.github/workflows/release.yml) picks it up and builds
macOS (Apple Silicon + Intel), Linux, and Windows installers, attaching them
to a draft GitHub release.

## File formats

| Direction | Formats |
|---|---|
| Import | `.fountain`, `.fdx` (Final Draft XML), `.txt` |
| Save / project file | `.scriptbreak` (plain JSON — readable, diffable, greppable) |
| Export | Prompt-pack `.md` files for any LLM |

## Opening project files

Double-click a `.scriptbreak` file to open it directly in the ScriptBreak
desktop app — no need to launch the app first and use an Open… dialog. This
works in installed desktop builds (see [Quick start](#quick-start) /
[Building from source](#building-from-source)); the OS registers the file
association when the app is installed (Windows/Linux) or, on macOS, the
first time the app is launched.

## Agent control (MCP)

ScriptBreak ships a headless **[MCP server](mcp/)** so an AI agent — Claude
Code, Codex, Hermes, or any MCP client — can read a saved breakdown and export
ScriptBreak's own prompt packs straight from a `.scriptbreak` file, without
opening the app. It's zero-dependency and needs only Node ≥ 18.

Point it at a project you saved with **Save project**, then add it to Claude
Code:

```bash
claude mcp add scriptbreak \
  --env SCRIPTBREAK_PROJECT=/absolute/path/to/your/project.scriptbreak \
  -- node /absolute/path/to/scriptbreak/mcp/scriptbreak-mcp.mjs
```

The agent gets nine read-only tools: `get_breakdown`, `list_scenes`,
`get_scene`, `list_elements`, `get_character_bible`, `get_location_bible`,
`get_shot_list`, `list_generators`, and `export_prompt_pack` — the last
reproduces ScriptBreak's AI video, storyboard-frame, coverage-consult, and
script-companion packs (with the same per-generator dialects) for any scene
range, page range, or filter. See **[mcp/README.md](mcp/README.md)** for the
full tool reference and Codex/Hermes/generic config.

## Privacy

ScriptBreak has no server, no accounts, and no telemetry — it does its work
locally and doesn't upload your script anywhere. Your script, your breakdown,
and your exports live in files you control. As with any software, your
overall privacy also depends on your own device and system setup.

## Troubleshooting

- **macOS says the app is "damaged" and should be moved to the Trash** —
  it isn't damaged; unsigned builds from the Releases page aren't notarized,
  so Gatekeeper blocks them. After copying ScriptBreak to Applications, run
  this once in Terminal, then open the app normally:
  ```bash
  xattr -cr /Applications/ScriptBreak.app
  ```
- **Windows SmartScreen warning** — same story, no code-signing certificate
  yet. Click "More info" → "Run anyway."
- **Double-clicking a `.scriptbreak` file doesn't open it on macOS** —
  file associations are registered with Launch Services the first time the
  app is opened, so launch ScriptBreak once (from Finder/Applications)
  before double-clicking a project file. macOS also delivers "open this
  file" requests as an Apple Event rather than a command-line argument, so
  this only works through the app's event-based file-open handling, not a
  plain argv check.

## Contributing

Issues and pull requests welcome. The frontend is intentionally a single
`src/index.html` with no build step — keep it that way. If you're touching
the desktop wrapper, it lives entirely in `src-tauri/`.

## License

Apache License 2.0 — see [LICENSE](LICENSE), same as the rest of the
[Wasserman Filmmaker Suite](https://github.com/wassermanproductions/wassermans-filmmaker-suite).
© 2026 Sam Wasserman / Wasserman Productions.

## Author & links

Created by **Sam Wasserman** · [wassermanproductions.com](https://wassermanproductions.com)
· [wasserman.ai](https://wasserman.ai)
· [GitHub](https://github.com/wassermanproductions)
· [Support Sam Wasserman on Ko-fi](https://ko-fi.com/samwasserman)
