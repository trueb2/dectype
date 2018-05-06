const {Emitter} = require('atom');
const GuestPortalBinding = require('./bindings/guest-portal-binding');
const HostPortalBinding = require('./bindings/host-portal-binding');

module.exports =
  class PortalBindingManager {
    constructor({decNet, workspace, notificationManager}) {
      this.decNet = decNet;
      this.workspace = workspace;
      this.notificationManager = notificationManager;

      this.emitter = new Emitter();

      this.hostPortalBindingPromise = null;
      this.promisesByGuestPortalId = new Map();
    }

    dispose() {
      const disposePromises = [];

      if (this.hostPortalBindingPromise) {
        const disposePromise = this.hostPortalBindingPromise.then((portalBinding) => {
          portalBinding.close()
        });
        disposePromises.push(disposePromise)
      }

      this.promisesByGuestPortalId.forEach(async (portalBindingPromise) => {
        const disposePromise = portalBindingPromise.then((portalBinding) => {
          if (portalBinding) portalBinding.leave()
        });
        disposePromises.push(disposePromise)
      });

      return Promise.all(disposePromises)
    }

    createHostPortalBinding() {
      if (this.hostPortalBindingPromise == null) {
        this.hostPortalBindingPromise = this._createHostPortalBinding();
        this.hostPortalBindingPromise.then((binding) => {
          if (!binding) this.hostPortalBindingPromise = null
        })
      }

      return this.hostPortalBindingPromise
    }

    async _createHostPortalBinding() {
      const portalBinding = new HostPortalBinding({
        decNet: this.decNet,
        workspace: this.workspace,
        notificationManager: this.notificationManager,
        didDispose: () => {
          this.didDisposeHostPortalBinding()
        }
      });

      if (await portalBinding.initialize()) {
        this.emitter.emit('did-change');
        return portalBinding
      }
    }

    getHostPortalBinding() {
      return this.hostPortalBindingPromise
        ? this.hostPortalBindingPromise
        : Promise.resolve(null)
    }

    didDisposeHostPortalBinding() {
      this.hostPortalBindingPromise = null;
      this.emitter.emit('did-change')
    }

    createGuestPortalBinding(portalIdentifier) {
      const [portalNumber, userId] = portalIdentifier.split(":");
      let promise = this.promisesByGuestPortalId.get(portalNumber);
      if (promise) {
        promise.then((binding) => {
          if (binding) binding.activate()
        })
      } else {
        promise = this._createGuestPortalBinding(portalNumber, userId);
        promise.then((binding) => {
          if (!binding) this.promisesByGuestPortalId.delete(portalNumber)
        });
        this.promisesByGuestPortalId.set(portalNumber, promise)
      }

      return promise
    }

    async _createGuestPortalBinding(portalNumber, remoteUserId) {
      const portalBinding = new GuestPortalBinding({
        portalNumber,
        remoteUserId,
        decNet: this.decNet,
        workspace: this.workspace,
        notificationManager: this.notificationManager,
        didDispose: () => {
          this.didDisposeGuestPortalBinding(portalBinding)
        }
      });

      if (await portalBinding.initialize()) {
        this.workspace.getElement().classList.add('teletype-Guest');
        this.emitter.emit('did-change');
        return portalBinding
      }
    }

    async getGuestPortalBindings() {
      const portalBindings = await Promise.all(this.promisesByGuestPortalId.values());
      return portalBindings.filter((binding) => binding !== null)
    }

    didDisposeGuestPortalBinding(portalBinding) {
      this.promisesByGuestPortalId.delete(portalBinding.portalId);
      if (this.promisesByGuestPortalId.size === 0) {
        this.workspace.getElement().classList.remove('teletype-Guest')
      }
      this.emitter.emit('did-change')
    }

    async getActiveGuestPortalBinding() {
      const activePaneItem = this.workspace.getActivePaneItem();
      for (const [_, portalBindingPromise] of this.promisesByGuestPortalId) { // eslint-disable-line no-unused-vars
        const portalBinding = await portalBindingPromise;
        if (portalBinding.hasPaneItem(activePaneItem)) {
          return portalBinding
        }
      }
    }

    async hasActivePortals() {
      const hostPortalBinding = await this.getHostPortalBinding();
      const guestPortalBindings = await this.getGuestPortalBindings();

      return (hostPortalBinding != null) || (guestPortalBindings.length > 0)
    }

    onDidChange(callback) {
      return this.emitter.on('did-change', callback)
    }

  };