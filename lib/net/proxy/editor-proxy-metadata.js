const Messages = require('../protobuf/decnet_pb');
const {CompositeDisposable} = require('event-kit');
const NOOP = () => {
};

module.exports =
  class EditorProxyMetadata {
    constructor({id, portalId, hostPeerId, bufferProxyId, bufferProxyUri, siteId, decNet, didDispose}) {
      this.id = id;
      this.portalId = portalId
      this.hostPeerId = hostPeerId;
      this.bufferProxyId = bufferProxyId;
      this.bufferProxyUri = bufferProxyUri;
      this.siteId = siteId;
      this.subscriptions = new CompositeDisposable();
      this.didDispose = didDispose || NOOP;
      if (didDispose) {
        this.subscriptions.add(
          decNet.onNotification(`/buffers/${id}`, this.portalId, this.id, this.receiveBufferUpdate.bind(this))
        );
        this.subscriptions.add(
          decNet.onNotification(`/editors/${id}/disposal`, this.portalId, this.id, this.dispose.bind(this))
        )
      }
    }

    dispose() {
      this.subscriptions.dispose();
      this.didDispose()
    }

    serialize () {
      const message = new Messages.DM.Portal.EditorProxyMetadata();
      message.setId(this.id);
      message.setBufferProxyId(this.bufferProxyId);
      message.setBufferProxyUri(this.bufferProxyUri);
      return message
    }

    static deserialize (message, props) {
      return new EditorProxyMetadata(Object.assign({
        id: message.getId(),
        bufferProxyId: message.getBufferProxyId(),
        bufferProxyUri: message.getBufferProxyUri()
      }, props))
    }


    receiveBufferUpdate ({body}) {
      const updateMessage = Messages.DM.Portal.Update.deserializeBinary(body)
      if (updateMessage.hasUri()) {
        this.bufferProxyUri = updateMessage.getUri().getUri()
      }
    }
  };
