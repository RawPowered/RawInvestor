import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectLikelyBotWall,
  hasEbaySoldSerpEvidence,
  hasTcgProductEvidence,
} from './botWallDetect.mjs';

const el = (tag, attrs = {}, children = []) => ({
  tagName: tag.toUpperCase(),
  textContent: attrs.text ?? '',
  getAttribute: (k) => attrs[k] ?? null,
  matches: (sel) => {
    const s = String(sel || '');
    if (s.includes('s-item') && attrs.class?.includes('s-item')) return true;
    if (s.includes("a.s-item__link") && tag === 'a' && attrs.class?.includes('s-item__link')) return true;
    if (s.includes("a[href*='/itm/']") && tag === 'a' && String(attrs.href || '').includes('/itm/')) return true;
    if (s.includes('s-item__price') && attrs.class?.includes('s-item__price')) return true;
    if (s.includes('srp-results') && attrs.class?.includes('srp-results')) return true;
    return false;
  },
  querySelector: (sel) => {
    for (const c of children) {
      const hit = c.querySelector?.(sel) ?? (c.matches?.(sel) ? c : null);
      if (hit) return hit;
    }
    return null;
  },
  querySelectorAll: (sel) => {
    const out = [];
    const walk = (nodes) => {
      for (const n of nodes) {
        if (n.matches?.(sel)) out.push(n);
        if (n.children) walk(n.children);
        if (n.querySelectorAll) walk(n.querySelectorAll('*') || []);
      }
    };
    walk(children);
    return out;
  },
  children,
});

const ebaySerpDoc = () => {
  const items = [
    el('li', { class: 's-item' }, [
      el('a', { class: 's-item__link', href: '/itm/1' }),
      el('span', { class: 's-item__price', text: '$10.00' }),
    ]),
    el('li', { class: 's-item' }, [
      el('a', { class: 's-item__link', href: '/itm/2' }),
      el('span', { class: 's-item__price', text: '$20.00' }),
    ]),
  ];
  const root = el('ul', { class: 'srp-results' }, items);
  items.forEach((i) => {
    i.querySelector = (sel) => {
      for (const c of i.children) if (c.matches?.(sel)) return c;
      return null;
    };
  });
  root.querySelectorAll = (sel) => {
    if (sel.includes('li.s-item')) return items;
    return [];
  };
  return {
    title: 'Results',
    body: {
      innerText:
        'just a moment attention required access denied security measure in footer help text.',
    },
    querySelector: (sel) => {
      if (String(sel).includes('srp-results')) return root;
      return null;
    },
    querySelectorAll: () => [],
  };
};

test('hasEbaySoldSerpEvidence: two s-item rows', () => {
  const doc = ebaySerpDoc();
  assert.equal(hasEbaySoldSerpEvidence(doc), true);
  assert.equal(detectLikelyBotWall(doc, 'ebay'), false);
});

test('detectLikelyBotWall: hcaptcha iframe is a wall', () => {
  const doc = {
    title: 'Verify',
    body: { innerText: 'verify you are human' },
    querySelector: (sel) =>
      String(sel).includes('iframe') ? { getAttribute: () => 'https://hcaptcha.com/x' } : null,
    querySelectorAll: () => [],
  };
  assert.equal(detectLikelyBotWall(doc, 'ebay'), true);
});

test('hasTcgProductEvidence: product path and market price text', () => {
  const doc = {
    location: { pathname: '/product/12345/card' },
    body: { innerText: 'Market Price $12.99 Add to cart $14.00' },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  assert.equal(hasTcgProductEvidence(doc), true);
  assert.equal(detectLikelyBotWall(doc, 'tcgplayer'), false);
});

test('detectLikelyBotWall: empty page with challenge copy is a wall', () => {
  const doc = {
    title: 'Checking',
    body: { innerText: 'verify you are human. unusual traffic from your network.' },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  assert.equal(hasEbaySoldSerpEvidence(doc), false);
  assert.equal(detectLikelyBotWall(doc, 'ebay'), true);
});
