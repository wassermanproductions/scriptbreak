#!/usr/bin/env node
/**
 * ScriptBreak MCP server — zero-dependency Node >=18 stdio bridge.
 *
 * Speaks the MCP stdio transport: newline-delimited JSON-RPC 2.0 on
 * stdin/stdout (NOT Content-Length framed): initialize /
 * notifications/initialized / tools/list / tools/call / ping.
 *
 * HEADLESS wrapper around a ScriptBreak project. Instead of driving the
 * desktop GUI, every tool reads a saved ScriptBreak project file directly
 * on disk (the `.scriptbreak` file the app writes with "Save project") and
 * reproduces the app's own breakdown views and prompt-pack exports. Any MCP
 * agent can read a breakdown and generate generator-ready prompt packs
 * without opening the app.
 *
 * ScriptBreak's breakdown (scene parsing, auto-tagging, bibles, coverage) is
 * produced by the desktop app's parser, so this server operates on an
 * ALREADY-SAVED project — it does not re-parse raw screenplays. The prompt
 * packs it emits mirror ScriptBreak's own templates and per-generator
 * dialects byte-for-byte.
 *
 * Uses only Node built-ins (fs, path, os) — run directly with `node`.
 */

import { readFileSync, existsSync } from 'node:fs'
import { join, resolve, isAbsolute } from 'node:path'
import { homedir, platform } from 'node:os'

const PROTOCOL_VERSION = '2024-11-05'

/* ------------------------- project location ----------------------------- */

// Mirror Tauri's appDataDir() for identifier com.wasserman.scriptbreak.
function appDataDir() {
  const home = homedir()
  if (platform() === 'darwin') return join(home, 'Library', 'Application Support')
  if (platform() === 'win32') return process.env.APPDATA || join(home, 'AppData', 'Roaming')
  return process.env.XDG_CONFIG_HOME || join(home, '.config')
}

const DEFAULT_PROJECT = join(appDataDir(), 'com.wasserman.scriptbreak', 'project.scriptbreak')

// Resolve the project file: explicit arg > SCRIPTBREAK_PROJECT env > default.
function resolveProjectPath(args) {
  const raw = (args && args.projectPath) || process.env.SCRIPTBREAK_PROJECT || DEFAULT_PROJECT
  const expanded = raw.startsWith('~') ? join(homedir(), raw.slice(1)) : raw
  return isAbsolute(expanded) ? expanded : resolve(expanded)
}

/* ---------------------------- project model ----------------------------- */
/*
 * ScriptBreak persists its live library in the app's localStorage; the
 * portable, on-disk artifact is the `.scriptbreak` file written by
 * "Save project", which is exactly `serialize()`:
 *
 *   { app:'scriptbreak', version:2, saved:ISO, project:name, draft:name, state:S }
 *
 * where S (the draft state / blankState() shape) is:
 *
 *   { title, scriptName, scenes:[], bibles:{characters:{},locations:{},props:{}},
 *     look:{ aspect,format,lensing,framing,camera,lighting,palette,design,
 *            wardrobe,music,tone,refs,negative },
 *     lookSrc:{}, customCats:[], lookAuto:false, styleGuide:null }
 *
 * A scene:
 *   { num, slug, intExt, location, master, sub, area, tod, todBucket,
 *     eighths, page?, text, synopsis, characters:[names],
 *     elements:{ <catKey>:[names] }, shots:[ {num,size,angle,move,lens,desc,auto} ] }
 *
 * A bible entry (characters/locations/props): { desc, auto }
 */

// The app's fixed element categories (index.html: const CATS).
const CATS = [
  { k: 'cast', label: 'Cast', auto: true },
  { k: 'extras', label: 'Extras / BG' },
  { k: 'props', label: 'Props' },
  { k: 'setdress', label: 'Set Dressing' },
  { k: 'wardrobe', label: 'Wardrobe' },
  { k: 'makeup', label: 'Makeup / Hair' },
  { k: 'vehicles', label: 'Vehicles' },
  { k: 'animals', label: 'Animals' },
  { k: 'stunts', label: 'Stunts' },
  { k: 'vfx', label: 'VFX' },
  { k: 'sfx', label: 'Special FX' },
  { k: 'sound', label: 'Sound / Music' },
  { k: 'equipment', label: 'Special Equipment' }
]

function blankState() {
  return {
    title: 'Untitled Project',
    scriptName: '',
    scenes: [],
    bibles: { characters: {}, locations: {}, props: {} },
    look: {
      aspect: '', format: '', lensing: '', framing: '', camera: '', lighting: '',
      palette: '', design: '', wardrobe: '', music: '', tone: '', refs: '', negative: ''
    },
    lookSrc: {},
    customCats: [],
    lookAuto: false,
    styleGuide: null
  }
}

// CATS + any project-defined custom categories (index.html: function cats).
function cats(S) {
  return CATS.concat((S.customCats || []).map((c) => ({ k: c.k, label: c.label, custom: true })))
}

function loadProject(path) {
  if (!existsSync(path)) {
    const err = new Error(
      `No ScriptBreak project at ${path}. Save one from the app ("Save project" → a .scriptbreak file), then pass projectPath or set SCRIPTBREAK_PROJECT.`
    )
    err.userFacing = true
    throw err
  }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'))
  } catch (e) {
    const err = new Error(`Could not parse ${path} as JSON: ${e.message}`)
    err.userFacing = true
    throw err
  }
  // Accept the "Save project" wrapper { app, version, state } or a raw state object.
  const rawState = parsed && parsed.state && Array.isArray(parsed.state.scenes)
    ? parsed.state
    : (Array.isArray(parsed.scenes) ? parsed : null)
  if (!rawState) {
    const err = new Error(
      `${path} is not a ScriptBreak project (expected an object with .state.scenes or .scenes).`
    )
    err.userFacing = true
    throw err
  }
  const S = Object.assign(blankState(), rawState)
  S.bibles = Object.assign({ characters: {}, locations: {}, props: {} }, S.bibles || {})
  S.look = Object.assign(blankState().look, S.look || {})
  S.customCats = S.customCats || []
  // Match hydrate(): ensure every scene has shots[] and elements{} for each category.
  S.scenes = (S.scenes || []).map((sc) => {
    const scene = Object.assign({}, sc)
    scene.shots = scene.shots || []
    scene.elements = scene.elements || {}
    scene.characters = scene.characters || []
    CATS.forEach((c) => { if (!c.auto && !scene.elements[c.k]) scene.elements[c.k] = [] })
    return scene
  })
  // Migration the app performs: "camera energy" → "camera movement".
  if (S.look.energy && !S.look.camera) { S.look.camera = S.look.energy; delete S.look.energy }
  return {
    S,
    meta: {
      app: parsed.app || '',
      version: parsed.version,
      saved: parsed.saved || '',
      project: parsed.project || '',
      draft: parsed.draft || ''
    }
  }
}

/* --------------------------- shared helpers ----------------------------- */
// These mirror the identically named functions in ScriptBreak's index.html so
// that reproduced exports match the app's output exactly.

function eighthsFmt(e) {
  e = e || 0
  const w = Math.floor(e / 8), r = e % 8
  return (w ? w + (r ? ' ' : '') : '') + (r ? r + '/8' : (w ? '' : '1/8'))
}

