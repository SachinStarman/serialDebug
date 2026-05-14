const vm = require('vm');

class ScriptEngine {
  constructor() {
    this.context = null;
    this.running = false;
    this.sendCallbacks = [];
    this.logCallbacks = [];
    this.dataHandlers = [];
    this.timers = [];
  }

  run(code) {
    this.stop();
    this.running = true;
    this.dataHandlers = [];
    this.timers = [];

    const sandbox = {
      send: (data) => {
        if (!this.running) return;
        this.sendCallbacks.forEach(cb => cb(data));
      },
      sendHex: (hexStr) => {
        if (!this.running) return;
        const bytes = [];
        const cleaned = hexStr.replace(/\s+/g, '');
        for (let i = 0; i < cleaned.length; i += 2) {
          bytes.push(parseInt(cleaned.substr(i, 2), 16));
        }
        this.sendCallbacks.forEach(cb => cb(bytes));
      },
      onData: (handler) => {
        this.dataHandlers.push(handler);
      },
      log: (...args) => {
        const msg = args.map(a => {
          if (typeof a === 'object') return JSON.stringify(a);
          return String(a);
        }).join(' ');
        this.logCallbacks.forEach(cb => cb(msg));
      },
      console: {
        log: (...args) => {
          const msg = args.map(a => {
            if (typeof a === 'object') return JSON.stringify(a);
            return String(a);
          }).join(' ');
          this.logCallbacks.forEach(cb => cb(msg));
        },
      },
      setTimeout: (fn, ms) => {
        const id = setTimeout(() => {
          if (this.running) fn();
        }, ms);
        this.timers.push(id);
        return id;
      },
      setInterval: (fn, ms) => {
        const id = setInterval(() => {
          if (this.running) fn();
        }, ms);
        this.timers.push(id);
        return id;
      },
      clearTimeout: clearTimeout,
      clearInterval: clearInterval,
      parseInt, parseFloat, isNaN, isFinite,
      Math, Date, JSON, String, Number, Array, Object, Boolean, RegExp,
      Buffer: {
        from: (data, encoding) => Array.from(Buffer.from(data, encoding)),
        alloc: (size) => Array.from(Buffer.alloc(size)),
      },
    };

    try {
      this.context = vm.createContext(sandbox);
      const script = new vm.Script(code, { timeout: 5000 });
      const result = script.runInContext(this.context, { timeout: 5000 });
      return result;
    } catch (err) {
      this.logCallbacks.forEach(cb => cb(`Error: ${err.message}`));
      throw err;
    }
  }

  feedData(data) {
    if (!this.running) return;
    this.dataHandlers.forEach(handler => {
      try {
        handler(data);
      } catch (err) {
        this.logCallbacks.forEach(cb => cb(`Script error in onData: ${err.message}`));
      }
    });
  }

  stop() {
    this.running = false;
    this.timers.forEach(id => {
      clearTimeout(id);
      clearInterval(id);
    });
    this.timers = [];
    this.dataHandlers = [];
    this.context = null;
  }

  onSend(callback) {
    this.sendCallbacks.push(callback);
  }

  onLog(callback) {
    this.logCallbacks.push(callback);
  }
}

module.exports = ScriptEngine;
