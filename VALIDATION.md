# How realistic are the numbers?

Slicer Lab is meant to give numbers you can trust for two real printers: the
**Prusa i3 MK3S+** and the **Creality Ender-3**. This page says where every number comes from,
how it was checked, and what is still an estimate.

## Where the printer data comes from

| Data | Source |
|---|---|
| Machine limits (max speed, max acceleration, jerk per axis), retraction, bed size | Official PrusaSlicer 2.9 system profiles "Original Prusa i3 MK3S & MK3S+" and "Creality Ender-3 (0.4 mm nozzle)" |
| Print speeds, accelerations per feature, line widths, walls, top/bottom layers, infill | PrusaSlicer profiles "0.20mm QUALITY @MK3" and "0.20 mm NORMAL (0.4 mm nozzle) @CREALITY" |
| Start and end G-code | Same printer profiles (simplified only where they use PrusaSlicer-specific placeholders) |
| Material temperatures, density, price, max volumetric speed, cooling | PrusaSlicer generic filament profiles (PLA, PETG, ABS, ASA, FLEX) |
| Heating times | First-order heater model calibrated to user measurements (e.g. Ender-3 bed 18 → 60 °C in ≈ 3 min, → 110 °C in ≈ 12 min). **Estimate.** |
| Homing and bed-levelling times | Homing feed rates of the firmware and typical durations (G80 ≈ 55 s). **Estimate.** |

All values are visible and editable in the app (Settings → "All settings"). The profiles live in
`src/core/printers.js`.

## 1. Print-time estimate (motion planning) — validated against PrusaSlicer

The time of every move is computed like the printer firmware does it (`src/core/planner.js`):
per-axis feed-rate and acceleration limits, separate print / travel / retract acceleration,
classic-jerk junction speeds, a reverse and a forward planning pass, and the same look-ahead
window as PrusaSlicer's estimator. G-code commands that change the limits (M201, M203, M204,
M205, M220, M221) are followed.

**Test:** PrusaSlicer 2.9.6 sliced five models with the official profiles for both printers.
Slicer Lab then read PrusaSlicer's G-code and computed its own time and filament use.

| G-code (made by PrusaSlicer) | PrusaSlicer estimate | Slicer Lab | difference | filament difference |
|---|---|---|---|---|
| MK3S cube | 24:42 | 24:42 | +0.0 % | 0.00 mm |
| MK3S cylinder | 34:35 | 34:36 | +0.0 % | 0.00 mm |
| MK3S sphere | 35:35 | 35:35 | +0.0 % | 0.00 mm |
| MK3S cone | 28:20 | 28:21 | +0.0 % | 0.00 mm |
| MK3S T-shape | 17:33 | 17:34 | +0.1 % | 0.00 mm |
| Ender-3 cube | 38:56 | 38:57 | +0.0 % | 0.00 mm |
| Ender-3 cylinder | 53:10 | 53:11 | +0.0 % | 0.00 mm |
| Ender-3 sphere | 53:26 | 53:27 | +0.0 % | 0.00 mm |
| Ender-3 cone | 40:44 | 40:44 | +0.0 % | 0.00 mm |
| Ender-3 T-shape | 23:55 | 23:56 | +0.1 % | 0.00 mm |

All within 0.1 %. Three of these files are kept in `test/fixtures/` and checked by `npm test`
(tolerance 0.5 %), so future changes cannot silently break the estimate.

PrusaSlicer's estimator itself emulates the Marlin/Prusa firmware planner; Prusa reports its
estimates to be within a few percent of real MK3S print times. Note that PrusaSlicer's
"estimated printing time" counts **moving only**. Slicer Lab shows that as "Moving", and adds
heating, homing/levelling and dwell (G4) on top to get the "Total, start to finish".

## 2. Slicing — compared with PrusaSlicer

Slicer Lab is its own slicer, so its tool paths are not identical to PrusaSlicer's (PrusaSlicer
uses variable-width "Arachne" walls, gap fill, wipe moves, its own gyroid, etc.). For the same
model, printer profile and settings:

| Model | MK3S time | MK3S filament | Ender-3 time | Ender-3 filament |
|---|---|---|---|---|
| Cube 20 mm | −2.8 % | −0.8 % | −2.8 % | −3.5 % |
| Cylinder | −3.7 % | −0.3 % | −3.8 % | −1.7 % |
| Sphere | +5.2 % | +4.5 % | +2.8 % | +1.4 % |
| Cone | +9.3 % | +4.2 % | +5.1 % | +2.7 % |
| T-shape (no support) | −7.0 % | −5.3 % | −8.9 % | −7.9 % |

What was needed to get there (all are things real slicers do):

- line spacing `width − height·(1 − π/4)` (round bead edges overlap),
- top/bottom skin that also keeps the shell thick on slopes ("vertical shell thickness"),
- connected (zig-zag) infill and skin lines,
- the PrusaSlicer cooling logic: small layers slow down the *fastest* lines first,
- per-feature speeds and accelerations, small-perimeter speed, top-surface speed,
  bridge detection with bridge speed/flow/fan, volumetric flow limit of the hot end.

To repeat the comparison: make the G-code with PrusaSlicer as described at the top of
`test/compare-prusaslicer.js`, then run `node test/compare-prusaslicer.js <folder>`.

## 3. What is a model, not a measurement

- **Heating and homing times** depend on room temperature, mains voltage, bed surface and
  firmware; the app's values are typical, not exact.
- **"Printed over air" / sagging** is a rule of thumb (a line may stick out ¼ line width past the
  line below; bridges sag a little, cantilevers a lot). It shows *where* problems are, not the
  exact shape of a failed print.
- Klipper/RepRap macros (e.g. `PRINT_START`) in imported G-code cannot be simulated; the app
  lists them and leaves their time out.
- Firmware features not modelled: junction deviation (Marlin 2 with `CLASSIC_JERK` off), input
  shaping, linear advance (no effect on time), the planner slowing down when the host cannot
  send moves fast enough (USB printing).

## References

- PrusaSlicer 2.9.6 — <https://github.com/prusa3d/PrusaSlicer> (AGPL-3.0, Prusa Research).
  Time estimator: `src/libslic3r/GCode/GCodeProcessor.cpp`; cooling: `src/libslic3r/GCode/CoolingBuffer.cpp`.
- PrusaSlicer system profiles as shipped in the PrusaSlicer 2.9.6 release (`resources/profiles/PrusaResearch.ini`,
  config 2.4.14, and `Creality.ini`, config 1.1.0), AGPL-3.0.
- Marlin firmware — <https://github.com/MarlinFirmware/Marlin> (GPL-3.0), motion planner `planner.cpp`.
- Grbl — <https://github.com/grbl/grbl> (GPL-3.0).
- Heated-bed measurements — "3D Printer Heated Bed Max Temperatures – Real Examples", 3DPrinterly,
  <https://3dprinterly.com/3d-printer-heated-bed-max-temperatures-real-examples/>.

See also [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
