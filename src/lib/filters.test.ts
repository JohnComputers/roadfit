import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTERS,
  activeFilterCount,
  deriveFacets,
  filterAndSortVehicles,
  filtersFromSearchParams,
  filtersFromStoredPreferences,
  filtersToSearchParams,
  sortVehicles,
  vehicleMatchesFilters,
} from './filters';
import { vehicles } from '../test/fixtures/vehicles';
import type { VehicleFilters } from '../types/vehicle';

function filters(overrides: Partial<VehicleFilters> = {}): VehicleFilters {
  return {
    ...DEFAULT_FILTERS,
    makes: [],
    models: [],
    trims: [],
    bodyStyles: [],
    categories: [],
    fuelTypes: [],
    transmissions: [],
    drivetrains: [],
    ...overrides,
  };
}

describe('vehicle filter combinations', () => {
  it('intersects price, year, make, body, fuel, drivetrain, efficiency, and sample filters', () => {
    const result = filterAndSortVehicles(
      vehicles,
      filters({
        minPrice: 10_000,
        maxPrice: 20_000,
        minYear: 2015,
        maxYear: 2021,
        makes: ['Subaru'],
        bodyStyles: ['Wagon'],
        fuelTypes: ['gasoline'],
        drivetrains: ['awd'],
        minMpg: 25,
        minSampleSize: 25,
      }),
    );

    expect(result.map((vehicle) => vehicle.id)).toEqual(['epa-100003']);
  });

  it('matches free-text across make, model, year, and trim without case sensitivity', () => {
    expect(vehicleMatchesFilters(vehicles[0]!, filters({ query: 'mustang gt' }))).toBe(true);
    expect(vehicleMatchesFilters(vehicles[3]!, filters({ query: '2022 NISSAN' , maxPrice: null, priceAvailable: null }))).toBe(true);
  });

  it('treats unsupported specifications as missing instead of inventing values', () => {
    expect(vehicleMatchesFilters(vehicles[3]!, filters({ minHorsepower: 100, maxPrice: null, priceAvailable: null }))).toBe(false);
    expect(vehicleMatchesFilters(vehicles[3]!, filters({ minSeats: 5, maxPrice: null, priceAvailable: null }))).toBe(true);
  });

  it('can select only records whose price is unavailable', () => {
    const result = filterAndSortVehicles(vehicles, filters({ minPrice: null, maxPrice: null, priceAvailable: false }));
    expect(result.map((vehicle) => vehicle.id)).toEqual(['epa-100004']);
  });

  it('narrows dependent model and trim facets after selecting a make and model', () => {
    const makeFacets = deriveFacets(vehicles, { makes: ['Ford'], models: [] });
    expect(makeFacets.models).toEqual(['Mustang']);
    expect(makeFacets.models).not.toContain('Prius');

    const modelFacets = deriveFacets(vehicles, { makes: ['Ford'], models: ['Mustang'] });
    expect(modelFacets.trims).toEqual(['GT']);
  });
});
describe('sorting', () => {
  it('puts missing prices last for ascending price', () => {
    const result = sortVehicles(vehicles, 'price-asc', filters({ minPrice: null, maxPrice: null, priceAvailable: null }));
    expect(result.map((vehicle) => vehicle.id)).toEqual(['epa-100003', 'epa-100002', 'epa-100001', 'epa-100004']);
  });

  it('sorts efficiency using populated combined values', () => {
    const result = sortVehicles(vehicles, 'mpg-desc', filters({ minPrice: null, maxPrice: null, priceAvailable: null }));
    expect(result[0]?.id).toBe('epa-100004');
    expect(result.at(-1)?.id).toBe('epa-100001');
  });

  it('makes budget fit deterministic and data-backed', () => {
    const selected = filters({ minPrice: 0, maxPrice: 20_000, priceAvailable: true, sort: 'fit' });
    const firstRun = sortVehicles(vehicles.slice(0, 3), 'fit', selected).map((vehicle) => vehicle.id);
    const secondRun = sortVehicles([...vehicles.slice(0, 3)].reverse(), 'fit', selected).map((vehicle) => vehicle.id);
    expect(secondRun).toEqual(firstRun);
    expect(firstRun[0]).toBe('epa-100002');
  });
});

describe('shareable filter URLs', () => {
  it('round-trips combined persistent filters', () => {
    const original = filters({
      query: 'plug in',
      minPrice: 7_500,
      maxPrice: 42_000,
      minYear: 2018,
      maxYear: 2025,
      makes: ['Ford', 'Toyota'],
      models: ['Mustang Mach-E'],
      bodyStyles: ['SUV'],
      fuelTypes: ['EV', 'PHEV'],
      drivetrains: ['AWD'],
      minHorsepower: 250,
      minMpg: 75,
      minSampleSize: 20,
      priceAvailable: null,
      sort: 'sample-desc',
      page: 3,
      pageSize: 48,
      view: 'list',
    });

    const restored = filtersFromSearchParams(filtersToSearchParams(original));
    expect(restored).toMatchObject(original);
  });

  it('sanitizes invalid page sizes and clamps invalid pages', () => {
    const restored = filtersFromSearchParams(new URLSearchParams('page=-2&size=13'));
    expect(restored.page).toBe(1);
    expect(restored.pageSize).toBe(24);
  });

  it('counts user-visible active constraints', () => {
    expect(activeFilterCount(filters({ maxPrice: 15_000, makes: ['Ford'], bodyStyles: ['Coupe'], minMpg: 20 }))).toBeGreaterThanOrEqual(4);
    expect(activeFilterCount(filters())).toBe(0);
  });

  it('restores safe account preferences and falls back to a saved budget', () => {
    const restored = filtersFromStoredPreferences({ makes: ['Ford', 17], maxPrice: undefined, sort: 'price-asc', pageSize: 13 }, 18_000);
    expect(restored.makes).toEqual(['Ford']);
    expect(restored.maxPrice).toBe(18_000);
    expect(restored.sort).toBe('price-asc');
    expect(restored.pageSize).toBe(24);
    expect(restored.page).toBe(1);
  });
});
