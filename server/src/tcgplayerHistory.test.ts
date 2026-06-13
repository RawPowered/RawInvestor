import { describe, it, expect } from 'vitest';
import {
  parseMartechWeekRangeToEndMs,
  parseUsdCell,
  parseRowsFromTableHtml,
} from './tcgplayerHistory.js';

describe('parseUsdCell', () => {
  it('parses money cells', () => {
    expect(parseUsdCell('$22.13')).toBeCloseTo(22.13);
    expect(parseUsdCell(' $1,234.50 ')).toBeCloseTo(1234.5);
  });
});

describe('parseMartechWeekRangeToEndMs', () => {
  it('parses same-month week', () => {
    const t = parseMartechWeekRangeToEndMs('4/14 to 4/20', 2025);
    expect(t).not.toBeNull();
    const d = new Date(t!);
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(3);
    expect(d.getDate()).toBe(20);
  });
});

describe('parseRowsFromTableHtml', () => {
  it('maps table rows to points', () => {
    const pts = parseRowsFromTableHtml(
      [
        { cells: ['4/14 to 4/20', '$15.43', '$219.00'] },
        { cells: ['4/21 to 4/27', '$12.26', '$243.00'] },
      ],
      2025
    );
    expect(pts.length).toBe(2);
    expect(pts[0].marketPrice).toBeCloseTo(15.43);
    expect(pts[1].marketPrice).toBeCloseTo(12.26);
    expect(pts[0].volumeUsd).toBeCloseTo(219);
  });
});
