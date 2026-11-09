export type FuelType = 'gasoline' | 'diesel' | 'hybrid' | 'phev' | 'ev' | 'alternative' | 'unknown';

export interface PriceData {
  average: number;
  min: number | null;
  max: number | null;
  sampleSize: number;
  averageMileage: number | null;
  currency: 'USD';
  methodology: string;
  source: string;
  updatedAt: string;
  scope?: 'model_year' | 'trim' | string;
  sourceUrl?: string;
}

export interface VehicleSpecs {
  fuelType?: FuelType | string | null;
  fuelLabel?: string | null;
  transmission?: string | null;
  drivetrain?: string | null;
  engine?: string | null;
  cylinders?: number | null;
  displacementL?: number | null;
  horsepower?: number | null;
  mpgCity?: number | null;
  mpgHighway?: number | null;
  mpgCombined?: number | null;
  efficiencyUnit?: 'MPG' | 'MPGe' | string | null;
  doors?: number | null;
  seats?: number | null;
  electricRangeMiles?: number | null;
}

export interface Provenance {
  source: string;
  sourceId?: string | number | null;
  url?: string | null;
  retrievedAt: string;
  license?: string | null;
}

export interface VehicleImage {
  url: string;
  alt?: string;
  representsExactVehicle?: boolean;
  creator?: string;
  sourceUrl?: string;
  license?: string;
}

export interface VehicleRecord {
  id: string;
  year: number;
  make: string;
  model: string;
  trim?: string | null;
  category?: string | null;
  categories?: string[];
  bodyStyle?: string | null;
  price?: PriceData | null;
  specs?: VehicleSpecs;
  image?: VehicleImage | null;
  provenance: Provenance[];
  variantLabel?: string | null;
  sourceUpdatedAt?: string | null;
  sourceDetails?: {
    epaVehicleId?: string;
    epaVehicleClass?: string;
    transmissionRaw?: string | null;
    drivetrainRaw?: string | null;
    fuelPrimaryRaw?: string | null;
    fuelSecondaryRaw?: string | null;
    efficiencyUnit?: 'MPG' | 'MPGe' | string | null;
    electricRangeMiles?: number | null;
    chargeTimeHours240V?: number | null;
    vpicMakeModelMatched?: boolean;
  };
}

export interface CatalogShard {
  id: string;
  url: string;
  count: number;
  minYear?: number | null;
  maxYear?: number | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  pricedCount?: number;
  bytes?: number;
  sha256?: string;
}

export interface CatalogSource {
  name: string;
  url: string;
  license?: string;
  retrievedAt?: string;
  updatedAt?: string;
  recordCount?: number;
  status?: string;
}

export interface CatalogManifest {
  version?: string;
  schemaVersion?: number;
  catalogVersion?: string;
  generatedAt: string;
  total: number;
  totalRecords?: number;
  pricedRecords?: number;
  pricedCount?: number;
  unpricedCount?: number;
  modelYears?: number;
  makes?: number;
  minYear?: number;
  maxYear?: number;
  sources?: CatalogSource[];
  facetsUrl?: string;
  statsUrl?: string;
  idIndexUrl?: string;
  facets?: {
    makes?: string[];
    bodyStyles?: string[];
    fuelTypes?: string[];
    years?: number[];
  };
  shards: CatalogShard[];
}

export type SortKey =
  | 'fit'
  | 'price-asc'
  | 'price-desc'
  | 'year-desc'
  | 'year-asc'
  | 'name-asc'
  | 'horsepower-desc'
  | 'mpg-desc'
  | 'mileage-asc'
  | 'sample-desc';

export interface VehicleFilters {
  query: string;
  minPrice: number | null;
  maxPrice: number | null;
  minYear: number | null;
  maxYear: number | null;
  makes: string[];
  models: string[];
  trims: string[];
  bodyStyles: string[];
  categories: string[];
  fuelTypes: string[];
  transmissions: string[];
  drivetrains: string[];
  minCylinders: number | null;
  maxCylinders: number | null;
  minDisplacement: number | null;
  maxDisplacement: number | null;
  minHorsepower: number | null;
  maxHorsepower: number | null;
  minMpg: number | null;
  minDoors: number | null;
  minSeats: number | null;
  priceAvailable: boolean | null;
  minSampleSize: number | null;
  sort: SortKey;
  page: number;
  pageSize: number;
  view: 'grid' | 'list';
}

export interface FilterFacets {
  makes: string[];
  models: string[];
  trims: string[];
  bodyStyles: string[];
  categories: string[];
  fuelTypes: string[];
  transmissions: string[];
  drivetrains: string[];
  years: number[];
}
