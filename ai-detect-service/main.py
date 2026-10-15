"""MetalMundi AI-image detection microservice.

Scores listing photos for AI-generation likelihood using two open-source
Hugging Face image-classification models:
  - umm-maybe/AI-image-detector   (labels: artificial / human)
  - Organika/sdxl-detector        (labels: SDXL / Real)

Warn-only service: it never blocks or rejects anything itself. The MetalMundi
API calls POST /detect and decides how to surface the score to admins.
"""

import io
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError
from transformers import pipeline

MODEL_IDS = [
    "umm-maybe/AI-image-detector",
    "Organika/sdxl-detector",
]

# Primary AI labels per the API contract...
AI_LABELS = {"artificial", "ai", "fake"}
# ...and the complement for detectors that phrase outputs as "not AI"
# (e.g. human / real), so their vote still counts as 1 - P(real).
REAL_LABELS = {"human", "real", "natural", "genuine", "photo"}

_detectors = []


def load_models():
    """Load both pipelines once. Called at startup (and by the Docker build)."""
    global _detectors
    _detectors = [pipeline("image-classification", model=m) for m in MODEL_IDS]
    return _detectors


def score_predictions(predictions):
    """Single 0-1 AI likelihood from one model's prediction list."""
    ai_hits = [p["score"] for p in predictions if p["label"].strip().lower() in AI_LABELS]
    if ai_hits:
        return max(ai_hits)
    real_hits = [p["score"] for p in predictions if p["label"].strip().lower() in REAL_LABELS]
    if real_hits:
        return 1.0 - max(real_hits)
    return None


@asynccontextmanager
async def lifespan(_app):
    load_models()
    yield


app = FastAPI(title="MetalMundi AI Image Detector", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok", "modelsLoaded": len(_detectors) == len(MODEL_IDS)}


@app.post("/detect")
async def detect(files: list[UploadFile] = File(...)):
    if not _detectors:
        raise HTTPException(status_code=503, detail="Models not loaded yet")

    results = []
    for f in files:
        name = f.filename or "unnamed"
        try:
            image = Image.open(io.BytesIO(await f.read())).convert("RGB")
        except (UnidentifiedImageError, OSError, ValueError) as exc:
            results.append({"name": name, "aiScore": None, "error": f"unreadable image ({type(exc).__name__})"})
            continue

        scores = [s for d in _detectors if (s := score_predictions(d(image))) is not None]
        if scores:
            results.append({"name": name, "aiScore": max(scores)})
        else:
            results.append({"name": name, "aiScore": None, "error": "no recognised detector labels"})
    return {"results": results}
