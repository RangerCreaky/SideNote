const { app, BrowserWindow, ipcMain, screen, dialog, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let tray;
let isExpanded = false;

const COLLAPSED_WIDTH = 16;
const DEFAULT_EXPANDED_WIDTH = 400;
const MIN_EXPANDED_WIDTH = 260;
const MAX_EXPANDED_WIDTH = 800;
const ANIMATION_STEPS = 12;
const ANIMATION_INTERVAL = 12;

// ===== Simple JSON File Store =====
class SimpleStore {
  constructor(defaults) {
    this.defaults = defaults;
    this.data = { ...defaults };
    // Will be set after app is ready
    this.filePath = null;
  }

  init(userDataPath) {
    this.filePath = path.join(userDataPath, 'sidenote-data.json');
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        this.data = { ...this.defaults, ...JSON.parse(raw) };
      }
    } catch (e) {
      console.error('Error loading store:', e);
      this.data = { ...this.defaults };
    }
  }

  get(key) {
    const keys = key.split('.');
    let val = this.data;
    for (const k of keys) {
      if (val == null) return undefined;
      val = val[k];
    }
    return val;
  }

  set(key, value) {
    const keys = key.split('.');
    let obj = this.data;
    for (let i = 0; i < keys.length - 1; i++) {
      if (obj[keys[i]] == null) obj[keys[i]] = {};
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
    this._save();
  }

  _save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (e) {
      console.error('Error saving store:', e);
    }
  }
}

const store = new SimpleStore({
  folders: [],
  settings: { defaultFontSize: 13, expandedWidth: DEFAULT_EXPANDED_WIDTH }
});

function getWindowBounds(expanded) {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  const windowWidth = expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH;
  return {
    x: screenWidth - windowWidth,
    y: 0,
    width: windowWidth,
    height: screenHeight
  };
}

function animateWindow(targetWidth, callback) {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth } = primaryDisplay.workAreaSize;
  const currentBounds = mainWindow.getBounds();
  const startWidth = currentBounds.width;
  const diff = targetWidth - startWidth;
  let step = 0;

  const interval = setInterval(() => {
    step++;
    const progress = step / ANIMATION_STEPS;
    const eased = 1 - Math.pow(1 - progress, 3);
    const newWidth = Math.round(startWidth + diff * eased);
    const newX = screenWidth - newWidth;
    mainWindow.setBounds({ x: newX, y: 0, width: newWidth, height: currentBounds.height });
    if (step >= ANIMATION_STEPS) {
      clearInterval(interval);
      if (callback) callback();
    }
  }, ANIMATION_INTERVAL);
}

function createWindow() {
  const bounds = getWindowBounds(false);

  mainWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: false,
    backgroundColor: '#0d1117',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Prevent the window from navigating away (e.g. clicking links/images in markdown preview)
  mainWindow.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    // Open external URLs in system browser
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
  });

  // Also handle new-window requests (target="_blank" links)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Open DevTools in dev mode
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  // Create a 16x16 template image for the tray
  const trayIcon = nativeImage.createEmpty();
  tray = new Tray(trayIcon);
  tray.setToolTip('SideNote');
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Toggle SideNote',
      click: () => {
        if (isExpanded) collapseWindow();
        else expandWindow();
      }
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);
  tray.setContextMenu(contextMenu);
}

function expandWindow() {
  if (isExpanded) return;
  isExpanded = true;
  mainWindow.webContents.send('expansion-state', true);
  animateWindow(store.get('settings.expandedWidth') || DEFAULT_EXPANDED_WIDTH);
}

function collapseWindow() {
  if (!isExpanded) return;
  isExpanded = false;
  mainWindow.webContents.send('expansion-state', false);
  animateWindow(COLLAPSED_WIDTH);
}

// ===== IPC Handlers =====
ipcMain.on('expand', () => expandWindow());
ipcMain.on('collapse', () => collapseWindow());
ipcMain.on('toggle', () => {
  if (isExpanded) collapseWindow();
  else expandWindow();
});

// Storage IPC – renderer reads/writes via main process
ipcMain.handle('store-get', (event, key) => {
  return store.get(key);
});

ipcMain.handle('store-set', (event, key, value) => {
  store.set(key, value);
});

ipcMain.handle('show-open-dialog', async (event, options) => {
  return await dialog.showOpenDialog(mainWindow, options);
});

ipcMain.handle('show-save-dialog', async (event, options) => {
  return await dialog.showSaveDialog(mainWindow, options);
});

ipcMain.handle('read-file', async (event, filePath) => {
  try {
    const data = fs.readFileSync(filePath);
    return { success: true, data: data.toString('base64'), name: path.basename(filePath) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('write-file', async (event, filePath, content) => {
  try {
    fs.writeFileSync(filePath, content, 'utf-8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-expanded-state', () => isExpanded);

ipcMain.on('resize-window', (event, newWidth) => {
  if (!isExpanded) return;
  const clamped = Math.max(MIN_EXPANDED_WIDTH, Math.min(MAX_EXPANDED_WIDTH, Math.round(newWidth)));
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
  const bounds = mainWindow.getBounds();
  mainWindow.setBounds({ x: screenWidth - clamped, y: 0, width: clamped, height: bounds.height });
  store.set('settings.expandedWidth', clamped);
});

app.whenReady().then(() => {
  store.init(app.getPath('userData'));
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
