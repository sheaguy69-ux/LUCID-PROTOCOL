---
name: capcut-asset-pipeline
description: Generate assets for CapCut video editing — custom .cube LUTs for color grading, .srt files for rapid number-counter / typewriter text effects, and Remotion-rendered motion graphics (animated UI lists, typing search bars, highlight effects, 3D maps) exported as transparent-background video overlays. Use when the user mentions CapCut, color grading, LUTs, animated counters, motion graphics overlays, Remotion, or wants programmatic video assets they can drop into a video editor timeline.
---

# CapCut Asset Pipeline

This skill produces drop-in assets for CapCut. CapCut itself has no API — the workflow is: generate the asset here, the user imports the file into CapCut.

## Step 1: Identify the asset type

Ask the user which asset they want (or infer it from the request). The three supported types:

| Type | Output | Use in CapCut |
|------|--------|---------------|
| **LUT** | `.cube` file | Drag onto Adjustment layer above footage |
| **SRT counter / typewriter** | `.srt` file | Import as subtitles, restyle, Compound Clip, speed up |
| **Motion graphic overlay** | `.mp4` or `.mov` with alpha | Drop onto overlay track above footage |

If unclear, ask once with `AskUserQuestion` and proceed.

---

## Type A: Custom LUT (.cube)

A `.cube` LUT is a plain-text 3D color lookup table. Standard sizes: 17, 33, or 65 cubed.

### Procedure

1. Ask the user for the **look** they want in plain English (e.g. "teal & orange cinematic", "faded film", "vintage warm", "moody desaturated blue").
2. Write a small Python or Node script that:
   - Generates a 33x33x33 LUT
   - Applies the requested transformation in RGB or HSL space (lift/gamma/gain, hue shift, saturation curve, channel mixing)
   - Outputs in the standard `.cube` format
3. Save the output as `assets/luts/<descriptive-name>.cube` and run the script.
4. Verify the file header is correct:
   ```
   TITLE "name"
   LUT_3D_SIZE 33
   DOMAIN_MIN 0.0 0.0 0.0
   DOMAIN_MAX 1.0 1.0 1.0
   <RGB triplets, one per line, in B-fastest order>
   ```
5. Tell the user where the file is and how to import it: **CapCut → Adjustment → Import LUT → drop on overlay track above footage**.

### Tips
- Keep transformations physically plausible — clamp to [0,1].
- Offer to generate 2–3 variants if the first look isn't quite right.

---

## Type B: SRT counter / typewriter (.srt)

CapCut imports `.srt` as a stack of subtitle clips on a single track. This is exploitable for rapid sequenced text.

### Procedure

1. Ask for:
   - Start and end value (e.g. `$0` to `$535`, `0` to `100`, custom strings)
   - Per-frame duration (default `0.1s` = 10 fps perceived; speed-ramped later in CapCut)
   - Format string (e.g. `${n}`, `{n}%`, plain `{n}`)
2. Generate an `.srt` file where each subtitle block lasts exactly that duration, sequenced back-to-back starting at `00:00:00,000`.
3. Standard SRT format:
   ```
   1
   00:00:00,000 --> 00:00:00,100
   $0

   2
   00:00:00,100 --> 00:00:00,200
   $1
   ```
4. Save to `assets/srt/<name>.srt`.
5. Tell the user the CapCut steps:
   1. Import the `.srt` via Captions panel.
   2. Select all subtitle blocks → restyle font, color, size simultaneously.
   3. Right-click → **Compound Clip**.
   4. Apply **Speed** (e.g. 10x) to compress to the final pacing.

### Tips
- For non-monotonic sequences (random, fibonacci, easing curves) just script the value list.
- For typewriter effects, emit progressive substrings of the target string.

---

## Type C: Remotion motion graphic (transparent-background video)

For UI animations, typing search bars, highlight effects, animated lists, 3D maps, etc.

### Procedure

1. Ask the user for:
   - The animation concept (or a reference image — Pinterest layout, screenshot, sketch)
   - Resolution (default 1920x1080) and duration (default 5s @ 30fps)
2. If a reference image is provided, **Read** it first to understand the layout.
3. Scaffold a Remotion project at `assets/remotion/<name>/` if one doesn't exist yet:
   ```bash
   npx create-video@latest --blank <name>
   ```
   Or, if already scaffolded, reuse it and add a new composition.
4. Build the composition as a React component using `remotion`'s `useCurrentFrame`, `interpolate`, `spring`, and `Sequence` primitives. Match the reference image's layout, colors, and typography.
5. **Critical**: render with transparent background. In the `Composition` set no background color, and render with:
   ```bash
   npx remotion render src/index.ts <CompositionId> out/<name>.mov \
     --codec=prores \
     --prores-profile=4444 \
     --pixel-format=yuva444p10le
   ```
   ProRes 4444 preserves alpha. Alternative for smaller files: `--codec=vp8` or `vp9` with `webm`.
6. After render, tell the user:
   - Where the output file is
   - **CapCut step**: drag the `.mov` onto an overlay track above the main footage. Alpha is preserved automatically; no chroma key needed.

### Tips
- Default to ProRes 4444 `.mov` — CapCut handles it cleanly.
- Keep the Remotion compositions modular: one file per effect so the user can mix-and-match later.
- If the user iterates ("make the highlight slower"), edit the component and re-render, don't restart from scratch.
- Use `npx remotion preview` to let the user preview in the browser before committing to a render.

---

## General notes

- Always save assets under `assets/<luts|srt|remotion>/` and `.gitignore` the heavy render outputs if the user wants — ask before committing large `.mov` files.
- After producing any asset, finish with a one-line summary: file path + the exact CapCut import action.
- If the user asks for something outside these three categories (e.g. ffmpeg-only batch resizing, audio normalization), say so — that's a different workflow, not this skill.
