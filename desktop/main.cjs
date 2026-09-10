const { app, BrowserWindow, dialog, ipcMain, shell, session } = require("electron");
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs"),
  path = require("node:path");
let window,
  backend,
  origin,
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
      env: { ...process.env, OPENSMASH_DESKTOP_TOKEN: token },
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
      origin = await startBackend();
      session.defaultSession.webRequest.onBeforeSendHeaders(
        { urls: [origin + "/*"] },
        (details, callback) =>
          callback({ requestHeaders: { ...details.requestHeaders, "X-OpenSmash-Token": token } }),
      );
      session.defaultSession.setPermissionRequestHandler((_web, _permission, callback) =>
        callback(false),
      );
      window = new BrowserWindow({
        width: 1040,
        height: 820,
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
      app.exit();
    });
});
