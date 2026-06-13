import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  closeAppPortfolioDb,
  defaultEmptyMeta,
  feesFromMetaDoc,
  listCardsPage,
  openAppPortfolioDb,
  totalCardCount,
  upsertCardFull,
  readPortfolioMeta,
  writePortfolioMeta,
} from './portfolioCardsRepository.js';

describe('portfolioCardsRepository', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pcgr-app-portfolio-'));
  });

  afterEach(() => {
    closeAppPortfolioDb(tmp);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('upserts and lists cards with pagination', () => {
    writePortfolioMeta(tmp, defaultEmptyMeta());
    const meta = feesFromMetaDoc(defaultEmptyMeta());
    upsertCardFull(
      tmp,
      {
        id: 'a',
        name: 'Pikachu',
        set: 'Base',
        raw: 10,
        grade9: 20,
        psa10: 100,
        p10: 0.3,
        p9: 0.5,
      },
      meta
    );
    upsertCardFull(
      tmp,
      {
        id: 'b',
        name: 'Mewtwo',
        set: 'Base',
        raw: 5,
        grade9: 15,
        psa10: 80,
        p10: 0.2,
        p9: 0.6,
      },
      meta
    );
    expect(totalCardCount(tmp)).toBe(2);
    const page = listCardsPage(tmp, {
      limit: 1,
      offset: 0,
      sort: 'name_asc',
      includePayload: true,
    });
    expect(page.total).toBe(2);
    expect(page.items.length).toBe(1);
    expect(String((page.items[0] as { name?: string }).name)).toBe('Mewtwo');
  });

  it('filters by portfolio_kind', () => {
    writePortfolioMeta(tmp, defaultEmptyMeta());
    const meta = feesFromMetaDoc(defaultEmptyMeta());
    upsertCardFull(
      tmp,
      {
        id: 's',
        name: 'Box',
        set: 'Test',
        raw: 100,
        grade9: 0,
        psa10: 0,
        p10: 0.3,
        p9: 0.5,
        portfolioKind: 'sealed',
      },
      meta
    );
    upsertCardFull(
      tmp,
      {
        id: 'c',
        name: 'Pika',
        set: 'Test',
        raw: 10,
        grade9: 20,
        psa10: 100,
        p10: 0.3,
        p9: 0.5,
        portfolioKind: 'single',
      },
      meta
    );
    const sealedOnly = listCardsPage(tmp, {
      limit: 50,
      offset: 0,
      sort: 'name_asc',
      portfolioKind: 'sealed',
      includePayload: true,
    });
    expect(sealedOnly.total).toBe(1);
    expect((sealedOnly.items[0] as { id?: string }).id).toBe('s');
  });

  it('singles filter includes rows with blank portfolio_kind (DB empty string)', () => {
    writePortfolioMeta(tmp, defaultEmptyMeta());
    const meta = feesFromMetaDoc(defaultEmptyMeta());
    upsertCardFull(
      tmp,
      {
        id: 'blank',
        name: 'X',
        set: 'T',
        raw: 1,
        grade9: 0,
        psa10: 0,
        p10: 0.3,
        p9: 0.5,
        portfolioKind: 'single',
      },
      meta
    );
    const db = openAppPortfolioDb(tmp);
    db.prepare(`UPDATE cards SET portfolio_kind = '' WHERE id = 'blank'`).run();
    const singles = listCardsPage(tmp, {
      limit: 50,
      offset: 0,
      sort: 'name_asc',
      portfolioKind: 'single',
      includePayload: true,
    });
    expect(singles.total).toBe(1);
    expect((singles.items[0] as { id?: string }).id).toBe('blank');
  });

  it('persists google CSE fields in portfolio meta JSON', () => {
    const base = defaultEmptyMeta();
    writePortfolioMeta(tmp, { ...base, googleCseKey: 'test-key', googleCseCx: 'cx:123' });
    const read = readPortfolioMeta(tmp);
    expect(String(read?.googleCseKey)).toBe('test-key');
    expect(String(read?.googleCseCx)).toBe('cx:123');
  });
});
