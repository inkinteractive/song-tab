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

### GitHub Pages (publishes the app)

`.github/workflows/pages.yml` builds, typechecks, tests and deploys to
`https://<owner>.github.io/song-tab/`. It does nothing until you enable it under
**Settings > Pages > Source: GitHub Actions**.

Two things to know before you do:

- **A Pages site is public even when the repository is private** (unless you are
  on GitHub Enterprise Cloud with access control). Enabling it publishes the app
  to anyone with the URL. The repository stays private either way.
- Pages for a private repository needs a **paid plan**. On a free personal
  account you would have to make the repository public first.

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
| **Full (reference)** | Best-effort transcription from the note engine, for you to pick apart. Labelled approximate, because it is. |

## The pipeline

1. **Capture** (Web Audio + `getUserMedia` / `getDisplayMedia`), with a live
   level meter.
2. **Trim** to a section on the waveform, with preview playback. Short isolated
   sections analyse far better than a whole track; the default selection is 30
   seconds.
3. **Isolate the guitar** - phase 2, optional. See `server/`.
4. **Detect tempo, beats and key**, then run the engines for the chosen tier.
5. **Simplify**: collapse the detected harmony to guitar-friendly voicings, one
   chord per bar unless a mid-bar change is genuinely strong, quantise the riff,
   drop notes below a density threshold.
6. **Suggest a capo** (or a transposition) that turns awkward chords into open
   shapes.
7. **Map notes to frets**, minimising hand movement, in any of seven tunings.
8. **Render** with alphaTab: a slash-notation chord chart with diagrams for
   Essential, notation + tab for Standard and Full. Playback with a moving
   cursor, driven either by alphaTab's synth or by the original clip.
9. **Edit** anything: chords, voicings, note pitches and lengths, tempo, key,
   time signature, tuning, capo, strumming pattern. Undo/redo with ⌘Z / ⌘⇧Z.
10. **Export**: chord chart (PDF and text), ASCII tab, MusicXML, MIDI, Guitar
    Pro 7 (`.gp`), alphaTex.

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

A harmonic-sum pitch tracker over a configurable register, median-filtered,
segmented into notes, quantised to a simple grid, then thinned by density so you
get a hook rather than every passing note.

Essentia's `PredominantPitchMelodia` is deliberately **not** used: it is built
for vocal melody over a full mix, and the built-in tracker followed a guitar
line more reliably in testing. Spotify's **Basic Pitch** is the phase 2
replacement for the Full tier - see `src/analysis/basicPitch.ts`.

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
server/        phase 2 Demucs isolation service (stub)
```

Analysis runs in a **web worker** - chroma over a 30 second clip is a few
thousand FFTs, and the page stays responsive. alphaTab (~1.2MB), Essentia's WASM
(~2.5MB) and jsPDF are all lazily loaded, so the first paint doesn't wait for
any of them.

The alphaTab `Score` model is built once and serves rendering, synth playback,
Guitar Pro export and alphaTex export, so what you see on screen is what lands
in the file.

### Two things that are easy to get backwards

- **Frets are always relative to the capo**, which is what a player reads off a
  tab staff. A chord is stored at concert pitch as detected; the *shape* chord is
  `detected + transpose − capo` and the *sounding* chord is `detected + transpose`.
- **alphaTab numbers strings 1..N from the lowest**, the reverse of MusicXML.
  Both conventions are in the codebase, each with a regression test, because
  flipping either one silently produces a mirror-image fingering.

## Tests

```bash
npm test
```

41 tests. The pipeline tests synthesise chord progressions with realistic
harmonic density and noise, run the real analysis path, and assert the chart
that comes out is the one a teacher would write down - currently 5/5
progressions recovered exactly, with tempo inside 5%. The exporter tests check
wellformedness and the invariants MuseScore and Guitar Pro actually care about.

## Phase 2

- Demucs stem isolation (`server/`, skeleton in place).
- Basic Pitch for the Full tier (`src/analysis/basicPitch.ts`).
- Richer chord toggles beyond the current simple/standard/rich vocabularies.

Guitar Pro export was planned for phase 2 but shipped in phase 1: alphaTab 1.8
carries a GP7 exporter, so it rides on the score model already in place.

## Licensing note

Essentia.js is **AGPL-3.0**. It is dynamically imported and the app falls back
to the built-in DSP if it is absent, but if you distribute this you need to
satisfy the AGPL or drop the dependency. alphaTab is MPL-2.0; jsPDF is MIT.
