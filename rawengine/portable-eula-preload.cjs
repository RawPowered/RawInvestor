const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("portableEulaApi", {
  accept: () => ipcRenderer.send("portable-eula:respond", true),
  decline: () => ipcRenderer.send("portable-eula:respond", false),
  openExternal: (url) => ipcRenderer.invoke("launcher:open-external", url),
});