function totals(S) {
  const t = { scenes: S.scenes.length, eighths: 0, int: 0, ext: 0, day: 0, night: 0, shots: 0 }
  const chars = new Set(), locs = new Set()
  for (const sc of S.scenes) {
    t.eighths += sc.eighths || 0
    if ((sc.intExt || '').includes('INT')) t.int++
    if ((sc.intExt || '').includes('EXT')) t.ext++
    if (sc.todBucket === 'DAY') t.day++
    if (sc.todBucket === 'NIGHT') t.night++
    ;(sc.characters || []).forEach((c) => chars.add(c))
    if (sc.master || sc.location) locs.add(sc.master || sc.location)
    t.shots += (sc.shots || []).length
  }
  t.chars = chars.size
  t.locs = locs.size
  return t
}

function shotLine(sh) {
  const bits = [sh.size, sh.angle, sh.move, sh.lens ? sh.lens + ' lens' : ''].filter(Boolean).join(', ')
  return `**SHOT ${sh.num}**${bits ? ' — ' + bits : ''}${sh.desc ? ': ' + sh.desc : ''}`
}

function sceneHeaderMd(sc) {
  return `### Scene ${sc.num} — ${sc.slug}  (${eighthsFmt(sc.eighths)} pg)`
}

function sceneContextMd(S, sc, includeText) {
  let out = ''
  if ((sc.characters || []).length) out += `Characters present: ${sc.characters.join(', ')}\n`
  const els = []
  for (const c of cats(S)) {
    if (c.auto) continue
    const items = sc.elements[c.k] || []
    if (items.length) els.push(`${c.label}: ${items.join(', ')}`)
  }
  if (els.length) out += `Tagged elements — ${els.join(' · ')}\n`
  if (includeText) out += '\n```\n' + (sc.text || '').trim() + '\n```\n'
  else if (sc.synopsis) out += `Action: ${sc.synopsis}\n`
  return out
}

function lookBlock(S) {
  const L = S.look, rows = []
  const push = (k, v) => { if (v && v.trim()) rows.push(`- **${k}:** ${v.trim()}`) }
  push('Aspect ratio', L.aspect); push('Format / stock', L.format); push('Lensing', L.lensing)
  push('Framing & composition', L.framing); push('Camera movement', L.camera || L.energy)
  push('Lighting', L.lighting); push('Palette', L.palette)
  push('Production design / locations', L.design); push('Wardrobe', L.wardrobe)
  push('Music & sound', L.music); push('Tone / themes', L.tone)
  push('References', L.refs); push('Avoid', L.negative)
  return rows.length
    ? rows.join('\n')
    : '_Not defined — infer a coherent, restrained cinematic look from the script’s tone and keep it consistent across all shots._'
}

function bibleBlock(S, type, names) {
  const rows = []
  for (const n of names) {
    const b = S.bibles[type][n]
    if (b && b.desc && b.desc.trim()) rows.push(`- **${n}:** ${b.desc.trim().replace(/\n+/g, ' ')}`)
  }
  return rows
}

function usedNames(scenes) {
  const chars = new Set(), locs = new Set(), props = new Set()
  scenes.forEach((sc) => {
    ;(sc.characters || []).forEach((c) => chars.add(c))
    if (sc.master || sc.location) locs.add(sc.master || sc.location)
    ;(sc.elements.props || []).forEach((p) => props.add(p))
  })
  return { chars: [...chars], locs: [...locs], props: [...props] }
}

function styleGuideBlock(S) {
  if (!S.styleGuide || !S.styleGuide.text) return ''
  return `## STYLE GUIDE — “${S.styleGuide.name}” (provided by the filmmaker)

This reference document is BINDING. Where it speaks — framing, camera movement, lighting, palette, music, themes — it outranks any generic choice you would otherwise make. Weave its language into the prompts.

${S.styleGuide.text}

`
}

/* ---------------------------- export scope ------------------------------ */
// Mirror ScriptBreak's EXP scope + exportScenes()/scopeLabel().

function scenePageStart(S, i) {
  if (S.scenes[i] && S.scenes[i].page) return S.scenes[i].page
  let e = 0
  for (let j = 0; j < i; j++) e += S.scenes[j].eighths || 0
  return Math.floor(e / 8) + 1
}

function parseRangeSet(str) {
  const set = new Set(), ranges = []
  String(str || '').split(/[,;]+/).map((s) => s.trim()).filter(Boolean).forEach((part) => {
    const m = part.match(/^(\d+)\s*[-–]\s*(\d+)$/)
    if (m) ranges.push([+m[1], +m[2]])
    else set.add(part.toUpperCase())
  })
  return {
    has(numStr, numVal) {
      if (set.has(String(numStr).toUpperCase())) return true
      if (!isNaN(numVal)) for (const [a, b] of ranges) if (numVal >= a && numVal <= b) return true
      return false
    },
    empty: set.size === 0 && ranges.length === 0
  }
}

function sceneMatchesFilters(sc, filters) {
  if (filters.INT && !(sc.intExt || '').includes('INT')) return false
  if (filters.EXT && !(sc.intExt || '').includes('EXT')) return false
  if (filters.DAY && sc.todBucket !== 'DAY') return false
  if (filters.NIGHT && sc.todBucket !== 'NIGHT') return false
  if (filters.char && !(sc.characters || []).includes(filters.char)) return false
  if (filters.loc && (sc.master || sc.location) !== filters.loc) return false
  return true
}

// exp = { mode:'all'|'shots'|'filter'|'scenes'|'pages', range:'', filters:{...} }
function exportScenes(S, exp) {
  const all = S.scenes
  switch (exp.mode) {
    case 'shots': return all.filter((sc) => (sc.shots || []).length)
    case 'filter': return all.filter((sc) => sceneMatchesFilters(sc, exp.filters || {}))
    case 'scenes': {
      const r = parseRangeSet(exp.range)
      if (r.empty) return all
      return all.filter((sc) => r.has(sc.num, parseInt(sc.num, 10)))
    }
    case 'pages': {
      const r = parseRangeSet(exp.range)
      if (r.empty) return all
      return all.filter((sc, i) => r.has('', scenePageStart(S, i)))
    }
    default: return all
  }
}

function scopeLabel(S, exp) {
  const n = exportScenes(S, exp).length, t = S.scenes.length
  if (exp.mode === 'all' || n === t) return `all ${t} scenes`
  const what = {
    shots: 'scenes with shots',
    filter: 'current search/filter',
    scenes: 'scene range ' + exp.range,
    pages: 'pages ' + exp.range
  }[exp.mode]
  return `${n} of ${t} scenes (${what})`
}

/* -------------------------- generator dialects -------------------------- */
// Verbatim copies of ScriptBreak's PLATFORMS (video) and IMG_PLATFORMS (stills).

