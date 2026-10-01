const { app, BrowserWindow, Tray, Menu, ipcMain, shell, clipboard, Notification } = require('electron');
const path = require('path');
const QRCode = require('qrcode');
const serverModule = require('./server');

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

let mainWindow = null;
let tray = null;
let isQuitting = false;
let currentPort = 3000;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 440,
    height: 650,
    resizable: false,
    frame: false,
    show: false,
    backgroundColor: '#0c101b',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'desktop', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'desktop', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Minimize to tray on close
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  tray = new Tray(iconPath);
  tray.setToolTip('PC Remote Controller');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Показать окно',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Курсор 72px (Диван)',
      click: () => {
        serverModule.setCursorScale('72');
        notifyStatus();
      }
    },
    {
      label: 'Курсор 32px (Стандарт)',
      click: () => {
        serverModule.setCursorScale('32');
        notifyStatus();
      }
    },
    {
      label: 'Экранная лупа (Вкл / Выкл)',
      click: () => {
        serverModule.setMagnifier('toggle');
      }
    },
    {
      label: 'Открыть в браузере ПК',
      click: () => {
        const ip = serverModule.getPrimaryIp();
        shell.openExternal(`http://${ip}:${currentPort}`);
      }
    },
    { type: 'separator' },
    {
      label: 'Выход',
      click: () => {
        isQuitting = true;
        serverModule.setCursorScale('32');
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

function notifyStatus() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const status = serverModule.getStatus();
    mainWindow.webContents.send('status-update', status);
  }
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  try {
    const serverInfo = await serverModule.startServer();
    currentPort = serverInfo.port;

    // Listen to WS connection events
    serverModule.setEventListeners({
      clientConnected: (count) => {
        notifyStatus();
        if (Notification.isSupported()) {
          new Notification({
            title: 'PC Remote Controller',
            body: `Подключено мобильное устройство! Всего: ${count}`,
            icon: path.join(__dirname, 'assets', 'icon.png')
          }).show();
        }
      },
      clientDisconnected: (_count) => {
        notifyStatus();
      }
    });

    createWindow();
    createTray();

  } catch (err) {
    console.error('Failed to initialize application:', err);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  serverModule.setCursorScale('32');
});

// --- IPC Handlers ---
ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.hide();
});

ipcMain.handle('get-server-info', async () => {
  const ips = serverModule.getLocalIpAddresses();
  const primaryIp = serverModule.getPrimaryIp();
  const status = serverModule.getStatus();
  return {
    ips,
    primaryIp,
    port: currentPort,
    clientCount: status.clientCount,
    cursorSize: status.cursorSize,
    cursorLarge: status.cursorLarge
  };
});

ipcMain.handle('get-qr-code', async (_event, ip) => {
  const chosenIp = ip || serverModule.getPrimaryIp();
  const url = `http://${chosenIp}:${currentPort}`;
  const dataUrl = await QRCode.toDataURL(url, {
    margin: 2,
    width: 300,
    color: {
      dark: '#0f172a',
      light: '#ffffff'
    }
  });
  return { url, dataUrl };
});

ipcMain.handle('toggle-cursor', () => {
  serverModule.setCursorScale('toggle');
  const status = serverModule.getStatus();
  return status;
});

ipcMain.handle('toggle-magnifier', () => {
  serverModule.setMagnifier('toggle');
  return { success: true };
});

ipcMain.handle('copy-to-clipboard', (_event, text) => {
  clipboard.writeText(text);
  return true;
});

ipcMain.handle('open-external-url', (_event, url) => {
  shell.openExternal(url);
  return true;
});
