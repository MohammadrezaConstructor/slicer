// Guided lessons. Each step explains one idea, offers "Try it" buttons that set up the app,
// and asks a question to think about. Written for students who are new to 3D printing.

const $ = (id) => document.getElementById(id);

/** Tick or untick a checkbox in the UI and fire its change event. */
function check(id, value) {
  const el = $(id);
  if (el && el.checked !== value) {
    el.checked = value;
    el.dispatchEvent(new Event('change'));
  }
}

function seekLayer(app, li) {
  const P = app.result.parsed;
  const L = P.layers[Math.min(li, P.layers.length - 1)];
  app.simSeek(P.t0[L.firstExtrusion >= 0 ? L.firstExtrusion : L.first]);
}

const BASE = { support: false, adhesion: 'skirt', layerHeight: 0.2, firstLayerHeight: 0.25, wallCount: 2, topLayers: 4, bottomLayers: 3, infillDensity: 20, infillPattern: 'grid', retraction: true, combing: true, seam: 'aligned', fanSpeed: 100, minLayerTime: 8, nozzle: 0.4, lineWidth: 0.42, supportRoofLayers: 2, material: 'PLA', nozzleTemp: 210, bedTemp: 60 };

export const LESSONS = [
  {
    id: 'intro',
    title: '1. What is slicing?',
    summary: 'From a 3D model to instructions a printer understands.',
    steps: [
      {
        title: 'The journey of a 3D print',
        html: `<p>A 3D printer cannot read a 3D model. It only understands very simple instructions such as <i>"move to X=10, Y=20 while pushing 0.5 mm of plastic"</i>. These instructions are called <b>G-code</b>.</p>
          <p>The <b>slicer</b> translates the model into G-code. This app follows the same four steps as a real slicer — see the buttons at the top: <b>1 Prepare → 2 Preview → 3 Simulate → 4 G-code</b>.</p>
          <p>A model file (STL) is just a list of triangles describing the surface. Let's load the most famous first print.</p>`,
        actions: [{ label: 'Load the calibration cube', run: (app) => { app.setSettings(BASE); app.loadSample('cube'); app.setMode('prepare'); } }],
      },
      {
        title: 'Cutting the model into layers',
        html: `<p>The printer builds the part one thin layer at a time, from the bottom up. So the slicer first <b>cuts</b> the model with many horizontal planes, one per layer.</p>
          <p>Switch on the cutting plane and drag the slider in the right panel. The blue shape is what one layer looks like.</p>`,
        actions: [{ label: 'Show the cutting plane', run: (app) => { app.setMode('prepare'); check('show-cut', true); } }],
        think: 'The cube is 20 mm tall and every layer is 0.2 mm thick. How many layers will the printer need? Check your answer under the slider.',
      },
      {
        title: 'From outlines to paths',
        html: `<p>Each outline is turned into <b>paths for the nozzle</b>:</p>
          <ul><li><b>Walls</b> (outer and inner): loops that follow the outline. They give the part its strength and its look.</li>
          <li><b>Infill</b>: a pattern that fills the inside partly, saving plastic and time.</li>
          <li><b>Top/bottom skin</b>: solid layers that close the part at the bottom and top.</li></ul>
          <p>Slice the model and drag the <b>layer slider</b> on the right of the 3D view (or use the ↑/↓ keys).</p>`,
        actions: [{ label: 'Slice & preview', run: (app) => app.setMode('preview') }],
        goal: 'mode:preview',
        think: 'Why are the bottom and top layers solid, while the layers in the middle are mostly empty?',
      },
      {
        title: 'In which order does the nozzle move?',
        html: `<p>The <b>layer inspector</b> in the right panel draws one layer from above. Press ▶ to watch the order in which the nozzle visits everything. Dashed blue lines are <b>travel moves</b>: the nozzle moves without printing.</p>`,
        actions: [{ label: 'Go to layer 50', run: (app) => { app.setMode('preview'); app.setLayer(49); } }],
        think: 'The walls are printed before the infill. Why might that be a good idea?',
      },
      {
        title: 'Watch it print',
        html: `<p>Now let the virtual printer run the G-code. Look at the thermometers: at the start the printer <b>waits</b> for the bed and the nozzle to heat up. Then it homes, draws a prime line at the front, and starts the first layer.</p>`,
        actions: [{ label: 'Simulate at 60×', run: (app) => { app.setMode('simulate').then(() => { app.sim.speed = 60; $('sim-speed').value = '60'; app.simSeek(0); app.simPlay(true); }); } }],
        goal: 'sim:play',
        think: 'Why must the printer wait for the temperatures before it starts? What would happen if it did not?',
      },
    ],
  },
  {
    id: 'layers',
    title: '2. Layer height: quality vs. time',
    summary: 'The most important trade-off in 3D printing.',
    steps: [
      {
        title: 'A sphere at 0.2 mm',
        html: `<p>Load the sphere and look at the <b>print time</b> in the status bar at the bottom. Write it down.</p>`,
        actions: [{ label: 'Sphere, 0.2 mm layers', run: (app) => { app.setSettings({ ...BASE, layerHeight: 0.2, firstLayerHeight: 0.25 }); app.loadSample('sphere'); app.setMode('preview'); } }],
      },
      {
        title: 'Thicker and thinner layers',
        html: `<p>Now try thick 0.3 mm layers and thin 0.1 mm layers. Compare the print time and the number of layers each time.</p>`,
        actions: [
          { label: '0.3 mm layers', run: (app) => { app.setSettings({ layerHeight: 0.3, firstLayerHeight: 0.3 }); app.showSetting('layerHeight'); app.setMode('preview'); } },
          { label: '0.1 mm layers', run: (app) => { app.setSettings({ layerHeight: 0.1, firstLayerHeight: 0.2 }); app.showSetting('layerHeight'); app.setMode('preview'); } },
        ],
        think: 'Halving the layer height roughly doubles the print time. Why?',
      },
      {
        title: 'The staircase effect',
        html: `<p>Zoom in on the upper part of the sphere with the mouse wheel. Every layer is a flat slice with vertical sides, so a curved surface becomes a <b>staircase</b>. Compare 0.3 mm and 0.1 mm layers.</p>`,
        actions: [
          { label: '0.3 mm layers', run: (app) => { app.setSettings({ layerHeight: 0.3, firstLayerHeight: 0.3 }); app.setMode('preview'); } },
          { label: '0.1 mm layers', run: (app) => { app.setSettings({ layerHeight: 0.1, firstLayerHeight: 0.2 }); app.setMode('preview'); } },
        ],
        think: 'Where on the sphere is the staircase most visible: at the sides (vertical) or near the top (almost flat)? Why?',
      },
    ],
  },
  {
    id: 'strength',
    title: '3. Walls, infill & top layers',
    summary: 'What is inside a 3D print — and what makes it strong.',
    steps: [
      {
        title: 'Walls',
        html: `<p>Look at a single layer of the cube from the top. Change the number of walls between 1 and 4.</p>`,
        actions: [
          { label: '1 wall', run: (app) => { app.setSettings({ ...BASE, wallCount: 1 }); app.loadSample('cube'); app.setMode('preview').then(() => { check('pv-single', true); app.setLayer(50); app.scene.viewTop(); }); } },
          { label: '4 walls', run: (app) => { app.setSettings({ wallCount: 4 }); app.showSetting('wallCount'); app.setMode('preview'); } },
        ],
        think: 'Each wall is the outline shrunk inward by one line width (0.42 mm). How thick is the shell with 4 walls?',
      },
      {
        title: 'Infill density',
        html: `<p>Try 0 %, 20 % and 100 % infill. Watch the print time, the weight and the "Where do time & plastic go?" chart.</p>`,
        actions: [
          { label: '0 %', run: (app) => { app.setSettings({ infillDensity: 0, wallCount: 2 }); app.showSetting('infillDensity'); app.setMode('preview'); } },
          { label: '20 %', run: (app) => { app.setSettings({ infillDensity: 20, wallCount: 2 }); app.setMode('preview'); } },
          { label: '100 %', run: (app) => { app.setSettings({ infillDensity: 100, wallCount: 2 }); app.setMode('preview'); } },
        ],
        think: 'A solid part uses much more plastic but is not much stronger in bending. Where is most of the stress in a bent beam: at the surface or in the middle?',
      },
      {
        title: 'Infill patterns',
        html: `<p>Infill can have different shapes. Compare them in the layer inspector and in 3D.</p>`,
        actions: ['lines', 'grid', 'triangles', 'gyroid', 'concentric'].map((p) => ({ label: p, run: (app) => { app.setSettings({ infillPattern: p, infillDensity: 20 }); app.showSetting('infillPattern'); app.setMode('preview'); } })),
        think: '"Lines" changes direction every layer. Why would it be weaker than "triangles"?',
      },
      {
        title: 'Top layers',
        html: `<p>The top surface is printed on top of the sparse infill, so it has to <b>bridge</b> over the gaps. With 10 % infill and only 1 top layer, look at the top of the cube.</p>`,
        actions: [
          { label: '1 top layer, 10 % infill', run: (app) => { app.setSettings({ topLayers: 1, infillDensity: 10 }); app.showSetting('topLayers'); app.setMode('preview').then(() => { check('pv-single', false); app.setLayer(1e6); }); } },
          { label: '5 top layers', run: (app) => { app.setSettings({ topLayers: 5, infillDensity: 10 }); app.setMode('preview').then(() => app.setLayer(1e6)); } },
        ],
        think: 'Colour by "Over air?". Which lines are bridges?',
      },
    ],
  },
  {
    id: 'support',
    title: '4. Overhangs & support',
    summary: 'You cannot print in mid-air.',
    steps: [
      {
        title: 'How steep is too steep?',
        html: `<p>Each layer can stick out a little past the layer below, resting partly on it. Up to about 45–60° from vertical this works. Beyond that, the plastic has nothing to rest on.</p>
          <p>The overhang test leans more and more: 20°, 35°, 50°, 65°, 80°. Red faces need support.</p>`,
        actions: [{ label: 'Load the overhang test', run: (app) => { app.setSettings({ ...BASE }); app.loadSample('overhang'); app.setMode('prepare'); check('show-overhang', true); } }],
      },
      {
        title: 'What happens without support?',
        html: `<p>Slice it and colour the lines by <b>"Over air?"</b>. Red lines have nothing below them: in the simulation they <b>sag</b>.</p>`,
        actions: [{ label: 'Preview: over air', run: (app) => { app.setSettings({ support: false }); app.setMode('preview').then(() => app.setColorMode('overair')); } }],
        think: 'At which angle does the problem start? Does it match the red faces in Prepare?',
      },
      {
        title: 'The T-shape',
        html: `<p>This T-shape has a bar that sticks out 16 mm on both sides. Watch what happens when the printer reaches the bar.</p>`,
        actions: [{ label: 'Simulate without support', run: (app) => { app.setSettings({ ...BASE, support: false }); app.loadSample('tshape'); app.setMode('simulate').then(() => { app.setColorMode('filament'); seekLayer(app, 97); app.sim.speed = 20; $('sim-speed').value = '20'; app.simPlay(true); }); } }],
        think: 'The plastic comes out of the nozzle as a soft string. What does gravity do to it?',
      },
      {
        title: 'Add support',
        html: `<p>Turn on support. The slicer finds areas that overhang too much and builds a breakable structure under them (pink in the feature colours).</p>`,
        actions: [
          { label: 'Support ON', run: (app) => { app.setSettings({ support: true }); app.showSetting('support'); app.setMode('preview').then(() => app.setColorMode('feature')); } },
          { label: 'Simulate the bar', run: (app) => { app.setMode('simulate').then(() => { seekLayer(app, 94); app.simPlay(true); }); } },
        ],
      },
      {
        title: 'Support roof',
        html: `<p>The top layers of the support (the <b>roof</b>) are dense so the bottom of the bar has something flat to sit on. Set roof layers to 0 and colour by "Over air?".</p>`,
        actions: [
          { label: 'No roof', run: (app) => { app.setSettings({ support: true, supportRoofLayers: 0 }); app.showSetting('supportRoofLayers'); app.setMode('preview').then(() => { app.setColorMode('overair'); app.setLayer(100); }); } },
          { label: '2 roof layers', run: (app) => { app.setSettings({ support: true, supportRoofLayers: 2 }); app.setMode('preview').then(() => { app.setColorMode('overair'); app.setLayer(100); }); } },
        ],
        think: 'Support costs plastic and time and leaves marks. Could you print the T-shape without any support by rotating it? Try the rotate buttons in Prepare.',
      },
    ],
  },
  {
    id: 'bridges',
    title: '5. Bridges',
    summary: 'Printing across a gap.',
    steps: [
      {
        title: 'A bridge is supported at both ends',
        html: `<p>The top of the bridge test spans 20 mm of air. Unlike an overhang, every line starts and ends on a pillar — like a rope stretched between two posts.</p>`,
        actions: [{ label: 'Preview: over air', run: (app) => { app.setSettings({ ...BASE }); app.loadSample('bridge'); app.setMode('preview').then(() => app.setColorMode('overair')); } }],
        think: 'Yellow lines are bridges, red ones hang free. Why does a bridge work much better than an overhang of the same length?',
      },
      {
        title: 'Watch the bridge',
        html: `<p>Simulate the first layer of the top. Bridges sag a little in the middle — good cooling (fan!) and speed help them stay straight.</p>`,
        actions: [{ label: 'Simulate the bridge', run: (app) => { app.setMode('simulate').then(() => { app.setColorMode('overair'); seekLayer(app, 59); app.sim.speed = 5; $('sim-speed').value = '5'; app.simPlay(true); }); } }],
        think: 'Look at the direction of the lines in the bridge layer. Which direction would be best for a bridge?',
      },
      {
        title: 'Without cooling',
        html: `<p>Turn the fan off and check the warnings in the Preview panel.</p>`,
        actions: [{ label: 'Fan 0 %', run: (app) => { app.setSettings({ fanSpeed: 0 }); app.showSetting('fanSpeed'); app.setMode('preview'); } }],
      },
    ],
  },
  {
    id: 'gcode',
    title: '6. Reading G-code',
    summary: 'The language of the printer.',
    steps: [
      {
        title: 'The start sequence',
        html: `<p>Open the G-code tab. Every line is one command. Click the first lines: the printer heats the bed (M140/M190) and the nozzle (M104/M109), finds its home position (G28) and resets the extruder (G92 E0).</p>`,
        actions: [{ label: 'Open the G-code', run: (app) => { app.setSettings({ ...BASE }); app.loadSample('cube'); app.setMode('gcode').then(() => app.gcodeView.select(5)); } }],
        goal: 'gcode:line',
        think: 'Why does the code start heating the bed with M140 (no waiting) before it homes, and only later wait with M190?',
      },
      {
        title: 'A printing move',
        html: `<p>Search for <code>;LAYER:5</code> and click the G1 lines below it. <b>X</b> and <b>Y</b> are where the nozzle goes, <b>F</b> is the speed in mm per minute, and <b>E</b> is how much filament has been pushed in total.</p>
          <p>The slicer computes E from the volume of the line: <i>length × line width × layer height</i>, divided by the cross-section of the filament.</p>`,
        actions: [{ label: 'Find layer 5', run: (app) => { app.setMode('gcode').then(() => { $('gc-search').value = ';LAYER:5'; app.gcodeView.search(';LAYER:5'); }); } }],
        think: 'A line 10 mm long, 0.42 mm wide and 0.2 mm high: how many mm of 1.75 mm filament does it need?',
      },
      {
        title: 'Change the code!',
        html: `<p>Press <b>Edit</b>, find <code>M190 S60</code> near the top and change it to <code>M190 S100</code>. Press <b>Apply &amp; simulate</b> and watch how long the printer now waits for the bed.</p>
          <p>Other experiments: delete the <code>M109</code> line, or change the F value of an outer wall.</p>`,
        actions: [{ label: 'Go to the G-code', run: (app) => app.setMode('gcode').then(() => app.gcodeView.select(9)) }],
        think: 'If M109 is deleted, the printer starts moving while the nozzle is still cold. What would happen on a real printer?',
      },
    ],
  },
  {
    id: 'travel',
    title: '7. Travel, retraction & seams',
    summary: 'Moving without printing, and avoiding strings.',
    steps: [
      {
        title: 'Travel moves',
        html: `<p>The thin wall test has several separate walls, so the nozzle must <b>travel</b> between them. Show travel moves: purple circles are <b>retractions</b> (filament pulled back so no plastic oozes out), green dots are where it is pushed back.</p>`,
        actions: [{ label: 'Show travel', run: (app) => { app.setSettings({ ...BASE }); app.loadSample('thinwalls'); app.setMode('preview').then(() => { check('pv-travel', true); check('pv-single', true); app.setLayer(20); }); } }],
      },
      {
        title: 'Retraction and combing',
        html: `<p>Retraction costs time. <b>Combing</b> skips it when the travel stays inside the part (a string would be hidden inside anyway). Turn combing and retraction on and off and look at the circles and the print time.</p>`,
        actions: [
          { label: 'Combing off', run: (app) => { app.setSettings({ combing: false }); app.showSetting('combing'); app.setMode('preview'); } },
          { label: 'Retraction off', run: (app) => { app.setSettings({ retraction: false }); app.showSetting('retraction'); app.setMode('preview'); } },
          { label: 'Both on', run: (app) => { app.setSettings({ retraction: true, combing: true }); app.setMode('preview'); } },
        ],
        think: 'Without retraction, molten plastic oozes from the nozzle during travel. What would that look like on the print?',
      },
      {
        title: 'The seam',
        html: `<p>Every wall loop starts and ends at one point: the <b>seam</b> (black dots in the inspector). Compare "aligned", "nearest" and "random" on the cylinder.</p>`,
        actions: ['aligned', 'nearest', 'random'].map((s) => ({ label: s, run: (app) => { app.setSettings({ ...BASE, seam: s }); if (app.model.name !== 'Cylinder') app.loadSample('cylinder'); app.showSetting('seam'); app.setMode('preview').then(() => { check('pv-single', false); check('pv-travel', false); }); } })),
        think: 'Which option hides the seam best on a statue? Which on a mechanical part?',
      },
    ],
  },
  {
    id: 'firstlayer',
    title: '8. First layer & bed adhesion',
    summary: 'If the first layer fails, everything fails.',
    steps: [
      {
        title: 'A small footprint',
        html: `<p>The inverted cone touches the bed with only a tiny circle. Compare <b>skirt</b> (a loop around the part — it only primes the nozzle) and <b>brim</b> (loops attached to the part that make the footprint bigger).</p>`,
        actions: [
          { label: 'Skirt', run: (app) => { app.setSettings({ ...BASE, adhesion: 'skirt' }); app.loadSample('invcone'); app.setMode('preview').then(() => app.setLayer(0)); } },
          { label: 'Brim', run: (app) => { app.setSettings({ adhesion: 'brim' }); app.showSetting('adhesion'); app.setMode('preview').then(() => app.setLayer(0)); } },
        ],
        think: 'Tall, thin parts often get knocked over by the nozzle. How does a brim help?',
      },
      {
        title: 'The first layer is special',
        html: `<p>Simulate the first layer: it is printed slowly (${BASE.layerHeight} mm → 0.25 mm thick), the fan is off, and the bed is hot. All this helps the plastic stick.</p>`,
        actions: [{ label: 'Simulate the first layer', run: (app) => app.setMode('simulate').then(() => { app.setColorMode('feature'); seekLayer(app, 0); app.sim.speed = 5; $('sim-speed').value = '5'; app.simPlay(true); }) }],
        think: 'Look at the fan readout. When does the fan switch on, and why not from the start?',
      },
    ],
  },
  {
    id: 'thin',
    title: '9. Thin walls & nozzle size',
    summary: 'You cannot print thinner than your nozzle.',
    steps: [
      {
        title: 'Walls that disappear',
        html: `<p>The thin wall test has walls of 0.2 to 2.0 mm. Look at the checks in the Preview panel and the red hatched areas in the layer inspector.</p>`,
        actions: [{ label: 'Load and preview', run: (app) => { app.setSettings({ ...BASE }); app.loadSample('thinwalls'); app.setMode('preview').then(() => { check('pv-single', true); check('pv-travel', false); app.setLayer(20); }); } }],
        think: 'With 0.42 mm wide lines, which walls survive? How many lines fit in the 1.2 mm wall?',
      },
      {
        title: 'Change the nozzle',
        html: `<p>Swap to a 0.25 mm nozzle (detail) or a 0.6 mm nozzle (speed). The line width follows the nozzle.</p>`,
        actions: [
          { label: '0.25 mm nozzle', run: (app) => { app.setSettings({ nozzle: 0.25, lineWidth: 0.26, layerHeight: 0.12, firstLayerHeight: 0.15 }); app.showSetting('nozzle'); app.setMode('preview'); } },
          { label: '0.6 mm nozzle', run: (app) => { app.setSettings({ nozzle: 0.6, lineWidth: 0.63, layerHeight: 0.3, firstLayerHeight: 0.3 }); app.showSetting('nozzle'); app.setMode('preview'); } },
          { label: 'back to 0.4 mm', run: (app) => { app.setSettings({ nozzle: 0.4, lineWidth: 0.42, layerHeight: 0.2, firstLayerHeight: 0.25 }); app.setMode('preview'); } },
        ],
        think: 'Compare detail and print time. When would you choose a bigger nozzle?',
      },
    ],
  },
  {
    id: 'cooling',
    title: '10. Cooling & minimum layer time',
    summary: 'Small layers need time to cool.',
    steps: [
      {
        title: 'The cone tip',
        html: `<p>Near the tip of the cone, each layer is tiny and would take only a second or two. The next layer would land on soft, still-hot plastic and the tip would melt into a blob.</p>
          <p>Colour by <b>layer time</b> and look at the "Time per layer" chart. The dashed red line is the <b>minimum layer time</b>.</p>`,
        actions: [{ label: 'Cone: colour by layer time', run: (app) => { app.setSettings({ ...BASE, minLayerTime: 0 }); app.loadSample('cone'); app.setMode('preview').then(() => app.setColorMode('layertime')); } }],
        think: 'With minimum layer time 0, how short are the last layers?',
      },
      {
        title: 'Slow down small layers',
        html: `<p>Set the minimum layer time to 10 s. The slicer slows down the small layers. Colour by <b>speed</b> to see it.</p>`,
        actions: [
          { label: 'Minimum layer time 10 s', run: (app) => { app.setSettings({ minLayerTime: 10 }); app.showSetting('minLayerTime'); app.setMode('preview').then(() => app.setColorMode('layertime')); } },
          { label: 'Colour by speed', run: (app) => app.setMode('preview').then(() => app.setColorMode('speed')) },
        ],
        think: 'Another trick is to print two cones at the same time. Why does that help cooling?',
      },
    ],
  },
];