const PLATFORMS = {
  generic: { name: 'Any video generator', style: [
    'Write one self-contained paragraph per shot, 60–120 words, present tense.',
    'Order: shot framing → subject & action → setting → lighting & atmosphere → camera movement → style/texture.',
    'Describe everything visually; never reference the screenplay, scene numbers, or other shots inside the prompt itself.',
    'State the camera movement explicitly and keep it to ONE primary move per shot.'
  ] },
  veo3: { name: 'Google Veo 3', style: [
    'Write flowing cinematic prose, 90–150 words per shot, present tense.',
    'Veo responds well to: explicit camera language ("slow push-in on…", "handheld tracking shot"), lighting descriptions, and atmosphere.',
    'Veo 3 generates audio: where the shot calls for it, include a short sound cue at the end (e.g. Audio: rain on glass, distant foghorn) and dialogue in quotes if a line is essential.',
    'One continuous camera action per shot — avoid cut-like language ("then we cut to") entirely.'
  ] },
  runway: { name: 'Runway (Gen-4)', style: [
    'Be concise and front-loaded: subject and action in the first sentence, 40–80 words total.',
    'Use positive phrasing only — describe what IS in frame, never what to avoid ("no X" often backfires; fold avoidances into positive alternatives).',
    'Use terse camera grammar: "low angle, slow push-in", "static wide shot", "handheld tracking".',
    'Keep motion simple and physical: one subject action + one camera action.'
  ] },
  kling: { name: 'Kling 2.x', style: [
    'Structure each prompt: Subject → Action → Scene/setting → Camera → Lighting/style. Simple declarative sentences, 50–100 words.',
    'Emphasize physical motion and its direction ("walks slowly toward camera", "rain falls diagonally").',
    'Name the shot size and camera move in plain terms Kling knows: close-up, wide shot, push in, pan left, tracking shot.',
    'Avoid abstract or emotional language without a visual anchor — translate mood into light, weather, and posture.'
  ] },
  comfyui: { name: 'ComfyUI (local workflows)', style: [
    'Write TWO parts per shot: a positive prompt (dense comma-separated visual phrases: subject, action, setting, lighting, lens/film texture, camera move) and on the next line "Negative:" followed by a negative prompt (artifacts and styles to avoid: e.g. "blurry, warped hands, morphing, oversaturated, watermark" plus anything from the AVOID field of the look).',
    'Keep the positive prompt 40–90 words, front-loaded with subject and action; motion described simply ("slow push-in", "camera tracks left").',
    'Assume a Wan/AnimateDiff-style text-to-video workflow: concrete nouns and physical descriptions outperform prose.',
    'Consistent trigger-style phrasing across shots (reuse exact character/location descriptor strings verbatim from the bibles) helps checkpoint consistency.'
  ] },
  wan22: { name: 'Wan 2.2', style: [
    'Structure: Subject → Action → Environment → Lighting → Camera movement → Style, in short declarative sentences, 50–100 words.',
    'Wan responds well to explicit cinematography vocabulary ("medium close-up", "dolly in slowly", "shallow depth of field") and physical motion cues with direction and speed.',
    'Reuse each character\'s bible descriptor verbatim in every shot they appear in — Wan keys identity off the text.',
    'End each prompt with a brief style clause carrying the PROJECT LOOK (film stock, palette, era).'
  ] },
  ltx23: { name: 'LTX 2.3', style: [
    'Write one flowing paragraph per shot, 60–120 words, present tense, describing continuous motion — LTX excels at smooth, realistic movement, so give every prompt one clear motion arc (subject motion and/or camera motion).',
    'Be precise about timing and pacing words ("slowly", "in one continuous move") and about what stays still.',
    'Lead with the shot framing and camera behavior, then subject and action, then atmosphere.',
    'Avoid scene cuts, montage language, or multiple angles in one prompt.'
  ] },
  seedance: { name: 'Seedance', style: [
    'Structure each prompt: shot size + angle → subject and action → environment → lighting/mood → camera movement → style tag, 40–90 words, simple sentences.',
    'Seedance handles multi-subject motion well but keep ONE primary camera instruction per shot.',
    'Use concrete, filmable language; translate emotion into staging, light, and weather rather than abstractions.',
    'Carry the PROJECT LOOK palette and texture words into every prompt for cross-shot consistency.'
  ] }
}

const IMG_PLATFORMS = {
  gptimage2: { name: 'GPT Image 2', style: [
    'Write one rich descriptive paragraph per frame, 60–120 words of natural language — this model rewards clear, literate description over keyword lists.',
    'Describe the frame like a still photograph: framing, subject and exact pose/expression, setting, light direction and quality, palette, lens/film texture.',
    'State the aspect ratio in words at the end (e.g. "widescreen 2.39:1 cinematic frame") per the PROJECT LOOK.',
    'It follows instructions literally — spell out what is and is not in frame rather than relying on style shorthand.'
  ] },
  nanobanana: { name: 'Nano Banana Pro', style: [
    'One conversational, detailed paragraph per frame, 50–110 words — describe the scene as if briefing a photographer.',
    'Excellent at faces and identity consistency: reuse each character\'s bible description VERBATIM in every frame they appear in.',
    'Specify lighting precisely (source, direction, warmth) and name the palette; it renders lighting language faithfully.',
    'End with format guidance: aspect ratio and film/lens texture from the PROJECT LOOK.'
  ] },
  krea2: { name: 'Krea 2', style: [
    'One compact cinematic description per frame, 40–80 words: framing, subject, setting, light, palette, texture.',
    'Krea leans aesthetic — anchor it with concrete photographic terms (focal length, film stock, lighting setup) from the PROJECT LOOK to keep frames grounded and consistent.',
    'Name a clear style register once per prompt (e.g. "35mm cinematic still, naturalistic") rather than stacking many style words.'
  ] },
  seedream: { name: 'Seedream', style: [
    'One detailed paragraph per frame, 50–100 words: subject and pose first, then environment, then lighting and palette, then style/texture.',
    'Strong at typography-free photoreal frames; keep language concrete and physical.',
    'Reuse bible descriptors verbatim for recurring characters and locations; state the aspect ratio at the end.'
  ] },
  midjourney: { name: 'Midjourney', style: [
    'One single-line prompt per shot: comma-separated visual phrases, no full sentences, no "camera moves" (this is a still frame).',
    'Order: shot framing, subject & pose, setting, lighting, palette, film/lens texture, style refs.',
    'End every prompt with parameter flags: aspect ratio flag derived from PROJECT LOOK (e.g. --ar 239:100 for 2.39:1, --ar 16:9), and --raw for photographic realism unless the look says otherwise.',
    'Use concrete photographic language ("35mm still, halation, tungsten practicals") over vibe words.'
  ] },
  genericimg: { name: 'Any image generator', style: [
    'One compact paragraph per shot, 40–80 words, describing a single frozen frame: framing, subject, setting, light, palette, texture.',
    'No camera movement, no temporal words ("then", "as she walks past") — describe one instant.',
    'Carry the PROJECT LOOK texture and palette language into every frame so the boards feel like one film.'
  ] }
}

/* ----------------------------- pack builders ---------------------------- */

function packHeader(S, exp, kind) {
  return `# ${S.title} — ${kind}
*Generated by ScriptBreak (Wasserman Filmmaker Suite) · ${new Date().toLocaleDateString()} · scope: ${scopeLabel(S, exp)}*

> **HOW TO USE THIS FILE:** Paste this entire document into any AI assistant (Claude, ChatGPT, Gemini — whatever you already use). It contains its own instructions. The assistant will do the rest. Nothing about this file requires an API key or a particular tool.

---
`
}

