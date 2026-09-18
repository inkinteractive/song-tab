# Song → Tab

A browser app for guitar teachers. A student plays you a song in a lesson and
asks how to play it; this listens to it and produces a **simplified,
single-guitar arrangement you can teach** - the essential chord progression plus
the main riff, the way you'd play the song solo on an acoustic.

It is a playable reduction, not a transcription. Everything it produces is
editable before you export it.

```bash
npm install
npm run dev     # http://localhost:5173
```

No login, no upload, no server. Analysis, rendering and every export run in the
browser.

## Previewing it

Microphone and tab capture need a **secure context**, so the app must be served
over HTTPS or from `localhost`. All three routes below satisfy that.

### Locally (best for real use)

The clone-and-`npm run dev` above. Use this when you actually want to capture
audio: it is your real input device, with no network in the way.

### GitHub Codespaces (keeps the repo private)

`Code > Codespaces > Create codespace`. `.devcontainer/` installs dependencies
on create; then run `npm run dev` and open the forwarded port 5173. The
forwarded URL is HTTPS and private to your account, so mic capture works and
nothing is published.

### GitHub Pages - the live site

**https://inkinteractive.github.io/song-tab/**

This is the one place capture actually works without installing anything: a
top-level HTTPS page, so the microphone and tab audio are available, phone
included.

`.github/workflows/pages.yml` typechecks, tests, builds and deploys on every
push to `main`, so the site is whatever `main` is. It can also be run by hand
from the Actions tab.

It depends on two settings that live outside the repository:

- **Settings > Pages > Source: GitHub Actions.**
- **Settings > Environments > github-pages > Deployment branches** must allow
  `main`. That policy is pinned to whatever branch was default when Pages was
  first switched on, so changing the default branch silently breaks deploys -
  the build passes and the deploy job fails in about a second **with no logs**,
  because it never starts. That signature means the branch policy, not your
  code.

Also worth knowing: **a Pages site is public even when the repository is
private** (outside GitHub Enterprise Cloud with access control), and Pages from
a private repository needs a paid plan - on a free personal account the
repository has to be public.

The workflow sets `BASE_PATH=/song-tab/` so the bundle, Bravura and the
SoundFont all resolve under the project path, and copies `index.html` to
`404.html` as the single-page-app fallback.

---

## What it can and cannot hear

- **DRM audio from the Spotify and Apple Music desktop apps cannot be captured
  by a browser.** That is a platform restriction, not a gap here. Two paths work:
  - **Microphone** (the primary one): the student plays, or you point the mic at
    a phone speaker. Capture runs with echo cancellation, noise suppression and
    auto-gain **off**, which music needs.
  - **Browser tab / system audio** via `getDisplayMedia({ audio: true })`: share
    the tab a web player is streaming in, with "Share tab audio" ticked.
    Sharing a window or a whole screen usually carries no sound.
  - File import is there too, mostly so you can work from something on disk.
- **Chord detection is far more robust than note detection** on a dense, effected
  mix, so the chord engine leads. On heavily produced material - the design case
  here was darkwave-style layered guitars over a simple progression - the
  harmony comes through cleanly while a full note-for-note transcription would
  be a mess. The app is built around that asymmetry rather than pretending
  otherwise.

## What you get

One output, every time: the chord progression **plus** the main riff or melody
as tab, so the student gets the recognisable hook over the progression.

There used to be three tiers - chords only, chords plus riff, and a polyphonic
Basic Pitch transcription. The middle one was the only one anyone chose. Chords
without the riff is not a teachable arrangement, and the polyphonic dump was a
reference document rather than something to play, so both were removed along
with the selector and the ~40MB of TensorFlow.js the top tier pulled in.

## The pipeline

1. **Capture** (Web Audio + `getUserMedia` / `getDisplayMedia`), with a live
   level meter.
2. **Trim** to a section on the waveform, with preview playback. Short isolated
   sections analyse far better than a whole track; the default selection is 30
   seconds.
3. **Detect tempo, beats and key**, then run the chord and note engines.
4. **Simplify**: collapse the detected harmony to guitar-friendly voicings, one
   chord per bar unless a mid-bar change is genuinely strong, quantise the riff,
   drop notes below a density threshold.
