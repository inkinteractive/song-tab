# Handover

Song → Tab: a browser app that listens to a recording and produces a simplified
single-guitar arrangement - a chord chart plus the main riff as tab - that a
teacher can edit and hand to a student as a PDF.

`README.md` documents how the app works. This document is for whoever picks it
up next: what state it is actually in, what has been tried and reversed, where
the bodies are buried, and what I would do first.

---

## 1. State of play

| | |
| --- | --- |
| Live | https://tab.inkinteractive.com.au |
| Repo | `inkinteractive/song-tab` |
| Working branch | `claude/song-to-tab-guitar-assistant-xctnri` |
| Deploys from | `main`, on every push, via `.github/workflows/pages.yml` |
| Tests | 78 across 7 files (`npm test`, about 60 seconds) |
| Source | ~9,100 lines of TypeScript/TSX in `src/` |
| Commits | 23 |

The app is **feature-complete and shipping**. Capture, trim, analyse, edit,
play back, export to PDF all work end to end, verified in Chromium against real
audio files.

**The chord detection is not accurate enough on real guitar.** That is the open
problem and section 4 is about it. Everything else is in reasonable shape.

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # 78 tests
npm run typecheck
npm run build        # tsc -b && vite build
npm run fixtures     # analysis against real recordings in fixtures/
```

No backend, no login, no database. Everything runs in the browser.

---

## 2. The shape of it

Four steps, driven by `src/state/store.ts`:

**Capture** (mic, browser-tab audio, or file import) → **Trim** to a section on
the waveform → **Analyse** in a web worker → **Chart & edit**, which is the
transport, the tab, and the chord chart.

The analysis produces an `Arrangement` (`src/types.ts`). That is the editable
document and the single source for everything downstream: the tab on screen, the
chord chart, the PDF, the synth, and the MusicXML/MIDI/Guitar Pro exporters. Edit
a chord in the chart and all of them follow.

### The pipeline, in order

1. `audio/capture.ts` gets samples in; `audio/buffer.ts` folds to mono.
2. `analysis/runAnalysis.ts` hands off to `analysis/analysis.worker.ts`.
3. `analysis/engine.ts` orchestrates: chroma (Essentia HPCP, falling back to the
   pure-TS `dsp.ts`), a second chroma over the bass register, onset-based tempo,
   key, then the chord decoder.
4. `analysis/chordEngine.ts` matches chroma against chord templates and runs a
   Viterbi pass to stop the naming flickering.
5. `analysis/simplify.ts` collapses the result to exactly one chord per bar.
6. `analysis/melody.ts` turns a pitch track into a riff; `music/fretboard.ts`
   maps those notes to strings and frets.
7. `render/tabGrid.ts` builds the character grid that both the page and the PDF
   draw from.

---

## 3. Complete file inventory

### Root

| File | Purpose |
| --- | --- |
| `index.html` | Vite entry point |
| `package.json` | Six runtime deps: alphaTab, essentia.js, jsPDF, React, react-dom, zustand |
| `vite.config.ts` | Vite + React + the alphaTab plugin (copies Bravura and the SoundFont into `public/`) |
| `vitest.config.ts` | Test config |
| `tsconfig.json` | Strict, with `noUnusedLocals` and `noUnusedParameters` on |
| `tailwind.config.js`, `postcss.config.js` | Styling |
| `README.md` | How the app works, and what it can and cannot hear |
| `HANDOVER.md` | This document |
| `.github/workflows/pages.yml` | Typecheck, test, build, deploy to Pages on push to `main` |

### `src/` top level

| File | Purpose |
| --- | --- |
| `main.tsx` | React root |
| `App.tsx` | Step routing and the result screen's layout |
| `types.ts` | `Arrangement`, `BarChord`, `RiffNote`, `AnalysisSettings`, `DEFAULT_SETTINGS` |
| `panels.ts` | **Four feature flags for panels that are built but hidden.** See section 5 |
| `index.css` | Tailwind layer plus the alphaTab cursor styles |
| `essentia-modules.d.ts` | Type shims; essentia.js ships none |

### `src/audio/` - getting sound in and out

| File | Purpose |
| --- | --- |
| `capture.ts` | `getUserMedia` / `getDisplayMedia` / file import, and the embedded-iframe permission check |
| `buffer.ts` | Mono fold, trimming, peak extraction, WAV encoding |
| `player.ts` | Clip playback. Corrects for `baseLatency + outputLatency` so the cursor matches what you hear |

### `src/analysis/` - the engine

| File | Purpose |
| --- | --- |
| `engine.ts` | Orchestrates the whole analysis. Start here |
| `dsp.ts` | Pure-TS FFT, chroma, onsets, tempo, harmonic-sum pitch tracking (551 lines, the densest file) |
| `essentia.ts` | Essentia.js WASM adapter. Every call returns `null` on failure so `dsp.ts` can take over |
| `chordEngine.ts` | Chord templates, Viterbi decode, key estimation |
| `simplify.ts` | Chord segments → one chord per bar |
| `melody.ts` | Pitch track → quantised, thinned riff |
| `reliability.ts` | Scores a finished progression for whether it settles into a key |
| `runAnalysis.ts` | Worker handoff, with a main-thread fallback |
| `analysis.worker.ts` | The worker itself |
| `testAudio.ts` | Synthetic progressions for the tests |
| `pipeline.test.ts` | End-to-end on synthetic progressions (5/5 recovered) |
| `voicings.test.ts` | **The one that matters.** Real guitar voicings; 3 of 7 fail. Section 4 |
| `reliability.test.ts` | The verdict thresholds |
| `fixtures.test.ts` | Runs real recordings from `fixtures/`, plus a WAV reader and its tests |

### `src/music/` - theory and the fretboard

| File | Purpose |
| --- | --- |
| `theory.ts` | Pitch classes, chord qualities, triad reduction, keys, Krumhansl-Kessler profiles |
| `chordShapes.ts` | The open and movable shape library, and voicing selection |
| `fretboard.ts` | Tunings, note-to-fret mapping (minimises hand movement) |
| `arrangement.ts` | Views over an `Arrangement`: bar grouping, display names, beat/time conversion |
| `capo.ts` | Capo and transposition search |
| `strumming.ts` | The six strum patterns and how one is suggested |
| `music.test.ts`, `polyphony.test.ts` | Theory and note-stacking coverage |

### `src/render/` - drawing

| File | Purpose |
| --- | --- |
| `tabGrid.ts` | **The tab, as characters.** Feeds both the screen and the PDF so they cannot drift |
| `ChordDiagram.tsx` | SVG chord boxes |
| `score.ts` | Builds an alphaTab `Score`. Now only used for the synth and the GP/alphaTex exports |
| `AlphaTabView.tsx` | alphaTab renderer. **Renders off-screen**; it exists only to be the synth |

### `src/components/` - the UI

| File | Purpose | On screen? |
| --- | --- | --- |
| `Stepper.tsx` | The four-step header. Also the only way back to Trim | yes |
| `CapturePanel.tsx` | Step 1 | yes |
| `WaveformTrimmer.tsx` | Step 2 | yes |
| `AnalyseSetup.tsx` | Step 3: title and Analyse | yes (engine settings hidden) |
| `PlaybackBar.tsx` | Transport: source, Play/Stop/Loop, scrub, speed | yes |
| `TabStaff.tsx` | The monospace tab with the moving playhead | yes |
| `ChordChart.tsx` | Bar grid of chords with diagrams, and the bar editor | yes |
| `PdfExportButton.tsx` | The only export in the UI | yes |
| `ResultSummary.tsx` | "What it heard" - tempo, key, tuning, capo, transpose, strum | **hidden** |
| `RiffEditor.tsx` | Per-note editing | **hidden** |
| `ReliabilityNote.tsx` | The "these chords are probably wrong" banner | **hidden** |

### `src/export/`

| File | Purpose |
| --- | --- |
| `pdf.ts` | The chord-chart PDF via jsPDF. The only export exposed in the UI |
| `ascii.ts` | Plain-text chart and tab. The PDF embeds this, so it is on the live path |
| `musicxml.ts` | MusicXML. Works, not exposed |
| `midi.ts` | Hand-written SMF. Works, not exposed |
| `guitarpro.ts` | GP7 and alphaTex via alphaTab. Works, not exposed |
| `download.ts` | Browser download helper |
| `export.test.ts` | Wellformedness and the invariants MuseScore and Guitar Pro care about |

### `src/state/`

| File | Purpose |
| --- | --- |
| `store.ts` | zustand store, the arrangement, and the undo/redo stack |
| `playhead.ts` | The playhead, deliberately **outside React**. See section 6 |

### `fixtures/`

| File | Purpose |
| --- | --- |
| `README.md` | How to add a real recording |
| `fixtures.json` | The manifest. **Currently empty** |

---

## 4. The open problem: chord accuracy on real guitar

This is the thing to fix. It is well diagnosed and not yet fixed.

### What is wrong

`src/analysis/voicings.test.ts` plays the app's own open-position shapes,
synthesised as real six-string chords, through the full pipeline:

```
x32010  C      ->  C     ok
332010  C/G    ->  C     ok
320003  G      ->  G     ok
320013  Gsus4  ->  G     ok
x32033  Cadd9  ->  Em    wrong
x32000  Cmaj7  ->  Em    wrong
320033  G      ->  D     wrong
```

A teacher also reported an open C on a real acoustic coming back as G, which I
could not reproduce in synthesis. The three failures above are the same family:
voicings with a ringing top end losing their root.

### Why

In all seven voicings **the root is not the loudest pitch class**. E leads a C
chord; B or D leads a G. That is just how a guitar sounds. The problem is that
the mechanism meant to correct for it makes it worse.

`engine.ts` builds a second chroma over MIDI 28-55 and passes it to the decoder
as `bassChroma`, to "reinforce the root". Measured, it leads with the third or
the fifth in every case:

```
C         E=1.00   C=0.37
Cmaj7     E=1.00   C=0.24
G         B=0.99   G=0.65
G 320033  D=0.97   B=0.82   G=0.71
```

Two causes:

1. **MIDI 55 is G3, the open fourth string.** The window is not the bass, it is
   the middle of the chord.
2. `computeChroma` divides spectral peaks by each harmonic number to guess
   fundamentals, so energy from the ringing top strings lands inside the window
   anyway.

The emission is `cosine(frame, template) * 6 + keyBias + bassTerm`. The bass term
is worth about **+0.66 on the wrong template and -0.11 on the right one**, on
every chord, against a key bias of **±0.05**. It is the largest single thing
moving chord names around and it points the wrong way.

Related, same root cause: the key estimate came back as Em for a clip containing
nothing but C chords.

### The proposed fix

Replace the register-window bass term with a real lowest-note detector: find the
lowest strong partial per frame and vote for that pitch class, which is what "the
bass note" actually means. Estimate: an hour, plus verification.

### Do not verify it against synthetic audio

This is the trap the project already fell into once. The original benchmark
measured 100% on five progressions and predicted nothing, because `testAudio.ts`
generates audio from the same assumptions the detector makes - equal temperament,
chord tones restated on every beat, a clean root in the bass. Degrading it on
purpose (vocals, cymbals, distortion) barely moved the number.

`fixtures/` exists to break that circularity. Put real recordings in, run
`npm run fixtures`, tune against that.

### Second-order issues found along the way

- **The melody tracker's default range is MIDI 52-84**, which is the entire lead
  vocal range, and `trackPitch` is monophonic. On anything with singing, the
  "riff" is a trace of the vocal.
- **There are no slash chords in the vocabulary**, so a `G/F#` is named after the
  F#.