function buildVideoPack(S, exp, platformKey) {
  const P = PLATFORMS[platformKey]
  const scenes = exportScenes(S, exp).filter((sc) => (exp.mode === 'shots' ? (sc.shots || []).length > 0 : true))
  const { chars, locs, props } = usedNames(scenes)
  const charB = bibleBlock(S, 'characters', chars), locB = bibleBlock(S, 'locations', locs), propB = bibleBlock(S, 'props', props)
  let md = packHeader(S, exp, 'AI Video Prompt Pack')
  md += `## YOUR TASK

You are an expert cinematic prompt writer for AI video generation (target platform: **${P.name}**). Below you'll find this film's PROJECT LOOK, its CHARACTER, LOCATION and PROP BIBLES, and a list of SHOTS TO GENERATE with scene context.

For **each shot**, write one production-ready video generation prompt.

Rules:
1. Follow the PLATFORM STYLE GUIDE below exactly.
2. Weave the PROJECT LOOK into every single prompt (texture, lensing, palette, tone) so all shots read as one film. Do not copy the look block verbatim — integrate it naturally.
3. Whenever a character, location, or prop from a BIBLE appears in a shot, fold its canonical description into the prompt. Never contradict a bible. This is how we keep faces, wardrobe and places consistent across generations.
4. Use the shot's size / angle / movement / lens fields as hard constraints. If a field is missing, choose what a skilled DP would choose for the scene and note your choice in one short parenthetical after the prompt.
5. The scene context (and script excerpt where given) tells you WHAT happens; your prompt tells the generator WHAT THE CAMERA SEES. Convert story into imagery.
6. Output format — for every shot, exactly:

SHOT <number> — <scene slug>
\`\`\`
<the prompt>
\`\`\`

No commentary between shots. After the final shot, stop.

## PLATFORM STYLE GUIDE — ${P.name}

${P.style.map((s) => '- ' + s).join('\n')}

${styleGuideBlock(S)}## PROJECT LOOK

${lookBlock(S)}

## CHARACTER BIBLE

${charB.length ? charB.join('\n') : '_No character descriptions defined. Invent a consistent, specific look for each named character on first appearance and reuse it verbatim in every subsequent shot._'}

## LOCATION BIBLE

${locB.length ? locB.join('\n') : '_No location descriptions defined. Establish each location with consistent, specific detail and reuse it._'}

${propB.length ? '## PROP BIBLE\n\n' + propB.join('\n') + '\n' : ''}## SHOTS TO GENERATE

`
  let total = 0
  for (const sc of scenes) {
    md += sceneHeaderMd(sc) + '\n\n' + sceneContextMd(S, sc, false) + '\n'
    if ((sc.shots || []).length) {
      for (const sh of sc.shots) { md += '- ' + shotLine(sh) + '\n'; total++ }
    } else {
      md += `- **SHOT ${sc.num}A** — (no shot list for this scene: design ONE master shot that best captures it, and state your framing choice)\n`
      total++
    }
    md += '\n'
  }
  md += `---\n*${total} shots · ${scenes.length} scenes · Prompt pack ends here. Begin with SHOT ${scenes[0] ? (scenes[0].shots[0] ? scenes[0].shots[0].num : scenes[0].num + 'A') : ''}.*\n`
  return md
}

function buildImagePack(S, exp, platformKey) {
  const P = IMG_PLATFORMS[platformKey]
  const scenes = exportScenes(S, exp)
  const { chars, locs, props } = usedNames(scenes)
  const charB = bibleBlock(S, 'characters', chars), locB = bibleBlock(S, 'locations', locs), propB = bibleBlock(S, 'props', props)
  let md = packHeader(S, exp, 'Storyboard / Concept Frame Prompt Pack')
  md += `## YOUR TASK

You are an expert prompt writer for AI **still-image** generation (target: **${P.name}**). For each shot below, write one prompt that renders that shot as a single storyboard/concept frame.

Rules:
1. Follow the PLATFORM STYLE GUIDE. These are STILLS — one frozen instant per prompt, no motion language.
2. Integrate the PROJECT LOOK into every frame; fold in BIBLE descriptions whenever their subject appears. Consistency across frames is the whole point.
3. Where a scene has no shot list, compose ONE definitive frame for the scene.
4. Output format — for every shot: the shot number on one line, then the prompt on the next line, then a blank line. No other commentary.

## PLATFORM STYLE GUIDE — ${P.name}

${P.style.map((s) => '- ' + s).join('\n')}

${styleGuideBlock(S)}## PROJECT LOOK

${lookBlock(S)}

## CHARACTER BIBLE

${charB.length ? charB.join('\n') : '_None defined — invent consistent looks and keep them identical across frames._'}

## LOCATION BIBLE

${locB.length ? locB.join('\n') : '_None defined — keep each location visually consistent across frames._'}

${propB.length ? '## PROP BIBLE\n\n' + propB.join('\n') + '\n' : ''}## FRAMES TO GENERATE

`
  for (const sc of scenes) {
    md += sceneHeaderMd(sc) + '\n\n' + sceneContextMd(S, sc, false) + '\n'
    if ((sc.shots || []).length) for (const sh of sc.shots) md += '- ' + shotLine(sh) + '\n'
    else md += `- **FRAME ${sc.num}A** — one definitive frame for this scene\n`
    md += '\n'
  }
  return md
}

function buildCoverageConsult(S, exp) {
  let md = packHeader(S, exp, 'Coverage Consult')
  md += `## YOUR TASK

You are a veteran director of photography and 1st AD reviewing a shot list before production. Below is the full scene list with page counts, characters, tagged elements, and the shots currently planned.

For each scene:
1. Assess whether the planned coverage tells the scene: establishing geography, key story beats, reactions, inserts of critical props, and an editorial escape hatch.
2. Recommend specific ADDITIONAL shots where coverage is thin (give size / angle / movement and WHY, in one line each). Flag scenes that are over-covered too — time on set is the scarcest resource.
3. Note any scene with dialogue but no reaction coverage, any tagged hero prop with no insert, and any location that never gets an establishing frame.

Finish with a one-paragraph overall assessment and the five highest-priority additions across the whole script.

${styleGuideBlock(S)}## SCENES & PLANNED COVERAGE

`
  for (const sc of exportScenes(S, exp)) {
    md += sceneHeaderMd(sc) + '\n\n' + sceneContextMd(S, sc, false)
    md += (sc.shots || []).length ? sc.shots.map((sh) => '- ' + shotLine(sh)).join('\n') + '\n\n' : '- _No shots planned yet._\n\n'
  }
  return md
}

function buildChatPack(S, exp) {
  let md = packHeader(S, exp, 'Script Companion')
  md += `## YOUR ROLE

You are now a producing/AD assistant with complete knowledge of the screenplay breakdown below. Answer any questions about this project: scenes, characters, locations, elements, scheduling implications, continuity, coverage. When useful, cite scene numbers. If asked for creative input (casting, budget, shot ideas), ground it in what's actually in the breakdown. Begin by briefly confirming what you've loaded (title, scene count, page count) and asking what's needed.

## BREAKDOWN DATA

**Title:** ${S.title}
**Scenes:** ${S.scenes.length} · **Pages:** ${(totals(S).eighths / 8).toFixed(1)}

### Project look
${lookBlock(S)}

${styleGuideBlock(S)}
### Bibles
${['characters', 'locations', 'props'].map((t) => {
    const rows = Object.entries(S.bibles[t]).filter(([, v]) => v.desc && v.desc.trim()).map(([k, v]) => `- **${k}** (${t.slice(0, -1)}): ${v.desc.trim().replace(/\n+/g, ' ')}`)
    return rows.join('\n')
  }).filter(Boolean).join('\n') || '_None defined._'}

### Scenes

`
  for (const sc of exportScenes(S, exp)) {
    md += sceneHeaderMd(sc) + '\n\n' + sceneContextMd(S, sc, true) + '\n'
    if ((sc.shots || []).length) md += 'Planned shots:\n' + sc.shots.map((sh) => '- ' + shotLine(sh)).join('\n') + '\n\n'
  }
  return md
}

