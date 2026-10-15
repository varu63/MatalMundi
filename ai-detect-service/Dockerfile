# Free-tier Hugging Face Space image. Downloads both models at build time so
# the container starts warm; serves on port 7860 as Spaces expects.
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Warm the HF cache with both detectors (CPU weights, runs at build time).
RUN python -c "from main import load_models; load_models()"

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]
