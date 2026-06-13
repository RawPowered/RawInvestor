import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchPsaPopulation } from './psa.js';

const samplePsaResponse = {
  SpecID: 12345,
  Brand: 'Pokemon',
  Subject: 'Pikachu',
  Year: '2024',
  CardNumber: '238',
  Population: {
    Auth: 2,
    Grade8: 10,
    Grade9: 300,
    Grade9_5: 5,
    Grade10: 200,
    TotalPop: 517,
  },
  PopulationWithQualifier: {
    Grade10: 3,
  },
};

describe('fetchPsaPopulation', () => {
  const origFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn() as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = origFetch;
  });

  it('rejects non-numeric spec IDs without hitting the network', async () => {
    await expect(fetchPsaPopulation('abc', 'tok')).rejects.toThrow(/Invalid PSA SpecID/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('requires a token', async () => {
    await expect(fetchPsaPopulation('123', '')).rejects.toThrow(/token/);
  });

  it('normalizes the PSA response into predictable shape', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => samplePsaResponse,
    });
    const data = await fetchPsaPopulation('12345', 'tok');

    expect(data.specId).toBe(12345);
    expect(data.brand).toBe('Pokemon');
    expect(data.totalPop).toBe(517);

    const psa10 = data.grades.find((g) => g.grade === 'PSA 10');
    expect(psa10?.population).toBe(200);
    expect(psa10?.qualifiedPopulation).toBe(3);

    const g95 = data.grades.find((g) => g.grade === 'PSA 9.5');
    expect(g95?.population).toBe(5);

    // Zero grades should be filtered out.
    expect(data.grades.find((g) => g.grade === 'PSA 7')).toBeUndefined();
  });

  it('maps 401 responses to a clear error', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({}),
    });
    await expect(fetchPsaPopulation('123', 'bad')).rejects.toThrow(/401/);
  });

  it('maps 429 responses to a rate-limit error', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      json: async () => ({}),
    });
    await expect(fetchPsaPopulation('123', 'tok')).rejects.toThrow(/rate limit|429/);
  });
});
