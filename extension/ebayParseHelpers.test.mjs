import assert from 'node:assert/strict';
import test from 'node:test';
import { parseEbayGradeTag, parseEbaySoldAt } from './ebayParseHelpers.mjs';

test('parseEbayGradeTag: TAG GEM MINT 10 is graded', () => {
  const r = parseEbayGradeTag(
    'Pokémon Persian 78/64 Shrouded Fable Illustration Rare TAG GEM MINT 10 or tab'
  );
  assert.equal(r.grader, 'TAG');
  assert.ok(r.gradeTag?.includes('GEM MINT'));
  assert.equal(r.isGraded, true);
});

test('parseEbayGradeTag: PSA 10 still works', () => {
  const r = parseEbayGradeTag('Card Name PSA 10 NM');
  assert.equal(r.grader, 'PSA');
  assert.equal(r.gradeTag, 'PSA 10');
  assert.equal(r.isGraded, true);
});

test('parseEbayGradeTag: CGC MINT 9', () => {
  const r = parseEbayGradeTag('Persian CGC MINT 9 Japanese');
  assert.equal(r.grader, 'CGC');
  assert.ok(r.gradeTag?.includes('MINT'));
  assert.equal(r.isGraded, true);
});

test('parseEbayGradeTag: raw-ish title', () => {
  const r = parseEbayGradeTag('Persian IR NM Pokemon Card');
  assert.equal(r.isGraded, false);
});

test('parseEbaySoldAt: date-only sold line uses local noon not midnight', () => {
  const text =
    'Sold  Mar 29, 2026  Best offer accepted  $249.99';
  const ms = parseEbaySoldAt(text);
  assert.ok(ms != null);
  const d = new Date(ms);
  assert.equal(d.getHours(), 12);
  assert.equal(d.getMinutes(), 0);
});

test('parseEbaySoldAt: ISO date-only', () => {
  const ms = parseEbaySoldAt('Sold 2025-03-14');
  assert.ok(ms != null);
  const d = new Date(ms);
  assert.equal(d.getHours(), 12);
});
