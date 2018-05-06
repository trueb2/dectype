'use-babel';

module.exports = class WireData {
  constructor({decNet}) {
    this.decNet = decNet;
    this.buffer = Buffer.concat([]);
    this.message_length = -1;
  }

  consume(payload) {
    try {
      this.buffer = Buffer.concat([this.buffer, payload]);

      if (this.message_length === -1) {
        if (this.buffer.length >= 4) {
          this.consume_message_length();
        }
      }
    } catch(e) {
      console.log("Failed to consume payload");
      console.log(e);
    }

  }

  consume_message_length() {
    this.message_length = this.buffer.readInt32BE();
    this.buffer = this.buffer.slice(4);
    this.consume_buf();
  }

  consume_buf() {
    if (this.buffer.length >= this.message_length) {
      const message = this.buffer.slice(0, this.message_length);
      const ui8 = new Uint8Array(this.message_length);
      this.buffer.copy(ui8, 0, 0, this.message_length);
      this.buffer = this.buffer.slice(this.message_length);
      this.decNet.receiveWireDataMessage(ui8);
      this.message_length = -1;
      this.consume(Buffer.concat([]));
    }
  }
};