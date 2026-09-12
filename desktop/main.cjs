const { app, BrowserWindow, dialog, ipcMain, shell, session, screen, Menu } = require("electron");
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs"),
  path = require("node:path");
let window,
  backend,
  surface,
  origin,
  saveWindowState,
  quitting = false;
const token = randomBytes(32).toString("hex");
const resources = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "../build");
const externalHosts = new Set(["github.com", "discord.gg"]);
async function startBackend() {
  const exe = app.isPackaged
    ? path.join(
        resources,
        "backend",
        "melee-backend",
        process.platform === "win32" ? "melee-backend.exe" : "melee-backend",
      )
    : process.env.OPENSMASH_DESKTOP_PYTHON || (process.platform === "win32" ? "python" : "python3");
  const args = app.isPackaged ? [] : [path.join(__dirname, "backend_entry.py"), "--development"];
  const child = spawn(
    exe,
    [...args, "--desktop", app.getPath("userData"), "--resources", resources],
    {
      env: { ...process.env, ...surface?.environment, OPENSMASH_DESKTOP_TOKEN: token },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  backend = child;
  const log = fs.createWriteStream(path.join(app.getPath("userData"), "desktop-backend.log"), {
    flags: "a",
  });
  child.stderr.pipe(log);
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(Error("The local game service did not start. Check desktop-backend.log."));
    }, 30000);
    child.once("error", (e) => {
      clearTimeout(timeout);
      reject(e);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(Error(`Game service stopped (${code}).`));
      if (!quitting && window) {
        dialog.showErrorBox(
          "Game service stopped",
          "Close and reopen OpenSmash Melee. Your saved game is retained.",
        );
        app.quit();
      }
    });
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        try {
          const msg = JSON.parse(line);
          if (msg.port) {
            clearTimeout(timeout);
            resolve(`http://127.0.0.1:${msg.port}`);
          }
        } catch {
          log.write(line + "\n");
        }
      }
    });
  });
}
if (!app.requestSingleInstanceLock()) app.quit();
else
  app.whenReady().then(async () => {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    try {
      surface = require("./surface.cjs")(app.getPath("userData"));
      origin = await startBackend();
      session.defaultSession.webRequest.onBeforeSendHeaders(
        { urls: [origin + "/*"] },
        (details, callback) =>
          callback({ requestHeaders: { ...details.requestHeaders, "X-OpenSmash-Token": token } }),
      );
      session.defaultSession.setPermissionRequestHandler((_web, _permission, callback) =>
        callback(false),
      );
      const placement = require("./window-state.cjs")(
        path.join(app.getPath("userData"), "window-state.json"), screen,
      );
      window = new BrowserWindow({
        ...placement.bounds,
        minWidth: 680,
        minHeight: 600,
        title: "OpenSmash Melee",
        backgroundColor: "#0c0905",
        show: false,
        webPreferences: {
          preload: path.join(__dirname, "preload.cjs"),
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
        },
      });
      saveWindowState = placement.track(window);
      const settingsItem = {
        label: "Settings…", accelerator: "CmdOrCtrl+,",
        click: () => window.webContents.send("melee:open-settings"),
      };
      Menu.setApplicationMenu(Menu.buildFromTemplate([
        ...(process.platform === "darwin" ? [{ role: "appMenu", submenu: [
          { role: "about" }, { type: "separator" }, settingsItem,
          { type: "separator" }, { role: "services" }, { role: "hide" }, { role: "quit" },
        ] }] : [{ label: "File", submenu: [settingsItem, { type: "separator" }, { role: "quit" }] }]),
        { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" },
      ]));
      surface?.attach(window);
      const lifecycle = require("./game-lifecycle.cjs")(async (route, body) => {
        const response = await fetch(origin + route, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-OpenSmash-Token": token },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(20000),
        });
        const result = await response.json();
        if (!response.ok) throw Error(result.error || "Could not change the game session.");
        return result;
      }, surface);
      const resetGame = () => {
        void lifecycle.reset().catch((error) => {
          if (!quitting) dialog.showErrorBox("Could not close the game", error.message);
        });
      };
      window.webContents.on("did-start-navigation", (_event, _url, inPlace, mainFrame) => {
        if (mainFrame && !inPlace) resetGame();
      });
      window.webContents.on("render-process-gone", resetGame);
      const syncFullscreen = () => {
        const fullscreen = window.isFullScreen();
        if (process.platform !== "darwin") window.setMenuBarVisibility(!fullscreen);
        window.webContents.send("melee:fullscreen-state", fullscreen);
      };
      for (const event of ["enter-full-screen", "leave-full-screen"])
        window.on(event, syncFullscreen);
      window.webContents.on("did-finish-load", syncFullscreen);
      window.webContents.setWindowOpenHandler(({ url }) => {
        try {
          const u = new URL(url);
          if (u.protocol === "https:" && externalHosts.has(u.hostname))
            void shell.openExternal(url);
        } catch {}
        return { action: "deny" };
      });
      window.webContents.on("will-navigate", (event, url) => {
        if (new URL(url).origin !== origin) event.preventDefault();
      });
      function validateCaller(event) {
        if (
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame ||
          new URL(event.senderFrame.url).origin !== origin
        )
          throw Error("Invalid desktop caller.");
      }
      const preferencesPath = path.join(app.getPath("userData"), "launcher-preferences.json");
      ipcMain.handle("melee:begin-game", (event, session) => {
        validateCaller(event);
        return lifecycle.begin(session);
      });
      ipcMain.on("melee:surface-ready", (event, ready) => {
        validateCaller(event);
        surface?.ready(ready === true);
      });
      ipcMain.on("melee:frame-ack", (event, id) => {
        validateCaller(event);
        surface?.ack?.(id);
      });
      ipcMain.on("melee:input", (event, code, down) => {
        validateCaller(event);
        if (code === null) surface?.clearInput();
        else if (typeof code === "string" && typeof down === "boolean") surface?.input(code, down);
      });
      ipcMain.handle("melee:fullscreen", (event, value) => {
        validateCaller(event);
        window.setFullScreen(typeof value === "boolean" ? value : !window.isFullScreen());
      });
      window.webContents.on("before-input-event", (event, input) => {
        if (
          input.type === "keyDown" &&
          !input.isAutoRepeat &&
          (input.key === "F11" || (input.key === "Escape" && window.isFullScreen()))
        ) {
          event.preventDefault();
          window.setFullScreen(input.key === "F11" ? !window.isFullScreen() : false);
        }
      });
      let preferences = {};
      try {
        preferences = JSON.parse(fs.readFileSync(preferencesPath, "utf8"));
      } catch {}
      const preferenceKeys = new Set(["melee-launch-v1", "melee-pending-import-v1"]);
      ipcMain.on("melee:preference", (event, operation, key, value) => {
        try {
          validateCaller(event);
          if (!preferenceKeys.has(key)) throw Error("Invalid preference key");
          if (operation === "get") {
            event.returnValue = preferences[key] ?? null;
            return;
          }
          if (operation === "set" && typeof value === "string" && value.length <= 16384)
            preferences[key] = value;
          else if (operation === "remove") delete preferences[key];
          else throw Error("Invalid preference");
          const temporary = preferencesPath + ".tmp";
          fs.writeFileSync(temporary, JSON.stringify(preferences));
          fs.renameSync(temporary, preferencesPath);
          event.returnValue = true;
        } catch {
          event.returnValue = null;
        }
      });
      ipcMain.handle("melee:choose-disc", async (event) => {
        validateCaller(event);
        const selected = await dialog.showOpenDialog(window, {
          title: "Choose Melee USA 1.02",
          properties: ["openFile"],
          filters: [{ name: "GameCube disc", extensions: ["iso", "gcm"] }],
        });
        if (selected.canceled) return { cancelled: true };
        const response = await fetch(origin + "/api/native/disc", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-OpenSmash-Token": token },
          body: JSON.stringify({ path: selected.filePaths[0] }),
        });
        const result = await response.json();
        if (!response.ok) throw Error(result.error);
        return result;
      });
      await window.loadURL(origin);
      if (placement.maximized) window.maximize();
      window.show();
    } catch (e) {
      dialog.showErrorBox("OpenSmash Melee could not start", e.message);
      app.quit();
    }
  });
app.on("second-instance", () => {
  window?.show();
  window?.focus();
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  saveWindowState?.();
  const stop = origin
    ? fetch(origin + "/api/native/shutdown", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-OpenSmash-Token": token },
        body: "{}",
        signal: AbortSignal.timeout(20000),
      })
    : Promise.resolve();
  stop
    .catch(() => {})
    .finally(() => {
      backend?.kill();
      surface?.close();
      app.exit();
    });
});
