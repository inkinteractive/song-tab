"""
Guitar isolation service (phase 2 stub).

The HTTP contract, validation and stem selection are real. The separation call
itself is left unimplemented until Demucs is installed, and returns 501 so the
client can fall back to analysing the raw capture.
"""

from __future__ import annotations

import logging
import os
import shutil
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

LOG = logging.getLogger("song-tab.separate")

ALLOWED_ORIGINS = os.environ.get(
    "ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:4173"
).split(",")

MODELS = {
    "htdemucs": {"stems": ["drums", "bass", "other", "vocals"]},
    "htdemucs_ft": {"stems": ["drums", "bass", "other", "vocals"]},
    "spleeter:4stems": {"stems": ["drums", "bass", "other", "vocals"]},
}

MAX_UPLOAD_BYTES = 50 * 1024 * 1024

app = FastAPI(title="song-tab separation", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)


def demucs_available() -> bool:
    try:
        import demucs.separate  # noqa: F401
    except Exception:
        return False
    return True


@app.get("/health")
def health() -> JSONResponse:
    return JSONResponse(
        {
            "ok": True,
            "models": list(MODELS),
            "backend_installed": demucs_available(),
        }
    )


def run_separation(source: Path, workdir: Path, model: str, stem: str) -> Path:
    """
    Run the separation backend and return the path of the requested stem.

    Not implemented yet. With `demucs` installed the body is roughly:

        import demucs.separate
        demucs.separate.main(
            ["-n", model, "--two-stems", stem, "-o", str(workdir), str(source)]
        )
        return next(workdir.rglob(f"{stem}.wav"))
    """
    raise NotImplementedError(
        "Separation backend is not wired up yet. Install demucs and implement "
        "run_separation(); see server/README.md."
    )


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

    payload = await audio.read()
    if not payload:
        raise HTTPException(400, "Empty upload.")
    if len(payload) > MAX_UPLOAD_BYTES:
        raise HTTPException(400, f"Clip is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)}MB.")

    workdir = Path(tempfile.mkdtemp(prefix="song-tab-"))
    try:
        source = workdir / "input.wav"
        source.write_bytes(payload)
        try:
            produced = run_separation(source, workdir, model, stem)
        except NotImplementedError as exc:
            LOG.warning("separation requested but backend missing: %s", exc)
            raise HTTPException(501, str(exc)) from exc
        return Response(content=produced.read_bytes(), media_type="audio/wav")
    finally:
        # Nothing is kept: the clip is someone's lesson recording.
        shutil.rmtree(workdir, ignore_errors=True)