- **`tuningOffset` is dead on the main path.** `engine.ts:51` only assigns it
  inside the `if (!chroma)` fallback branch, so on the Essentia path it stays 0
  and the "off concert pitch" warning can never fire.
- **Beat-tracking confidence was 0.118** on perfectly regular synthetic
  strumming, which is very low. A wrong bar grid scrambles chord-to-bar
  assignment independently of whether the harmony was read correctly.

---

## 5. Panels that are hidden, not deleted

`src/panels.ts` holds four flags, all `false`. Flip one to `true` to bring a
panel back; nothing else needs changing.

| Flag | What comes back | What its absence costs |
| --- | --- | --- |
| `SHOW_ENGINE_SETTINGS` | Chord vocabulary, stickiness, beats per bar, both pitch ranges, note confidence, riff quantisation, tempo and key overrides | Analysis always runs on `DEFAULT_SETTINGS` |
| `SHOW_WHAT_IT_HEARD` | Tempo, key, time signature, tuning, capo, transpose, strum pattern, Re-trim, Re-analyse | **The only editor for those fields.** Capo and transpose change every chord name and every fret. Re-trim/Re-analyse are still reachable from the stepper |
| `SHOW_RIFF_EDITOR` | Per-note pitch, length, octave shift, delete | The only per-note editor |
| `SHOW_RELIABILITY_NOTE` | The banner over the tab when a progression never settles into a key | Both wordings, amber and red. The chart is still scored, nothing says so |

