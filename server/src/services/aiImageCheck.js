'use strict';

/**
 * Warn-only AI-image screening for marketplace listings.
 *
 * Downloads the listing's photos, sends them to the ai-detect-service
 * (ai-detect-service/, FastAPI), and stores the verdict on the listing row.
 * Admins see a warning badge; listings are NEVER auto-rejected or hidden.
 *
 * Contract with callers: this module NEVER throws. Any failure is recorded
 * as imageCheckStatus='error' on the listing and a single console.error line
 * (message only — never image data or URLs, which may carry signed tokens).
 */

const env = require('../config/env');
const logger = require('../utils/logger');
const listingsRepo = require('../repositories/listings');

const DETECT_TIMEOUT_MS = 60_000;
const IMAGE_DOWNLOAD_TIMEOUT_MS = 30_000;

function timeoutSignal(ms) {
  return AbortSignal.timeout(ms);
}

/** Downloads one image and appends it to the multipart form. */
async function appendImage(form, image, index) {
  const res = await fetch(image.url, { signal: timeoutSignal(IMAGE_DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`image download failed with status ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const name = image.url.split('/').filter(Boolean).pop() || `image-${index + 1}.jpg`;
  form.append('files', new Blob([bytes]), name);
}

async function runAiImageCheck(listingId, images) {
  const list = Array.isArray(images) ? images.filter((i) => i && i.url) : [];
  if (!env.mlServiceUrl) return; // skipped silently when no service is configured
  try {
    let perImage;
    if (list.length === 0) {
      perImage = [];
    } else {
      const form = new FormData();
      for (const [index, image] of list.entries()) {
        await appendImage(form, image, index);
      }
      const res = await fetch(`${env.mlServiceUrl}/detect`, {
        method: 'POST',
        body: form,
        signal: timeoutSignal(DETECT_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`ML service responded ${res.status}`);
      const data = await res.json().catch(() => {
        throw new Error('ML service returned a non-JSON body');
      });
      const results = Array.isArray(data.results) ? data.results : [];
      perImage = results.map((r) => ({ name: r.name, aiScore: r.aiScore ?? null }));
    }

    const scores = perImage.map((p) => p.aiScore).filter((s) => typeof s === 'number');
    const maxAiScore = scores.length ? Math.max(...scores) : null;
    await listingsRepo.updateById(listingId, {
      imageCheckStatus: 'done',
      imageCheckFlagged: maxAiScore !== null && maxAiScore >= env.aiFlagThreshold,
      imageCheckMaxScore: maxAiScore,
      imageCheckPerImage: perImage,
      imageCheckError: null,
      imageCheckedAt: new Date(),
    });
  } catch (err) {
    await listingsRepo
      .updateById(listingId, {
        imageCheckStatus: 'error',
        imageCheckError: String(err && err.message).slice(0, 500),
      })
      .catch(() => {});
    logger.error(`[aiImageCheck] listing ${listingId}: ${err && err.message}`);
  }
}

/** Fire-and-forget wrapper for request handlers. */
function scheduleAiImageCheck(listing) {
  if (!env.mlServiceUrl || !listing) return;
  runAiImageCheck(listing.id, listing.images).catch(() => {});
}

module.exports = { runAiImageCheck, scheduleAiImageCheck };
