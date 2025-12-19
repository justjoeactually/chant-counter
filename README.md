# Mantra Counter

A simple static web app to track mantra chanting repetitions using audio pattern matching.

## Features

- Record your mantra template once
- Automatically detect and count repetitions in real-time
- Test mode to validate detection accuracy
- Adjustable similarity threshold and debounce settings
- Works entirely in the browser (no server needed)

## How to Use

1. Set your goal number (default: 108)
2. Click "Record Mantra" and chant your mantra
3. Click "Confirm Mantra" when done
4. Click "Start Listening" to begin automatic counting
5. Chant your mantra - the counter will increment automatically

## Test Mode

Enable test mode to record your mantra + 5 repetitions and validate detection accuracy. Export the results as test fixtures for unit testing.

## Technical Details

- Uses Web Audio API for audio capture and analysis
- Pattern matching via cosine similarity with energy gating
- Handles variations in pace, volume, and duration
- All processing happens client-side

## Local Development

```bash
# Serve locally (required for microphone access)
python3 -m http.server 8000
# or
npx serve

# Open http://localhost:8000
```

## GitHub Pages

This app is designed to work on GitHub Pages. Just enable GitHub Pages in your repository settings (Settings → Pages → Source: main branch).

The app will be available at: `https://[username].github.io/chant-counter/`