These were hidden on request to get the page down to the transport, the tab and
the chord chart. They all still work.

---

## 6. Things that are easy to get backwards

Each of these cost time to find. The README has the first three in more detail.

- **Frets are always relative to the capo.** A chord is stored at concert pitch
  as detected. The *shape* chord is `detected + transpose - capo`; the
  *sounding* chord is `detected + transpose`.
- **alphaTab numbers strings 1..N from the lowest. MusicXML numbers string 1 as
  the highest.** Both conventions are in the codebase, each with a regression
  test, because flipping either silently produces mirror-image fingering.
- **A tab staff cannot paint a note with no string.** alphaTab's painter throws
  deep inside its worker and the whole score fails while the rest of the app
  looks fine. Everything reaching the riff track has a string assigned.
- **The tab grid is measured in characters.** The playhead is positioned in `ch`
  units, so a line whose characters and whose column arithmetic disagree by one
  puts the cursor on the wrong note. A test pins every line to the width its own
  system claims.
- **The playhead lives outside React** (`src/state/playhead.ts`). Driving it
  through component state meant a `setState` per animation frame, re-rendering
  the chart and the riff table sixty times a second - that render work *was* the
  lag it was supposed to be tracking. Components subscribe and snapshot a
  primitive id, so React bails out until the chord actually changes.
