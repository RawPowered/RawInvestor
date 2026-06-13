const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("captureLogView", {
  readTail: (n) => ipcRenderer.invoke("rawengine-capture-log:read-tail", n),
  getInfo: () => ipcRenderer.invoke("rawengine-capture-log:get-info"),
  append: (entry) => ipcRenderer.invoke("rawengine-capture-log:append", entry || {}),
  revealFile: () => ipcRenderer.invoke("rawengine-capture-log:reveal"),
  listBrowserTabs: () => ipcRenderer.invoke("rawengine-browser:list"),
  reloadBrowserTab: (id) => ipcRenderer.invoke("rawengine-browser:reload-tab", id),
  activateBrowserTab: (id) => ipcRenderer.invoke("rawengine-browser:activate", id),
  signalScrapeReady: () => ipcRenderer.invoke("rawengine-scrape-gate:signal"),
  onPush: (fn) => {
    const handler = (_e, payload) => fn(payload);
    ipcRenderer.on("rawengine-capture-log:push", handler);
    return () => ipcRenderer.removeListener("rawengine-capture-log:push", handler);
  },
});