/* -------------------- shooting schedule & Day Out of Days ----------------
 * These helpers are duplicated VERBATIM from ScriptBreak's index.html so the
 * app and this server produce the same suggested stripboard + DOOD. Keep the
 * two copies identical. Cast presence is inferred from dialogue only (silent /
 * background cast are not detected), so this is a draft — not a locked
 * schedule. See SCHED_CAVEAT below and the get_schedule / get_day_out_of_days
 * tool descriptions.
 */
function csvCell(v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v }

const SCHED_REGIME_RANK = { DAY: 0, MAGIC: 1, NIGHT: 2 }
const SCHED_REGIME_LABEL = { DAY: 'DAY', MAGIC: 'DUSK/DAWN', NIGHT: 'NIGHT' }
function schedRegime(sc) { const b = sc.todBucket || ''; if (b === 'DUSK' || b === 'DAWN') return 'MAGIC'; if (b === 'NIGHT') return 'NIGHT'; return 'DAY' }
function schedLocKey(sc) { return sc.master || sc.location || '(Unspecified location)' }
function schedIeLabel(sc) { return sc.intExt === 'INT/EXT' ? 'INT/EXT' : (sc.intExt === 'EXT' ? 'EXT' : 'INT') }
function schedIeRank(sc, regime) { const ext = sc.intExt === 'EXT' || sc.intExt === 'INT/EXT'; return regime === 'DAY' ? (ext ? 0 : 1) : (ext ? 1 : 0) }
function schedNatKey(num) { const s = String(num == null ? '' : num); const m = s.match(/^(\d+)(.*)$/); return m ? [parseInt(m[1], 10), m[2]] : [Number.MAX_SAFE_INTEGER, s] }

function buildScheduleDays(scenes, opts) {
  opts = opts || {}
  const target = Math.max(8, Math.round((opts.pagesPerDay || 5) * 8))
  const tol = (opts.tolerance != null ? opts.tolerance : 8)
  const castOrder = [], castId = {}
  scenes.forEach((sc) => (sc.characters || []).forEach((c) => { if (!(c in castId)) { castId[c] = castOrder.length + 1; castOrder.push(c) } }))
  const locFirst = new Map()
  scenes.forEach((sc, i) => { const k = schedLocKey(sc); if (!locFirst.has(k)) locFirst.set(k, i) })
  const groups = new Map()
  scenes.forEach((sc) => {
    const loc = schedLocKey(sc), reg = schedRegime(sc), key = loc + ' ' + reg
    if (!groups.has(key)) groups.set(key, { loc, regime: reg, scenes: [] })
    groups.get(key).scenes.push(sc)
  })
  const groupList = [...groups.values()].sort((a, b) => {
    const la = locFirst.get(a.loc), lb = locFirst.get(b.loc)
    if (la !== lb) return la - lb
    return SCHED_REGIME_RANK[a.regime] - SCHED_REGIME_RANK[b.regime]
  })
  groupList.forEach((g) => g.scenes.sort((a, b) => {
    const ra = schedIeRank(a, g.regime), rb = schedIeRank(b, g.regime)
    if (ra !== rb) return ra - rb
    const ka = schedNatKey(a.num), kb = schedNatKey(b.num)
    if (ka[0] !== kb[0]) return ka[0] - kb[0]
    return ka[1] < kb[1] ? -1 : ka[1] > kb[1] ? 1 : 0
  }))
  const days = []
  for (const g of groupList) {
    let cur = null
    for (const sc of g.scenes) {
      const e = sc.eighths || 0
      if (!cur || (cur.eighths > 0 && cur.eighths + e > target + tol)) { cur = { loc: g.loc, regime: g.regime, scenes: [], eighths: 0 }; days.push(cur) }
      cur.scenes.push(sc); cur.eighths += e
    }
  }
  const rows = days.map((d, idx) => {
    const cast = new Set()
    d.scenes.forEach((sc) => (sc.characters || []).forEach((c) => cast.add(c)))
    const ieset = [...new Set(d.scenes.map(schedIeLabel))]
    return {
      n: idx + 1, location: d.loc, regime: d.regime, regimeLabel: SCHED_REGIME_LABEL[d.regime],
      ie: ieset.join(' / '), sceneNums: d.scenes.map((sc) => sc.num), eighths: d.eighths,
      castNames: castOrder.filter((c) => cast.has(c)), castIds: castOrder.filter((c) => cast.has(c)).map((c) => castId[c])
    }
  })
  return { days: rows, castOrder, castId, targetEighths: target, tolerance: tol }
}
function buildDood(plan) {
  const dayCount = plan.days.length
  const worksOn = {}
  plan.castOrder.forEach((c) => worksOn[c] = new Set())
  plan.days.forEach((d, di) => d.castNames.forEach((c) => worksOn[c].add(di)))
  const cast = plan.castOrder.map((name) => {
    const set = worksOn[name], wd = [...set].sort((a, b) => a - b)
    const codes = new Array(dayCount).fill('')
    let work = 0, hold = 0
    if (wd.length) {
      const first = wd[0], last = wd[wd.length - 1]
      for (let d = first; d <= last; d++) {
        if (set.has(d)) { codes[d] = first === last ? 'SWF' : d === first ? 'SW' : d === last ? 'WF' : 'W'; work++ }
        else { codes[d] = 'H'; hold++ }
      }
    }
    return { id: plan.castId[name], name, codes, work, hold, total: work + hold }
  })
  return { dayCount, cast }
}
function buildScheduleCSV(scenes, opts) {
  const plan = buildScheduleDays(scenes, opts)
  const rows = [['Day', 'Location', 'I/E', 'Day/Night', 'Scenes', 'Pages (1/8)', 'Cast IDs', 'Cast']]
  plan.days.forEach((d) => rows.push([d.n, d.location, d.ie, d.regimeLabel, d.sceneNums.join(' '), eighthsFmt(d.eighths), d.castIds.join(' '), d.castNames.join('; ')]))
  return rows.map((r) => r.map(csvCell).join(',')).join('\n')
}
function buildDoodCSV(scenes, opts) {
  const plan = buildScheduleDays(scenes, opts), dood = buildDood(plan)
  const header = ['ID', 'Character', ...plan.days.map((d) => 'Day ' + d.n), 'Work', 'Hold', 'Total']
  const rows = [header]
  dood.cast.forEach((c) => rows.push([c.id, c.name, ...c.codes, c.work, c.hold, c.total]))
  return rows.map((r) => r.map(csvCell).join(',')).join('\n')
}
const SCHED_CAVEAT = 'Draft stripboard generated from ScriptBreak’s auto-parsed breakdown. Cast presence is inferred from dialogue only — silent / background cast are not detected, and page counts may be estimated. This is a starting point, not a locked schedule: it does not account for cast or location availability, company moves, day↔night turnaround, or child / stunt constraints. Verify with your 1st AD before scheduling.'