- **The decoder's `confidence` is not a probability.** It is a softmax over the
  whole vocabulary - 97 states for `standard` - and most of those share notes
  with the right answer, so a flawless run of Am F C G measures **0.214**. Its
  absolute value tracks vocabulary size, not correctness. Thresholding it once
  flagged a 100%-correct chart as unreliable. Do not gate anything on it.
- **The `github-pages` environment has a deployment-branch policy** pinned to
  whatever branch was default when Pages was switched on. Get it wrong and the
  build passes while the deploy job fails in about a second **with no logs at
  all**, because it never starts. Settings → Environments → github-pages.
- **`BASE_PATH` stays `/`** in the workflow. The site is served from the root of
  a custom domain; setting it to `/<repo>/` 404s every asset.

---

## 7. Decisions worth knowing about, including the reversals

The direction of travel has been consistently **towards less**. Several things
were built, shipped, and then removed. The history is in `git log`; the reasons:

- **Three output tiers became one.** Essential (chords only), Standard (chords +
  riff), Full (polyphonic Basic Pitch transcription). Only the middle one was
  ever useful. Removing Full took `@spotify/basic-pitch` and `@tensorflow/tfjs`
  with it, about 40MB.
- **Engraved notation became a monospace grid.** The tab was drawn by alphaTab
  for most of the project. It is the wrong document: a teacher reads
  `e|--7--5--|`, not a staff. `render/tabGrid.ts` now draws it and the PDF reads
  the same grid, so the two cannot drift.
