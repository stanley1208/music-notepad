# Music Notepad

Type music the way you type words. Plain-text [ABC notation](https://abcnotation.com) goes in on the left; engraved sheet music appears instantly on the right, on a grand staff, with synthesized playback and a moving cursor.

Built for piano teachers who are tired of click-and-drag notation editors.

## Features

- Live rendering: text → grand-staff sheet music, ~200 ms after you stop typing
- Playback with both hands in sync, chords, tempo warp, and a follow-along highlight
- Friendly errors: a bad edit shows a message with a line number while the last good score stays visible
- Built-in cheat sheet with click-to-insert snippets
- Multiple documents, autosaved privately in your browser (no account, no server)
- Export as `.abc` text, MIDI, or print-to-PDF

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl`/`Cmd` + `Enter` | Play / pause |
| `Ctrl`/`Cmd` + `S` | Save now |
| `Ctrl`/`Cmd` + `/` | Toggle cheat sheet |

## Development

```bash
npm install
npm run dev
```

Built with Vite + React + TypeScript, Tailwind CSS, and [abcjs](https://abcjs.net).
