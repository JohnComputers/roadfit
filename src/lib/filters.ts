import type { FilterFacets, SortKey, VehicleFilters, VehicleRecord } from '../types/vehicle';

export const DEFAULT_FILTERS: VehicleFilters = {
  query: '',
  minPrice: null,
  maxPrice: 25000,
  minYear: null,
  maxYear: null,
  makes: [],
  models: [],
  trims: [],
  bodyStyles: [],
  categories: [],
  fuelTypes: [],
  transmissions: [],
  drivetrains: [],
  minCylinders: null,
  maxCylinders: null,
  minDisplacement: null,
  maxDisplacement: null,
  minHorsepower: null,
  maxHorsepower: null,
  minMpg: null,
  minDoors: null,
  minSeats: null,
  priceAvailable: true,
  minSampleSize: null,
  sort: 'fit',
  page: 1,
  pageSize: 24,
  view: 'grid',
};

const ARRAY_KEYS: Array<keyof VehicleFilters> = [
  'makes',
  'models',
  'trims',
  'bodyStyles',
  'categories',
  'fuelTypes',
  'transmissions',
  'drivetrains',
];

const NUMERIC_KEYS: Array<keyof VehicleFilters> = [
  'minPrice',
  'maxPrice',
  'minYear',
  'maxYear',
  'minCylinders',
  'maxCylinders',
  'minDisplacement',
  'maxDisplacement',
  'minHorsepower',
  'maxHorsepower',
  'minMpg',
  'minDoors',
  'minSeats',
  'minSampleSize',
  'page',
  'pageSize',
];

const SORT_KEYS: SortKey[] = [
  'fit', 'price-asc', 'price-desc', 'year-desc', 'year-asc', 'name-asc',
  'horsepower-desc', 'mpg-desc', 'mileage-asc', 'sample-desc',
];

export function filtersFromStoredPreferences(value: unknown, defaultBudget?: unknown): VehicleFilters {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const filters: VehicleFilters = {
    ...DEFAULT_FILTERS,
    makes: [], models: [], trims: [], bodyStyles: [], categories: [], fuelTypes: [], transmissions: [], drivetrains: [],
  };
  for (const key of ARRAY_KEYS) {
    const candidate = source[key];
    if (Array.isArray(candidate)) {
      (filters[key] as string[]) = candidate.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim());
    }
  }
  for (const key of NUMERIC_KEYS) {
    const candidate = source[key];
    if (candidate === null || (typeof candidate === 'number' && Number.isFinite(candidate))) {
      (filters[key] as number | null) = candidate as number | null;
    }
  }
  if (source.maxPrice === undefined && typeof defaultBudget === 'number' && Number.isFinite(defaultBudget)) filters.maxPrice = defaultBudget;
  if (typeof source.query === 'string') filters.query = source.query.trim();
  if (source.priceAvailable === null || typeof source.priceAvailable === 'boolean') filters.priceAvailable = source.priceAvailable;
  if (typeof source.sort === 'string' && SORT_KEYS.includes(source.sort as SortKey)) filters.sort = source.sort as SortKey;
  if (source.view === 'grid' || source.view === 'list') filters.view = source.view;
  filters.page = 1;
  filters.pageSize = [12, 24, 48, 96].includes(filters.pageSize) ? filters.pageSize : DEFAULT_FILTERS.pageSize;
  return filters;
}

