'use strict';

const path = require('path');
const { validateModeDefinition } = require('./contract');
const SafeCrackerMode = require('./safeCracker');
const RhythmEchoMode = require('./rhythmEcho');
const VirtualMarbleMode = require('./virtualMarble');
const HotColdHuntMode = require('./hotColdHunt');
const FidgetSandboxMode = require('./fidgetSandbox');

const MODE_LIST = [
  SafeCrackerMode,
  RhythmEchoMode,
  VirtualMarbleMode,
  HotColdHuntMode,
  FidgetSandboxMode,
];

const MODES = {};
for (const mode of MODE_LIST) {
  validateModeDefinition(mode);
  MODES[mode.id] = mode;
}

function getMode(id) {
  return MODES[id] || null;
}

function listModeIds() {
  return MODE_LIST.map((m) => m.id);
}

/**
 * Resolves either a registered mode id (e.g. 'safe') or a path to a custom
 * mode module (e.g. './src/engine/_template.js') so agents can validate new
 * prototypes before registering them in the app.
 */
function resolveMode(idOrPath) {
  if (!idOrPath || typeof idOrPath !== 'string') {
    throw new Error('Mode id or file path is required');
  }
  if (MODES[idOrPath]) {
    return MODES[idOrPath];
  }
  const absPath = path.resolve(process.cwd(), idOrPath);
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const loaded = require(absPath);
  const mode = loaded && loaded.default ? loaded.default : loaded;
  validateModeDefinition(mode);
  return mode;
}

module.exports = {
  MODES,
  MODE_LIST,
  getMode,
  listModeIds,
  resolveMode,
};
