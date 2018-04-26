'use babel';

import DectypeView from './dectype-view';
import { CompositeDisposable } from 'atom';

export default {

  dectypeView: null,
  modalPanel: null,
  subscriptions: null,

  activate(state) {
    this.dectypeView = new DectypeView(state.dectypeViewState);
    this.modalPanel = atom.workspace.addModalPanel({
      item: this.dectypeView.getElement(),
      visible: false
    });

    // Events subscribed to in atom's system can be easily cleaned up with a CompositeDisposable
    this.subscriptions = new CompositeDisposable();

    // Register command that toggles this view
    this.subscriptions.add(atom.commands.add('atom-workspace', {
      'dectype:toggle': () => this.toggle()
    }));
  },

  deactivate() {
    this.modalPanel.destroy();
    this.subscriptions.dispose();
    this.dectypeView.destroy();
  },

  serialize() {
    return {
      dectypeViewState: this.dectypeView.serialize()
    };
  },

  toggle() {
    console.log('Dectype was toggled!');
    return (
      this.modalPanel.isVisible() ?
      this.modalPanel.hide() :
      this.modalPanel.show()
    );
  }

};
