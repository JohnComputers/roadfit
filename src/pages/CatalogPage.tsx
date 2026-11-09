import { AlertTriangle, ArrowLeft, ArrowRight, DatabaseZap, SearchX } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BudgetHero } from '../components/BudgetHero';
import { ActiveFilterChips, CatalogToolbar } from '../components/CatalogToolbar';
import { CompareTray } from '../components/CompareTray';
import { FilterSidebar } from '../components/FilterSidebar';
import { CatalogSkeleton } from '../components/Skeletons';
import { VehicleCard } from '../components/VehicleCard';
import { useAuth } from '../contexts/AuthContext';
import { activeFilterCount, DEFAULT_FILTERS, deriveFacets, filterAndSortVehicles, filtersFromSearchParams, filtersFromStoredPreferences, filtersToSearchParams, groupModelYearResults } from '../lib/filters';
import { loadCatalog } from '../services/catalog';
import { requireSupabase } from '../services/supabase';
import type { CatalogManifest, VehicleFilters, VehicleRecord } from '../types/vehicle';

export function CatalogPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => filtersFromSearchParams(searchParams), [searchParams]);
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [manifest, setManifest] = useState<CatalogManifest | null>(null);
  const [loadedShards, setLoadedShards] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { user, loading: authLoading } = useAuth();
  const preferencesAttemptedFor = useRef<string | null>(null);
  const shardFilters = useMemo(() => ({
    ...DEFAULT_FILTERS,
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice,
    minYear: filters.minYear,
    maxYear: filters.maxYear,
    priceAvailable: filters.priceAvailable,
  }), [filters.minPrice, filters.maxPrice, filters.minYear, filters.maxYear, filters.priceAvailable]);
  const closeFilters = useCallback(() => {
    setFiltersOpen(false);
    window.setTimeout(() => (document.querySelector('.mobile-filter-button') as HTMLButtonElement | null)?.focus(), 0);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    const identity = user?.id ?? 'guest';
    if (preferencesAttemptedFor.current === identity) return;
    preferencesAttemptedFor.current = identity;
    if (!user || searchParams.size > 0) return;
    let active = true;
    void requireSupabase().from('profiles').select('preferred_filters, default_budget').eq('id', user.id).maybeSingle().then(({ data, error: profileError }) => {
      if (!active || profileError || !data) return;
      const preferred = filtersFromStoredPreferences(data.preferred_filters, data.default_budget);
      setSearchParams(filtersToSearchParams(preferred), { replace: true });
    });
    return () => { active = false; };
  }, [authLoading, user, searchParams, setSearchParams]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void loadCatalog(shardFilters, controller.signal)
      .then((result) => {
        setVehicles(result.vehicles);
        setManifest(result.manifest);
        setLoadedShards(result.loadedShards);
        setLoading(false);
      })
      .catch((loadError) => {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : 'The catalog could not be loaded.');
        setLoading(false);
      });
    return () => controller.abort();
  }, [shardFilters]);

  const updateFilters = useCallback(
    (changes: Partial<VehicleFilters>) => {
      const next = { ...filters, ...changes };
      setSearchParams(filtersToSearchParams(next), { replace: true });
    },
    [filters, setSearchParams],
  );

  const resetFilters = useCallback(() => setSearchParams(filtersToSearchParams(DEFAULT_FILTERS), { replace: true }), [setSearchParams]);
  const filtered = useMemo(() => filterAndSortVehicles(vehicles, filters), [vehicles, filters]);
  const groups = useMemo(() => groupModelYearResults(filtered), [filtered]);
  const facets = useMemo(() => deriveFacets(vehicles, { makes: filters.makes, models: filters.models }), [vehicles, filters.makes, filters.models]);
  const pageCount = Math.max(1, Math.ceil(groups.length / filters.pageSize));
  const page = Math.min(filters.page, pageCount);
  const pageItems = groups.slice((page - 1) * filters.pageSize, page * filters.pageSize);
  const suggestions = useMemo(
    () => [...facets.makes, ...facets.models, ...facets.trims].filter((value, index, all) => all.indexOf(value) === index),
    [facets],
  );

  const goToPage = (nextPage: number) => {
    updateFilters({ page: Math.min(Math.max(nextPage, 1), pageCount) });
    document.getElementById('catalog-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <>
      <BudgetHero
        filters={filters}
        onSubmit={updateFilters}
        catalogTotal={manifest?.totalRecords ?? manifest?.total}
        pricedRecords={manifest?.pricedRecords ?? manifest?.pricedCount}
      />
      <section className="catalog-section" id="catalog-results">
        <div className="container">
          <CatalogToolbar
            filters={filters}
            total={groups.length}
            configurationCount={filtered.length}
            suggestions={suggestions}
            activeCount={activeFilterCount(filters)}
            onChange={updateFilters}
            onOpenFilters={() => setFiltersOpen(true)}
          />
          <ActiveFilterChips filters={filters} onChange={updateFilters} onReset={resetFilters} />
          <div className="catalog-layout">
            <FilterSidebar filters={filters} facets={facets} open={filtersOpen} onClose={closeFilters} onChange={updateFilters} onReset={resetFilters} />
            <div className="catalog-content" aria-busy={loading}>
              {manifest ? (
                <div className="data-status">
                  <DatabaseZap aria-hidden="true" />
                  <span>Loaded {loadedShards} optimized {loadedShards === 1 ? 'shard' : 'shards'} · Catalog refreshed {new Date(manifest.generatedAt).toLocaleDateString()}</span>
                </div>
              ) : null}
              {loading ? <CatalogSkeleton /> : null}
              {!loading && error ? (
                <div className="state-card error-state">
                  <AlertTriangle aria-hidden="true" />
                  <h3>Catalog temporarily unavailable</h3>
                  <p>{error}</p>
                  <p>The app does not depend on live third-party APIs; reload to retry the last published static catalog.</p>
                  <button className="primary-button" type="button" onClick={() => window.location.reload()}>Reload catalog</button>
                </div>
              ) : null}
              {!loading && !error && !filtered.length ? (
                <div className="state-card empty-state">
                  <SearchX aria-hidden="true" />
                  <h3>No vehicles match every filter</h3>
                  <p>Try raising the budget, widening the year range, or allowing records without a market price.</p>
                  <div>
                    {filters.maxPrice !== null ? <button type="button" className="primary-button" onClick={() => updateFilters({ maxPrice: Math.round(filters.maxPrice! * 1.25), page: 1 })}>Raise budget 25%</button> : null}
                    <button type="button" className="secondary-button" onClick={resetFilters}>Reset filters</button>
                  </div>
                </div>
              ) : null}
              {!loading && !error && pageItems.length ? (
                <>
                  <div className={filters.view === 'grid' ? 'vehicle-grid' : 'vehicle-list'}>
                    {pageItems.map(({ key, configurations }) => (
                      <VehicleCard key={`${filters.sort}:${key}`} vehicle={configurations[0]} configurations={configurations} view={filters.view} />
                    ))}
                  </div>
                  <nav className="pagination" aria-label="Vehicle result pages">
                    <button type="button" onClick={() => goToPage(page - 1)} disabled={page <= 1}><ArrowLeft aria-hidden="true" /> Previous</button>
                    <span>Page <strong>{page}</strong> of {pageCount}</span>
                    <button type="button" onClick={() => goToPage(page + 1)} disabled={page >= pageCount}>Next <ArrowRight aria-hidden="true" /></button>
                  </nav>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </section>
      <CompareTray />
    </>
  );
}