5. **Suggest a capo** (or a transposition) that turns awkward chords into open
   shapes.
6. **Map notes to frets**, minimising hand movement, in any of seven tunings.
7. **Render** the tab as the monospace grid a guitarist expects: six dashed
   lines, fret numbers on them, chord names above, bar lines between. The page
   and the PDF are built from the same grid (`src/render/tabGrid.ts`), so what
   is on screen is what gets printed. Engraved notation was tried first and was
   the wrong document - a teacher reads `e|--7--5--|`, not a staff. A moving
   cursor shades the sounding bar and draws a line at the beat, driven by
   whichever source is playing.
8. **Edit** anything: chords, voicings, note pitches and lengths, tempo, key,
   time signature, tuning, capo, strumming pattern, and whether chords read as
   plain triads or as detected. Undo/redo with ⌘Z / ⌘⇧Z.
9. **Export** the printable chord chart as PDF, from the top of the tab
    panel. Diagrams, the bar grid, the strumming pattern and the tab.

Every guess is overridable, and the ones the engine is unsure about say so.

## How the analysis works

### Chord engine (primary)

Chroma/HPCP via **Essentia.js** (WASM), with a pure-TypeScript chroma
implementation as a fallback when the WASM bundle cannot load. On top of that:

- **Template matching with a Viterbi pass.** Frame-level chord matches flicker
  constantly on a reverb-soaked mix; the transition penalty holds a chord until
  the evidence for changing is strong. The penalty is exposed as "chord
  stickiness".
- **Bass-register reinforcement.** A second chroma over MIDI 28-55 votes for the
  root. This is what separates C from Am7, and G from Em - in testing it took
  the synthetic benchmark from 72% to 100%.
- **Key bias.** The detected key nudges the decoder towards diatonic chords.
- **A pitch-range filter**, so bass rumble and vocal air stay out of the harmony.

### Note engine

A harmonic-sum pitch tracker runs over a configurable register,
median-filtered, segmented into notes, quantised, then thinned by density so you
get a hook rather than every passing note. It is monophonic on purpose: the
arrangement wants the line a student can hum.

Essentia's `PredominantPitchMelodia` is deliberately **not** used. It is built
for vocal melody over a full mix, and on a guitar register it returned
near-zero salience pinned to the range boundary; the built-in tracker followed
the line reliably.

Spotify's **Basic Pitch** was wired up for the old Full tier and has been
removed with it. The score model, exporters and fret mapper are still
polyphonic - stacked notes become one beat, notes that cannot be voiced on six
strings are dropped weakest-first - because a hand-edited riff can still stack
notes even when the tracker does not.

## Known failure modes, and what the app does about them

| Problem | What happens |
| --- | --- |
| Effects and layers add phantom notes | The chord engine mostly sidesteps this. The note engine's confidence floor is adjustable. |
| Chord clusters come back messy | Everything snaps to the nearest common voicing, as a suggestion you can override per bar. |
| Octave and register leakage (bass, vocals) | Separate pitch-range filters for harmony and melody, plus 8va/8vb buttons per note in the riff editor. |
| Ambiguous chords (add9, sus, slash) | The plain triad is shown by default, with "use detected *Xadd9*" one click away. |
| Tempo half/double errors | Flagged when the two trackers disagree; ×2 and ÷2 buttons sit next to the tempo field. |
| The recording is off concert pitch | The tuning offset is estimated and reported when it is significant. |

## Exports

The UI offers **one** export: the chord-chart PDF. That is the artefact a lesson
actually needs, and every other button was clutter around it. Its tab pages are
the same grid the app draws, character for character.

Working exporters for MusicXML, MIDI, Guitar Pro 7 (`.gp`), ASCII tab and
alphaTex are still in `src/export/`, still covered by tests, and unexposed. The
PDF embeds the ASCII tab, so that one is on the live path. If you want any of
the others back in the UI it is a button, not a feature.

## Playback

Two sources: the **original clip** as captured, and alphaTab's **synth** playing
the arrangement. Either can loop, and both drive the same cursor.

