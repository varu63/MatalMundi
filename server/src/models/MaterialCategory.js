'use strict';

const mongoose = require('mongoose');
const { baseSchemaOptions } = require('./baseSchemaOptions');

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true, index: true },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
    description: { type: String, trim: true, maxlength: 500, default: '' },
    icon: { type: String, trim: true, default: 'recycle' },
    sortOrder: { type: Number, default: 0 },
    active: { type: Boolean, default: true, index: true },
  },
  baseSchemaOptions(),
);

categorySchema.pre('validate', function setSlug(next) {
  if (!this.slug && this.name) {
    this.slug = this.name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
  next();
});

module.exports = mongoose.model('MaterialCategory', categorySchema);
