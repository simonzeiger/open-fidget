'use strict';

const path = require('path');
const registry = require('../src/engine/registry');
const prototypes = require('../src/engine/prototypes');
const { validateModeDefinition } = require('../src/engine/contract');

/**
 * Node-only mode resolver for CLI scripts (`validate.js`, `playtest.js`).
 * Checks built-in registry modes first, then static prototypes by id, and
 * finally resolves a local file path.
 */
function resolveMode(idOrPath) {
  if (!idOrPath || typeof idOrPath !== 'string') {
    throw new Error('Mode id or file path is required');
  }

  const builtIn = registry.getMode(idOrPath);
  if (builtIn) {
    return builtIn;
  }

  if (Array.isArray(prototypes)) {
    const proto = prototypes.find((m) => m && m.id === idOrPath);
    if (proto) {
      validateModeDefinition(proto);
      return proto;
    }
  }

  const absPath = path.resolve(process.cwd(), idOrPath);
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const loaded = require(absPath);
  const mode = loaded && loaded.default ? loaded.default : loaded;
  validateModeDefinition(mode);
  return mode;
}

module.exports = {
  resolveMode,
};
