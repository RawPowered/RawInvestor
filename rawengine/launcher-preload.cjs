const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("launcherApi", {
  onStatus: (fn) => {
    const handler = (_event, payload) => fn(payload);
    ipcRenderer.on("launcher:status", handler);
    return () => ipcRenderer.removeListener("launcher:status", handler);
  },
  getMeta: () => ipcRenderer.invoke("launcher:get-meta"),
  cancelBoot: () => ipcRenderer.invoke("launcher:cancel-boot"),
  openExternal: (url) => ipcRenderer.invoke("launcher:open-external", url),
});
