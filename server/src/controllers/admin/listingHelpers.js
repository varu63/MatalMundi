'use strict';

const { uploadImage, deleteAssets } = require('../../services/storageService');

/**
 * Resolves the image set for a marketplace listing. When the admin uploads
 * listing images these are used; otherwise the submission's primary photos are
 * reused (never seller-identifiable metadata, just photos).
 */
async function storageUploadForListing(req, submission) {
  const files = req.files && req.files.images;
  if (!files || files.length === 0) {
    const sides = ['front', 'back', 'left', 'right'];
    return uploadImports(submission.images, sides);
  }

  const uploaded = [];
  try {
    const folder = 'listings';
    for (const file of files) {
      // eslint-disable-next-line no-await-in-loop
      const asset = await uploadImage(file.buffer, { folder, mimetype: file.mimetype });
      uploaded.push(asset);
    }
    return flipped(uploaded);
  } catch (err) {
    await deleteAssets(uploaded);
    throw err;
  }
}

function uploadImports(images, sides) {
  const result = [];
  for (const side of sides) {
    if (images && images[side] && images[side].url) result.push(images[side]);
  }
  return result;
}

function flipped(list) {
  // keep { url, publicId, provider } shape only
  return list.map((a) => ({ url: a.url, publicId: a.publicId, provider: a.provider }));
}

module.exports = { storageUploadForListing };