 const { SerialPort } = require('serialport');

class SerialService {
  constructor() {
    this.port = null;
    this.dataCallbacks = [];
    this.errorCallbacks = [];
    this.closeCallbacks = [];
  }

  async listPorts() {
    try {
      const ports = await SerialPort.list();
      return ports.map(p => ({
        path: p.path,
        manufacturer: p.manufacturer || 'Unknown',
        serialNumber: p.serialNumber || '',
        vendorId: p.vendorId || '',
        productId: p.productId || '',
        friendlyName: p.friendlyName || p.path,
      }));
    } catch (err) {
      console.error('Error listing ports:', err);
      return [];
    }
  }

  async connect(config) {
    if (this.port && this.port.isOpen) {
      await this.disconnect();
    }

    return new Promise((resolve, reject) => {
      this.port = new SerialPort({
        path: config.path,
        baudRate: parseInt(config.baudRate) || 115200,
        dataBits: parseInt(config.dataBits) || 8,
        stopBits: parseFloat(config.stopBits) || 1,
        parity: config.parity || 'none',
        rtscts: config.flowControl === 'rtscts',
        xon: config.flowControl === 'xon/xoff',
        xoff: config.flowControl === 'xon/xoff',
        autoOpen: false,
      });

      this.port.open((err) => {
        if (err) {
          reject(err);
          return;
        }

        this.port.on('data', (data) => {
          const arr = Array.from(data);
          this.dataCallbacks.forEach(cb => cb(arr));
        });

        this.port.on('error', (err) => {
          this.errorCallbacks.forEach(cb => cb(err));
        });

        this.port.on('close', () => {
          this.port = null;
          const cbs = [...this.closeCallbacks];
          this.dataCallbacks = [];
          this.errorCallbacks = [];
          this.closeCallbacks = [];
          cbs.forEach(cb => cb());
        });

        resolve();
      });
    });
  }

  async disconnect() {
    if (!this.port) return;
    return new Promise((resolve, reject) => {
      if (!this.port.isOpen) {
        this.port = null;
        this.dataCallbacks = [];
        this.errorCallbacks = [];
        this.closeCallbacks = [];
        resolve();
        return;
      }
      this.port.close((err) => {
        this.port = null;
        this.dataCallbacks = [];
        this.errorCallbacks = [];
        this.closeCallbacks = [];
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async send(data) {
    if (!this.port || !this.port.isOpen) {
      throw new Error('Serial port is not open');
    }
    return new Promise((resolve, reject) => {
      this.port.write(data, (err) => {
        if (err) reject(err);
        else {
          this.port.drain((drainErr) => {
            if (drainErr) reject(drainErr);
            else resolve();
          });
        }
      });
    });
  }

  onData(callback) {
    this.dataCallbacks.push(callback);
  }

  onError(callback) {
    this.errorCallbacks.push(callback);
  }

  onClosed(callback) {
    this.closeCallbacks.push(callback);
  }

  isConnected() {
    return this.port && this.port.isOpen;
  }
}

module.exports = SerialService;
