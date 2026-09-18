"""
Guitar isolation service (phase 2).

Runs Demucs over a trimmed clip and returns one stem as WAV. Guitars mostly
land in Demucs' `other` stem; pulling `vocals` out is often enough on its own,
because a vocal line is what most confuses the note engine.

The client treats a missing, failing or slow service as "not available" and
analyses the raw capture instead, so this never becomes a hard dependency.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import tempfile
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

logging.basicConfig(level=logging.INFO)
LOG = logging.getLogger("song-tab.separate")

ALLOWED_ORIGINS = os.environ.get(
    "ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:4173"
).split(",")

# Stem order is Demucs'. `other` is where guitars and keys end up.
DEMUCS_STEMS = ["drums", "bass", "other", "vocals"]
MODELS: dict[str, dict[str, Any]] = {
    "htdemucs": {"stems": DEMUCS_STEMS, "backend": "demucs"},
    "htdemucs_ft": {"stems": DEMUCS_STEMS, "backend": "demucs"},
}

MAX_UPLOAD_BYTES = 50 * 1024 * 1024
# Separation is CPU-bound and single-threaded per request; one at a time keeps
# a lesson-length clip predictable rather than thrashing.
SEPARATION_LOCK = asyncio.Lock()

app = FastAPI(title="song-tab separation", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

_separators: dict[str, Any] = {}


def backend_available() -> bool:
    try:
        import demucs.api  # noqa: F401
    except Exception:
        return False
    return True


def get_separator(model: str):
    """Separators hold model weights, so build each one once and keep it."""
    if model not in _separators:
        from demucs.api import Separator

        LOG.info("loading demucs model %s (first call downloads weights)", model)
        _separators[model] = Separator(model=model, device="cpu", progress=False)
    return _separators[model]


@app.get("/health")
def health() -> JSONResponse:
    return JSONResponse(
        {
            "ok": True,
            "models": list(MODELS),
            "backend_installed": backend_available(),
            "loaded": list(_separators),
        }
    )


def run_separation(source: Path, workdir: Path, model: str, stem: str) -> Path:
    """Separate `source` and write the requested stem as WAV. Returns its path."""
    from demucs.api import save_audio

    separator = get_separator(model)
    started = time.monotonic()
    _origin, separated = separator.separate_audio_file(source)
    LOG.info("separated %s in %.1fs", source.name, time.monotonic() - started)

    if stem not in separated:
        raise HTTPException(500, f"Model {model!r} produced no {stem!r} stem.")

    out = workdir / f"{stem}.wav"
    save_audio(separated[stem], out, samplerate=separator.samplerate)
    return out


@app.post("/separate")
async def separate(
    audio: UploadFile = File(...),
    model: str = Form("htdemucs"),
    stem: str = Form("other"),
) -> Response:
    if model not in MODELS:
        raise HTTPException(400, f"Unknown model {model!r}. Choose one of {list(MODELS)}.")
    if stem not in MODELS[model]["stems"]:
        raise HTTPException(400, f"Model {model!r} has no stem {stem!r}.")
    if not backend_available():
        raise HTTPException(
            501,
            "Demucs is not installed in this environment. See server/README.md.",
        )

    payload = await audio.read()
    if not payload:
        raise HTTPException(400, "Empty upload.")
    if len(payload) > MAX_UPLOAD_BYTES:
        raise HTTPException(400, f"Clip is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)}MB.")

    workdir = Path(tempfile.mkdtemp(prefix="song-tab-"))
    try:
        source = workdir / "input.wav"
        source.write_bytes(payload)
        async with SEPARATION_LOCK:
            # Demucs is blocking; keep the event loop free so /health still answers.
            produced = await asyncio.to_thread(run_separation, source, workdir, model, stem)
        return Response(
            content=produced.read_bytes(),
            media_type="audio/wav",
            headers={"X-Separation-Model": model, "X-Separation-Stem": stem},
        )
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - surfaced to the client as 500
        LOG.exception("separation failed")
        raise HTTPException(500, f"Separation failed: {exc}") from exc
    finally:
        # Nothing is kept: the clip is someone's lesson recording.
        shutil.rmtree(workdir, ignore_errors=True)
