# MetalMundi AI Image Detector

Small FastAPI microservice that scores listing photos for AI-generation
likelihood. Warn-only: it never blocks uploads or rejects listings itself —
the MetalMundi API calls it in the background and shows the score to admins.

## How scoring works

Each image is classified by two open-source Hugging Face models:

- `umm-maybe/AI-image-detector` (labels: `artificial` / `human`)
- `Organika/sdxl-detector` (labels: `SDXL` / `Real`)

Per image, the score is the highest `artificial` / `ai` / `fake` label
probability (case-insensitive) across both models. Detectors that phrase
outputs as "not AI" (`human`, `real`, ...) contribute `1 - P(real)` instead,
so both models always vote. Final `aiScore` is 0-1, higher = more likely AI.

Corrupt or unreadable images never fail the batch: they come back with
`aiScore: null` plus an `error` string.

## Endpoints

| Method | Path      | Description                                                        |
| ------ | --------- | ------------------------------------------------------------------ |
| GET    | `/health` | `{ "status": "ok", "modelsLoaded": true }`                          |
| POST   | `/detect` | multipart form field `files` (one or more images) → see below     |

`POST /detect` response:

```json
{
  "results": [
    { "name": "front.jpg", "aiScore": 0.031 },
    { "name": "broken.jpg", "aiScore": null, "error": "unreadable image (UnidentifiedImageError)" }
  ]
}
```

## Run locally

```bash
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 7860
```

First startup downloads both models (~1-2 GB with PyTorch); after that they
are cached. The Dockerfile pre-downloads them at build time.

## Deploy (free Hugging Face Space)

1. Create a new **Docker** Space on huggingface.co (free CPU tier).
2. Push this folder (`main.py`, `requirements.txt`, `Dockerfile`, `README.md`).
3. The Space builds and serves on port 7860.
4. Set `ML_SERVICE_URL` in the MetalMundi API to
   `https://<your-space>.hf.space` (no trailing slash needed).
