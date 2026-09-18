"""
Contract tests for the separation service.

Demucs' model weights cannot be downloaded in every environment (this one
blocks the weight hosts), so the separator is stubbed. What is under test is
everything around the model: validation, stem selection, WAV encoding, the
response headers, and that the uploaded clip is deleted either way.
"""

import io
import struct
import wave
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import app as service


def make_wav(seconds: float = 0.5, rate: int = 44100) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        frames = int(seconds * rate)
        w.writeframes(b"".join(struct.pack("<h", (i % 400) - 200) for i in range(frames)))
    return buf.getvalue()


@pytest.fixture
def client(monkeypatch):
    """A separator that writes a recognisable WAV instead of running Demucs."""
    captured = {}

    def fake_run(source: Path, workdir: Path, model: str, stem: str) -> Path:
        captured["source_exists"] = source.exists()
        captured["model"] = model
        captured["stem"] = stem
        out = workdir / f"{stem}.wav"
        out.write_bytes(make_wav(0.25))
        return out

    monkeypatch.setattr(service, "run_separation", fake_run)
    monkeypatch.setattr(service, "backend_available", lambda: True)
    c = TestClient(service.app)
    c.captured = captured
    return c


def test_health_reports_models(client):
    body = client.get("/health").json()
    assert body["ok"] is True
    assert "htdemucs" in body["models"]


def test_separate_returns_wav_and_headers(client):
    res = client.post(
        "/separate",
        files={"audio": ("clip.wav", make_wav(), "audio/wav")},
        data={"model": "htdemucs", "stem": "other"},
    )
    assert res.status_code == 200
    assert res.headers["content-type"] == "audio/wav"
    assert res.headers["X-Separation-Model"] == "htdemucs"
    assert res.headers["X-Separation-Stem"] == "other"
    assert res.content[:4] == b"RIFF"
    # The clip really reached the separator as a file on disk.
    assert client.captured["source_exists"] is True
    assert client.captured["stem"] == "other"


def test_unknown_model_is_rejected(client):
    res = client.post(
        "/separate",
        files={"audio": ("clip.wav", make_wav(), "audio/wav")},
        data={"model": "not-a-model", "stem": "other"},
    )
    assert res.status_code == 400


def test_unknown_stem_is_rejected(client):
    res = client.post(
        "/separate",
        files={"audio": ("clip.wav", make_wav(), "audio/wav")},
        data={"model": "htdemucs", "stem": "banjo"},
    )
    assert res.status_code == 400


def test_empty_upload_is_rejected(client):
    res = client.post(
        "/separate",
        files={"audio": ("clip.wav", b"", "audio/wav")},
        data={"model": "htdemucs", "stem": "other"},
    )
    assert res.status_code == 400


def test_oversized_upload_is_rejected(client):
    big = b"\0" * (service.MAX_UPLOAD_BYTES + 1)
    res = client.post(
        "/separate",
        files={"audio": ("clip.wav", big, "audio/wav")},
        data={"model": "htdemucs", "stem": "other"},
    )
    assert res.status_code == 400


def test_missing_backend_reports_501(client, monkeypatch):
    monkeypatch.setattr(service, "backend_available", lambda: False)
    res = client.post(
        "/separate",
        files={"audio": ("clip.wav", make_wav(), "audio/wav")},
        data={"model": "htdemucs", "stem": "other"},
    )
    assert res.status_code == 501


def test_temp_directory_is_removed_even_on_failure(client, monkeypatch, tmp_path):
    seen = {}

    def exploding(source: Path, workdir: Path, model: str, stem: str) -> Path:
        seen["workdir"] = workdir
        raise RuntimeError("model blew up")

    monkeypatch.setattr(service, "run_separation", exploding)
    res = client.post(
        "/separate",
        files={"audio": ("clip.wav", make_wav(), "audio/wav")},
        data={"model": "htdemucs", "stem": "other"},
    )
    assert res.status_code == 500
    # Lesson recordings do not linger on disk.
    assert not seen["workdir"].exists()
