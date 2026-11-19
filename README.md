# SwingLab — Golf Swing Analyzer (Phase 1)

Client-side golf swing analysis for **Down-the-Line (DTL)** and **Face-On (FO)** video.
Next.js (App Router) + TypeScript + Tailwind CSS v4. No backend, and videos never leave the browser.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:3000. Requires Node 20.9+.

## Features

- **Camera angle toggle** (DTL / FO) with angle-specific reference presets
  - DTL: Address Spine Line, Shaft Plane Line, Butt/Hip Wall Line
  - FO: Head Stability Circle, Lead Hip Sway Line, Trail Hip Box
  - Click a preset to place it, then drag its handles to fit. Click it again to remove it.
- **Video loading**: drag-and-drop or file picker (.mp4, .mov, .webm), plus **Load Sample Video**
  (`public/sample-swing.mp4`, a synthetic face-on swing with a 3:1 tempo).
- **Frame-accurate transport**: play/pause, 0.1x / 0.25x / 0.5x / 1x, a smooth scrubber, and ±1 frame stepping at a 30 or 60 fps setting.
- **Checkpoints**: Address (A), Top (T), Impact (I) and Finish (F). One click tags the current frame or jumps to an existing tag. Shows backswing time, downswing time and tempo ratio.
- **Telestrator** canvas aligned to the video at any window size: Line, Circle, 3-point Angle with live degrees, Freehand Pen, 4 neon colors, Undo and Clear All. In Move mode you can drag whole shapes and delete the selected one.
- **Live measurements**: angle degrees, line tilt from vertical, and other shape sizes in the sidebar.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | Play / pause |
| ← / → | Step 1 frame (hold Shift for 10) |
| A / T / I / F | Jump to the checkpoint, or tag it if it isn't set yet |
| Shift + A/T/I/F | Re-tag the checkpoint at the current frame |
| 1–5 | Move, Line, Circle, Angle, Pen |
| Ctrl/⌘ + Z | Undo |
| Delete | Delete the selected shape |
| Esc | Cancel the current drawing / deselect |

## How it fits together

```
app/                 layout, page, globals.css (Tailwind v4)
components/
  SwingLab.tsx       state owner: video, playback, checkpoints, shapes, undo history, shortcuts
  VideoStage.tsx     contain-fit box (ResizeObserver) holding <video> and the canvas, plus the drop zone
  TelestratorCanvas  pointer handling, drawing tools, handle dragging (DPR-aware)
  TransportControls  timeline, stepping, speed, fps, checkpoint buttons
  Sidebar.tsx        presets, checkpoints and tempo, measurements, video info, shortcuts
  AngleToggle / DrawingToolbar
lib/
  types, constants, presets, geometry (hit-testing, angles), render (canvas drawing)
```

All shapes are stored in **normalized video coordinates** (0–1). The canvas always has exactly the
size of the displayed video frame, so drawings stay locked to the footage when the window resizes.
Angles are computed in the video's pixel space, so vertical and horizontal clips measure correctly.

## Notes

- Browsers don't expose a video's true frame rate. Set the fps toggle to match how the clip was
  recorded, or some frame steps will repeat or skip frames.
- iPhone `.mov` files recorded in HEVC play in Safari but may not play in Chrome or Firefox.
  Use "Most Compatible" capture, or export to H.264 MP4.
