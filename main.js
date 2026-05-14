const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// Services
const SerialService = require('./src/services/serial-service');
const TcpService = require('./src/services/tcp-service');
const UdpService = require('./src/services/udp-service');
const EncodingService = require('./src/services/encoding-service');
const ScriptEngine = require('./src/services/script-engine');

let mainWindow;
let serialService;
let tcpService;
let udpService;
let encodingService;
let scriptEngine;

function getWindowState() {
  const statePath = path.join(app.getPath('userData'), 'window-state.json');
  try {
    if (fs.existsSync(statePath)) {
      return JSON.parse(fs.readFileSync(statePath, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load window state:', e);
  }
  return { width: 1400, height: 900, maximized: false };
}

function saveWindowState(win) {
  const statePath = path.join(app.getPath('userData'), 'window-state.json');
  if (!win) return;
  try {
    const isMax = win.isMaximized();
    const bounds = isMax ? win.getNormalBounds() : win.getBounds();
    const state = { ...bounds, maximized: isMax };
    fs.writeFileSync(statePath, JSON.stringify(state));
  } catch (e) {
    console.error('Failed to save window state:', e);
  }
}

function createWindow() {
  const winState = getWindowState();

  mainWindow = new BrowserWindow({
    x: winState.x,
    y: winState.y,
    width: winState.width || 1400,
    height: winState.height || 900,
    minWidth: 800,
    minHeight: 500,
    title: 'Serial Debug Assistant Pro',
    backgroundColor: '#0a0e1a',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: false,
      nodeIntegration: true,
    },
    frame: false,
    titleBarStyle: 'hidden',
  });

  if (winState.maximized) {
    mainWindow.maximize();
  }

  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximized', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximized', false));

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Open DevTools in development
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  // Force-close failsafe: if close is stuck, force quit after 3s
  let forceCloseTimer = null;
  mainWindow.on('close', (e) => {
    saveWindowState(mainWindow);
    if (!forceCloseTimer) {
      forceCloseTimer = setTimeout(() => {
        console.log('Force closing app due to timeout');
        mainWindow?.destroy();
        app.quit();
      }, 3000);
    }
  });

  mainWindow.on('closed', () => {
    if (forceCloseTimer) clearTimeout(forceCloseTimer);
    mainWindow = null;
  });
}

function initializeServices() {
  serialService = new SerialService();
  tcpService = new TcpService();
  udpService = new UdpService();
  encodingService = new EncodingService();
  scriptEngine = new ScriptEngine();
}

function setupIPC() {
  // ──── Window controls ────
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.on('window:close', () => mainWindow?.close());

  // ──── Serial IPC ────
  ipcMain.handle('serial:listPorts', async () => {
    return await serialService.listPorts();
  });

  ipcMain.handle('serial:connect', async (event, config) => {
    try {
      await serialService.connect(config);
      // Clear old callbacks to prevent accumulation on reconnect
      serialService.dataCallbacks = [];
      serialService.errorCallbacks = [];
      serialService.closeCallbacks = [];
      serialService.onData((data) => {
        mainWindow?.webContents.send('serial:data', data);
      });
      serialService.onError((error) => {
        mainWindow?.webContents.send('serial:error', error.message);
      });
      serialService.onClosed(() => {
        mainWindow?.webContents.send('serial:closed');
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('serial:disconnect', async () => {
    try {
      await serialService.disconnect();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('serial:send', async (event, data, encoding) => {
    try {
      const encoded = encodingService.encode(data, encoding);
      await serialService.send(encoded);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('serial:sendHex', async (event, hexString) => {
    try {
      const buffer = Buffer.from(hexString.replace(/\s+/g, ''), 'hex');
      await serialService.send(buffer);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ──── TCP IPC ────
  ipcMain.handle('tcp:connect', async (event, config) => {
    try {
      await tcpService.connect(config);
      tcpService.onData((data) => {
        mainWindow?.webContents.send('tcp:data', data);
      });
      tcpService.onError((error) => {
        mainWindow?.webContents.send('tcp:error', error.message);
      });
      tcpService.onClose(() => {
        mainWindow?.webContents.send('tcp:closed');
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('tcp:startServer', async (event, config) => {
    try {
      await tcpService.startServer(config);
      tcpService.onData((data) => {
        mainWindow?.webContents.send('tcp:data', data);
      });
      tcpService.onClientConnect((info) => {
        mainWindow?.webContents.send('tcp:clientConnected', info);
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('tcp:disconnect', async () => {
    try {
      await tcpService.disconnect();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('tcp:send', async (event, data, encoding) => {
    try {
      const encoded = encodingService.encode(data, encoding);
      await tcpService.send(encoded);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('tcp:sendHex', async (event, hexString) => {
    try {
      const buffer = Buffer.from(hexString.replace(/\s+/g, ''), 'hex');
      await tcpService.send(buffer);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ──── UDP IPC ────
  ipcMain.handle('udp:bind', async (event, config) => {
    try {
      await udpService.bind(config);
      udpService.onData((data, rinfo) => {
        mainWindow?.webContents.send('udp:data', data, rinfo);
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('udp:send', async (event, data, host, port, encoding) => {
    try {
      const encoded = encodingService.encode(data, encoding);
      await udpService.send(encoded, host, port);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('udp:sendHex', async (event, hexString, host, port) => {
    try {
      const buffer = Buffer.from(hexString.replace(/\s+/g, ''), 'hex');
      await udpService.send(buffer, host, port);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('udp:close', async () => {
    try {
      await udpService.close();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ──── Encoding IPC ────
  ipcMain.handle('encoding:decode', (event, buffer, encoding) => {
    return encodingService.decode(Buffer.from(buffer), encoding);
  });

  ipcMain.handle('encoding:encode', (event, text, encoding) => {
    return Array.from(encodingService.encode(text, encoding));
  });

  // ──── Script Engine IPC ────
  ipcMain.handle('script:run', async (event, code) => {
    try {
      // Clear old callbacks to prevent accumulation across runs
      scriptEngine.sendCallbacks = [];
      scriptEngine.logCallbacks = [];
      scriptEngine.onSend((data) => {
        mainWindow?.webContents.send('script:send', data);
      });
      scriptEngine.onLog((msg) => {
        mainWindow?.webContents.send('script:log', msg);
      });
      const result = scriptEngine.run(code);
      return { success: true, result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('script:stop', () => {
    scriptEngine.stop();
    return { success: true };
  });

  ipcMain.handle('script:feedData', (event, data) => {
    scriptEngine.feedData(data);
  });

  // ──── File dialogs ────
  ipcMain.handle('dialog:saveFile', async (event, options) => {
    const result = await dialog.showSaveDialog(mainWindow, options);
    return result;
  });

  ipcMain.handle('dialog:openFile', async (event, options) => {
    const result = await dialog.showOpenDialog(mainWindow, options);
    return result;
  });

  ipcMain.handle('file:write', async (event, filePath, content) => {
    try {
      fs.writeFileSync(filePath, content);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('file:writeBinary', async (event, filePath, base64Data) => {
    try {
      const buffer = Buffer.from(base64Data, 'base64');
      fs.writeFileSync(filePath, buffer);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('file:read', async (event, filePath) => {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return { success: true, content };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

// ──── App lifecycle ────
app.whenReady().then(() => {
  initializeServices();
  setupIPC();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  serialService?.disconnect().catch(() => {});
  tcpService?.disconnect().catch(() => {});
  udpService?.close().catch(() => {});
  if (process.platform !== 'darwin') app.quit();
});
