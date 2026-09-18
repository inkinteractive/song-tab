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

## Tiers

One selector, defaulting to Essential.

| Tier | What you get |
| --- | --- |
| **Essential** (default) | Chord chart only: names, open/barre diagrams, a suggested strumming pattern, one chord per bar. The acoustic busking version. |
| **Standard** | Those chords **plus** the main riff or melody as tab, so the student gets the recognisable hook over the progression. |
| **Full (reference)** | Polyphonic transcription from Spotify's Basic Pitch, for you to pick apart. Labelled approximate, because it is. |

## The pipeline

1. **Capture** (Web Audio + `getUserMedia` / `getDisplayMedia`), with a live
   level meter.
2. **Trim** to a section on the waveform, with preview playback. Short isolated
   sections analyse far better than a whole track; the default selection is 30
   seconds.
3. **Isolate the guitar** (optional): Demucs separates the clip and the app analyses one stem instead of the raw capture. See `server/`.
4. **Detect tempo, beats and key**, then run the engines for the chosen tier.
5. **Simplify**: collapse the detected harmony to guitar-friendly voicings, one
   chord per bar unless a mid-bar change is genuinely strong, quantise the riff,
   drop notes below a density threshold.
6. **Suggest a capo** (or a transposition) that turns awkward chords into open
   shapes.
7. **Map notes to frets**, minimising hand movement, in any of seven tunings.
8. **Render** with alphaTab, laid out like the printed chart: **tablature only**,
   chord names and diagrams above it, systems wrapped down the panel. A guitar
   teacher reads frets, and the standard-notation staff doubled every system's
   height to say the same thing twice. A moving cursor shades the sounding bar
   and draws a line at the beat, driven by whichever source is playing.
9. **Edit** anything: chords, voicings, note pitches and lengths, tempo, key,
   time signature, tuning, capo, strumming pattern, and whether chords read as
   plain triads or as detected. Undo/redo with ⌘Z / ⌘⇧Z.
10. **Export** the printable chord chart as PDF, from the top of the score
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

**Standard tier** runs a harmonic-sum pitch tracker over a configurable
register, median-filtered, segmented into notes, quantised, then thinned by
density so you get a hook rather than every passing note. It is monophonic on
purpose: the Standard tier wants the line a student can hum.

Essentia's `PredominantPitchMelodia` is deliberately **not** used. It is built
for vocal melody over a full mix, and on a guitar register it returned
near-zero salience pinned to the range boundary; the built-in tracker followed
the line reliably.

**Full tier** runs Spotify's **Basic Pitch**, which is polyphonic. Two notes on
how it is wired:

- It uses **TensorFlow.js**, not onnxruntime-web. That is what the package
  ships, and the model is bundled in it rather than fetched from a CDN, so the
  Full tier works offline.
- It runs on the **main thread**, unlike the chord engine. tfjs can only reach
  WebGL from a document, and the CPU backend is too slow to be useful. It
  reports progress while it works.

A guitar has six strings and Basic Pitch will happily report denser stacks than
that, so notes that cannot be voiced are dropped - weakest of each stack first -
and the count is reported. On the test clip that was 14 of 226.

### Guitar isolation

`server/` runs Demucs (`htdemucs`) behind a small FastAPI service. The client
posts the trimmed clip, gets one stem back, and analyses that instead of the raw
capture; the stem is also available as a playback source, so you can hear what
the engine is reading. Guitars mostly land in Demucs' `other` stem.

Every failure path is soft. No service, an unreachable one, or a separation that
errors all fall back to analysing the raw capture, which is what phase 1 did.

### Tempo

The built-in onset-flux tracker is the tempo source. Essentia's
`RhythmExtractor2013` runs as a second opinion: agreement raises confidence, and
a clean 2× / 0.5× disagreement is surfaced to you rather than acted on. Measured
across the test progressions, Essentia routinely reported double time on slow
material and half time on fast material, which throws the bar grid out even when
the harmony is right.

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
actually needs, and every other button was clutter around it.

Working exporters for MusicXML, MIDI, Guitar Pro 7 (`.gp`), ASCII tab and
alphaTex are still in `src/export/`, still covered by tests, and unexposed. The
PDF embeds the ASCII tab, so that one is on the live path. If you want any of
the others back in the UI it is a button, not a feature.

## Playback

Three sources, in order of how close they are to the record: the **original
clip**, the **isolated guitar** stem once you have one, and alphaTab's **synth**
playing the arrangement. Any of them can loop, and all three drive the same
cursor.

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
  render/      alphaTab score builder, alphaTab React view, SVG chord diagrams
  export/      ascii, musicxml, midi, pdf, guitar pro
  components/  the UI
  state/       store, undo/redo
server/        Demucs isolation service (FastAPI)
```

Analysis runs in a **web worker** - chroma over a 30 second clip is a few
thousand FFTs, and the page stays responsive. alphaTab (~1.2MB), Essentia's WASM
(~2.5MB) and jsPDF are all lazily loaded, so the first paint doesn't wait for
any of them.

The alphaTab `Score` model is built once and serves rendering, synth playback,
Guitar Pro export and alphaTex export, so what you see on screen is what lands
in the file.

### Three things that are easy to get backwards

- **Frets are always relative to the capo**, which is what a player reads off a
  tab staff. A chord is stored at concert pitch as detected; the *shape* chord is
  `detected + transpose − capo` and the *sounding* chord is `detected + transpose`.
- **alphaTab numbers strings 1..N from the lowest**, the reverse of MusicXML.
  Both conventions are in the codebase, each with a regression test, because
  flipping either one silently produces a mirror-image fingering.
- **A tab staff cannot paint a note with no string.** alphaTab's painter throws
  deep inside its worker, and the whole score fails to render while the rest of
  the app looks fine. Anything reaching the riff track has a string assigned;
  there is a test asserting exactly that.

## Tests

```bash
npm test
```

51 tests. The pipeline tests synthesise chord progressions with realistic
harmonic density and noise, run the real analysis path, and assert the chart
that comes out is the one a teacher would write down - currently 5/5
progressions recovered exactly, with tempo inside 5%. The exporter tests check
wellformedness and the invariants MuseScore and Guitar Pro actually care about.
The polyphony tests cover what phase 2 changed: stacking, string collisions,
and the fretboard limit.

The separation service has its own suite:

```bash
cd server && .venv/bin/python -m pytest -q
```

8 tests covering validation, stem selection, response headers and that an
uploaded clip is deleted even when separation fails. The separator itself is
stubbed there, because Demucs' model weights cannot be downloaded in every
environment.

## Status

Phase 1 and phase 2 are both in. Guitar Pro export was planned for phase 2 but
shipped in phase 1: alphaTab 1.8 carries a GP7 exporter, so it rode on the score
model already in place.

**Not verified here:** Demucs' model weights download from hosts this
development environment blocks, so the service has been exercised against a
stubbed separator and a stand-in server, not against Demucs itself. The first
real `/separate` call will download weights (a few hundred MB) before it
answers. Separation is CPU-bound and slow without a GPU - expect minutes, not
seconds, for a lesson-length clip.

## Licensing note

Essentia.js is **AGPL-3.0**. It is dynamically imported and the app falls back
to the built-in DSP if it is absent, but if you distribute this you need to
satisfy the AGPL or drop the dependency. alphaTab is MPL-2.0; jsPDF is MIT.
