import type { CatalogManifest, CatalogShard, VehicleFilters, VehicleRecord } from '../types/vehicle';

const shardCache = new Map<string, Promise<VehicleRecord[]>>();
let manifestPromise: Promise<CatalogManifest> | null = null;
let facetsPromise: Promise<CatalogFacetIndex> | null = null;
let idIndexPromise: Promise<Record<string, string>> | null = null;

interface CatalogFacetIndex {
  makes: Array<{
    name: string;
    models: Array<{ name: string; years: number[]; trims?: string[] }>;
  }>;
}

function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  return `${base}${path.replace(/^\//, '')}`;
}

async function fetchJson<T>(url: string, cache: RequestCache = 'force-cache'): Promise<T> {
  const response = await fetch(url, { cache });
  if (!response.ok) throw new Error(`Catalog request failed (${response.status}) for ${url}`);
  return response.json() as Promise<T>;
}

function versionedUrl(path: string, catalogVersion: string): string {
  const url = assetUrl(path);
  return `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(catalogVersion)}`;
}

function waitWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener('abort', abort); resolve(value); },
      (error) => { signal.removeEventListener('abort', abort); reject(error); },
    );
  });
}

export function loadManifest(signal?: AbortSignal): Promise<CatalogManifest> {
  if (!manifestPromise) {
    manifestPromise = fetchJson<CatalogManifest>(assetUrl('data/catalog-manifest.json'), 'no-cache').catch((error) => {
      manifestPromise = null;
      throw error;
    });
  }
  return waitWithSignal(manifestPromise, signal);
}

export async function loadModelYears(make: string, model: string, signal?: AbortSignal): Promise<number[]> {
  if (!facetsPromise) {
    facetsPromise = loadManifest()
      .then((manifest) => fetchJson<CatalogFacetIndex>(versionedUrl(manifest.facetsUrl || 'data/facets.json', manifest.catalogVersion ?? manifest.generatedAt)))
      .catch((error) => {
        facetsPromise = null;
        throw error;
      });
  }
  const facets = await waitWithSignal(facetsPromise, signal);
  const makeEntry = facets.makes.find((entry) => entry.name.toLowerCase() === make.toLowerCase());
  const modelEntry = makeEntry?.models.find((entry) => entry.name.toLowerCase() === model.toLowerCase());
  return [...(modelEntry?.years ?? [])].sort((a, b) => b - a);
}

function overlaps(minA: number | null | undefined, maxA: number | null | undefined, minB: number | null, maxB: number | null): boolean {
  const a0 = minA ?? -Infinity;
  const a1 = maxA ?? Infinity;
  const b0 = minB ?? -Infinity;
  const b1 = maxB ?? Infinity;
  return a0 <= b1 && b0 <= a1;
}

export function chooseShards(manifest: CatalogManifest, filters: Pick<VehicleFilters, 'minPrice' | 'maxPrice' | 'minYear' | 'maxYear' | 'priceAvailable'>): CatalogShard[] {
  return manifest.shards.filter((shard) => {
    const yearMatch = overlaps(shard.minYear, shard.maxYear, filters.minYear, filters.maxYear);
    if (!yearMatch) return false;
    const isUnpricedShard = shard.id.includes('price-unavailable') || (shard.minPrice === null && shard.maxPrice === null);
    if (filters.priceAvailable === false) return isUnpricedShard;
    if (filters.priceAvailable === true && isUnpricedShard) return false;
    if (filters.minPrice === null && filters.maxPrice === null) return true;
    if (isUnpricedShard) return filters.minPrice === null && filters.maxPrice === null;
    return overlaps(shard.minPrice, shard.maxPrice, filters.minPrice, filters.maxPrice);
  });
}

