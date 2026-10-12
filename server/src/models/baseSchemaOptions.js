'use strict';

/**
 * Global Mongoose schema options applied to every model:
 * - toJSON/toObject hide __v
 * - virtuals enabled so `id` is available
 * - no transform of _id (frontend uses `id`)
 */
function baseSchemaOptions(overrides = {}) {
  return {
    timestamps: true,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform(_doc, ret) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.passwordHash;
        delete ret.__v;
        return ret;
      },
      ...(overrides.toJSON || {}),
    },
    toObject: {
      virtuals: true,
      versionKey: false,
      transform(_doc, ret) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
      ...(overrides.toObject || {}),
    },
    ...overrides,
  };
}

module.exports = { baseSchemaOptions };
