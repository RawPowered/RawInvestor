# pcgr-server

## Native module (better-sqlite3) / `NODE_MODULE_VERSION` errors

If the API crashes or returns 500 on card writes with a message like **compiled against a different Node.js version** / **NODE_MODULE_VERSION**:

1. Use the **same Node binary** that runs the bundled server (RawEngine uses Electron’s embedded Node when `ELECTRON_RUN_AS_NODE=1`).
2. From this directory, rebuild:

```bash
npm rebuild better-sqlite3
```

3. Re-copy or re-package `server/node_modules` into your `win-unpacked` tree if you ship a prebuilt bundle.

Capture and portfolio routes depend on SQLite; a mismatched `better_sqlite3.node` will fail inside `upsertCardFull` and similar calls.