/* ------------------------------ generators ------------------------------ */

const VIDEO_GENERATORS = Object.keys(PLATFORMS)
const STILL_GENERATORS = Object.keys(IMG_PLATFORMS)
const OTHER_PACKS = { coverage: 'Coverage Consult', companion: 'Script Companion' }
const ALL_GENERATORS = [...VIDEO_GENERATORS, ...STILL_GENERATORS, ...Object.keys(OTHER_PACKS)]

function generatorCatalog() {
  return {
    video: VIDEO_GENERATORS.map((k) => ({ key: k, name: PLATFORMS[k].name })),
    stills: STILL_GENERATORS.map((k) => ({ key: k, name: IMG_PLATFORMS[k].name })),
    other: Object.entries(OTHER_PACKS).map(([k, name]) => ({ key: k, name }))
  }
}

/* -------------------------- scope from tool args ------------------------ */

function scopeFromArgs(args) {
  const filters = {
    INT: !!args.int, EXT: !!args.ext, DAY: !!args.day, NIGHT: !!args.night,
    char: args.character || '', loc: args.location || ''
  }
  let mode = args.scope || 'all'
  // Convenience: a range/page-range implies scenes/pages scope when scope omitted.
  if (!args.scope) {
    if (args.pageRange) mode = 'pages'
    else if (args.sceneRange) mode = 'scenes'
    else if (args.int || args.ext || args.day || args.night || args.character || args.location) mode = 'filter'
  }
  const range = mode === 'pages' ? (args.pageRange || args.range || '') : (args.sceneRange || args.range || '')
  return { mode, range, filters }
}

/* ---------------------------------- tools ------------------------------- */

const PROJECT_PATH_FIELD = {
  type: 'string',
  description: 'Absolute path to a saved ScriptBreak project (.scriptbreak) file. Optional — defaults to the SCRIPTBREAK_PROJECT env var, then the app-data location.'
}

const SCOPE_FIELDS = {
  scope: { type: 'string', enum: ['all', 'scenes', 'pages', 'shots', 'filter'], description: 'Scope selector, mirroring ScriptBreak\'s export scope bar. "all" (default); "scenes" + sceneRange; "pages" + pageRange; "shots" (only scenes with a shot list); "filter" (INT/EXT/day/night/character/location).' },
  sceneRange: { type: 'string', description: 'Scene-number range/list, e.g. "1-20, 34, 50A". Used with scope "scenes" (or implies it).' },
  pageRange: { type: 'string', description: 'Page range/list, e.g. "1-12". Used with scope "pages" (or implies it).' },
  int: { type: 'boolean', description: 'Filter: interior scenes (scope "filter").' },
  ext: { type: 'boolean', description: 'Filter: exterior scenes (scope "filter").' },
  day: { type: 'boolean', description: 'Filter: DAY scenes (scope "filter").' },
  night: { type: 'boolean', description: 'Filter: NIGHT scenes (scope "filter").' },
  character: { type: 'string', description: 'Filter: scenes featuring this exact character name (scope "filter").' },
  location: { type: 'string', description: 'Filter: scenes at this master location (scope "filter").' }
}

const TOOLS = [
  {
    name: 'get_breakdown',
    description:
      'Call FIRST. Reads a saved ScriptBreak (.scriptbreak) project on disk and returns the breakdown summary: title, script name, page count (in industry 1/8ths), scene count, INT/EXT and day/night tallies, unique character & location counts, per-category element totals, shot count, the character/location/prop bible sizes, the PROJECT LOOK fields that are filled, and the list of supported prompt-pack generators. Conventions: ScriptBreak\'s breakdown (scene parsing, auto-tagging, bibles, coverage) is produced by the desktop app; this server operates on the ALREADY-SAVED project and does not re-parse raw screenplays. Elements are grouped by category (cast is auto from dialogue; then extras, props, setdress, wardrobe, makeup, vehicles, animals, stunts, vfx, sfx, sound, equipment, plus any custom categories). Each scene carries a number (e.g. "1", "50A"), slugline, INT/EXT, location, time of day, page length in 1/8ths, the characters present, tagged elements by category, and a shot list. export_prompt_pack reproduces ScriptBreak\'s own prompt packs from this data.',
    inputSchema: { type: 'object', properties: { projectPath: PROJECT_PATH_FIELD }, additionalProperties: false }
  },
  {
    name: 'list_scenes',
    description: 'List the scenes with number, slugline, INT/EXT, location, time of day + day/night bucket, page length (1/8ths and decimal pages), the characters present, shot count, and tagged-element count. Optionally filter by scene range, page range, INT/EXT, day/night, character, or location (same scope selectors as the app\'s export scope bar).',
    inputSchema: {
      type: 'object',
      properties: { projectPath: PROJECT_PATH_FIELD, ...SCOPE_FIELDS },
      additionalProperties: false
    }
  },
  {
    name: 'get_scene',
    description: 'Return the full detail of one scene by its scene number (e.g. "12" or "50A"): slugline and its parsed parts (intExt, master, sub, area, time of day), page length, synopsis, the full script text, characters present, all tagged elements grouped by category, and the complete shot list (each shot\'s number, size, angle, movement, lens, description).',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: PROJECT_PATH_FIELD,
        scene: { type: 'string', description: 'Scene number as shown in the breakdown, e.g. "12" or "50A".' }
      },
      required: ['scene'],
      additionalProperties: false
    }
  },
  {
    name: 'list_elements',
    description: 'List tagged production elements. Without a category, returns every non-cast category with its elements and, for each element, the scene numbers it appears in. With a category (e.g. "props", "vehicles", "vfx", "wardrobe"), returns just that category. Element names are the exact strings the app stores.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: PROJECT_PATH_FIELD,
        category: { type: 'string', description: 'Optional category key: extras, props, setdress, wardrobe, makeup, vehicles, animals, stunts, vfx, sfx, sound, equipment (or a custom category key). Omit for all categories.' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'get_character_bible',
    description: 'Return the character bible: for each character, the canonical description ScriptBreak seeded/edited and whether it was auto-generated. Optionally pass name for a single character.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: PROJECT_PATH_FIELD,
        name: { type: 'string', description: 'Optional exact character name. Omit to return the whole bible.' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'get_location_bible',
    description: 'Return the location bible: for each master location, the canonical description and whether it was auto-generated. Optionally pass name for a single location. (Prop bible entries are included in get_breakdown counts and in export_prompt_pack output.)',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: PROJECT_PATH_FIELD,
        name: { type: 'string', description: 'Optional exact location name. Omit to return the whole bible.' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'get_shot_list',
    description: 'Return the shot list, grouped by scene, with each shot\'s number, size, angle, movement, lens, and description (the same fields ScriptBreak\'s shot-list CSV exports). Optionally scope to a scene range, page range, or filters.',
    inputSchema: {
      type: 'object',
      properties: { projectPath: PROJECT_PATH_FIELD, ...SCOPE_FIELDS },
      additionalProperties: false
    }
  },
  {
    name: 'list_generators',
    description: 'List the prompt-pack targets this server can export: video generators (Veo 3, Runway, Kling, ComfyUI, Wan 2.2, LTX 2.3, Seedance, generic), still-image generators (GPT Image 2, Nano Banana Pro, Krea 2, Seedream, Midjourney, generic), and the two non-generator packs (coverage consult, script companion). Use a returned key as the generator argument to export_prompt_pack.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'export_prompt_pack',
    description: 'Reproduce one of ScriptBreak\'s own prompt-pack exports as markdown, for a chosen generator and scope, returning the pack text. A video generator (veo3/runway/kling/comfyui/wan22/ltx23/seedance/generic) yields the AI Video Prompt Pack; a still generator (gptimage2/nanobanana/krea2/seedream/midjourney/genericimg) yields the Storyboard / Concept Frame Prompt Pack; "coverage" yields the Coverage Consult and "companion" the Script Companion. The output embeds the PROJECT LOOK, character/location/prop bibles, the per-generator PLATFORM STYLE GUIDE, and the scene-by-scene shots — identical to what the desktop app writes. Scope selectors mirror the app\'s export scope bar.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: PROJECT_PATH_FIELD,
        generator: { type: 'string', enum: ALL_GENERATORS, description: 'Target key from list_generators. Video, still, or "coverage"/"companion".' },
        ...SCOPE_FIELDS
      },
      required: ['generator'],
      additionalProperties: false
    }
  },
  {
    name: 'get_schedule',
    description:
      'Reproduce ScriptBreak\'s suggested SHOOTING SCHEDULE (draft stripboard): scenes grouped into synthetic shoot days by master location, then lighting regime (DAY / dusk-dawn "MAGIC" / NIGHT), then INT vs EXT, then scene number, and split under a page budget (default 5 pages/day, ±1 page tolerance; one location per day). Returns the ordered day list — each with location, INT/EXT, day/night, scene numbers, page eighths, and the cast IDs working that day — plus the cast key and a byte-identical `csv` of the same table (matching the desktop app). IMPORTANT: cast presence is inferred from DIALOGUE CUES ONLY, so silent/background cast are not detected, and page counts may be estimated — this is a starting point for a 1st AD, not a locked schedule (see the `caveat` field). Scope selectors mirror the app\'s export scope bar; a partial scope yields a partial schedule.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: PROJECT_PATH_FIELD,
        pagesPerDay: { type: 'number', description: 'Target page budget per shoot day (default 5). Days are split when they exceed this by more than ~1 page.' },
        ...SCOPE_FIELDS
      },
      additionalProperties: false
    }
  },
  {
    name: 'get_day_out_of_days',
    description:
      'Reproduce ScriptBreak\'s cast DAY OUT OF DAYS (DOOD) grid from the same suggested schedule as get_schedule: one row per cast member (numbered by first appearance), one column per shoot day, with standard status codes — SW (Start Work), W (Work), WF (Work Finish), SWF (single-day Start-Work-Finish), H (Hold: carried and paid between a performer\'s first and last day) — plus per-cast Work / Hold / Total(span) day counts. Returns the structured grid and a byte-identical `csv` (matching the desktop app). SAME CAVEAT as get_schedule: cast presence is inferred from DIALOGUE ONLY, so a performer on set with no line in a scene is not counted — the DOOD under-reports who is needed; treat it as a preliminary draft. Accepts the same pagesPerDay and scope selectors as get_schedule.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: PROJECT_PATH_FIELD,
        pagesPerDay: { type: 'number', description: 'Target page budget per shoot day (default 5), matching get_schedule.' },
        ...SCOPE_FIELDS
      },
      additionalProperties: false
    }
  }
]

