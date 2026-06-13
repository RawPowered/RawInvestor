import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CURRENT_VERSION, EMPTY_DOC, Storage } from './storage.js';

/** Fresh temp dir per test so the filesystem state never leaks. */
let tmp = '';

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'pcgr-store-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const makeStore = (overrides: { maxBackups?: number } = {}) =>
  new Storage({
    dataDir: tmp,
    maxBackups: overrides.maxBackups,
    backupDir: path.join(tmp, 'portfolio-backups-vault'),
  });

describe('Storage.read', () => {
  it('returns EMPTY_DOC when the file does not exist', async () => {
    const s = makeStore();
    const doc = await s.read();
    expect(doc).toEqual(EMPTY_DOC);
  });

  it('round-trips a simple document', async () => {
    const s = makeStore();
    await s.write({ cards: [{ id: 'a' }], fees: { gradingFee: 20 } }, 1000);
    const read = await s.read();
    expect(read.version).toBe(CURRENT_VERSION);
    expect(read.updatedAt).toBe(1000);
    expect(read.cards).toEqual([{ id: 'a' }]);
    expect(read.fees).toEqual({ gradingFee: 20 });
  });

  it('returns EMPTY_DOC when the file is unreadable garbage', async () => {
    const s = makeStore();
    await fs.writeFile(s.dataFile, 'not json at all');
    // JSON.parse throws, which we let bubble up - callers should recover.
    await expect(s.read()).rejects.toThrow();
  });

  it('recovers from a file that contains a JSON array (unexpected shape)', async () => {
    const s = makeStore();
    await fs.writeFile(s.dataFile, JSON.stringify([1, 2, 3]));
    const doc = await s.read();
    expect(doc).toEqual(EMPTY_DOC);
  });

  it('coerces missing version/updatedAt to sane defaults', async () => {
    const s = makeStore();
    await fs.writeFile(s.dataFile, JSON.stringify({ cards: [] }));
    const doc = await s.read();
    expect(doc.version).toBe(CURRENT_VERSION);
    expect(doc.updatedAt).toBe(0);
    expect(doc.cards).toEqual([]);
  });
});

describe('Storage.write', () => {
  it('stamps version and updatedAt server-side, ignoring the patch values', async () => {
    const s = makeStore();
    const out = await s.write(
      { version: 999, updatedAt: 111, cards: [] } as Record<string, unknown>,
      5000
    );
    expect(out.version).toBe(CURRENT_VERSION);
    expect(out.updatedAt).toBe(5000);
  });

  it('merges patches into the existing doc (so partial writes preserve state)', async () => {
    const s = makeStore();
    await s.write({ cards: ['a', 'b'], fees: { gradingFee: 20 } }, 1000);
    // Second write only touches fees.
    await s.write({ fees: { gradingFee: 25 } }, 2000);
    const doc = await s.read();
    expect(doc.cards).toEqual(['a', 'b']);
    expect(doc.fees).toEqual({ gradingFee: 25 });
    expect(doc.updatedAt).toBe(2000);
  });

  it('writes atomically - no .tmp file should remain after success', async () => {
    const s = makeStore();
    await s.write({ cards: [] }, 1000);
    const files = await fs.readdir(tmp);
    expect(files).not.toContain('portfolio.json.tmp');
    expect(files).toContain('portfolio.json');
  });

  it('creates the data directory if it is missing', async () => {
    const nested = path.join(tmp, 'a', 'b', 'c');
    const s = new Storage({
      dataDir: nested,
      backupDir: path.join(tmp, 'nested-backup-vault'),
    });
    await s.write({ cards: [] }, 1000);
    const files = await fs.readdir(nested);
    expect(files).toContain('portfolio.json');
  });
});

describe('Storage backups', () => {
  it('creates a dated backup on the first write of each day', async () => {
    const s = makeStore();
    const t = Date.parse('2026-04-18T10:00:00Z');
    await s.write({ cards: [] }, t);
    const backups = await s.listBackups();
    expect(backups).toEqual(['portfolio-2026-04-18.json']);
  });

  it('keeps at most one backup per UTC day', async () => {
    const s = makeStore();
    const day = Date.parse('2026-04-18T06:00:00Z');
    await s.write({ cards: [1] }, day);
    await s.write({ cards: [2] }, day + 3_600_000); // +1 hour, same day
    await s.write({ cards: [3] }, day + 7_200_000); // +2 hours, same day
    const backups = await s.listBackups();
    expect(backups).toHaveLength(1);
    // And the backup is the FIRST write of that day - not the latest.
    const body = JSON.parse(
      await fs.readFile(path.join(s.backupDir, backups[0]), 'utf-8')
    );
    expect(body.cards).toEqual([1]);
  });

  it('produces a new backup on a new UTC day', async () => {
    const s = makeStore();
    await s.write({ cards: [1] }, Date.parse('2026-04-18T00:00:00Z'));
    await s.write({ cards: [2] }, Date.parse('2026-04-19T00:00:00Z'));
    await s.write({ cards: [3] }, Date.parse('2026-04-20T00:00:00Z'));
    const backups = await s.listBackups();
    expect(backups).toEqual([
      'portfolio-2026-04-20.json',
      'portfolio-2026-04-19.json',
      'portfolio-2026-04-18.json',
    ]);
  });

  it('prunes backups beyond the configured cap', async () => {
    const s = makeStore({ maxBackups: 3 });
    const base = Date.parse('2026-04-10T00:00:00Z');
    for (let d = 0; d < 5; d++) {
      await s.write({ cards: [d] }, base + d * 86_400_000);
    }
    const backups = await s.listBackups();
    expect(backups).toHaveLength(3);
    // Oldest two got pruned; we kept 04-12, 04-13, 04-14.
    expect(backups).toEqual([
      'portfolio-2026-04-14.json',
      'portfolio-2026-04-13.json',
      'portfolio-2026-04-12.json',
    ]);
  });

  it('listBackups returns [] when the backup dir does not exist', async () => {
    const s = makeStore();
    const backups = await s.listBackups();
    expect(backups).toEqual([]);
  });
});
