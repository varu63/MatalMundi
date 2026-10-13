'use strict';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const env = require('../config/env');
const logger = require('../utils/logger');

const UPLOAD_ROOT = path.resolve(__dirname, '../../uploads');

let cloudinary = null;
function getCloudinary() {
  if (cloudinary) return cloudinary;
  const { cloudName, apiKey, apiSecret } = env.cloudinary;
  if (!cloudName || !apiKey || !apiSecret) return null;
  // Lazily require so the dependency isn't needed when unused.
  const { v2 } = require('cloudinary');
  v2.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
  cloudinary = v2;
  return cloudinary;
}

function isCloudinaryEnabled() {
  return Boolean(env.cloudinary.cloudName && env.cloudinary.apiKey && env.cloudinary.apiSecret);
}

const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function extFromMime(mimetype) {
  return EXT_BY_MIME[mimetype] || 'bin';
}

function uploadToCloudinary(buffer, { folder }) {
  const cld = getCloudinary();
  return new Promise((resolve, reject) => {
    const stream = cld.uploader.upload_stream(
      {
        folder: `${env.cloudinary.folder}/${folder}`,
        resource_type: 'image',
        public_id: `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`,
        overwrite: false,
      },
      (err, result) => {
        if (err) return reject(err);
        return resolve({
          url: result.secure_url,
          publicId: result.public_id,
          provider: 'cloudinary',
        });
      }
    );
    stream.on('error', reject);
    stream.end(buffer, 'binary');
  });
}

async function uploadToLocal(buffer, { folder, mimetype }) {
  const dir = path.join(UPLOAD_ROOT, folder);
  await fs.mkdir(dir, { recursive: true });
  const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${extFromMime(mimetype)}`;
  await fs.writeFile(path.join(dir, filename), buffer);
  const publicId = `${folder}/${filename}`;
  return {
    url: `${env.apiPublicUrl}/uploads/${publicId}`,
    publicId,
    provider: 'local',
  };
}

/**
 * Uploads a single in-memory image buffer. Uses Cloudinary when configured,
 * otherwise falls back to local disk so the workflow works without creds.
 */
async function uploadImage(buffer, { folder = 'waste', mimetype = 'image/jpeg' } = {}) {
  if (isCloudinaryEnabled()) {
    return uploadToCloudinary(buffer, { folder, mimetype });
  }
  return uploadToLocal(buffer, { folder, mimetype });
}

/**
 * Best-effort deletion of an uploaded asset. Never throws — uploads that are
 * cleaned up should not break the main request flow.
 */
async function deleteAsset({ publicId, provider } = {}) {
  if (!publicId) return false;
  try {
    if (provider === 'cloudinary' && isCloudinaryEnabled()) {
      await getCloudinary().uploader.destroy(publicId, { resource_type: 'image' });
      return true;
    }
    if (provider === 'local') {
      await fs.unlink(path.join(UPLOAD_ROOT, publicId));
      return true;
    }
  } catch (err) {
    logger.warn(`Failed to delete asset ${publicId}: ${err.message}`);
  }
  return false;
}

/** Deletes many assets; returns the count removed. */
async function deleteAssets(assets = []) {
  let removed = 0;
  const list = Array.isArray(assets) ? assets : Object.values(assets);
  for (const asset of list) {
    if (asset && asset.publicId) {
      if (await deleteAsset(asset)) removed += 1;
    }
  }
  return removed;
}

module.exports = {
  uploadImage,
  deleteAsset,
  deleteAssets,
  isCloudinaryEnabled,
  UPLOAD_ROOT,
};
