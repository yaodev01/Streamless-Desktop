const { app, BrowserWindow, session, desktopCapturer, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const { WebSocketServer } = require('ws');
const ffbin = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');

let mainWin = null;
const brs = new Map();

// ---- Built-in relay: receives video from the UI and pushes it to the platform with FFmpeg ----
function startRelay() {
  const wss = new WebSocketServer({
    host: '127.0.0.1', port: 8787,
    verifyClient: (i) => !i.origin || i.origin === 'file://' || i.origin === 'null'
  });
  wss.on('error', () => {});
  wss.on('connection', (ws) => {
    let ff = null, last = '';
    ws.on('message', (data) => {
      if (!ff) {
        let c;
        try { c = JSON.parse(data.toString()); } catch { return ws.close(); }
        if (!/^rtmps?:\/\//.test(c.url) || !/^[a-z0-9_]+$/.test(c.enc)) return ws.close();
        const br = Math.max(500, Math.min(50000, +c.bitrate || 6000));
        const fps = Math.max(10, Math.min(120, +c.fps || 30));
        const args = ['-loglevel', 'warning', '-i', 'pipe:0',
          '-c:v', c.enc, ...(c.enc === 'libx264' ? ['-preset', 'veryfast', '-tune', 'zerolatency'] : []),
          '-b:v', br + 'k', '-maxrate', br + 'k', '-bufsize', br * 2 + 'k',
          '-pix_fmt', 'yuv420p', '-r', String(fps), '-g', String(fps * 2),
          '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-f', 'flv', c.url];
        ff = spawn(ffbin, args, { windowsHide: true });
        ff.stderr.on('data', (x) => { last = x.toString().trim().slice(-160); });
        ff.on('error', () => { if (ws.readyState === 1) ws.send('Encoder could not start.'); ws.close(); });
        ff.on('exit', (code) => { if (ws.readyState === 1) ws.send('Encoder stopped (' + code + '). ' + last); ws.close(); });
        ff.stdin.on('error', () => {});
        return;
      }
      ff.stdin.write(data);
    });
    ws.on('close', () => { if (ff) ff.stdin.end(); });
  });
}

// ---- Screen and window list for the in-app picker ----
ipcMain.handle('sources', async (e, thumbs) => {
  const s = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: thumbs ? { width: 320, height: 180 } : { width: 0, height: 0 } });
  return s.map((x) => ({ id: x.id, name: x.name, thumb: thumbs ? x.thumbnail.toDataURL() : '' }));
});

// ---- Browser sources: hidden offscreen pages whose frames are sent to the UI ----
function destroyB(id) { const w = brs.get(id); if (w && !w.isDestroyed()) w.destroy(); brs.delete(id); }
ipcMain.handle('b:create', (e, o) => {
  destroyB(o.id);
  const url = String(o.url || '');
  if (!/^(https?|file):\/\//i.test(url)) return { ok: false, error: 'URL must start with http://, https:// or file://' };
  const w = Math.max(16, Math.min(4096, (o.w | 0) || 1280));
  const h = Math.max(16, Math.min(4096, (o.h | 0) || 720));
  const fps = Math.max(1, Math.min(60, (o.fps | 0) || 30));
  const win = new BrowserWindow({ show: false, width: w, height: h, frame: false, transparent: true,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.setFrameRate(fps);
  let latest = null, timer = null;
  win.webContents.on('paint', (ev, dirty, img) => {
    latest = img;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (!latest || !mainWin || mainWin.isDestroyed()) return;
      const sz = latest.getSize();
      mainWin.webContents.send('b:frame', o.id, sz.width, sz.height, latest.toBitmap());
    }, 1000 / fps);
  });
  win.loadURL(url).catch(() => {});
  brs.set(o.id, win);
  return { ok: true };
});
ipcMain.handle('b:destroy', (e, id) => { destroyB(id); return true; });
ipcMain.handle('b:reload', (e, id) => { const w = brs.get(id); if (w && !w.isDestroyed()) w.webContents.reload(); return true; });

function createWindow() {
  mainWin = new BrowserWindow({ width: 1280, height: 800, minWidth: 900, minHeight: 600, backgroundColor: '#17181c', autoHideMenuBar: true, title: 'STREAMLESS',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required' } });
  mainWin.loadFile('index.html');
  mainWin.on('closed', () => { mainWin = null; for (const id of [...brs.keys()]) destroyB(id); });
}

app.whenReady().then(() => {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(['media', 'display-capture'].includes(perm)));
  // Desktop audio (loopback) uses the primary screen automatically, without a dialog.
  ses.setDisplayMediaRequestHandler(async (req, cb) => {
    const s = await desktopCapturer.getSources({ types: ['screen'] });
    try { s[0] ? cb({ video: s[0], audio: 'loopback' }) : cb({}); } catch (e) {}
  });
  startRelay();
  createWindow();
});
app.on('window-all-closed', () => app.quit());
