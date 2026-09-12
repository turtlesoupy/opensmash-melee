// Run with desktop/node_modules/.bin/electron tests/fullscreen.test.cjs.
const { app, BrowserWindow, Menu, screen } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const createFullscreen = require("../desktop/fullscreen.cjs");
const pause = () => new Promise(resolve => setTimeout(resolve, 250));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1040, height: 820, show: false,
    autoHideMenuBar: true,
    webPreferences: { preload: path.resolve(__dirname, "../desktop/preload.cjs"), sandbox: true },
  });
  const toggle = createFullscreen(window);
  window.webContents.on("preload-error", (_event, file, error) => console.error(file, error));
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: "View", submenu: [
    { label: "Toggle Fullscreen", accelerator: "F11", click: () => toggle() },
  ] }]));
  window.setMenuBarVisibility(false);
  const css = ["web/vendor/opensmash/site-shell.css", "web/app/melee-shell.css"]
    .map(file => fs.readFileSync(path.resolve(__dirname, "..", file), "utf8")).join("\n");
  await window.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(`
    <html class="is-direct-site"><style>${css}</style><body class="is-game-booted">
    <main class="arena-shell"><header>Header</header><section class="intro-video-stage">
    <div class="intro-video-frame"><section class="native-game"><header class="native-game-toolbar">Toolbar</header>
    <div class="native-game-screen"><canvas width="960" height="720"></canvas></div></section>
    <div class="intro-video-rule-layer"></div></div></section><div class="arena-surface">Roster</div></main></body></html>`));
  for (const maximized of [false, true]) {
    if (maximized) window.maximize();
    await pause();
    for (let i = 0; i < 3; i++) {
      toggle();
      await pause();
      assert.equal(window.isFullScreen(), true);
      assert.deepEqual(window.getBounds(), screen.getDisplayMatching(window.getBounds()).bounds);
      const layout = await window.webContents.executeJavaScript(`(() => {
        const r = document.querySelector('.native-game').getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height,
          viewport: [innerWidth, innerHeight],
          roster: getComputedStyle(document.querySelector('.arena-surface')).visibility };
      })()`);
      assert.deepEqual([layout.x, layout.y, layout.width, layout.height], [0, 0, ...layout.viewport]);
      assert.equal(layout.roster, "hidden");
      toggle(false);
      await pause();
      assert.equal(window.isFullScreen(), false);
      assert.equal(await window.webContents.executeJavaScript("document.body.classList.contains('is-native-fullscreen')"), false);
    }
  }
  console.log("PASS: repeated fullscreen from normal/maximized windows covers the display and hides the roster.");
  window.destroy();
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