const TOOL_NAMES = new Set(TOOLS.map((t) => t.name))

/* --------------------------- tool handlers ------------------------------ */

function sceneSummary(S, sc) {
  const elementCount = cats(S).filter((c) => !c.auto).reduce((n, c) => n + (sc.elements[c.k] || []).length, 0)
  return {
    num: sc.num,
    slug: sc.slug,
    intExt: sc.intExt,
    location: sc.master || sc.location || '',
    tod: sc.tod || '',
    todBucket: sc.todBucket || '',
    eighths: sc.eighths || 0,
    pages: eighthsFmt(sc.eighths),
    characters: sc.characters || [],
    shotCount: (sc.shots || []).length,
    elementCount
  }
}

function runTool(name, args) {
  switch (name) {
    case 'get_breakdown': {
      const path = resolveProjectPath(args)
      const { S, meta } = loadProject(path)
      const t = totals(S)
      const elementsByCategory = {}
      for (const c of cats(S)) {
        if (c.auto) continue
        const set = new Set()
        S.scenes.forEach((sc) => (sc.elements[c.k] || []).forEach((x) => set.add(x)))
        if (set.size) elementsByCategory[c.k] = { label: c.label, unique: set.size }
      }
      const lookFilled = Object.entries(S.look).filter(([, v]) => v && String(v).trim()).map(([k]) => k)
      return {
        projectPath: path,
        title: S.title,
        scriptName: S.scriptName || '',
        savedFile: { app: meta.app, version: meta.version, saved: meta.saved, project: meta.project, draft: meta.draft },
        scenes: t.scenes,
        pages: +(t.eighths / 8).toFixed(1),
        pageEighths: t.eighths,
        intExt: { int: t.int, ext: t.ext },
        dayNight: { day: t.day, night: t.night },
        uniqueCharacters: t.chars,
        uniqueLocations: t.locs,
        shots: t.shots,
        elementsByCategory,
        bibles: {
          characters: Object.keys(S.bibles.characters).length,
          locations: Object.keys(S.bibles.locations).length,
          props: Object.keys(S.bibles.props).length
        },
        look: { filled: lookFilled, styleGuide: S.styleGuide ? (S.styleGuide.name || 'attached') : null },
        generators: generatorCatalog()
      }
    }
    case 'list_scenes': {
      const path = resolveProjectPath(args)
      const { S } = loadProject(path)
      const exp = scopeFromArgs(args)
      const scenes = exportScenes(S, exp).map((sc) => sceneSummary(S, sc))
      return { projectPath: path, scope: scopeLabel(S, exp), count: scenes.length, scenes }
    }
    case 'get_scene': {
      const path = resolveProjectPath(args)
      const { S } = loadProject(path)
      const sc = S.scenes.find((s) => String(s.num).toUpperCase() === String(args.scene).toUpperCase())
      if (!sc) { const e = new Error(`No scene numbered "${args.scene}".`); e.userFacing = true; throw e }
      const elements = {}
      for (const c of cats(S)) {
        if (c.auto) continue
        const items = sc.elements[c.k] || []
        if (items.length) elements[c.k] = { label: c.label, items }
      }
      return {
        num: sc.num,
        slug: sc.slug,
        intExt: sc.intExt,
        master: sc.master || '',
        sub: sc.sub || '',
        area: sc.area || '',
        location: sc.master || sc.location || '',
        tod: sc.tod || '',
        todBucket: sc.todBucket || '',
        eighths: sc.eighths || 0,
        pages: eighthsFmt(sc.eighths),
        synopsis: sc.synopsis || '',
        characters: sc.characters || [],
        elements,
        shots: (sc.shots || []).map((sh) => ({
          num: sh.num, size: sh.size || '', angle: sh.angle || '', move: sh.move || '',
          lens: sh.lens || '', desc: sh.desc || '', auto: !!sh.auto
        })),
        text: sc.text || ''
      }
    }
    case 'list_elements': {
      const path = resolveProjectPath(args)
      const { S } = loadProject(path)
      const wanted = cats(S).filter((c) => !c.auto && (!args.category || c.k === args.category))
      if (args.category && !wanted.length) {
        const e = new Error(`Unknown category "${args.category}". Valid: ${cats(S).filter((c) => !c.auto).map((c) => c.k).join(', ')}.`)
        e.userFacing = true; throw e
      }
      const out = {}
      for (const c of wanted) {
        const byName = new Map()
        S.scenes.forEach((sc) => (sc.elements[c.k] || []).forEach((name) => {
          if (!byName.has(name)) byName.set(name, [])
          byName.get(name).push(sc.num)
        }))
        out[c.k] = { label: c.label, elements: [...byName.entries()].map(([name, scenes]) => ({ name, scenes })) }
      }
      return { projectPath: path, categories: out }
    }
    case 'get_character_bible':
    case 'get_location_bible': {
      const path = resolveProjectPath(args)
      const { S } = loadProject(path)
      const type = name === 'get_character_bible' ? 'characters' : 'locations'
      const bible = S.bibles[type] || {}
      if (args.name) {
        const entry = bible[args.name]
        if (!entry) { const e = new Error(`No ${type.slice(0, -1)} bible entry for "${args.name}".`); e.userFacing = true; throw e }
        return { projectPath: path, type, name: args.name, desc: entry.desc || '', auto: !!entry.auto }
      }
      return {
        projectPath: path,
        type,
        count: Object.keys(bible).length,
        entries: Object.entries(bible).map(([n, v]) => ({ name: n, desc: v.desc || '', auto: !!v.auto }))
      }
    }
    case 'get_shot_list': {
      const path = resolveProjectPath(args)
      const { S } = loadProject(path)
      const exp = scopeFromArgs(args)
      const scenes = exportScenes(S, exp)
      let total = 0
      const out = scenes.map((sc) => {
        const shots = (sc.shots || []).map((sh) => ({
          num: sh.num, size: sh.size || '', angle: sh.angle || '', move: sh.move || '',
          lens: sh.lens || '', desc: sh.desc || '', auto: !!sh.auto
        }))
        total += shots.length
        return { scene: sc.num, slug: sc.slug, shots }
      })
      return { projectPath: path, scope: scopeLabel(S, exp), sceneCount: scenes.length, shotCount: total, scenes: out }
    }
    case 'list_generators': {
      return generatorCatalog()
    }
    case 'export_prompt_pack': {
      const path = resolveProjectPath(args)
      const { S } = loadProject(path)
      const exp = scopeFromArgs(args)
      const g = args.generator
      let kind, markdown
      if (VIDEO_GENERATORS.includes(g)) { kind = 'video'; markdown = buildVideoPack(S, exp, g) }
      else if (STILL_GENERATORS.includes(g)) { kind = 'still'; markdown = buildImagePack(S, exp, g) }
      else if (g === 'coverage') { kind = 'coverage'; markdown = buildCoverageConsult(S, exp) }
      else if (g === 'companion') { kind = 'companion'; markdown = buildChatPack(S, exp) }
      else { const e = new Error(`Unknown generator "${g}". Call list_generators.`); e.userFacing = true; throw e }
      const generatorName = PLATFORMS[g]?.name || IMG_PLATFORMS[g]?.name || OTHER_PACKS[g] || g
      return {
        projectPath: path,
        generator: g,
        generatorName,
        kind,
        scope: scopeLabel(S, exp),
        sceneCount: exportScenes(S, exp).length,
        markdown
      }
    }
    case 'get_schedule': {
      const path = resolveProjectPath(args)
      const { S } = loadProject(path)
      const exp = scopeFromArgs(args)
      const opts = { pagesPerDay: args.pagesPerDay || 5 }
      const scenes = exportScenes(S, exp)
      const plan = buildScheduleDays(scenes, opts)
      return {
        projectPath: path,
        scope: scopeLabel(S, exp),
        pagesPerDay: opts.pagesPerDay,
        shootDays: plan.days.length,
        cast: plan.castOrder.map((name) => ({ id: plan.castId[name], name })),
        days: plan.days.map((d) => ({
          day: d.n, location: d.location, intExt: d.ie, dayNight: d.regimeLabel,
          scenes: d.sceneNums, eighths: d.eighths, pages: +(d.eighths / 8).toFixed(2),
          castIds: d.castIds, cast: d.castNames
        })),
        csv: buildScheduleCSV(scenes, opts),
        caveat: SCHED_CAVEAT
      }
    }
    case 'get_day_out_of_days': {
      const path = resolveProjectPath(args)
      const { S } = loadProject(path)
      const exp = scopeFromArgs(args)
      const opts = { pagesPerDay: args.pagesPerDay || 5 }
      const scenes = exportScenes(S, exp)
      const plan = buildScheduleDays(scenes, opts)
      const dood = buildDood(plan)
      return {
        projectPath: path,
        scope: scopeLabel(S, exp),
        pagesPerDay: opts.pagesPerDay,
        shootDays: dood.dayCount,
        legend: { SW: 'Start Work', W: 'Work', WF: 'Work Finish', SWF: 'Start-Work-Finish (single day)', H: 'Hold (carried & paid between first and last day)' },
        cast: dood.cast.map((c) => ({ id: c.id, name: c.name, codes: c.codes, work: c.work, hold: c.hold, total: c.total })),
        csv: buildDoodCSV(scenes, opts),
        caveat: SCHED_CAVEAT
      }
    }
    default: {
      const e = new Error(`Unknown tool: ${name}`)
      e.userFacing = true
      throw e
    }
  }
}

