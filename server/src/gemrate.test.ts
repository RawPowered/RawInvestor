import { describe, it, expect, vi } from 'vitest';

import { searchGemRate, buildGemRateQuery, fetchGemRateCardSummary } from './gemrate.js';



const searchPayload = [

  {

    description: '2024 Surging Sparks Pikachu EX 238',

    gemrate_id: 'abc123',

    population_type: 'Universal',

    total_population: 27895,

  },

  {

    description: '2024 Surging Sparks Pikachu EX 238 BGS',

    gemrate_id: 'def456',

    population_type: 'BGS',

    total_population: 2,

  },

  { description: 'no id here', total_population: 5 },

];



const cardDetailsPayload = {

  description: 'Test Card',

  total_population: 200,

  total_gems_or_greater: 50,

  population_data: [

    {

      grader: 'PSA',

      card_total_grades: 50,

      grades: { g10: 20 },

    },

  ],

};



let lastGotoUrl = '';

let lastEvaluateArg: unknown;



vi.mock('playwright', () => {

  const page = {

    goto: vi.fn(async (url: string) => {

      lastGotoUrl = url;

    }),

    waitForTimeout: vi.fn(async () => {}),

    content: vi.fn(async () => '<html><body>const cardDetailsToken = "tok123";</body></html>'),

    evaluate: vi.fn(async (fn: unknown, arg?: unknown) => {

      lastEvaluateArg = arg;

      if (typeof fn === 'function') {

        const body = String(fn);

        if (body.includes('universal-search-query')) {

          if (arg === 'x') {

            return Promise.reject(new Error('GemRate search 500: Server Error'));

          }

          return searchPayload;

        }

        if (body.includes('card-details')) {

          return cardDetailsPayload;

        }

      }

      return null;

    }),

    close: vi.fn(async () => {}),

  };

  const context = {

    newPage: vi.fn(async () => page),

    close: vi.fn(async () => {}),

  };

  const browser = {

    newContext: vi.fn(async () => context),

    close: vi.fn(async () => {}),

  };

  return {

    chromium: {

      launch: vi.fn(async () => browser),

    },

  };

});



describe('buildGemRateQuery', () => {

  it('combines name + number + set into a single search string', () => {

    expect(

      buildGemRateQuery({

        name: 'Pikachu ex',

        set: 'Surging Sparks',

        cardNumber: '238',

      })

    ).toBe('Pikachu ex 238 Surging Sparks');

  });



  it('strips a trailing "(num)" from the name (PriceCharting convention)', () => {

    expect(

      buildGemRateQuery({

        name: 'Pikachu ex (238)',

        set: 'Surging Sparks',

        cardNumber: '238',

      })

    ).toBe('Pikachu ex 238 Surging Sparks');

  });



  it('drops blank fields without leaving extra spaces', () => {

    expect(

      buildGemRateQuery({ name: 'Meowth', set: '', cardNumber: '106' })

    ).toBe('Meowth 106');

  });

});



describe('searchGemRate', () => {

  it('bootstraps universal-search via Playwright and normalizes candidates', async () => {

    const result = await searchGemRate('pikachu ex 238');



    expect(lastGotoUrl).toContain('gemrate.com/universal-search');

    expect(result.query).toBe('pikachu ex 238');

    expect(result.candidates).toHaveLength(2);

    expect(result.candidates[0]).toMatchObject({

      gemrateId: 'abc123',

      populationType: 'Universal',

      totalPopulation: 27895,

    });

    expect(result.candidates[0].detailUrl).toContain('gemrate_id=abc123');

  });



  it('returns empty candidates for empty query without launching browser', async () => {

    const { chromium } = await import('playwright');

    const launch = vi.mocked(chromium.launch);

    launch.mockClear();



    const result = await searchGemRate('   ');

    expect(result.candidates).toEqual([]);

    expect(launch).not.toHaveBeenCalled();

  });



  it('drops rows missing gemrate_id', async () => {

    const result = await searchGemRate('test');

    expect(result.candidates).toHaveLength(2);

    expect(result.candidates.every((c) => c.gemrateId)).toBe(true);

  });



  it('throws a clear error on non-ok in-page search responses', async () => {

    await expect(searchGemRate('x')).rejects.toThrow(/500/);

  });

});



describe('fetchGemRateCardSummary', () => {

  it('parses token from page HTML then returns PSA 10 % and universal gems %', async () => {

    const out = await fetchGemRateCardSummary('abc');



    expect(lastGotoUrl).toContain('gemrate_id=abc');

    expect(lastEvaluateArg).toEqual({ gid: 'abc', token: 'tok123' });

    expect(out?.psa10Pct).toBe(40);

    expect(out?.universalGemsPct).toBe(25);

    expect(out?.description).toBe('Test Card');

  });



  it('returns null when token is missing from HTML', async () => {

    const { chromium } = await import('playwright');

    const browser = await vi.mocked(chromium.launch).mock.results[0]?.value;

    const context = await vi.mocked(browser.newContext).mock.results[0]?.value;

    const page = await vi.mocked(context.newPage).mock.results[0]?.value;

    vi.mocked(page.content).mockResolvedValueOnce('<html></html>');



    await expect(fetchGemRateCardSummary('x')).resolves.toBeNull();

  });

});


