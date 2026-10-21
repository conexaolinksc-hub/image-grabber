const { app, BrowserWindow, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');

// Keep references to avoid garbage collection
let mainWindow = null;
let tray = null;
let actualPort = 3000;

/**
 * Start the Express server and get the actual port.
 */
async function bootServer() {
  const { startServer } = require('./server');
  actualPort = await startServer();
  console.log(`[Electron] Server started on port ${actualPort}`);
}

/**
 * Create the main application window.
 */
function createWindow() {
  const iconPath = path.join(__dirname, 'icon.ico');
  const iconFallback = path.join(__dirname, 'icon.jpg');
  const icon = require('fs').existsSync(iconPath) ? iconPath : iconFallback;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    icon: icon,
    title: 'Image Grabber',
    backgroundColor: '#f0f2f5',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    titleBarStyle: 'default',
    autoHideMenuBar: true,
  });

  // Load the app using the actual port
  mainWindow.loadURL(`http://localhost:${actualPort}`);

  // Show window when page is ready (avoids white flash)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Handle external links — open in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Handle window close — minimize to tray instead
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Create system tray icon and menu.
 */
function createTray() {
  const iconPath = path.join(__dirname, 'icon.ico');
  const iconFallback = path.join(__dirname, 'icon.jpg');
  const iconFile = require('fs').existsSync(iconPath) ? iconPath : iconFallback;
  const icon = nativeImage.createFromPath(iconFile).resize({ width: 16, height: 16 });
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Abrir Image Grabber',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Sair',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip('Image Grabber');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// =============================================
//  APP LIFECYCLE
// =============================================

app.whenReady().then(async () => {
  // Start the Express backend
  await bootServer();

  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
});
