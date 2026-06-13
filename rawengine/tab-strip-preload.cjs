const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rawEngineTabs", {
  newTab: (url) => ipcRenderer.invoke("rawengine-browser:new-tab", url || ""),
  activate: (id) => ipcRenderer.invoke("rawengine-browser:activate", id),
  closeTab: (id) => ipcRenderer.invoke("rawengine-browser:close-tab", id),
  openUrl: (url) => ipcRenderer.invoke("rawengine-browser:open-url", url || ""),
  back: () => ipcRenderer.invoke("rawengine-browser:back-active"),
  forward: () => ipcRenderer.invoke("rawengine-browser:forward-active"),
  reload: () => ipcRenderer.invoke("rawengine-browser:reload-active"),
  forceReload: () => ipcRenderer.invoke("rawengine-browser:force-reload-active"),
  screenshot: (mode) =>
    ipcRenderer.invoke("rawengine-browser:screenshot-start", {
      mode:
        mode === "choose"
          ? "choose"
          : mode === "fullpage" || mode === "full"
            ? "fullpage"
            : mode === "region"
              ? "region"
              : "viewport",
    }),
  onUpdated: (cb) => {
    ipcRenderer.on("rawengine-browser:tabs-updated", (_e, list) => {
      try {
        cb(list);
      } catch {
        // ignore renderer errors
      }
    });
    void ipcRenderer.invoke("rawengine-browser:list").then((list) => {
      try {
        cb(list || []);
      } catch {
        // ignore
      }
    });
  },
  onCaptureChrome: (cb) => {
    if (typeof cb !== "function") return () => {};
    const handler = (_e, payload) => {
      try {
        cb(payload);
      } catch {
        // ignore
      }
    };
    ipcRenderer.on("rawengine-tab-strip:capture-chrome", handler);
    return () => ipcRenderer.removeListener("rawengine-tab-strip:capture-chrome", handler);
  },
  cancelQuickFetch: () => ipcRenderer.invoke("rawengine-capture-chrome:cancel-from-strip"),
  openCaptureDeck: () => ipcRenderer.invoke("rawengine-capture-log:open"),
});
