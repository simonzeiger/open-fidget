'use strict';

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

module.exports = {
  MODES,
  MODE_LIST,
  getMode,
  listModeIds,
};
