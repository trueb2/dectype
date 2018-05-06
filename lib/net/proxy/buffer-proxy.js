const assert = require('assert');
const {CompositeDisposable, Emitter} = require('event-kit');
const {Document, serializeOperation, deserializeOperation} = require('@atom/teletype-crdt');
const Messages = require('../protobuf/decnet_pb');

function doNothing() {}

module.exports =
  class BufferProxy {
    constructor({id, portalId, uri, text, history, operations, hostPeerId, siteId, decNet, didDispose}) {
      this.id = id;
      this.portalId = portalId;
      this.hostPeerId = hostPeerId;
      this.siteId = siteId;
      this.isHost = (this.siteId === 1);
      this.uri = uri;
      this.decNet = decNet;
      this.emitDidDispose = didDispose || doNothing;
      this.document = new Document({siteId, text, history});
      this.nextMarkerLayerId = 1;
      this.emitter = new Emitter();
      this.subscriptions = new CompositeDisposable();
      this.subscriptions.add(
        this.decNet.onNotification(`/buffers/${id}`, this.hostPeerId, this.portalId, this.receiveUpdate.bind(this))
      );
      if (this.isHost) {
        this.subscriptions.add(
          this.decNet.onRequest(`/buffers/${id}`, this.hostPeerId, this.portalId, this.receiveFetch.bind(this)),
          this.decNet.onNotification(`/buffers/${id}/save`, this.hostPeerId, this.portalId, this.receiveSave.bind(this))
        )
      } else {
        this.subscriptions.add(
          this.decNet.onNotification(`/buffers/${id}/disposal`, this.hostPeerId, this.portalId, this.dispose.bind(this))
        )
      }

      if (operations) this.integrateOperations(operations)
    }

    dispose() {
      this.subscriptions.dispose();
      if (this.delegate) this.delegate.dispose();
      if (this.isHost) this.decNet.notify({
        channelId: `/buffers/${this.id}/disposal`,
        portalId: this.portalId,
        hostId: this.hostPeerId
      });
      this.emitDidDispose()
    }

    serialize () {
      const bufferProxyMessage = new Messages.DM.Portal.BufferProxy();
      bufferProxyMessage.setId(this.id);
      bufferProxyMessage.setUri(this.uri);
      bufferProxyMessage.setOperationsList(this.document.getOperations().map(serializeOperation));
      return bufferProxyMessage;
    }

    static deserialize (message, props) {
      const id = message.getId();
      const uri = message.getUri();
      const operations = message.getOperationsList().map(deserializeOperation);
      return new BufferProxy(Object.assign({id, uri, operations}, props))
    }

    setDelegate(delegate) {
      this.delegate = delegate;
      if (this.siteId !== 1 && this.delegate) {
        this.delegate.setText(this.document.getText())
      }
    }

    getNextMarkerLayerId() {
      return this.nextMarkerLayerId++
    }

    setTextInRange(oldStart, oldEnd, newText) {
      const operations = this.document.setTextInRange(oldStart, oldEnd, newText);
      this.broadcastOperations(operations);
      this.emitter.emit('did-update-text', {remote: false})
    }

    setURI(uri) {
      assert(this.isHost, 'Only hosts can change the URI');
      this.uri = uri;

      this.broadcastURIChange(uri)
    }

    getMarkers() {
      return this.document.getMarkers()
    }

    updateMarkers(markerUpdatesByLayerId, broadcastOperations = true) {
      const operations = this.document.updateMarkers(markerUpdatesByLayerId);
      if (broadcastOperations) this.broadcastOperations(operations);
      return operations
    }

    onDidUpdateMarkers(listener) {
      return this.emitter.on('did-update-markers', listener)
    }

    onDidUpdateText(listener) {
      return this.emitter.on('did-update-text', listener)
    }

    undo() {
      const undoEntry = this.document.undo();
      if (undoEntry) {
        const {operations, textUpdates, markers} = undoEntry;
        this.broadcastOperations(operations);
        if (textUpdates.length > 0) {
          this.emitter.emit('did-update-text', {remote: false})
        }
        return {textUpdates, markers}
      } else {
        return null
      }
    }

    redo() {
      const redoEntry = this.document.redo();
      if (redoEntry) {
        const {operations, textUpdates, markers} = redoEntry;
        this.broadcastOperations(operations);
        if (textUpdates.length > 0) {
          this.emitter.emit('did-update-text', {remote: false})
        }
        return {textUpdates, markers}
      } else {
        return null
      }
    }

    createCheckpoint(options) {
      return this.document.createCheckpoint(options)
    }

    getChangesSinceCheckpoint(checkpoint) {
      return this.document.getChangesSinceCheckpoint(checkpoint)
    }

    groupChangesSinceCheckpoint(checkpoint, options) {
      return this.document.groupChangesSinceCheckpoint(checkpoint, options)
    }

    groupLastChanges() {
      return this.document.groupLastChanges()
    }

    revertToCheckpoint(checkpoint, options) {
      const result = this.document.revertToCheckpoint(checkpoint, options);
      if (result) {
        const {operations, textUpdates, markers} = result;
        this.broadcastOperations(operations);
        if (textUpdates.length > 0) {
          this.emitter.emit('did-update-text', {remote: false})
        }
        return {textUpdates, markers}
      } else {
        return false
      }
    }

    applyGroupingInterval(groupingInterval) {
      this.document.applyGroupingInterval(groupingInterval)
    }

    getHistory(maxEntries) {
      return this.document.getHistory(maxEntries)
    }

    requestSave() {
      assert(!this.isHost, 'Only guests can request a save');
      this.decNet.notify({
        channelId: `/buffers/${this.id}/save`,
        portalId: this.portalId,
        hostId: this.hostPeerId
      });
    }

    receiveFetch({requestId}) {
      this.decNet.respond({requestId, body: this.serialize().serializeBinary()})
    }

    receiveUpdate({body}) {
      const updateMessage = Messages.DM.Portal.Update.deserializeBinary(body);
      if (updateMessage.hasOperations()) {
        this.receiveOperationsUpdate(updateMessage.getOperations())
      } else if (updateMessage.hasUri()) {
        this.receiveURIUpdate(updateMessage.getUri())
      } else {
        throw new Error('Received unknown update message')
      }

    }

    receiveOperationsUpdate(operationsUpdateMessage) {
      const operations = operationsUpdateMessage.getOperationsList().map(deserializeOperation);
      this.integrateOperations(operations)
    }

    receiveURIUpdate (uriMessage) {
      this.uri = uriMessage.getUri();
      this.delegate.didChangeURI(this.uri)
    }

    receiveSave() {
      this.delegate.save()
    }

    broadcastOperations(operations) {
      const operationsMessage = new Messages.DM.Portal.Update.Operations();
      operationsMessage.setOperationsList(operations.map(serializeOperation));
      const updateMessage = new Messages.DM.Portal.Update();
      updateMessage.setOperations(operationsMessage);

      this.notifyBufferUpdate(updateMessage)
    }

    integrateOperations(operations) {
      const {textUpdates, markerUpdates} = this.document.integrateOperations(operations);
      if (this.delegate) this.delegate.updateText(textUpdates);
      this.emitter.emit('did-update-markers', markerUpdates);
      if (textUpdates.length > 0) {
        this.emitter.emit('did-update-text', {remote: true})
      }
    }

    broadcastURIChange(uri) {
      const uriMessage = new Messages.DM.Portal.Update.Uri();
      uriMessage.setUri(uri);
      const updateMessage = new Messages.DM.Portal.Update();
      updateMessage.setUri(uriMessage);

      this.notifyBufferUpdate(updateMessage);
    }

    notifyBufferUpdate(updateMessage) {
      this.decNet.notify({
        channelId: `/buffers/${this.id}`,
        portalId: this.portalId,
        hostId: this.hostPeerId,
        body: updateMessage.serializeBinary()
      })
    }
  };
