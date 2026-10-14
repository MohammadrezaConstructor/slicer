# Slicer Lab — a teaching slicer & 3D-printing simulator

Slicer Lab lets students see every step between a 3D model and a printed part:

1. **Prepare** – load a model (12 built-in teaching models, or any STL), scale/rotate/move it,
   see its overhangs, and drag a cutting plane through it to see what "slicing" means.
2. **Preview** – inspect the sliced result layer by layer, coloured by feature, speed, layer time or
   "printed over air?"; step through the moves of a layer in the 2D layer inspector; see where the
   print time and plastic go; read the automatic checks (thin walls lost, overhangs without support,
   short layer times, wrong temperatures…).
3. **Simulate** – a virtual printer runs the G-code: heat-up waits, homing, prime line, the nozzle
   moving and plastic appearing, temperatures, fan, the current G-code line explained in plain words.
   Lines printed in mid-air **sag**, so students see why supports exist.
4. **G-code** – read, search, edit and re-simulate the G-code; click any line for an explanation;
   import G-code from other slicers (Cura, PrusaSlicer, Orca/Bambu comments are understood).

Every setting has an **i** button explaining what it does. **Lessons** (top right) are ten guided
lessons with "Try it" buttons and questions to think about:

1. What is slicing? · 2. Layer height · 3. Walls, infill & top layers · 4. Overhangs & support ·
5. Bridges · 6. Reading G-code · 7. Travel, retraction & seams · 8. First layer & adhesion ·
9. Thin walls & nozzle size · 10. Cooling & minimum layer time

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
npm test         # slices every built-in model in Node and checks the results
npm run build    # writes the single-file app to dist/index.html
```

### How the code is organised

```
src/core/          pure JavaScript, no browser needed (tested by test/core.test.js)
  mesh.js            STL reading/writing, welding, transforms, overhang angles
  primitives.js      built-in teaching models
  clip.js            polygon offsets & booleans (Clipper library)
  slicer.js          mesh → layers → islands → walls / skin / infill / support → ordered paths
  infill.js          infill patterns (lines, grid, triangles, gyroid, concentric)
  gcodeWriter.js     paths → Marlin G-code (retraction, combing, cooling slow-down, comments)
  gcodeParser.js     G-code → timed moves (acceleration, heater model, arcs, other slicers' dialects)
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

## Simplifications (worth discussing with students)

Slicer Lab is built to explain, not to drive a real printer. Things it simplifies:

- **Physics** of sagging is a rule of thumb: a line may stick out ¼ line width past the layer
  below; beyond that it is "over air". Bridges sag a little, cantilevers a lot. Warping, curling,
  stringing and layer adhesion are not simulated.
- **Print time** uses a simple acceleration model (no look-ahead), so it is close to, but not the
  same as, a real printer's.
- **Heating** uses constant heating/cooling rates.
- The slicer has no raft, ironing, variable layer height, tree supports, gap fill, or connected
  infill lines; supports are simple line supports with a dense roof.
- G-code is generic Marlin style; do not send it to a real printer without checking the start/end
  code for your machine.
