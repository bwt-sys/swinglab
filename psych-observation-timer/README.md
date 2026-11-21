# Observation Timer

A standalone, no-build web app for direct behavioural observation sessions. Open `index.html` in any modern browser. It has no dependencies and no server, and the app makes no network requests. Recorded data stays in the page until you download it.

## Features

- **Session setup:** participant ID, observer, session length (or untimed), interval length, and recording method.
- **Behaviours with hotkeys:**
  - *Event* behaviours count each occurrence (frequency and rate per minute).
  - *Duration* behaviours toggle on and off (bouts, total time, mean bout length, % of session).
- **Interval recording,** scored from the timestamped log once the session ends:
  - *Partial interval:* the behaviour occurred at any point in the interval.
  - *Whole interval:* the duration behaviour was on for the entire interval.
  - *Momentary time sampling:* the duration behaviour was on at the instant the interval ended.

  An incomplete final interval is shown with `*` and left out of interval percentages. Whole-interval and momentary methods apply only to duration behaviours.
- **Interval cues:** a beep, vibration on supported phones, and a flash of the panel.
- **Pause and resume:** the observation clock stops while paused.
- **Undo** for the last behaviour or note entry, and **timestamped notes**.
- **CSV export:** a raw events log, an interval-by-interval score sheet, and a per-behaviour summary. Each file is UTF-8 with a BOM so Excel opens it correctly.
- Keeps the screen awake during recording where the browser supports it. Setup is remembered in the browser between sessions.

## Keyboard

| Key | Action |
| --- | --- |
| behaviour hotkey | record event, or start/stop a duration behaviour |
| <kbd>Space</kbd> | pause / resume |
| <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Z</kbd> | undo last entry |
| <kbd>Enter</kbd> (in note box) | add note |

## Files

- `index.html`, `style.css`, `app.js`: the user interface.
- `logic.js`: pure scoring and formatting functions, shared by the browser and the tests.
- `test/logic.test.js`: unit tests. Run them with `npm test` (needs Node 18 or later).
