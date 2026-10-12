'use strict';

const multer = require('multer');
const ApiError = require('../utils/ApiError');

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_FILES = 10;

const storage = multer.memoryStorage();

function fileFilter(_req, file, cb) {
  if (ALLOWED_MIME.includes(file.mimetype)) return cb(null, true);
  return cb(ApiError.badRequest(`Unsupported image type: ${file.mimetype}. Use JPEG, PNG or WebP.`));
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
});

// Expected multipart fields for a waste submission.
const wasteImageUpload = upload.fields([
  { name: 'front', maxCount: 1 },
  { name: 'back', maxCount: 1 },
  { name: 'left', maxCount: 1 },
  { name: 'right', maxCount: 1 },
  { name: 'additional', maxCount: MAX_FILES },
]);

// Optional listing images used when publishing a marketplace listing.
const listingImageUpload = upload.fields([{ name: 'images', maxCount: 8 }]);

module.exports = {
  upload,
  wasteImageUpload,
  listingImageUpload,
  ALLOWED_MIME,
  MAX_FILE_BYTES,
  MAX_FILES,
};