The chord chart is one row that scrolls itself to keep the sounding bar in view.

### Why the highlight is not laggy

The playhead lives outside React (`src/state/playhead.ts`). Driving it through
component state meant a `setState` every animation frame, re-rendering the whole
chart and riff table sixty times a second - that render work *was* the lag.
Components now subscribe and snapshot the id of the chord under the playhead, so
React bails out until that id changes: roughly once a bar instead of once a
frame.

The player also reports the audio *being heard* rather than the audio being
scheduled, subtracting the graph and device output latency. Measured in
Chromium, chord highlights land within about one frame (mean gap 2.417s against
a true bar length of 2.414s, worst deviation 17ms).

## Architecture

```
src/
  audio/       capture (mic / tab / file), buffer maths, clip playback
  analysis/    dsp (FFT, chroma, onsets, tempo, pitch), essentia adapter,
               chord decoder, simplifier, melody segmentation, worker
  music/       theory, chord shapes, fretboard mapping, capo search, strumming
  render/      tab grid (page + PDF), alphaTab score builder and synth view,
               SVG chord diagrams
  export/      ascii, musicxml, midi, pdf, guitar pro
  components/  the UI
  state/       store, undo/redo
```

Analysis runs in a **web worker** - chroma over a 30 second clip is a few
thousand FFTs, and the page stays responsive. alphaTab (~1.2MB), Essentia's WASM
(~2.5MB) and jsPDF are all lazily loaded, so the first paint doesn't wait for
any of them.

The alphaTab `Score` model serves synth playback, Guitar Pro export and
alphaTex export. It no longer draws anything: the tab on the page comes from
`tabGrid.ts`. alphaTab's player only exists attached to a rendered score, so the
view is still mounted - off-screen, one system nobody sees, in exchange for
being able to hear the arrangement.

### Three things that are easy to get backwards

- **Frets are always relative to the capo**, which is what a player reads off a
  tab staff. A chord is stored at concert pitch as detected; the *shape* chord is
  `detected + transpose − capo` and the *sounding* chord is `detected + transpose`.
- **alphaTab numbers strings 1..N from the lowest**, the reverse of MusicXML.
  Both conventions are in the codebase, each with a regression test, because
  flipping either one silently produces a mirror-image fingering.
- **A tab staff cannot paint a note with no string.** alphaTab's painter throws
  deep inside its worker, and the whole score fails while the rest of the app
  looks fine. Anything reaching the riff track has a string assigned; there is a
  test asserting exactly that.
- **The tab grid is measured in characters.** The playhead is positioned in
  `ch` units, so a line whose characters and whose column arithmetic disagree by
  one puts the cursor on the wrong note. A test pins every line to the width its
  own system claims.

## Tests

```bash
npm test
```

54 tests. The pipeline tests synthesise chord progressions with realistic
harmonic density and noise, run the real analysis path, and assert the chart
that comes out is the one a teacher would write down - currently 5/5
progressions recovered exactly, with tempo inside 5%. The exporter tests check
wellformedness, the invariants MuseScore and Guitar Pro actually care about, and
the character alignment the tab grid and its playhead depend on.
The polyphony tests cover what phase 2 changed: stacking, string collisions,
and the fretboard limit.


## Status

Phase 1 and phase 2 are both in. Guitar Pro export was planned for phase 2 but
shipped in phase 1: alphaTab 1.8 carries a GP7 exporter, so it rode on the score
model already in place.

**Guitar isolation has been removed.** A Demucs stem-separation service used to
live in `server/`, with the app analysing one stem instead of the raw capture.
It is gone: it could only ever run on the machine serving the app, a browser
will not let an https page reach a service on localhost, and the chord engine
reads through a dense mix well enough without it. It is in the git history if
it is ever wanted back - `git log --diff-filter=D -- server/` finds the commit.

## Licensing note

Essentia.js is **AGPL-3.0**. It is dynamically imported and the app falls back
to the built-in DSP if it is absent, but if you distribute this you need to
satisfy the AGPL or drop the dependency. alphaTab is MPL-2.0; jsPDF is MIT.
