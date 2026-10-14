# Slicer & 3D-Printing Simulator — Plan

A teaching tool: students load (or pick) a 3D model, change slicer settings, slice it,
inspect the result layer by layer, read the generated G-code and watch a simulated
printer build the part — including what goes wrong when settings are bad.

## 1. Who uses it and how

| User | Needs |
|---|---|
| Student | Zero install (runs in a browser), clear explanations next to every setting, immediate visual feedback, safe to experiment |
| Teacher | Ready-made test models (overhangs, bridges, thin walls…), guided lessons, works offline in a classroom, one file to distribute |

**Decision:** a browser app (Three.js + JavaScript), built with Vite into a **single
self-contained HTML file** (`dist/index.html`) that works offline by double-clicking.
Slicing runs in a Web Worker so the UI stays responsive.

## 2. Functional requirements

### 2.1 Prepare (model)
- Load STL (binary + ASCII) by button or drag-and-drop.
- Built-in teaching models: calibration cube, cylinder, sphere, cone, overhang test,
  bridge test, hollow box, arch, T-shape (needs support), torus, thin-wall test.
- Place on bed: auto-center, drop to bed, scale (%), rotate 90° about X/Y/Z, uniform size.
- Show build volume; warn if the model does not fit.
- Overhang visualisation: colour faces whose angle exceeds the support threshold.
- "How slicing works" cut-plane: drag a Z slider, see the model cut and the cross-section contour.
- Model info: size, volume, triangle count.

### 2.2 Slicer engine
Pipeline (each stage explained in the app):
1. **Mesh → layers:** intersect triangles with horizontal planes (mid-layer), chain segments into closed loops.
2. **Loops → regions:** union with non-zero winding → islands with holes (Clipper library).
3. **Walls (perimeters):** inward offsets by line width; outer wall first or last.
4. **Top/bottom skin:** area not covered by N layers above/below → solid infill.
5. **Sparse infill:** pattern clipped to inner area — lines, grid, triangles, concentric, gyroid; density %.
6. **Supports:** overhang detection by angle, top-down propagation, XY/Z gaps, "everywhere" vs "build plate only".
7. **Adhesion:** skirt or brim.
8. **Path planning:** nearest-neighbour ordering, seam position (nearest/aligned/random), combing to avoid retractions inside the part.
9. **G-code:** start/end code, temperatures, fan, retraction, extrusion amount from volume, per-feature speeds, minimum layer time slowdown, `;TYPE:` / `;LAYER:` comments.
10. **Estimates:** print time (with acceleration), filament length/weight/cost.

### 2.3 Settings (each with a "what does it do" explanation)
Printer (bed size, nozzle Ø, filament Ø), material presets (PLA/PETG/ABS/TPU),
quality (layer height, first layer height, line width), walls, top/bottom layers,
infill (density, pattern), speeds, travel/retraction, cooling (fan, min layer time),
supports, adhesion. Beginner/Expert view.

### 2.4 Preview
- Layer slider; show all layers up to N or only layer N.
- Colour by: feature type, speed, layer time, "overhang risk" (printed-over-air).
- Toggle travel moves.
- 2D layer inspector: top-down drawing of the layer, step through moves in order.
- Statistics + warnings (doesn't fit, thin walls lost, unsupported extrusions, short layer times).

### 2.5 Print simulation
- Driven by parsed G-code (so edited or imported G-code also simulates).
- Animated nozzle + gantry, plastic appears along the path.
- Play / pause / speed (1×…2000×) / scrub timeline / jump to layer.
- Live readouts: position, layer, feature, feed rate, nozzle/bed temperature (with simulated
  heat-up during M109/M190), fan, elapsed / remaining time.
- Current G-code line highlighted with a plain-language explanation.
- **Physics-lite failure mode:** extrusions printed over air sag in proportion to the distance from support
  and are highlighted, so students see why supports exist.

### 2.6 G-code view
- Full G-code listing; hover/select a line to see what each command means.
- Edit G-code and re-simulate; import external G-code (Cura/PrusaSlicer comments understood).
- Download G-code.

### 2.7 Lessons
Guided lessons that set up the app (load model, change settings) and tell students what to observe:
1. What is slicing? 2. Layer height & time. 3. Walls & infill strength. 4. Overhangs & supports.
5. Bridges. 6. Reading G-code. 7. Retraction & travel. 8. First layer & adhesion.

## 3. Non-functional
- Offline, single HTML file; also runs via `npm run dev`.
- Slices typical classroom models (< 200k triangles) in seconds.
- Renders up to ~1M extrusion segments (falls back to lines above that).
- Readable, commented code organised by pipeline stage so advanced students can read it.

## 4. Architecture

```
src/
  core/            pure JS, no DOM — testable in Node
    mesh.js          STL parsing, welding, transforms, bbox, volume, overhang
    primitives.js    built-in teaching models
    clip.js          Clipper wrappers (offset, boolean, open-path clipping)
    slicer.js        mesh → layers → islands → walls/skin/infill/support → paths
    infill.js        infill pattern generators
    gcodeWriter.js   paths → G-code text (+ estimates)
    gcodeParser.js   G-code text → typed move arrays + timeline + heater model
    analysis.js      per-layer occupancy grid → over-air detection / sag
    settings.js      settings schema, defaults, presets, explanations
  worker.js        runs slicer + writer in a Web Worker
  view/
    scene.js         Three.js scene, bed, build volume, camera, controls
    printMesh.js     extrusion bead geometry (preview + simulation), travel lines
    printer.js       nozzle/gantry model
  ui/
    app.js           state, wiring, modes
    settingsPanel.js settings form with info popovers
    simPanel.js      simulator controls & readouts
    gcodePanel.js    G-code viewer/editor with explanations
    layerInspector.js 2D layer canvas
    lessons.js       lesson content + actions
    gcodeDocs.js     G/M-code dictionary
  main.js, style.css
```

Data flow: `Model (mesh) → [worker] slice → G-code text → parse → moves → render / simulate / analyse`.

## 5. Build steps
1. Project scaffold (Vite, three, clipper-lib, single-file build).
2. Core geometry: STL, primitives, mesh utils.
3. Slicer core + Node test script on primitives.
4. G-code writer + parser + estimates; Node test.
5. Analysis (over-air detection).
6. 3D scene, model display, overhang colouring, cut-plane.
7. Preview geometry, layer slider, colour modes.
8. Simulator.
9. UI panels: settings, stats/warnings, G-code, layer inspector.
10. Lessons.
11. Build single-file bundle, test in browser, write README.