async function loadShard(shard: CatalogShard, catalogVersion: string, signal?: AbortSignal): Promise<VehicleRecord[]> {
  const path = shard.url.replace(/^public\//, '').replace(/^data\//, 'data/');
  const url = versionedUrl(path, catalogVersion);
  if (!shardCache.has(url)) {
    shardCache.set(
      url,
      fetchJson<VehicleRecord[] | { vehicles: VehicleRecord[] }>(url)
        .then((data) => (Array.isArray(data) ? data : data.vehicles))
        .catch((error) => {
          shardCache.delete(url);
          throw error;
        }),
    );
  }
  return waitWithSignal(shardCache.get(url)!, signal);
}

async function loadIdIndex(manifest: CatalogManifest, signal?: AbortSignal): Promise<Record<string, string>> {
  if (!idIndexPromise) {
    idIndexPromise = fetchJson<Record<string, string>>(versionedUrl(manifest.idIndexUrl || 'data/id-index.json', manifest.catalogVersion ?? manifest.generatedAt)).catch((error) => {
      idIndexPromise = null;
      throw error;
    });
  }
  return waitWithSignal(idIndexPromise, signal);
}

export async function loadCatalog(filters: VehicleFilters, signal?: AbortSignal): Promise<{ manifest: CatalogManifest; vehicles: VehicleRecord[]; loadedShards: number }> {
  const manifest = await loadManifest(signal);
  const shards = chooseShards(manifest, filters);
  const catalogVersion = manifest.catalogVersion ?? manifest.generatedAt;
  const results = await Promise.all(shards.map((shard) => loadShard(shard, catalogVersion, signal)));
  return { manifest, vehicles: results.flat(), loadedShards: shards.length };
}

export async function findVehicleById(id: string, signal?: AbortSignal, yearHint?: number): Promise<{ vehicle: VehicleRecord | null; manifest: CatalogManifest }> {
  const manifest = await loadManifest(signal);
  const index = await loadIdIndex(manifest, signal).catch(() => null);
  const indexedShard = index ? manifest.shards.find((shard) => shard.id === index[id] || shard.url === index[id]) : undefined;
  const catalogVersion = manifest.catalogVersion ?? manifest.generatedAt;
  if (indexedShard) {
    const vehicles = await loadShard(indexedShard, catalogVersion, signal);
    return { vehicle: vehicles.find((candidate) => candidate.id === id) ?? null, manifest };
  }
  const likelyShards = typeof yearHint === 'number'
    ? manifest.shards.filter((shard) => (shard.minYear ?? -Infinity) <= yearHint && (shard.maxYear ?? Infinity) >= yearHint)
    : manifest.shards;
  const remainingShards = typeof yearHint === 'number' ? manifest.shards.filter((shard) => !likelyShards.includes(shard)) : [];
  for (const shard of [...likelyShards, ...remainingShards]) {
    const vehicles = await loadShard(shard, catalogVersion, signal);
    const vehicle = vehicles.find((candidate) => candidate.id === id);
    if (vehicle) return { vehicle, manifest };
  }
  return { vehicle: null, manifest };
}

export async function findVehiclesByIds(ids: string[], signal?: AbortSignal, yearHints?: Record<string, number>): Promise<VehicleRecord[]> {
  const wanted = new Set(ids);
  if (!wanted.size) return [];
  const manifest = await loadManifest(signal);
  const found: VehicleRecord[] = [];
  const index = await loadIdIndex(manifest, signal).catch(() => null);
  const hintedYears = new Set(Object.values(yearHints ?? {}));
  const indexedShardIds = new Set(index ? ids.map((id) => index[id]).filter((value): value is string => Boolean(value)) : []);
  const indexedShards = manifest.shards.filter((shard) => indexedShardIds.has(shard.id) || indexedShardIds.has(shard.url));
  const likelyShards = indexedShards.length ? indexedShards : hintedYears.size
    ? manifest.shards.filter((shard) => [...hintedYears].some((year) => (shard.minYear ?? -Infinity) <= year && (shard.maxYear ?? Infinity) >= year))
    : manifest.shards;
  const orderedShards = [...likelyShards, ...manifest.shards.filter((shard) => !likelyShards.includes(shard))];
  const catalogVersion = manifest.catalogVersion ?? manifest.generatedAt;
  for (const shard of orderedShards) {
    const vehicles = await loadShard(shard, catalogVersion, signal);
    for (const vehicle of vehicles) {
      if (wanted.has(vehicle.id)) {
        found.push(vehicle);
        wanted.delete(vehicle.id);
      }
    }
    if (!wanted.size) break;
  }
  return ids.map((id) => found.find((vehicle) => vehicle.id === id)).filter((vehicle): vehicle is VehicleRecord => Boolean(vehicle));
}

export function clearCatalogCache(): void {
  shardCache.clear();
  manifestPromise = null;
  facetsPromise = null;
  idIndexPromise = null;
}
