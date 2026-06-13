import { describe, it, expect } from 'vitest';
import { appendTcgplayerSelfSample } from './tcgplayerSelfHistory';

describe('appendTcgplayerSelfSample', () => {
  it('appends and caps length', () => {
    let h = appendTcgplayerSelfSample(undefined, 10, 1000);
    expect(h).toEqual([{ at: 1000, marketPrice: 10 }]);
    h = appendTcgplayerSelfSample(h, 11, 2000);
    expect(h[1]).toEqual({ at: 2000, marketPrice: 11 });
  });

  it('skips duplicate price within 2 minutes', () => {
    const h = appendTcgplayerSelfSample(undefined, 5, 100);
    const h2 = appendTcgplayerSelfSample(h, 5, 120_000);
    expect(h2.length).toBe(1);
  });
});
