# Third-party notices and references

Slicer Lab is licensed under the GNU Affero General Public License v3.0 or later
(see [LICENSE](LICENSE)). It uses, is derived from, or was checked against the works below.

## Trademarks

Prusa, Original Prusa, PrusaSlicer and Prusament are trademarks of Prusa Research a.s.
Creality and Ender are trademarks of Shenzhen Creality 3D Technology Co., Ltd.
Other product and company names mentioned (for example Cura, OrcaSlicer, Bambu Studio, Marlin)
are trademarks of their respective owners.

These names are used only to say which printers the profiles describe and which programs the
G-code is compatible with or was compared against. **Slicer Lab is not affiliated with, sponsored
by or endorsed by any of these companies.** The printers in the simulator are simplified models built
from basic shapes for this project; no manufacturer drawings, CAD files or logos are used.

## Code this project is derived from

### PrusaSlicer — print-time estimator and cooling logic

- Project: PrusaSlicer 2.9.6, <https://github.com/prusa3d/PrusaSlicer>
- Licence: GNU Affero General Public License v3.0 or later
- Copyright (c) Prusa Research 2020–2023: Enrico Turri, Vojtěch Bubník, Pavel Mikuš, Lukáš Matěna,
  Filip Sykala, Oleksandra Iushchenko; Copyright (c) SuperSlicer 2023 Remi Durand
  (`src/libslic3r/GCode/GCodeProcessor.cpp`)
- Copyright (c) Prusa Research 2016–2023: Lukáš Matěna, Pavel Mikuš, Vojtěch Bubník;
  Copyright (c) Slic3r 2013–2016 Alessandro Ranellucci (`src/libslic3r/GCode/CoolingBuffer.cpp`)

Used in this project:

| Our file | What comes from PrusaSlicer |
|---|---|
| `src/core/planner.js` | JavaScript translation of the time-estimation planner in `GCodeProcessor.cpp`: block feed-rate and acceleration limits, classic-jerk junction speed, reverse/forward planning passes, trapezoid calculation, look-ahead window (64 blocks, refreshed every 256), `M204`/`M205`/`M201`/`M203` handling. |
| `src/core/gcodeParser.js` | Which moves use print / travel / retract acceleration; synchronisation of the planner on `G4`, `G92` and similar; the format of the "estimated printing time (normal mode)" and "filament used [mm]" comments that are read from imported files. |
| `src/core/gcodeWriter.js` | The cooling slow-down method of `CoolingBuffer.cpp` (slow the fastest lines down first, never below the minimum print speed); the machine-limit header (`M201`–`M205`) and summary comment format. |
| `src/core/slicer.js` | The line-spacing formula `width − height·(1 − π/4)` (Slic3r/PrusaSlicer `Flow::spacing`) and the idea of "ensure vertical shell thickness". |

### Marlin firmware and Grbl — origin of the planner algorithm

PrusaSlicer's estimator re-implements the motion planner of the Marlin firmware, which in turn
descends from Grbl. We did not copy code from these projects directly, but the algorithm in
`src/core/planner.js` is theirs.

- Marlin, <https://github.com/MarlinFirmware/Marlin>, GNU General Public License v3.0
  (Copyright (c) Marlin Firmware contributors)
- Grbl, <https://github.com/grbl/grbl>, GNU General Public License v3.0
  (Copyright (c) 2009–2011 Simen Svale Skogsrud, 2011–2016 Sungeun K. Jeon)

## Data

### PrusaSlicer system profiles — printer, print and material settings

Values in `src/core/printers.js` and `src/core/settings.js` (machine limits, speeds, accelerations,
line widths, retraction, temperatures, densities, prices, maximum volumetric speeds, cooling) and the
start/end G-code of both printers come from the system profiles shipped in the PrusaSlicer 2.9.6
release (`resources/profiles/`, AGPL-3.0, Prusa Research, <https://github.com/prusa3d/PrusaSlicer>):

- `PrusaResearch.ini` (config version 2.4.14): "Original Prusa i3 MK3S & MK3S+", "0.20mm QUALITY @MK3",
  "Prusament PLA", "Generic PLA", "Generic PETG", "Generic ABS", "Prusament ASA", "Generic FLEX"
- `Creality.ini` (config version 1.1.0): "Creality Ender-3 (0.4 mm nozzle)", "0.20 mm NORMAL (0.4 mm nozzle) @CREALITY",
  "Generic PLA @CREALITY"

### Reference G-code (test fixtures)

The files in `test/fixtures/` were produced by PrusaSlicer 2.9.6 from Slicer Lab's own built-in
models with the profiles above. They are used to check that our time and filament estimates match
PrusaSlicer's.

### Heater calibration

The heating model of the Ender-3 is calibrated to user measurements reported in
"3D Printer Heated Bed Max Temperatures – Real Examples", 3DPrinterly,
<https://3dprinterly.com/3d-printer-heated-bed-max-temperatures-real-examples/>.

## Libraries included in the app

### three.js

<https://github.com/mrdoob/three.js> — used for all 3D graphics.

```
The MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### Clipper (clipper-lib 6.4.2)

<https://www.angusj.com> (original), JavaScript translation <https://github.com/junmer/clipper-lib>
— used for all polygon operations (offsets, unions, clipping).
Copyright (c) Angus Johnson 2010–2017 (original library); JavaScript translation by Timo.

```
Boost Software License - Version 1.0 - August 17th, 2003

Permission is hereby granted, free of charge, to any person or organization
obtaining a copy of the software and accompanying documentation covered by
this license (the "Software") to use, reproduce, display, distribute,
execute, and transmit the Software, and to prepare derivative works of the
Software, and to permit third-parties to whom the Software is furnished to
do so, all subject to the following:

The copyright notices in the Software and this entire statement, including
the above license grant, this restriction and the following disclaimer,
must be included in all copies of the Software, in whole or in part, and
all derivative works of the Software, unless such copies or derivative
works are solely in the form of machine-executable object code generated by
a source language processor.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE, TITLE AND NON-INFRINGEMENT. IN NO EVENT
SHALL THE COPYRIGHT HOLDERS OR ANYONE DISTRIBUTING THE SOFTWARE BE LIABLE
FOR ANY DAMAGES OR OTHER LIABILITY, WHETHER IN CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### Vite (small runtime helper)

<https://vitejs.dev> — the build tool. It adds a small piece of its own code to the app to start the
slicing worker. vite-plugin-singlefile (<https://github.com/richardtallent/vite-plugin-singlefile>, MIT)
is only used during the build and adds no code.

```
MIT License

Copyright (c) 2019-present, VoidZero Inc. and Vite contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
