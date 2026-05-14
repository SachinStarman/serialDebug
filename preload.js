const { ipcRenderer } = require('electron');

// With nodeIntegration:true and contextIsolation:false,
// we attach the API directly to window.
window.serialDebug = {
  // ──── Window controls ────
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    onMaximized: (callback) => ipcRenderer.on('window:maximized', (_, isMax) => callback(isMax)),
  },

  // ──── Serial ────
  serial: {
    listPorts: () => ipcRenderer.invoke('serial:listPorts'),
    connect: (config) => ipcRenderer.invoke('serial:connect', config),
    disconnect: () => ipcRenderer.invoke('serial:disconnect'),
    send: (data, encoding) => ipcRenderer.invoke('serial:send', data, encoding),
    sendHex: (hexString) => ipcRenderer.invoke('serial:sendHex', hexString),
    onData: (callback) => ipcRenderer.on('serial:data', (_, data) => callback(data)),
    onError: (callback) => ipcRenderer.on('serial:error', (_, err) => callback(err)),
    onClosed: (callback) => ipcRenderer.on('serial:closed', () => callback()),
    removeAllListeners: () => {
      ipcRenderer.removeAllListeners('serial:data');
      ipcRenderer.removeAllListeners('serial:error');
      ipcRenderer.removeAllListeners('serial:closed');
    },
  },

  // ──── TCP ────
  tcp: {
    connect: (config) => ipcRenderer.invoke('tcp:connect', config),
    startServer: (config) => ipcRenderer.invoke('tcp:startServer', config),
    disconnect: () => ipcRenderer.invoke('tcp:disconnect'),
    send: (data, encoding) => ipcRenderer.invoke('tcp:send', data, encoding),
    sendHex: (hexString) => ipcRenderer.invoke('tcp:sendHex', hexString),
    onData: (callback) => ipcRenderer.on('tcp:data', (_, data) => callback(data)),
    onError: (callback) => ipcRenderer.on('tcp:error', (_, err) => callback(err)),
    onClosed: (callback) => ipcRenderer.on('tcp:closed', () => callback()),
    onClientConnected: (callback) => ipcRenderer.on('tcp:clientConnected', (_, info) => callback(info)),
    removeAllListeners: () => {
      ipcRenderer.removeAllListeners('tcp:data');
      ipcRenderer.removeAllListeners('tcp:error');
      ipcRenderer.removeAllListeners('tcp:closed');
      ipcRenderer.removeAllListeners('tcp:clientConnected');
    },
  },

  // ──── UDP ────
  udp: {
    bind: (config) => ipcRenderer.invoke('udp:bind', config),
    send: (data, host, port, encoding) => ipcRenderer.invoke('udp:send', data, host, port, encoding),
    sendHex: (hexString, host, port) => ipcRenderer.invoke('udp:sendHex', hexString, host, port),
    close: () => ipcRenderer.invoke('udp:close'),
    onData: (callback) => ipcRenderer.on('udp:data', (_, data, rinfo) => callback(data, rinfo)),
    removeAllListeners: () => {
      ipcRenderer.removeAllListeners('udp:data');
    },
  },

  // ──── Encoding ────
  encoding: {
    decode: (buffer, encoding) => ipcRenderer.invoke('encoding:decode', buffer, encoding),
    encode: (text, encoding) => ipcRenderer.invoke('encoding:encode', text, encoding),
  },

  // ──── Script Engine ────
  script: {
    run: (code) => ipcRenderer.invoke('script:run', code),
    stop: () => ipcRenderer.invoke('script:stop'),
    feedData: (data) => ipcRenderer.invoke('script:feedData', data),
    onSend: (callback) => ipcRenderer.on('script:send', (_, data) => callback(data)),
    onLog: (callback) => ipcRenderer.on('script:log', (_, msg) => callback(msg)),
    removeAllListeners: () => {
      ipcRenderer.removeAllListeners('script:send');
      ipcRenderer.removeAllListeners('script:log');
    },
  },

  // ──── File dialogs ────
  dialog: {
    saveFile: (options) => ipcRenderer.invoke('dialog:saveFile', options),
    openFile: (options) => ipcRenderer.invoke('dialog:openFile', options),
  },
  file: {
    write: (filePath, content) => ipcRenderer.invoke('file:write', filePath, content),
    writeBinary: (filePath, base64Data) => ipcRenderer.invoke('file:writeBinary', filePath, base64Data),
    read: (filePath) => ipcRenderer.invoke('file:read', filePath),
  },
};
