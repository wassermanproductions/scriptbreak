# scriptbreak-mcp

Headless MCP (Model Context Protocol) server for **[ScriptBreak](https://github.com/wassermanproductions/scriptbreak)** — the local-first screenplay breakdown app. With this server connected, an AI agent can read a ScriptBreak breakdown and export its prompt packs **without opening the desktop app** — it works directly on a saved `.scriptbreak` project file on disk.

An agent can pull the breakdown summary, list and read scenes, filter elements by category, read the character and location bibles, get the shot list, reproduce ScriptBreak's own AI prompt packs (video, stills, coverage consult, script companion) for any scene range, page range, or filter — byte-for-byte the same markdown the app writes — and generate a draft shooting schedule and cast Day Out of Days.

Zero dependencies. Node ≥ 18. One file.

## What it operates on

ScriptBreak keeps its live project library in the app's local storage; the portable, on-disk artifact is the **`.scriptbreak`** file the app writes with **Save project**. That file is the app's `serialize()` output:

```
{ app: "scriptbreak", version: 2, saved: "…", project: "…", draft: "…", state: { … } }
```

where `state` holds the breakdown: `title`, `scriptName`, `scenes[]` (each with slugline, INT/EXT, location, time of day, page length in 1/8ths, characters, tagged `elements` by category, and a `shots[]` list), the `bibles` (`characters`, `locations`, `props`), the PROJECT `look`, and an optional `styleGuide`. ScriptBreak's parser produces the breakdown inside the app, so this server reads an **already-saved** project — it does not re-parse raw screenplays. This server never writes; it only reads.

The project file is resolved in this order:

1. the `projectPath` argument on a tool call, if given;
2. the `SCRIPTBREAK_PROJECT` environment variable;
3. the default app-data location — `~/Library/Application Support/com.wasserman.scriptbreak/project.scriptbreak` on macOS (`%APPDATA%\com.wasserman.scriptbreak\…` on Windows, `$XDG_CONFIG_HOME/com.wasserman.scriptbreak/…` on Linux).

Because ScriptBreak persists to local storage rather than a fixed file, you will normally point this server at a `.scriptbreak` file you exported with **Save project** — via `projectPath` or `SCRIPTBREAK_PROJECT`.

## Requirements

- **Node ≥ 18.** No build step, no `npm install` — the server uses only Node built-ins.
- A saved ScriptBreak project (`.scriptbreak`) file. Make one in the app with **Save project**.

## Connect

### Claude Code

```bash
claude mcp add scriptbreak \
  --env SCRIPTBREAK_PROJECT=/absolute/path/to/your/project.scriptbreak \
  -- node /absolute/path/to/scriptbreak/mcp/scriptbreak-mcp.mjs
```

### Codex

Add to your Codex MCP config (`~/.codex/config.toml`):

```toml
[mcp_servers.scriptbreak]
command = "node"
args = ["/absolute/path/to/scriptbreak/mcp/scriptbreak-mcp.mjs"]
env = { SCRIPTBREAK_PROJECT = "/absolute/path/to/your/project.scriptbreak" }
```

### Hermes

Add to `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  scriptbreak:
    command: "node"
    args: ["/absolute/path/to/scriptbreak/mcp/scriptbreak-mcp.mjs"]
    env:
      SCRIPTBREAK_PROJECT: "/absolute/path/to/your/project.scriptbreak"
```

### Any MCP client (generic stdio config)

```json
{
  "mcpServers": {
    "scriptbreak": {
      "command": "node",
      "args": ["/absolute/path/to/scriptbreak/mcp/scriptbreak-mcp.mjs"],
      "env": { "SCRIPTBREAK_PROJECT": "/absolute/path/to/your/project.scriptbreak" }
    }
  }
}
```

## Tools (11)

Call **`get_breakdown` first** — its response explains the data conventions (scenes, elements by category, page counts in 1/8ths, bibles, generators).

| Tool | What it does |
| --- | --- |
| `get_breakdown` | Read the project and summarize title, page count, scene/INT-EXT/day-night tallies, unique characters & locations, element totals by category, shot count, bible sizes, filled PROJECT LOOK fields, and the supported generators. Start here. |
| `list_scenes` | List scenes with number, slugline, INT/EXT, location, time of day, page length, characters, shot count, and element count. Filterable by scene range, page range, INT/EXT, day/night, character, or location. |
| `get_scene` | Full detail of one scene by number: slugline + parsed parts, page length, synopsis, script text, characters, tagged elements by category, and the full shot list. |
| `list_elements` | Tagged production elements, with the scene numbers each appears in. Optionally scoped to one category (props, wardrobe, vehicles, vfx, …). |
| `get_character_bible` | The character bible — canonical descriptions (all, or one by name). |
| `get_location_bible` | The location bible — canonical descriptions (all, or one by name). |
| `get_shot_list` | The shot list grouped by scene (size, angle, movement, lens, description). Optionally scoped. |
| `list_generators` | The prompt-pack targets: video (Veo 3, Runway, Kling, ComfyUI, Wan 2.2, LTX 2.3, Seedance), stills (GPT Image 2, Nano Banana Pro, Krea 2, Seedream, Midjourney), plus coverage consult and script companion. |
| `export_prompt_pack` | Reproduce ScriptBreak's own prompt pack as markdown for a chosen `generator` and scope — the video/stills pack (PROJECT LOOK + bibles + per-generator platform style guide + scene-by-scene shots), the coverage consult, or the script companion. |
| `get_schedule` | Reproduce ScriptBreak's suggested **shooting schedule** (draft stripboard): scenes grouped into synthetic shoot days by location → day/night → int/ext under a page budget (`pagesPerDay`, default 5). Returns the ordered day list (location, I/E, D/N, scenes, page eighths, cast IDs) plus a byte-identical `csv`. |
| `get_day_out_of_days` | Reproduce ScriptBreak's cast **Day Out of Days** grid from that schedule — one row per cast member, one column per shoot day, standard codes (SW/W/WF/SWF/H) and Work/Hold/Total counts, plus a byte-identical `csv`. |

> ⚠️ `get_schedule` / `get_day_out_of_days` are a **draft**. Cast presence is inferred from **dialogue cues only**, so silent/background cast are not detected and the DOOD under-reports who's needed; page counts may be estimated; and no cast/location availability, company moves, or turnaround are modelled. Every response includes a `caveat` field saying so. Treat it as a starting point for a 1st AD, not a locked schedule.

### Scope selectors

`list_scenes`, `get_shot_list`, `export_prompt_pack`, `get_schedule`, and `get_day_out_of_days` accept the same scope selectors as ScriptBreak's export scope bar:

- `scope: "all"` (default) — every scene.
- `scope: "scenes"` + `sceneRange: "1-20, 34, 50A"` — a scene-number range/list.
- `scope: "pages"` + `pageRange: "1-12"` — a page range.
- `scope: "shots"` — only scenes that have a shot list.
- `scope: "filter"` + any of `int`, `ext`, `day`, `night`, `character`, `location` — the breakdown filters.

(Passing `sceneRange` / `pageRange` / a filter without `scope` implies the matching scope.)

The prompt-pack markdown — header, PROJECT LOOK block, character/location/prop bibles, the per-generator platform style guide, and the scene-by-scene shot listing — is generated from the same templates and per-generator dialects ScriptBreak uses internally, so packs produced here match the app's exports exactly.

A typical agent session: `get_breakdown` → `list_scenes` (with a filter) → `get_scene` for the beats that matter → `export_prompt_pack` with a video or stills generator over a scene range → hand the markdown to your generator.

## Security

This server only reads the local filesystem: it reads the `.scriptbreak` project JSON you point it at and never writes to it. It opens no network connections and exposes nothing off-machine. Point it only at project paths you trust.

## License & credit

Apache-2.0 — see the repository [LICENSE](../LICENSE). Created by **Sam Wasserman ([wassermanproductions.com](https://wassermanproductions.com))**. Please keep the attribution in uses, forks, and redistributions.
