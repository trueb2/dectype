'use babel';

const {Emitter, CompositeDisposable} = require('event-kit');
const {spawn} = require('child_process');
const {createConnection} = require('net');
const assert = require('assert');

const Errors = require('../errors');
const convertToProtobufCompatibleBuffer = require('../convert-to-protobuf-compatible-buffer');
const Messages = require('./protobuf/decnet_pb');
const Portal = require('./portal');
const WireData = require('./wire-data');

module.exports =
  class DecNet {
    constructor({dev}) {
      console.log("Starting DecNet");

      this.dev = dev;
      const settings = atom.config.settings.dectype;
      const defaults = atom.config.defaultSettings.dectype;
      this.startPath = settings.startPath || defaults.startPath;
      const homePath = settings.homePath || defaults.homePath;
      const socketPath = settings.socketPath || defaults.socketPath;
      if (this.dev) {
        this.socketPath = homePath + '.dev/' + this.dev + '/' + socketPath;
      } else {
        this.socketPath = homePath + socketPath;
      }
      console.log("Communicating over", this.socketPath);


      this.emitter = new Emitter();
      this.subscriptions = new CompositeDisposable();
      this.bufferDecoder = new TextDecoder();
      this.wireData = new WireData({decNet: this});

      this.lastReceivePromise = Promise.resolve();
      this.requestPromiseResolveCallbacks = new Map();
      this.peerIdsByRequestId = new Map();
      this.connectedMemberIds = new Set();
      this.resetConnectedMembers();

      this.instanceState = 'disconnected';
      this.instance = null;
      this.clientSocket = null;

      this.nextRequestId = 0;
    }

    async initialize({onReady}) {
      this.instanceState = 'connecting';
      if (this.dev) {
        this.instance = spawn('unbuffer', ['python', `${this.startPath}`, `--teletype`, `--dev=${this.dev}`]);
      } else {
        this.instance = spawn('unbuffer', ['python', `${this.startPath}`, `--teletype`]);
      }

      this.instance.stdout.on('data', (data) => {
        console.log('Received data on stdout');
        const message = this.bufferDecoder.decode(data);
        console.log('%c' + message, 'background: #222; color: #bada55');

        if (message.includes("Waiting for dectype client")) {
          console.log("Connecting to DecNet");

          this.clientSocket = createConnection({path: this.socketPath}, async () => {
            // 'connect' listener
            console.log("Connected to DecNet instance");
            this.instanceState = 'connected';
            this.userIdPromise = new Promise((resolve) => {
              this.resolveUserIdPromise = resolve;
              this.requestUserId();
            });
            await this.userIdPromise;
            this.resetConnectedMembers();
            onReady();
          });

          this.clientSocket.on('end', () => {
            console.log("ClientSocket connection ended");
            this.instanceState = 'disconnected';
            this.destroy();
          });

          this.clientSocket.on('data', this.consumeBinary.bind(this));
        }
      });

      this.instance.stderr.on('data', (data) => {
        console.log(`stderr receiving data`);
        try {
          console.log(this.bufferDecoder.decode(data));
        } catch(e) {
          console.log(e);
        }
        this.destroy();
      });

      this.instance.on('close', (code) => {
        console.log(`child process exited with code ${code}.`);
        this.destroy();
      });
    }

    destroy() {
      this.instanceState = 'disconnected';
      if (this.clientSocket) this.clientSocket.destroy();
      if (this.instance) this.instance.kill();
    }

    dispose() {
      console.log("Disposing DecNet");
      this.subscriptions.dispose();
      this.destroy();
    }

    /**
     *
     * @param {Uint8Array|Buffer} dmBuffer
     */
    frameAndSend(dmBuffer) {
      assert(this.instanceState === 'connected', "Must be connected to DecNet instance to send protobuf message");

      if (!(dmBuffer instanceof Buffer)) dmBuffer = new Buffer(dmBuffer);

      // Frame messages up to ~4GB
      const lengthBuffer = new Buffer(4);
      lengthBuffer.writeInt32BE(dmBuffer.length, 0);
      const framedBuffer = Buffer.concat([lengthBuffer, dmBuffer]);

      // NodeJS always succeeds in writing all of a Buffer
      this.clientSocket.write(framedBuffer);
    }

    consumeBinary(dataBuffer) {
      this.wireData.consume(dataBuffer);
    }

    requestUserId() {
      console.log("Requesting User Id from DecNet");
      const dm = new Messages.DM();
      dm.setUserIdRequest(true);

      this.frameAndSend(dm.serializeBinary());
    }

    receiveUserIdResponse(userIdResponseMessage) {
      this.userId = userIdResponseMessage.getUserId();
      this.resolveUserIdPromise(this.userId);
      this.resolveUserIdPromise = null;
      console.log("userId: ", this.userId);
    }

    requestCreatePortal() {
      const dm = new Messages.DM();
      dm.setCreatePortalRequest(true);

      this.createPortalPromise = new Promise((resolve) => {
        this.resolveCreatePortalPromise = resolve;
      });

      this.frameAndSend(dm.serializeBinary());
    }

    receiveCreatePortalResponse(createPortalResponseMessage) {
      this.resolveCreatePortalPromise(createPortalResponseMessage.getPortalId());
    }

    requestJoinPortal(hostId, portalId) {
      if (hostId === this.userId) {
        throw new Error('Requesting to join own portal')
      }
      const joinPortalRequestMessage = new Messages.DM.JoinPortalRequest();
      joinPortalRequestMessage.setHostId(hostId);
      joinPortalRequestMessage.setRemoteId(this.userId);
      joinPortalRequestMessage.setPortalId(portalId);
      const dm = new Messages.DM();
      dm.setJoinPortalRequest(joinPortalRequestMessage);

      this.joinPortalPromise = new Promise((resolve) => {
        this.resolveJoinPortalPromise = resolve;
      }).catch((error) => {
        console.log(error);
      });

      this.frameAndSend(dm.serializeBinary());
    }

    receiveJoinPortalRequest(joinPortalRequestMessage) {
      console.log('Received join portal request', joinPortalRequestMessage);
      const remoteId = joinPortalRequestMessage.getRemoteId();
      const portalId = joinPortalRequestMessage.getPortalId();

      this.emitter.emit('join', {remoteId, portalId});

    }

    receiveJoinPortalResponse(joinPortalResponseMessage) {
      console.log("Received join portal response", joinPortalResponseMessage);
      this.resolveJoinPortalPromise(joinPortalResponseMessage.getSuccess());
    }

    receiveNotification(notificationMessage) {
      this.lastReceivePromise = this.lastReceivePromise.then(async () => {
        const body = convertToProtobufCompatibleBuffer(notificationMessage.getBody());
        await this.emitter.emitAsync(
          'notification:' + notificationMessage.getChannelId(),
          {senderId: notificationMessage.getSenderId(), body}
        )
      });
    }

    receiveRequest (request) {
      this.lastReceivePromise = this.lastReceivePromise.then(async () => {
        const channelId = request.getChannelId();
        const requestId = request.getRequestId();
        const eventName = 'request:' + channelId;
        const body = convertToProtobufCompatibleBuffer(request.getBody());
        this.peerIdsByRequestId.set(requestId, request.getSenderId());

        if (this.emitter.listenerCountForEventName(eventName) === 0) {
          this.respond({requestId, ok: false})
        } else {
          await this.emitter.emitAsync(eventName, {senderId: request.getSenderId(), requestId, body})
        }
      })
    }

    receiveResponse (response) {
      const requestId = response.getRequestId();
      const requestResolveCallback = this.requestPromiseResolveCallbacks.get(requestId);
      requestResolveCallback({
        body: convertToProtobufCompatibleBuffer(response.getBody()),
        ok: response.getOk()
      })
    }


    receiveWireDataMessage(data) {
      const dm = Messages.DM.deserializeBinary(data);
      if (dm.hasUserIdResponse()) {
        this.receiveUserIdResponse(dm.getUserIdResponse());
      } else if (dm.hasCreatePortalResponse()) {
        this.receiveCreatePortalResponse(dm.getCreatePortalResponse());
      } else if (dm.hasJoinPortalRequest()) {
        this.receiveJoinPortalRequest(dm.getJoinPortalRequest());
      } else if (dm.hasJoinPortalResponse()) {
        this.receiveJoinPortalResponse(dm.getJoinPortalResponse());
      } else if (dm.hasNotification()) {
        this.receiveNotification(dm.getNotification());
      } else if (dm.hasRequest()) {
        this.receiveRequest(dm.getRequest());
      } else if (dm.hasResponse()) {
        this.receiveResponse(dm.getResponse());
      } else {
        throw new Error('Unknown DecMessage type');
      }
    }

    async createPortal() {
      this.requestCreatePortal();
      const portalId = await this.createPortalPromise;
      const portal = new Portal({
        id: portalId,
        hostPeerId: this.userId,
        siteId: 1,
        decNet: this
      });

      // await portal.initialize();

      return portal;
    }

    async joinPortal(hostId, portalId) {
      this.requestJoinPortal(hostId, portalId);
      const confirmation = await this.joinPortalPromise;
      console.log("Received confirmation", confirmation, "to join portal");
      if (confirmation) {
        const portal = new Portal({
          id: portalId,
          hostPeerId: hostId,
          decNet: this
        });

        // await portal.initialize();
        await portal.join();

        return portal;
      } else {
        throw new Errors.PortalJoinError(`Could not join ${hostId}'s portal ${portalId}.`);
      }
    }

    notify({portalId, hostId, channelId, body}) {
      const host = new Messages.DM.Host();
      host.setPortalId(portalId);
      host.setUserId(hostId);

      const notification = new Messages.DM.Notification();
      notification.setChannelId(channelId);
      notification.setHost(host);
      notification.setBody(body);

      const dm  = new Messages.DM();
      dm.setNotification(notification);

      this.frameAndSend(dm.serializeBinary());
    }

    request({portalId, hostId, channelId, body}) {
      const requestId = this.nextRequestId++;
      if (body) body = convertToProtobufCompatibleBuffer(body);

      const host = new Messages.DM.Host();
      host.setPortalId(portalId);
      host.setUserId(hostId);

      const request = new Messages.DM.Request();
      request.setSenderId(this.userId);
      request.setHost(host);
      request.setChannelId(channelId);
      request.setRequestId(requestId);
      request.setBody(body);

      const dm = new Messages.DM();
      dm.setRequest(request);

      const ret = new Promise((resolve) => {
        this.requestPromiseResolveCallbacks.set(requestId, resolve);
      });

      this.frameAndSend(dm.serializeBinary());

      return ret;
    }

    respond({requestId, ok, body}) {
      const recipientId = this.peerIdsByRequestId.get(requestId);
      if (!recipientId) throw new Error('Multiple responses to the same requestId');

      if (ok === null) ok = true;
      if (body) body = convertToProtobufCompatibleBuffer(body);

      console.log("Sending Response to", recipientId);
      const response = new Messages.DM.Response();
      response.setRecipientId(recipientId);
      response.setRequestId(requestId);
      response.setOk(ok);
      response.setBody(body);

      const dm = new Messages.DM();
      dm.setResponse(response);

      this.peerIdsByRequestId.delete(requestId);

      this.frameAndSend(dm.serializeBinary());
    }

    joinChannel({channelId, hostId, portalId}) {
      const channelMessage = new Messages.DM.Channel();
      channelMessage.setJoin(true);
      channelMessage.setChannelId(channelId);
      channelMessage.setHostId(hostId);
      channelMessage.setPortalId(portalId);

      const dm = new Messages.DM();
      dm.setChannel(channelMessage);

      this.frameAndSend(dm.serializeBinary());
    }

    onNotification(channelId, hostId, portalId, callback) {
      this.joinChannel({channelId, hostId, portalId});
      return this.emitter.on('notification:' + channelId, callback)
    }

    onRequest(channelId, hostId, portalId, callback) {
      this.joinChannel({channelId, hostId, portalId});
      return this.emitter.on('request:' + channelId, callback)
    }

    onMemberJoin(callback) {
      return this.emitter.on('join', callback)
    }

    onMemberLeave(callback) {
      return this.emitter.on('leave', callback)
    }

    getMemberIds() {
      return Array.from(this.connectedMemberIds);
    }

    resetConnectedMembers() {
      this.connectedMemberIds.clear();
      this.connectedMemberIds.add(this.userId);
    }
  };
