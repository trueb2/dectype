'use babel';

const Dectype = require('./dectype');

module.exports = new Dectype({
  workspace: atom.workspace,
  notificationManager: atom.notifications,
  commandRegistry: atom.commands,
  tooltipManager: atom.tooltips,
  clipboard: atom.clipboard,
  getAtomVersion: atom.getVersion.bind(atom)
})