/* ---------------------------- JSON-RPC plumbing ------------------------- */

function write(msg) { process.stdout.write(JSON.stringify(msg) + '\n') }
function reply(id, result) { write({ jsonrpc: '2.0', id, result }) }
function replyError(id, code, message) { write({ jsonrpc: '2.0', id, error: { code, message } }) }

function handleToolCall(id, params) {
  const name = params?.name
  const args = params?.arguments ?? {}
  if (!TOOL_NAMES.has(name)) {
    reply(id, { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true })
    return
  }
  try {
    const result = runTool(name, args)
    reply(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] })
  } catch (error) {
    reply(id, { content: [{ type: 'text', text: error.userFacing ? error.message : `Error: ${error.message}` }], isError: true })
  }
}

function handle(msg) {
  const { id, method, params } = msg
  switch (method) {
    case 'initialize':
      reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'scriptbreak', version: '1.0.0' }
      })
      return
    case 'notifications/initialized':
      return
    case 'tools/list':
      reply(id, { tools: TOOLS })
      return
    case 'tools/call':
      handleToolCall(id, params)
      return
    case 'ping':
      reply(id, {})
      return
    default:
      if (id !== undefined && id !== null) replyError(id, -32601, `Method not found: ${method}`)
      return
  }
}

/* ------------------------------- stdin loop ----------------------------- */

let buffer = ''
process.stdin.setEncoding('utf-8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let idx
  while ((idx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, idx).trim()
    buffer = buffer.slice(idx + 1)
    if (!line) continue
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      continue
    }
    handle(msg)
  }
})
process.stdin.on('end', () => process.exit(0))