function normalized(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function matchesAny(value: string | null | undefined, choices: string[]): boolean {
  if (!choices.length) return true;
  const candidate = normalized(value);
  return choices.some((choice) => normalized(choice) === candidate);
}

function inRange(value: number | null | undefined, min: number | null, max: number | null): boolean {
  if (min === null && max === null) return true;
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  return (min === null || value >= min) && (max === null || value <= max);
}

function includesCategory(vehicle: VehicleRecord, categories: string[]): boolean {
  if (!categories.length) return true;
  const candidates = new Set([vehicle.category, ...(vehicle.categories ?? [])].map(normalized));
  return categories.some((category) => candidates.has(normalized(category)));
}

export function vehicleMatchesFilters(vehicle: VehicleRecord, filters: VehicleFilters): boolean {
  const { specs = {}, price } = vehicle;
  const query = normalized(filters.query);
  if (query) {
    const searchable = [vehicle.year, vehicle.make, vehicle.model, vehicle.trim, vehicle.bodyStyle, vehicle.category, vehicle.variantLabel]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const generationSearch = vehicle.generation ? `${searchable} ${vehicle.generation.name.toLowerCase()}` : '';
    const generationMatch = generationSearch && query.split(/\s+/).every((part) => generationSearch.includes(part));
    if (!searchable.includes(query) && !generationMatch) return false;
  }
  if (price) {
    if (!inRange(price.average, filters.minPrice, filters.maxPrice)) return false;
  } else if (filters.priceAvailable === true || (filters.priceAvailable !== false && (filters.minPrice !== null || filters.maxPrice !== null))) {
    return false;
  }
  if (!inRange(vehicle.year, filters.minYear, filters.maxYear)) return false;
  if (!matchesAny(vehicle.make, filters.makes)) return false;
  if (!matchesAny(vehicle.model, filters.models)) return false;
  if (!matchesAny(vehicle.trim, filters.trims)) return false;
  if (!matchesAny(vehicle.bodyStyle, filters.bodyStyles)) return false;
  if (!includesCategory(vehicle, filters.categories)) return false;
  if (!matchesAny(specs.fuelType, filters.fuelTypes)) return false;
  if (!matchesAny(specs.transmission, filters.transmissions)) return false;
  if (!matchesAny(specs.drivetrain, filters.drivetrains)) return false;
  if (!inRange(specs.cylinders, filters.minCylinders, filters.maxCylinders)) return false;
  if (!inRange(specs.displacementL, filters.minDisplacement, filters.maxDisplacement)) return false;
  if (!inRange(specs.horsepower, filters.minHorsepower, filters.maxHorsepower)) return false;
  if (filters.minMpg !== null && (typeof specs.mpgCombined !== 'number' || specs.mpgCombined < filters.minMpg)) return false;
  if (filters.minDoors !== null && (typeof specs.doors !== 'number' || specs.doors < filters.minDoors)) return false;
  if (filters.minSeats !== null && (typeof specs.seats !== 'number' || specs.seats < filters.minSeats)) return false;
  if (filters.priceAvailable === true && !price) return false;
  if (filters.priceAvailable === false && price) return false;
  if (filters.minSampleSize !== null && (!price || price.sampleSize < filters.minSampleSize)) return false;
  return true;
}

function fitScore(vehicle: VehicleRecord, filters: VehicleFilters): number {
  if (!vehicle.price) return -Infinity;
  const ceiling = filters.maxPrice ?? vehicle.price.average;
  const floor = filters.minPrice ?? 0;
  const span = Math.max(ceiling - floor, 1);
  const budgetUse = 1 - Math.min(Math.abs(ceiling - vehicle.price.average) / span, 1);
  const sampleConfidence = Math.min(Math.log10(vehicle.price.sampleSize + 1) / 3, 1);
  const recency = Math.min(Math.max((vehicle.year - 1980) / 50, 0), 1);
  const specCoverage = Object.values(vehicle.specs ?? {}).filter((value) => value !== null && value !== undefined && value !== '').length / 12;
  return budgetUse * 0.5 + sampleConfidence * 0.25 + recency * 0.15 + Math.min(specCoverage, 1) * 0.1;
}

function compareNumeric(left: number | null | undefined, right: number | null | undefined, direction: 1 | -1): number {
  const leftKnown = typeof left === 'number' && Number.isFinite(left);
  const rightKnown = typeof right === 'number' && Number.isFinite(right);
  if (!leftKnown) return rightKnown ? 1 : 0;
  if (!rightKnown) return -1;
  return (left - right) * direction;
}

export function sortVehicles(vehicles: VehicleRecord[], sort: SortKey, filters: VehicleFilters): VehicleRecord[] {
  const scores = sort === 'fit' ? new Map(vehicles.map((vehicle) => [vehicle.id, fitScore(vehicle, filters)])) : null;
  return [...vehicles].sort((a, b) => {
    const newestFirst = () => b.year - a.year || a.make.localeCompare(b.make) || a.model.localeCompare(b.model) || a.id.localeCompare(b.id);
    switch (sort) {
      case 'price-asc':
        return compareNumeric(a.price?.average, b.price?.average, 1) || newestFirst();
      case 'price-desc':
        return compareNumeric(a.price?.average, b.price?.average, -1) || newestFirst();
      case 'year-desc':
        return newestFirst();
      case 'year-asc':
        return a.year - b.year || newestFirst();
      case 'name-asc':
        return a.make.localeCompare(b.make) || a.model.localeCompare(b.model) || newestFirst();
      case 'horsepower-desc':
        return compareNumeric(a.specs?.horsepower, b.specs?.horsepower, -1) || newestFirst();
      case 'mpg-desc':
        return compareNumeric(a.specs?.mpgCombined, b.specs?.mpgCombined, -1) || newestFirst();
      case 'mileage-asc':
        return compareNumeric(a.price?.averageMileage, b.price?.averageMileage, 1) || newestFirst();
      case 'sample-desc':
        return compareNumeric(a.price?.sampleSize, b.price?.sampleSize, -1) || newestFirst();
      case 'fit':
      default:
        return compareNumeric(scores?.get(a.id), scores?.get(b.id), -1) || newestFirst();
    }
  });
}

export function filterAndSortVehicles(vehicles: VehicleRecord[], filters: VehicleFilters): VehicleRecord[] {
  return sortVehicles(vehicles.filter((vehicle) => vehicleMatchesFilters(vehicle, filters)), filters.sort, filters);
}

export function vehicleModelYearKey(vehicle: VehicleRecord): string {
  const model = normalized(vehicle.model);
  const nameplate = model.replace(/(?:\s+(?:2wd|4wd|awd|fwd|rwd|4x2|4x4|ffv))+$/u, '');
  const groupedModel = vehicle.bodyStyle?.toLowerCase() === 'pickup' ? nameplate.replace(/\s+pickup$/u, '') : nameplate;
  return JSON.stringify([vehicle.year, normalized(vehicle.make), (groupedModel || model).replace(/[-\s]+/gu, '')]);
}

export function groupModelYearResults(sortedVehicles: VehicleRecord[]): Array<{ key: string; configurations: [VehicleRecord, ...VehicleRecord[]] }> {
  const groups = new Map<string, [VehicleRecord, ...VehicleRecord[]]>();
  for (const vehicle of sortedVehicles) {
    const key = vehicleModelYearKey(vehicle);
    const group = groups.get(key);
    if (group) group.push(vehicle);
    else groups.set(key, [vehicle]);
  }
  return Array.from(groups, ([key, configurations]) => ({ key, configurations }));
}

export function deriveFacets(vehicles: VehicleRecord[], selected: Pick<VehicleFilters, 'makes' | 'models'>): FilterFacets {
  const makeFiltered = selected.makes.length ? vehicles.filter((vehicle) => matchesAny(vehicle.make, selected.makes)) : vehicles;
  const modelFiltered = selected.models.length ? makeFiltered.filter((vehicle) => matchesAny(vehicle.model, selected.models)) : makeFiltered;
  const unique = (values: Array<string | null | undefined>) =>
    [...new Set(values.filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim()))].sort((a, b) => a.localeCompare(b));

  return {
    makes: unique(vehicles.map((vehicle) => vehicle.make)),
    models: unique(makeFiltered.map((vehicle) => vehicle.model)),
    trims: unique(modelFiltered.map((vehicle) => vehicle.trim)),
    bodyStyles: unique(vehicles.map((vehicle) => vehicle.bodyStyle)),
    categories: unique(vehicles.flatMap((vehicle) => [vehicle.category, ...(vehicle.categories ?? [])])),
    fuelTypes: unique(vehicles.map((vehicle) => vehicle.specs?.fuelType)),
    transmissions: unique(vehicles.map((vehicle) => vehicle.specs?.transmission)),
    drivetrains: unique(vehicles.map((vehicle) => vehicle.specs?.drivetrain)),
    years: [...new Set(vehicles.map((vehicle) => vehicle.year))].sort((a, b) => b - a),
  };
}