export class Lessons {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.lesson = null;
    this.step = 0;
    this.done = new Set();
    try { this.done = new Set(JSON.parse(localStorage.getItem('slicerlab.lessons') || '[]')); } catch { /* ignore */ }
  }

  toggle() {
    this.root.hidden = !this.root.hidden;
    if (!this.root.hidden) this.render();
  }

  open(id) {
    this.lesson = LESSONS.find((l) => l.id === id) || null;
    this.step = 0;
    this.root.hidden = false;
    this.render();
  }

  notify(event) {
    if (!this.lesson || this.root.hidden) return;
    const st = this.lesson.steps[this.step];
    if (st && st.goal && event === st.goal && !st._reached) {
      st._reached = true;
      const el = this.root.querySelector('.goal');
      if (el) el.hidden = false;
    }
  }

  render() {
    const r = this.root;
    if (!this.lesson) {
      r.innerHTML = `<header><h2>Lessons</h2><button class="icon" data-close aria-label="Close">✕</button></header>
        <div class="content"><p class="small muted">Short guided lessons. Each step sets up the app for you and asks a question to think about. You can change any setting yourself at any time.</p>
        ${LESSONS.map((l) => `<button class="lesson-item${this.done.has(l.id) ? ' done' : ''}" data-open="${l.id}"><b>${l.title}</b><span>${l.summary}</span></button>`).join('')}</div>`;
    } else {
      const L = this.lesson, st = L.steps[this.step];
      r.innerHTML = `<header><button class="icon" data-back aria-label="All lessons">←</button><h2>${L.title}</h2><button class="icon" data-close aria-label="Close">✕</button></header>
        <div class="content step">
          <div class="step-count">Step ${this.step + 1} of ${L.steps.length}</div>
          <h4>${st.title}</h4>
          ${st.html}
          ${st.actions ? `<div class="try"><b>Try it:</b><br>${st.actions.map((a, i) => `<button data-act="${i}">${a.label}</button>`).join('')}</div>` : ''}
          ${st.goal ? `<p class="goal warnings" ${st._reached ? '' : 'hidden'}><span class="good" style="display:block;padding:6px 9px;border-radius:7px;background:var(--good-bg)">✓ Done!</span></p>` : ''}
          ${st.think ? `<div class="think">${st.think}</div>` : ''}
        </div>
        <footer><button data-prev ${this.step === 0 ? 'disabled' : ''}>← Back</button>
          ${this.step < L.steps.length - 1 ? '<button class="primary" data-next>Next →</button>' : '<button class="primary" data-finish>Finish ✓</button>'}</footer>`;
    }
    r.querySelector('[data-close]').onclick = () => (r.hidden = true);
    r.querySelector('[data-back]')?.addEventListener('click', () => { this.lesson = null; this.render(); });
    r.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => this.open(b.dataset.open)));
    r.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => this.lesson.steps[this.step].actions[+b.dataset.act].run(this.app)));
    r.querySelector('[data-prev]')?.addEventListener('click', () => { this.step--; this.render(); });
    r.querySelector('[data-next]')?.addEventListener('click', () => { this.step++; this.render(); });
    r.querySelector('[data-finish]')?.addEventListener('click', () => {
      this.done.add(this.lesson.id);
      try { localStorage.setItem('slicerlab.lessons', JSON.stringify([...this.done])); } catch { /* ignore */ }
      this.lesson = null;
      this.render();
    });
  }
}
