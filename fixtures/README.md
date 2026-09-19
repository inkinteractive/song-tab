# Real recordings

Synthesised audio is the reason the chord engine measured 100% and then got a
C wrong on a real guitar: the test audio was built from the same assumptions
the detector makes. This directory is the fix. Put actual recordings here, say
what you played, and the numbers start meaning something.

## Adding a recording

1. **Record a WAV.** Not MP3 or M4A - there is no audio decoder in the build
   environment, so anything compressed cannot be read. Any sample rate, mono or
   stereo, 16/24/32-bit PCM or 32-bit float.
   - Voice Memos on a Mac or iPhone gives M4A. Export or convert to WAV first
     (QuickTime, Audacity, or `ffmpeg -i in.m4a out.wav` locally).
   - Audacity: *File > Export > Export as WAV*.
2. **Keep it short.** Ten to thirty seconds. These live in git, and a minute of
   44.1kHz stereo is about 10MB.
3. **Drop the file in this directory** and add a row to `fixtures.json`:

```json
[
  {
    "file": "open-c.wav",
    "chords": ["C", "C", "C", "C"],
    "note": "open C x32010, four bars, steel string, phone mic"
  }
]
```

`chords` is **what you actually played, one entry per bar**, written the way
the app writes them: `C`, `Am`, `F#m`, `Cadd9`, `Gsus4`, `Bb`. If you played
one chord and let it ring for four bars, that is four entries.

The `note` is free text and worth filling in: the voicing, the guitar, the mic,
whether anything was ringing over from the chord before. That is usually where
the answer turns out to be.

## Seeing the result

```bash
npm run fixtures
```

It prints what you played against what the engine heard, per bar, with an
accuracy figure. Nothing in `src/` is tuned against this until there is enough
of it to be worth tuning against - the point is to have a number that is not
measuring my own synthesiser.

## What to record first

The cases that break today (see `src/analysis/voicings.test.ts`) all involve a
ringing top end, so these are worth having:

| Clip | Why |
| --- | --- |
| Open C `x32010`, four bars | The reported failure. Does it come back as C? |
| C then G, two bars each | Does the change land on the right bar? |
| Cadd9 `x32033` | Synthesised, this comes back as Em |
| Cmaj7 `x32000` | Synthesised, this comes back as Em |
| Big G `320033` | Synthesised, this comes back as D |
| Whatever you played when a C came back as G | The actual case |

Same guitar, same mic, same distance for all of them if you can - it makes the
comparison between clips mean something.
