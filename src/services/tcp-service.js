const net = require('net');

class TcpService {
  constructor() {
    this.client = null;
    this.server = null;
    this.serverClients = [];
    this.dataCallbacks = [];
    this.errorCallbacks = [];
    this.closeCallbacks = [];
    this.clientConnectCallbacks = [];
    this.mode = null; // 'client' or 'server'
  }

  async connect(config) {
    await this.disconnect();
    this.mode = 'client';

    return new Promise((resolve, reject) => {
      this.client = new net.Socket();
      let settled = false;

      this.client.connect(parseInt(config.port), config.host, () => {
        settled = true;
        resolve();
      });

      this.client.on('data', (data) => {
        const arr = Array.from(data);
        this.dataCallbacks.forEach(cb => cb(arr));
      });

      this.client.on('error', (err) => {
        this.errorCallbacks.forEach(cb => cb(err));
        if (!settled) { settled = true; reject(err); }
      });

      this.client.on('close', () => {
        this.closeCallbacks.forEach(cb => cb());
      });
    });
  }

  async startServer(config) {
    await this.disconnect();
    this.mode = 'server';

    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        this.serverClients.push(socket);
        const info = { address: socket.remoteAddress, port: socket.remotePort };
        this.clientConnectCallbacks.forEach(cb => cb(info));

        socket.on('data', (data) => {
          const arr = Array.from(data);
          this.dataCallbacks.forEach(cb => cb(arr));
        });

        socket.on('error', (err) => {
          this.errorCallbacks.forEach(cb => cb(err));
        });

        socket.on('close', () => {
          this.serverClients = this.serverClients.filter(c => c !== socket);
        });
      });

      this.server.listen(parseInt(config.port), config.host || '0.0.0.0', () => {
        resolve();
      });

      this.server.on('error', (err) => {
        reject(err);
      });
    });
  }

  async disconnect() {
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
    if (this.server) {
      this.serverClients.forEach(c => c.destroy());
      this.serverClients = [];
      await new Promise((resolve) => {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      });
    }
    this.dataCallbacks = [];
    this.errorCallbacks = [];
    this.closeCallbacks = [];
    this.clientConnectCallbacks = [];
    this.mode = null;
  }

  async send(data) {
    if (this.mode === 'client' && this.client) {
      return new Promise((resolve, reject) => {
        this.client.write(Buffer.from(data), (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    } else if (this.mode === 'server') {
      const promises = this.serverClients.map(c => {
        return new Promise((resolve, reject) => {
          c.write(Buffer.from(data), (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      });
      await Promise.allSettled(promises);
    } else {
      throw new Error('TCP not connected');
    }
  }

  onData(callback) { this.dataCallbacks.push(callback); }
  onError(callback) { this.errorCallbacks.push(callback); }
  onClose(callback) { this.closeCallbacks.push(callback); }
  onClientConnect(callback) { this.clientConnectCallbacks.push(callback); }
}

module.exports = TcpService;
