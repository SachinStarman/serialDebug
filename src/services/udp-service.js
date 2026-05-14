const dgram = require('dgram');

class UdpService {
  constructor() {
    this.socket = null;
    this.dataCallbacks = [];
  }

  async bind(config) {
    await this.close();

    return new Promise((resolve, reject) => {
      this.socket = dgram.createSocket('udp4');

      this.socket.on('message', (msg, rinfo) => {
        const arr = Array.from(msg);
        this.dataCallbacks.forEach(cb => cb(arr, rinfo));
      });

      this.socket.on('error', (err) => {
        console.error('UDP error:', err);
        this.close();
        reject(err);
      });

      this.socket.bind(parseInt(config.port), config.host || '0.0.0.0', () => {
        resolve();
      });
    });
  }

  async send(data, host, port) {
    if (!this.socket) {
      throw new Error('UDP socket not bound');
    }
    return new Promise((resolve, reject) => {
      this.socket.send(Buffer.from(data), parseInt(port), host, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async close() {
    if (this.socket) {
      const sock = this.socket;
      this.socket = null;
      this.dataCallbacks = [];
      return new Promise((resolve) => {
        try {
          sock.close(() => resolve());
        } catch (e) {
          resolve(); // Already closed
        }
      });
    }
  }

  onData(callback) {
    this.dataCallbacks.push(callback);
  }
}

module.exports = UdpService;