export function filtersFromSearchParams(searchParams: URLSearchParams): VehicleFilters {
  const filters: VehicleFilters = { ...DEFAULT_FILTERS };
  const aliases: Record<string, keyof VehicleFilters> = {
    q: 'query',
    min: 'minPrice',
    max: 'maxPrice',
    y0: 'minYear',
    y1: 'maxYear',
    make: 'makes',
    model: 'models',
    trim: 'trims',
    body: 'bodyStyles',
    category: 'categories',
    fuel: 'fuelTypes',
    transmission: 'transmissions',
    drive: 'drivetrains',
    cyl0: 'minCylinders',
    cyl1: 'maxCylinders',
    disp0: 'minDisplacement',
    disp1: 'maxDisplacement',
    hp0: 'minHorsepower',
    hp1: 'maxHorsepower',
    mpg: 'minMpg',
    doors: 'minDoors',
    seats: 'minSeats',
    samples: 'minSampleSize',
    page: 'page',
    size: 'pageSize',
    sort: 'sort',
    view: 'view',
    priced: 'priceAvailable',
  };

  for (const [parameter, key] of Object.entries(aliases)) {
    const value = searchParams.get(parameter);
    if (value === null) continue;
    if (ARRAY_KEYS.includes(key)) {
      (filters[key] as string[]) = value.split(',').filter(Boolean);
    } else if (NUMERIC_KEYS.includes(key)) {
      if (key === 'maxPrice' && value === 'any') {
        filters.maxPrice = null;
        continue;
      }
      const parsed = Number(value);
      if (Number.isFinite(parsed)) (filters[key] as number | null) = parsed;
    } else if (key === 'priceAvailable') {
      filters.priceAvailable = value === 'any' ? null : value !== 'no';
    } else if (key === 'sort') {
      if (SORT_KEYS.includes(value as SortKey)) filters.sort = value as SortKey;
    } else if (key === 'view') {
      filters.view = value === 'list' ? 'list' : 'grid';
    } else if (key === 'query') {
      filters.query = value;
    }
  }
  filters.page = Math.max(1, filters.page);
  filters.pageSize = [12, 24, 48, 96].includes(filters.pageSize) ? filters.pageSize : 24;
  return filters;
}

