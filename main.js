const { app, BrowserWindow, Tray, Menu, ipcMain, Notification, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

// GPU 캐시 오류 방지
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

let mainWindow = null;
let widgetWindow = null;
let tray = null;
let isAlwaysOnTop = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'Daywalker',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    frame: true,
    show: false
  });

  mainWindow.loadFile('Workflow.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 창 닫기 시 트레이로 최소화
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createWidgetWindow() {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.show();
    widgetWindow.focus();
    return;
  }

  widgetWindow = new BrowserWindow({
    width: 360,
    height: 520,
    minWidth: 280,
    minHeight: 300,
    title: 'Daywalker Widget',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    show: false
  });

  widgetWindow.loadFile('Widget.html');

  widgetWindow.once('ready-to-show', () => {
    widgetWindow.show();
  });

  widgetWindow.on('closed', () => {
    widgetWindow = null;
  });
}

function createTray() {
  const icon = nativeImage.createFromBuffer(createTrayIconBuffer());
  tray = new Tray(icon);
  updateTrayMenu();

  tray.setToolTip('Daywalker');

  tray.on('double-click', () => {
    mainWindow.show();
    mainWindow.focus();
  });
}

// 트레이 아이콘용 최소 PNG 생성 (16x16, #e94560 색상 사각형)
function createTrayIconBuffer() {
  const size = 16;
  const rawData = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const x = i % size;
    const y = Math.floor(i / size);
    const inBounds = x >= 2 && x < 14 && y >= 2 && y < 14;
    if (inBounds) {
      rawData[i * 4] = 233;
      rawData[i * 4 + 1] = 69;
      rawData[i * 4 + 2] = 96;
      rawData[i * 4 + 3] = 255;
    } else {
      rawData[i * 4 + 3] = 0;
    }
  }

  function crc32(buf) {
    let crc = -1;
    for (let i = 0; i < buf.length; i++) {
      crc ^= buf[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    return (crc ^ -1) >>> 0;
  }

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeAndData = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeAndData), 0);
    return Buffer.concat([len, typeAndData, crc]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const rawPixels = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    rawPixels[y * (1 + size * 4)] = 0;
    for (let x = 0; x < size; x++) {
      const srcIdx = (y * size + x) * 4;
      const dstIdx = y * (1 + size * 4) + 1 + x * 4;
      rawPixels[dstIdx] = rawData[srcIdx];
      rawPixels[dstIdx + 1] = rawData[srcIdx + 1];
      rawPixels[dstIdx + 2] = rawData[srcIdx + 2];
      rawPixels[dstIdx + 3] = rawData[srcIdx + 3];
    }
  }

  const deflateData = [];
  const MAX_BLOCK = 65535;
  let offset = 0;
  while (offset < rawPixels.length) {
    const blockLen = Math.min(MAX_BLOCK, rawPixels.length - offset);
    const isLast = offset + blockLen >= rawPixels.length;
    const header = Buffer.alloc(5);
    header[0] = isLast ? 1 : 0;
    header.writeUInt16LE(blockLen, 1);
    header.writeUInt16LE(blockLen ^ 0xffff, 3);
    deflateData.push(header);
    deflateData.push(rawPixels.slice(offset, offset + blockLen));
    offset += blockLen;
  }

  const zlibHeader = Buffer.from([0x78, 0x01]);
  const deflated = Buffer.concat(deflateData);
  let a = 1, b = 0;
  for (let i = 0; i < rawPixels.length; i++) {
    a = (a + rawPixels[i]) % 65521;
    b = (b + a) % 65521;
  }
  const adler = Buffer.alloc(4);
  adler.writeUInt32BE((b << 16) | a, 0);
  const idatData = Buffer.concat([zlibHeader, deflated, adler]);

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const iend = chunk('IEND', Buffer.alloc(0));
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idatData), iend]);
}

function updateTrayMenu() {
  if (!tray) return;
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '열기',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      }
    },
    {
      label: '위젯 열기',
      click: () => {
        createWidgetWindow();
      }
    },
    { type: 'separator' },
    {
      label: '항상 위에 표시',
      type: 'checkbox',
      checked: isAlwaysOnTop,
      click: (menuItem) => {
        isAlwaysOnTop = menuItem.checked;
        mainWindow.setAlwaysOnTop(isAlwaysOnTop);
        mainWindow.webContents.send('always-on-top-changed', isAlwaysOnTop);
      }
    },
    { type: 'separator' },
    {
      label: '종료',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);
  tray.setContextMenu(contextMenu);
}

// IPC 핸들러 등록
function setupIPC() {
  ipcMain.on('toggle-always-on-top', () => {
    isAlwaysOnTop = !isAlwaysOnTop;
    mainWindow.setAlwaysOnTop(isAlwaysOnTop);
    updateTrayMenu();
    mainWindow.webContents.send('always-on-top-changed', isAlwaysOnTop);
  });

  ipcMain.on('show-notification', (event, { title, body }) => {
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: title || 'Daywalker',
        body: body || '',
        silent: false
      });
      notification.on('click', () => {
        mainWindow.show();
        mainWindow.focus();
      });
      notification.show();
    }
  });

  ipcMain.handle('get-always-on-top', () => {
    return isAlwaysOnTop;
  });

  ipcMain.on('open-main-window', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // 로컬 파일 저장/읽기
  const dataDir = path.join(app.getPath('userData'), 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  ipcMain.handle('load-local-data', (event, filename) => {
    const filePath = path.join(dataDir, filename);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf-8');
  });

  ipcMain.handle('save-local-data', (event, filename, data) => {
    const filePath = path.join(dataDir, filename);
    fs.writeFileSync(filePath, data, 'utf-8');
    return true;
  });

  ipcMain.handle('get-data-path', () => dataDir);
}

app.whenReady().then(() => {
  setupIPC();
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  // 트레이가 있으므로 종료하지 않음
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else {
    mainWindow.show();
  }
});
