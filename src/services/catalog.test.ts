import { describe, expect, it } from 'vitest';
import { chooseShards } from './catalog';
import type { CatalogManifest, VehicleFilters } from '../types/vehicle';

const manifest: CatalogManifest = {
  schemaVersion: 1,
  catalogVersion: 'test',
  generatedAt: '2026-11-08T00:00:00Z',
  total: 400,
  shards: [
    { id: 'year-1990-1999_price-000000-009999', url: 'data/catalog/a.json', count: 100, minYear: 1990, maxYear: 1999, minPrice: 1_000, maxPrice: 9_999 },
    { id: 'year-2000-2009_price-010000-024999', url: 'data/catalog/b.json', count: 100, minYear: 2000, maxYear: 2009, minPrice: 10_000, maxPrice: 24_999 },
    { id: 'year-2010-2019_price-025000-049999', url: 'data/catalog/c.json', count: 100, minYear: 2010, maxYear: 2019, minPrice: 25_000, maxPrice: 49_999 },
    { id: 'year-2000-2009_price-unavailable', url: 'data/catalog/d.json', count: 100, minYear: 2000, maxYear: 2009, minPrice: null, maxPrice: null },
  ],
};

function selection(overrides: Partial<Pick<VehicleFilters, 'minPrice' | 'maxPrice' | 'minYear' | 'maxYear' | 'priceAvailable'>> = {}) {
  return { minPrice: null, maxPrice: null, minYear: null, maxYear: null, priceAvailable: null, ...overrides };
}

describe('catalog shard selection', () => {
  it('loads only price buckets that can overlap a budget', () => {
    expect(chooseShards(manifest, selection({ minPrice: 8_000, maxPrice: 15_000, priceAvailable: true })).map((shard) => shard.id)).toEqual([
      'year-1990-1999_price-000000-009999',
      'year-2000-2009_price-010000-024999',
    ]);
  });

  it('prunes non-overlapping year buckets as well as price buckets', () => {
    expect(chooseShards(manifest, selection({ maxPrice: 20_000, minYear: 2005, maxYear: 2007, priceAvailable: true })).map((shard) => shard.id)).toEqual([
      'year-2000-2009_price-010000-024999',
    ]);
  });

  it('loads only unavailable-price shards when requested', () => {
    expect(chooseShards(manifest, selection({ priceAvailable: false })).map((shard) => shard.id)).toEqual([
      'year-2000-2009_price-unavailable',
    ]);
  });

  it('includes both priced and unpriced buckets when all prices are allowed without a budget', () => {
    expect(chooseShards(manifest, selection())).toHaveLength(4);
  });

  it('does not download unavailable-price shards when a budget would reject them', () => {
    expect(chooseShards(manifest, selection({ maxPrice: 20_000, priceAvailable: null })).map((shard) => shard.id)).toEqual([
      'year-1990-1999_price-000000-009999',
      'year-2000-2009_price-010000-024999',
    ]);
  });
});