export function filtersToSearchParams(filters: VehicleFilters): URLSearchParams {
  const params = new URLSearchParams();
  const setNumber = (name: string, value: number | null, defaultValue: number | null) => {
    if (value !== null && value !== defaultValue) params.set(name, String(value));
  };
  const setArray = (name: string, values: string[]) => {
    if (values.length) params.set(name, values.join(','));
  };
  if (filters.query) params.set('q', filters.query);
  setNumber('min', filters.minPrice, DEFAULT_FILTERS.minPrice);
  if (filters.maxPrice === null) params.set('max', 'any');
  else setNumber('max', filters.maxPrice, DEFAULT_FILTERS.maxPrice);
  setNumber('y0', filters.minYear, DEFAULT_FILTERS.minYear);
  setNumber('y1', filters.maxYear, DEFAULT_FILTERS.maxYear);
  setArray('make', filters.makes);
  setArray('model', filters.models);
  setArray('trim', filters.trims);
  setArray('body', filters.bodyStyles);
  setArray('category', filters.categories);
  setArray('fuel', filters.fuelTypes);
  setArray('transmission', filters.transmissions);
  setArray('drive', filters.drivetrains);
  setNumber('cyl0', filters.minCylinders, DEFAULT_FILTERS.minCylinders);
  setNumber('cyl1', filters.maxCylinders, DEFAULT_FILTERS.maxCylinders);
  setNumber('disp0', filters.minDisplacement, DEFAULT_FILTERS.minDisplacement);
  setNumber('disp1', filters.maxDisplacement, DEFAULT_FILTERS.maxDisplacement);
  setNumber('hp0', filters.minHorsepower, DEFAULT_FILTERS.minHorsepower);
  setNumber('hp1', filters.maxHorsepower, DEFAULT_FILTERS.maxHorsepower);
  setNumber('mpg', filters.minMpg, DEFAULT_FILTERS.minMpg);
  setNumber('doors', filters.minDoors, DEFAULT_FILTERS.minDoors);
  setNumber('seats', filters.minSeats, DEFAULT_FILTERS.minSeats);
  setNumber('samples', filters.minSampleSize, DEFAULT_FILTERS.minSampleSize);
  if (filters.priceAvailable !== DEFAULT_FILTERS.priceAvailable) params.set('priced', filters.priceAvailable === null ? 'any' : filters.priceAvailable ? 'yes' : 'no');
  if (filters.sort !== DEFAULT_FILTERS.sort) params.set('sort', filters.sort);
  if (filters.page !== 1) params.set('page', String(filters.page));
  if (filters.pageSize !== DEFAULT_FILTERS.pageSize) params.set('size', String(filters.pageSize));
  if (filters.view !== DEFAULT_FILTERS.view) params.set('view', filters.view);
  return params;
}

export function activeFilterCount(filters: VehicleFilters): number {
  return (
    (filters.query ? 1 : 0) +
    (filters.minPrice !== null ? 1 : 0) +
    (filters.maxPrice !== DEFAULT_FILTERS.maxPrice ? 1 : 0) +
    (filters.minYear !== null ? 1 : 0) +
    (filters.maxYear !== null ? 1 : 0) +
    ARRAY_KEYS.reduce((total, key) => total + (filters[key] as string[]).length, 0) +
    (filters.minHorsepower !== null ? 1 : 0) +
    (filters.maxHorsepower !== null ? 1 : 0) +
    (filters.minCylinders !== null ? 1 : 0) +
    (filters.maxCylinders !== null ? 1 : 0) +
    (filters.minDisplacement !== null ? 1 : 0) +
    (filters.maxDisplacement !== null ? 1 : 0) +
    (filters.minMpg !== null ? 1 : 0) +
    (filters.minDoors !== null ? 1 : 0) +
    (filters.minSeats !== null ? 1 : 0) +
    (filters.minSampleSize !== null ? 1 : 0) +
    (filters.priceAvailable !== DEFAULT_FILTERS.priceAvailable ? 1 : 0)
  );
}
