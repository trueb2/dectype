'use babel';

const {CompositeDisposable}  = require('atom');

const DecNet = require('./net/dec-net');
const PortalBindingManager = require('./portal-binding-manager');
const StatusIndicator = require('./components/status-indicator');

module.exports =
class Dectype  {
  config = {
    startPath: {
      type: 'string',
      default: '/Users/jwtrueb/Documents/dec/start.py'
    },
    homePath: {
      type: 'string',
      default: '/Users/jwtrueb/.dec/'
    },
    socketPath: {
      type: 'string',
      default: 'aaadectype/uds_socket'
    }
  };

  constructor (options) {
    const {
      workspace, notificationManager, commandRegistry,
      tooltipManager, clipboard } = options;
    this.clipboard = clipboard;
    this.workspace = workspace;
    this.tooltipManager = tooltipManager;
    this.commandRegistry = commandRegistry;
    this.notificationManager = notificationManager;
    this.subscriptions = new CompositeDisposable();

    this.decNet = null;
    this.decNetPromise = null;
    this.portalBindingManagerPromise = null;
    this.devPromise = new Promise((resolve) => {
      this.resolveDevPromise = resolve;
    })
  }

  async consumeStatusBar (statusBar) {
    const dev = await this.devPromise;
    const decNet = await this.getDecNet(this.dev);
    const portalBindingManager = await this.getPortalBindingManager();
    this.statusIndicator = new StatusIndicator({
      statusBar,
      decNet,
      portalBindingManager,
      tooltipManager: this.tooltipManager,
      commandRegistry: this.commandRegistry,
      clipboard: this.clipboard,
      workspace: this.workspace,
      notificationManager: this.notificationManager,
    });

    this.statusIndicator.attach()
  }

  getDecNet (dev) {
    if (!this.decNetPromise) {
      this.decNet = new DecNet({dev});
      this.decNetPromise = new Promise(async (resolve, reject) => {
        this.decNet.initialize({onReady: () => resolve(this.decNet)});
      });
    }

    return this.decNetPromise;
  }

  getPortalBindingManager () {
    if (!this.portalBindingManagerPromise) {
      this.portalBindingManagerPromise = new Promise(async (resolve) => {
        if (this.decNet) {
          resolve(new PortalBindingManager({
              decNet: this.decNet,
              workspace: this.workspace,
              notificationManager: this.notificationManager
          }));
        } else {
          this.portalBindingManagerPromise = null;
          resolve(null);
        }
      })
    }

    return this.portalBindingManagerPromise;
  }

  activate() {
    this.subscriptions.add(atom.commands.add('atom-workspace', {
      'Dectype:toggle': () => this.handleToggle(),
      'Dectype:toggle-dev-1': () => this.handleToggle(1),
      'Dectype:toggle-dev-2': () => this.handleToggle(2)
    }));
  }

  async deactivate() {
    this.subscriptions.dispose();

    if (this.decNetPromise) {
      const decNet = await this.decNetPromise;
      decNet.dispose();
    }
    if (this.statusIndicator) this.statusIndicator.destroy()
  }

  async handleToggle(dev) {
    console.log('Dectype was toggled');
    this.dev = dev;
    console.log('Dev is set to', this.dev);
    this.resolveDevPromise(this.dev);
    if (!this.running) {
      this.running = true;
      await this.getDecNet(dev);
    } else {
      if (this.decNet) this.decNet.dispose();
      this.decNet = null;
      this.running = false;
    }
  }
};
