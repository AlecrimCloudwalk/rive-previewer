# Rive Standalone Tester

A minimal static web app to preview and test `.riv` files with an interactive UI. Select from a curated library of Rive animations or upload your own files to test state machines and interact with dynamic controls.

## Features

✨ **Library Browser** - Browse and preview Rive files from the included library  
📤 **Local Upload** - Upload your own `.riv` files for testing  
🎯 **Drag & Drop** - Simply drag `.riv` files onto the canvas  
🎮 **Interactive Controls** - Auto-generated controls for all state machine inputs  
📱 **Responsive** - Adapts to any screen size

## Quick Start

### Option 1: Local Server (Recommended)

1. Serve the folder with any static server:

```bash
# Python 3
python3 -m http.server 5500

# Node
npx http-server -p 5500 --cors -c-1
```

2. Open `http://localhost:5500/index.html`
3. Click any file in the library to preview it
4. Or upload your own `.riv` file using the file picker

### Option 2: Direct File Open

1. Open `index.html` directly in your browser
2. Use the file upload feature to load your `.riv` files
3. The app reads files as ArrayBuffer to avoid CORS issues

## Adding Files to the Library

1. Place your `.riv` files in the `rives/` folder
2. Edit `main.js` and add your file to the `LIBRARY_FILES` array:

```javascript
const LIBRARY_FILES = [
  { name: 'Your Animation', path: './rives/your-file.riv' },
  // ... other files
];
```

3. Refresh the page to see your new file in the library

## Controls

The app automatically generates controls based on your state machine inputs:

- **Booleans** → Toggle switches
- **Triggers** → Fire buttons  
- **Numbers** → Numeric inputs

Select different artboards and state machines from the dropdowns at the top.

## Technical Details

- Uses the official [Rive Canvas Runtime](https://rive.app/community/doc/web-js/docvlgRit9mp) from CDN
- No build process or dependencies required
- Pure HTML, CSS, and vanilla JavaScript
- Canvas auto-scales to fit the viewport
