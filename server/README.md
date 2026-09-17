# Guitar isolation service (phase 2 stub)

Optional companion service for the "Isolate the guitar" step. The app works
without it - phase 1 analyses the raw capture, which is fine for chords and is
the weak point for the note engine.

## What it does

Takes the trimmed clip, runs [Demucs](https://github.com/adefossez/demucs)
(`htdemucs`) or Spleeter over it, and returns a single stem as WAV. Guitars
mostly land in Demucs' `other` stem; pulling `vocals` out is often enough on its
own, because a vocal line is what most confuses the note engine.

## Status

`app.py` is a working skeleton: the HTTP contract, validation, and stem
selection are real, and the separation call itself raises
`NotImplementedError` until Demucs is wired in. That is deliberate - the client
treats a missing or failing service as "not available" and carries on.

## Contract

```
POST /separate
  multipart/form-data
    audio  - the clip (WAV preferred)
    model  - htdemucs | htdemucs_ft | spleeter:4stems
    stem   - other | vocals | drums | bass
  -> 200 audio/wav  (the requested stem)
  -> 400 bad request
  -> 501 separation backend not installed

GET /health -> { "ok": true, "models": [...] }
```

## Running it

```bash
cd server
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# Demucs is a large download; uncomment it in requirements.txt when you want it.
uvicorn app:app --reload --port 8000
```

Then put `http://localhost:8000` into the app's "Isolate the guitar" panel.

CORS is open to localhost by default; change `ALLOWED_ORIGINS` before exposing
this anywhere else. Nothing is persisted - clips are processed in a temporary
directory and deleted.
