const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("screenshotEditor", {
  onLoad: (callback) => {
    ipcRenderer.on("screenshot-editor:load", (_event, payload) => {
      try {
        callback(payload);
      } catch {
        // ignore
      }
    });
  },
  savePng: (dataUrl) => ipcRenderer.invoke("screenshot-editor:save-png", dataUrl),
  copyPngToClipboard: (dataUrl) =>
    ipcRenderer.invoke("screenshot-editor:copy-png", dataUrl),
});