- **alphaTab was demoted to being the synth.** It no longer draws anything but
  is still mounted, off-screen, because its player only exists attached to a
  rendered score. Mounting it lazily on switching to Synth was tried and
  reverted: the soundfont takes seconds to load, so the first press of Play did
  nothing, and unmounting left the transport holding a destroyed player.
- **Demucs stem separation was removed entirely.** It lived in `server/` and
  could only ever run on the machine serving the app - a browser will not let an
  https page reach localhost - so it was unusable from the deployed site by
  construction. `git log --diff-filter=D -- server/` finds it.
- **Mid-bar chord changes were removed.** `simplifyToBars` used to emit a second
  chord when one owned each half of a bar. Real songs do change mid-bar, but the
  chart could not tell a real change from the detector wobbling, and a bar with
  two stacked diagrams is harder to teach. The manual "Split in half" button went
  too, so one chord per bar is now true by construction.
- **The reliability banner was built and then hidden.** It measures the
  progression and says when it is probably wrong. The measurement is still
  running; only the display is off.
- **Six exporters, one button.** MusicXML, MIDI, GP7, alphaTex and ASCII all work
  and are all tested. Only the PDF is exposed, because that is the artefact a
  lesson needs. Re-exposing one is a button, not a feature.

---

## 8. Constraints of the build environment

Worth knowing before planning work that depends on the network.

- **Outbound access is very restricted.** Of the hosts tried: `github.com` and
  `api.github.com` reachable; `zenodo.org`, `huggingface.co`, `archive.org` all
  blocked. This matters because **GuitarSet** - 360 excerpts of solo acoustic
  guitar with chord and pitch annotations, CC licensed, exactly the calibration
  set this app needs - lives on Zenodo and cannot be fetched.
- **There is no audio decoder.** No ffmpeg, no sox. `fixtures/` is therefore
  **WAV only**; MP3 and M4A cannot be read at all. Phone voice memos are M4A and
  need converting first.
- **Essentia.js is AGPL-3.0.** It is dynamically imported and the app falls back
  to the built-in DSP without it, but distributing this means satisfying the AGPL
  or dropping the dependency. alphaTab is MPL-2.0, jsPDF is MIT.

---

## 9. What I would do next, in order

1. **Get real recordings into `fixtures/`.** Nothing else is worth doing first.
   Ten to twenty clips of known chords on a real guitar, same instrument and mic
   throughout. Until then every accuracy number in this repo measures a
   synthesiser.
2. **Fix the bass term** (section 4). Verify against the fixtures and against
   `voicings.test.ts` - the three wrong rows there are asserted deliberately, so
   a fix shows up as a failing test that you then update.
3. **Narrow the melody range to the guitar register.** MIDI 52-84 spans the whole
   vocal range and the tracker is monophonic, so on anything sung it follows the
   voice.
4. **Look at the beat grid.** Confidence of 0.118 on regular strumming suggests
   chords may be landing in the wrong bars independently of whether they were
   named correctly. The raw pre-simplification segments are already carried on
   `AnalysisResult.rawSegments` and would show this immediately.
5. **Then consider slash chords**, which need a bass detector to exist first -
   so it falls out of step 2 nearly for free.

Left alone deliberately: the UI. It has been through many rounds and is where
the owner wants it.
