# Slicer Lab — a teaching slicer & 3D-printing simulator

Slicer Lab lets students see every step between a 3D model and a printed part — with **realistic
numbers** for two real printers, the **Prusa i3 MK3S+** and the **Creality Ender-3** (machine limits,
speeds, start/end G-code and materials from the official PrusaSlicer profiles). Print-time
estimates match PrusaSlicer's firmware-based estimator within 0.1 %; see [VALIDATION.md](VALIDATION.md).

1. **Prepare** – load a model (12 built-in teaching models, or STL / OBJ / 3MF files), scale/rotate/move it,
   see its overhangs, and drag a cutting plane through it to see what "slicing" means.
2. **Preview** – inspect the sliced result layer by layer, coloured by feature, speed, layer time or
   "printed over air?"; step through the moves of a layer in the 2D layer inspector; see where the
   print time and plastic go; read the automatic checks (thin walls lost, overhangs without support,
   short layer times, wrong temperatures…).
3. **Simulate** – a virtual printer runs the G-code: heat-up waits, homing, bed levelling, purge line,
   the nozzle accelerating and slowing down at corners like the real firmware plans it, temperatures,
   fan, the current G-code line explained in plain words.
   Lines printed in mid-air **sag**, so students see why supports exist.
4. **G-code** – read, search, edit and re-simulate the G-code; click any line for an explanation;
   import G-code from other slicers (Cura, PrusaSlicer, Orca/Bambu comments are understood).

Every setting has an **i** button explaining what it does. **Lessons** (top right) are eleven guided
lessons with "Try it" buttons and questions to think about:

1. What is slicing? · 2. Layer height · 3. Walls, infill & top layers · 4. Overhangs & support ·
5. Bridges · 6. Reading G-code · 7. Travel, retraction & seams · 8. First layer & adhesion ·
9. Thin walls & nozzle size · 10. Cooling & minimum layer time · 11. Why does it take so long?
(acceleration, jerk, flow limits, heating)

### What the time estimate includes

- **Moving**: every move planned like the printer firmware (per-axis speed and acceleration
  limits, jerk at corners, look-ahead). This is what slicers call "estimated printing time".
- **Heating**: the waits for the bed (M190) and nozzle (M109), from a heater model of the printer.
- **Homing and bed levelling** (G28, G80/G29) and dwell (G4).

When you import G-code from another slicer, the app shows the slicer's own estimate next to its
own, and warns about printer macros it cannot simulate. Choose the matching printer first.

## Using it in class

**No installation needed:** `dist/index.html` is one self-contained file. Copy it to the students'
computers, a USB stick or a shared drive and open it in Chrome, Edge or Firefox — it works offline.
It can also be put on any web server.

Settings are remembered per browser. *Reset* in the settings panel restores the defaults.

## Developing

Requires Node.js 18+.

```bash
npm install
npm run dev      # development server with live reload
npm test         # planner + PrusaSlicer reference tests, then every model on both printers
npm run build    # writes the single-file app to dist/index.html
```

### How the code is organised

```
src/core/          pure JavaScript, no browser needed (tested by test/core.test.js)
  mesh.js            STL/OBJ/3MF reading, STL writing, welding, transforms, overhang angles
  printers.js        the MK3S+ and Ender-3 profiles and the material table (sources in VALIDATION.md)
  planner.js         firmware motion planner: time of every move
  primitives.js      built-in teaching models
  clip.js            polygon offsets & booleans (Clipper library)
  slicer.js          mesh → layers → islands → walls / skin / infill / support → ordered paths
  infill.js          infill patterns (lines, grid, triangles, gyroid, concentric)
  gcodeWriter.js     paths → Marlin G-code (retraction, combing, cooling slow-down, comments)
  gcodeParser.js     G-code → timed moves (planner, heater model, homing, arcs, other slicers' dialects)
  analysis.js        "is this line resting on anything?" → over-air detection and sag
  settings.js        all settings, presets and their explanations
src/worker.js      runs slicing off the main thread
src/view/          Three.js: scene & model, toolpath mesh, printer head
src/ui/            settings panel, layer inspector, charts, G-code viewer & docs, lessons
```

The design document with requirements and architecture is in [PLAN.md](PLAN.md).

**Adding a lesson:** append an entry to `LESSONS` in `src/ui/lessons.js`. Each step has HTML text,
optional "Try it" actions (small functions that call the app: `loadSample`, `setSettings`,
`setMode`, `setLayer`, `setColorMode`, `simSeek`, `simPlay`…) and an optional question.

**Adding a built-in model:** append to `SAMPLES` in `src/core/primitives.js`.

## Accuracy and limits

See [VALIDATION.md](VALIDATION.md) for the sources of all printer data and the comparison with
PrusaSlicer. In short:

- The **moving time** of a G-code file matches PrusaSlicer's estimator within 0.1 %, and filament use
  matches exactly. The G-code written by Slicer Lab's own slicer is within about ±10 % of
  PrusaSlicer's for the same model and settings.
- **Heating and homing times** are typical values for each printer, not measurements of yours.
- The **sagging** of lines printed over air is a rule of thumb that shows where problems are.
  Warping, curling, stringing and layer adhesion are not simulated.
- The slicer has no raft, ironing, variable layer height, tree supports, gap fill or variable-width
  walls; supports are line supports with a dense roof.
- The generated G-code uses the real start/end sequences of the two printers, but it is made for
  learning: check it before sending it to a printer.

To compare with PrusaSlicer yourself: `node test/compare-prusaslicer.js <folder>` (instructions in
the script).

## Licence and credits

Slicer Lab is free software, licensed under the **GNU Affero General Public License v3.0 or later**
([LICENSE](LICENSE)). You may use, study, change and share it, also in class. If you share a changed
version or run it as a website for others, you must publish its source code under the same licence.

Copyright © 2026 The Slicer Lab authors. Source code: <https://github.com/MohammadrezaConstructor/slicer>

It builds on the work of others — full details and licence texts in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md):

- **PrusaSlicer** (AGPL-3.0, © Prusa Research and contributors; Slic3r © Alessandro Ranellucci) —
  the print-time estimator (`src/core/planner.js`) is derived from PrusaSlicer's `GCodeProcessor`;
  the cooling slow-down and the line-spacing formula follow PrusaSlicer.
- **Marlin** and **Grbl** (GPL-3.0) — origin of the motion-planning algorithm.
- **PrusaSlicer system profiles** — machine limits, print settings, start/end G-code and material
  data of the Prusa i3 MK3S+ and Creality Ender-3.
- **three.js** (MIT) — 3D graphics. **Clipper** by Angus Johnson, JavaScript translation by Timo
  (Boost Software License 1.0) — polygon operations.
- **3DPrinterly** — heated-bed measurements used to calibrate the heater model.

The app shows the licence and these credits under "About & licence" in the status bar.

**Trademarks.** Prusa, Original Prusa, PrusaSlicer and Prusament are trademarks of Prusa Research a.s.;
Creality and Ender are trademarks of Shenzhen Creality 3D Technology Co., Ltd.; other names are
trademarks of their respective owners. They are used only to identify the printers and programs.
Slicer Lab is not affiliated with or endorsed by these companies. The printers in the simulator are
simplified models built from basic shapes; no manufacturer drawings, CAD files or logos are used.
