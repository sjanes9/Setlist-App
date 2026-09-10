# Setlist App

Live-performance lyric teleprompter and setlist tool. Single self-contained HTML file.
Deployed to GitHub Pages at `sjanes9.github.io/Setlist-App` from `main`.

---

## Architecture rules

These are not up for renegotiation on a per-task basis. If a task appears to require
breaking one, say so and stop rather than working around it.

- Single self-contained HTML file. Vanilla JavaScript. No framework, no build step, no
  bundler.
- `index.html` stays at the repo root. GitHub Pages serves it from there.
- XSS-safe DOM construction via an `el()` helper. No `innerHTML` for anything carrying
  user data, song data, or file data.
- Event delegation. No inline `onclick` attributes.
- All colors, spacing, radii, font sizes, and z-indexes live in one `:root` custom
  property block. Light and dark themes are one attribute flip, never a second stylesheet.
- Every `localStorage` read and write is wrapped in try/catch. The app must boot with
  storage completely blocked. Schema version key plus legacy key migration on read.
- IndexedDB for anything binary or large.
- Library import and export must round-trip in a fresh session with no data loss.
- Expose internals for testing on a single namespaced global, `window.__setlist`. Do not
  leave app functions trapped in a closure where the harness cannot reach them. A prior
  session lost time to exactly this, with `saveLib` unreachable from the harness.

## Working rules

- Run `npm test` after every change. Not at the end of a batch, after every change.
- Anything not actually wired up gets a visible "Coming Soon" label in the UI. Never ship
  a control that silently does nothing.
- Update the How-To modal in the same commit as any feature change that alters it.
- New UI starts as a shell: real markup, real tokens, stub data, no logic. Layout gets
  settled before handlers are wired.
- Flag anything unverified in the artifact itself, not just in conversation.

## Layout

```
index.html              the entire app
library.json            song and setlist data, imported through the UI
CLAUDE.md               this file
package.json            dev dependencies and scripts, not shipped
test/harness.js         jsdom test runner
test/polyfills.js       jsdom gap fills, applied via beforeParse
test/fixtures/          sample library data for tests
scripts/syntax-check.js extracts the largest <script> and runs node --check
```

`node_modules`, `package.json`, `package-lock.json`, `test/`, and `scripts/` are dev-only.
They sit in the repo but are never referenced by `index.html`.

## Commands

```bash
npm install         # first time only
npm run check       # JS syntax check on the extracted script block
npm test            # syntax check plus the jsdom suite
```

To look at it: open `index.html` directly in a browser. Do not judge storage behavior
from any sandboxed preview, because `localStorage` is blocked in some of them and has
twice produced phantom bugs that were not real.

## Deploy

Commit to `main`. GitHub Pages picks it up. That is the whole process now.

Do not reintroduce a manual upload step. A prior release was corrupted by a copy-paste
upload that appended a duplicate code fragment after `</html>`, which is why the old
workflow required drag-and-drop plus a byte-count check.

## Cloud sync model

Manual publish only. The cloud changes when the Upload to Cloud button is pressed and at
no other time. It auto-downloads a timestamped local backup first.

- Supabase project URL and anon key are constants near the top of the script.
- `UPLOAD_PASSCODE` gates the upload button. This is an accident guard, not security. The
  file is public and the constant is readable. Do not describe it as security anywhere in
  the UI or in commit messages.
- There is no automatic write path. If a task seems to need one, raise it first.

## Known traps in this codebase

- Metronome auto-start is bound to the Play button, not to internal scroll calls. Keep
  user-initiated and internally-initiated paths distinct.
- Section headers must be ChordPro `{c: ...}` format for bar-timed scrolling to work.
  Plain-text headers break it silently.
- The header element sits outside the view-switching containers, so the library dropdown
  stays reachable in performance mode. Do not move it inside a view container.
- jsdom reports `offsetWidth` as 0. Any layout math that divides by it needs the polyfill
  in `test/polyfills.js`, and needs a guard in the app so a zero width does not produce
  `NaN` or `Infinity` in production.
