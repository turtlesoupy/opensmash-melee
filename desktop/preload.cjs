const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld(
  "meleeDesktop",
  Object.freeze({
    storage: {
      getItem: (key) => ipcRenderer.sendSync("melee:preference", "get", key),
      setItem: (key, value) => ipcRenderer.sendSync("melee:preference", "set", key, value),
      removeItem: (key) => ipcRenderer.sendSync("melee:preference", "remove", key),
    },
    protocol: 1,
    chooseDisc: () => ipcRenderer.invoke("melee:choose-disc"),
  }),
);
