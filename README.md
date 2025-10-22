# Rive Standalone Tester

A minimal static web app to load a `.riv` file, auto-detect the single state machine, and expose controls for boolean inputs, trigger inputs, and an integer named `bg_color`.

## Quick start

There are two ways to load a `.riv` without CORS errors:

### A) Use the built-in file picker (no server required)
1. Open `index.html` directly in your browser.
2. Click the file input next to Load and select your `.riv` file.
3. The app reads it as an ArrayBuffer and loads it via the Rive runtime.

### B) Serve the folder locally and load by URL
1. Ensure your `.riv` file is in this folder. The default is `jim_eye_all_master_v4_evil_cores_bg_(1)(1).riv`.
2. Serve the folder with any static server. Examples:

```bash
# Python 3
python3 -m http.server 5500
# or Node
npx http-server -p 5500 --cors -c-1
```

3. Open `http://localhost:5500/index.html`.
4. If needed, change the file path or state machine name at the top and click Load/Reload.

## Notes
- Uses the official Rive Canvas runtime from a CDN.
- Controls are generated dynamically:
  - Booleans get toggles
  - Triggers get a Fire button
  - Numbers get a numeric input; `bg_color` is supported as an integer field
- Canvas scales to the available space; adjust the window to resize.
