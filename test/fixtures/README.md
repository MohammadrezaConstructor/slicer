# Test fixtures

Reference G-code produced by **PrusaSlicer 2.9.6** (<https://github.com/prusa3d/PrusaSlicer>,
AGPL-3.0, Prusa Research) from Slicer Lab's own built-in models (20 mm cube, T-shape), using the
PrusaSlicer system profiles:

| File | Printer profile | Print profile | Filament |
|---|---|---|---|
| `ps_mk3s_cube.gcode.gz` | Original Prusa i3 MK3S & MK3S+ | 0.20mm QUALITY @MK3 | Prusament PLA |
| `ps_mk3s_tshape.gcode.gz` | Original Prusa i3 MK3S & MK3S+ | 0.20mm QUALITY @MK3 | Prusament PLA |
| `ps_ender3_cube.gcode.gz` | Creality Ender-3 (0.4 mm nozzle) | 0.20 mm NORMAL (0.4 mm nozzle) @CREALITY | Generic PLA @CREALITY |

`npm test` checks that Slicer Lab's time and filament estimates for these files match the estimates
PrusaSlicer wrote into them. See `VALIDATION.md` and `THIRD_PARTY_NOTICES.md`.
