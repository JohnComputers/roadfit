import { ArrowLeft, Bookmark, CalendarDays, Check, ExternalLink, Fuel, Gauge, GitCompareArrows, Heart, Info, Route, ShieldCheck, UsersRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CompareTray } from '../components/CompareTray';
import { CatalogSkeleton } from '../components/Skeletons';
import { VehicleArtwork } from '../components/VehicleArtwork';
import { VehicleCard } from '../components/VehicleCard';
import { useAuth } from '../contexts/AuthContext';
import { useCompare } from '../contexts/CompareContext';
import { useSavedCars } from '../contexts/SavedCarsContext';
import { useToast } from '../contexts/ToastContext';
import { DEFAULT_FILTERS, groupModelYearResults, vehicleModelYearKey } from '../lib/filters';
import { formatCurrency, formatDate, formatNumber, titleCase } from '../lib/format';
import { findVehicleById, loadCatalog, loadModelYears } from '../services/catalog';
import type { VehicleRecord } from '../types/vehicle';

function SpecItem({ label, value, icon: Icon }: { label: string; value: string | number | null | undefined; icon?: typeof Gauge }) {
  return (
    <div className="spec-item">
      {Icon ? <Icon aria-hidden="true" /> : null}
      <span>{label}</span>
      <strong>{value ?? 'Unavailable'}</strong>
    </div>
  );
}

export function VehicleDetailPage() {
  const { vehicleId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const [vehicle, setVehicle] = useState<VehicleRecord | null>(null);
  const [related, setRelated] = useState<VehicleRecord[]>([]);
  const [modelYears, setModelYears] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const compare = useCompare();
  const { user } = useAuth();
  const savedCars = useSavedCars();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const yearHint = Number(searchParams.get('vy')) || undefined;
  const budgetParam = searchParams.get('max');
  const budget = budgetParam !== null && budgetParam.trim() !== '' && Number.isFinite(Number(budgetParam)) && Number(budgetParam) >= 0
    ? Number(budgetParam)
    : DEFAULT_FILTERS.maxPrice ?? 25000;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setRelated([]);
    setModelYears([]);
    void findVehicleById(decodeURIComponent(vehicleId), controller.signal, yearHint)
      .then(({ vehicle: found }) => {
        if (controller.signal.aborted) return;
        if (!found) throw new Error('That vehicle record was not found in the current catalog.');
        setVehicle(found);
        setLoading(false);
        void loadModelYears(found.make, found.model, controller.signal)
          .then((years) => { if (!controller.signal.aborted) setModelYears(years); })
          .catch(() => { /* Model-year navigation is optional. */ });
        void loadCatalog(
          { ...DEFAULT_FILTERS, minPrice: null, maxPrice: null, minYear: found.year, maxYear: found.year, priceAvailable: null },
          controller.signal,
        ).then((result) => {
          if (!controller.signal.aborted) setRelated(result.vehicles.filter((candidate) => candidate.year === found.year));
        }).catch(() => { /* Similar cars are optional. */ });
      })
      .catch((loadError) => {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : 'Vehicle details could not be loaded.');
        setLoading(false);
      });
    return () => controller.abort();
  }, [vehicleId, yearHint]);

  const alternatives = useMemo(() => {
    if (!vehicle) return [];
    const modelYear = vehicleModelYearKey(vehicle);
    return related.filter((candidate) => candidate.id !== vehicle.id && vehicleModelYearKey(candidate) === modelYear).slice(0, 6);
  }, [related, vehicle]);
  const similar = useMemo(() => {
    if (!vehicle) return [];
    const ranked = related
      .filter((candidate) => candidate.id !== vehicle.id && candidate.make !== vehicle.make && (candidate.bodyStyle === vehicle.bodyStyle || candidate.category === vehicle.category))
      .sort((a, b) => {
        if (Boolean(a.price) !== Boolean(b.price)) return a.price ? -1 : 1;
        const target = vehicle.price?.average ?? budget;
        return Math.abs((a.price?.average ?? target) - target) - Math.abs((b.price?.average ?? target) - target);
      })
    return groupModelYearResults(ranked).slice(0, 4).map(({ configurations }) => configurations[0]);
  }, [related, vehicle, budget]);

  const handleSave = async () => {
    if (!vehicle) return;
    if (!user) {
      navigate(`/account?return=${encodeURIComponent(location.pathname + location.search)}`);
      return;
    }
    try {
      if (savedCars.isSaved(vehicle.id)) {
        await savedCars.remove(vehicle.id);
        showToast('Removed from your garage.', 'info');
      } else {
        await savedCars.save(vehicle.id);
        showToast('Saved to your garage.', 'success');
      }
    } catch (saveError) {
      showToast(saveError instanceof Error ? saveError.message : 'Could not update your garage.', 'error');
    }
  };

  if (loading) return <div className="page-section container detail-loading"><CatalogSkeleton count={3} /></div>;
  if (error || !vehicle) {
    return <div className="page-section container"><div className="state-card error-state"><Info aria-hidden="true" /><h1>Vehicle unavailable</h1><p>{error}</p><Link className="primary-button" to="/">Back to discovery</Link></div></div>;
  }

  const price = vehicle.price;
  const budgetDifference = price ? budget - price.average : null;
  const budgetPercent = price ? Math.min((price.average / Math.max(budget, 1)) * 100, 100) : 0;
  const searchQuery = `${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.trim ? ` ${vehicle.trim}` : ''} for sale`;
  const efficiencyUnit = vehicle.specs?.efficiencyUnit || vehicle.sourceDetails?.efficiencyUnit || (vehicle.specs?.fuelType?.toLowerCase() === 'ev' ? 'MPGe' : 'MPG');
  const discoveryParams = new URLSearchParams(searchParams);
  discoveryParams.delete('vy');
  const adjustedBudgetParams = new URLSearchParams(discoveryParams);
  adjustedBudgetParams.set('max', String(Math.max(price?.average ?? budget, budget)));
  const generation = vehicle.generation;
  const epaDetails = vehicle.sourceDetails;
  const horsepowerLabel = epaDetails?.horsepowerScope === 'system' ? 'System horsepower'
    : epaDetails?.horsepowerScope === 'test-vehicle' ? 'EPA test-car horsepower' : 'Horsepower';
  const generationParams = generation ? new URLSearchParams({
    make: vehicle.make, model: vehicle.model, y0: String(generation.startYear), y1: String(generation.endYear), priced: 'any', max: 'any',
  }) : null;

  return (
    <>
      <section className="detail-hero page-section">
        <div className="container">
          <Link className="back-link" to={discoveryParams.size ? `/?${discoveryParams}` : '/'}><ArrowLeft aria-hidden="true" /> Back to results</Link>
          <div className="detail-hero-grid">
            <VehicleArtwork vehicle={vehicle} detail />
            <div className="detail-summary">
              <div className="detail-badges"><span>{vehicle.year}</span>{generation ? <span>{generation.name}</span> : null}<span>{vehicle.bodyStyle || vehicle.category || 'Body type unavailable'}</span>{vehicle.sourceDetails?.vpicMakeModelMatched ? <span className="verified"><ShieldCheck aria-hidden="true" /> vPIC make/model match</span> : null}</div>
              <h1>{vehicle.make} {vehicle.model}</h1>
              <p className="detail-variant">{vehicle.trim || vehicle.variantLabel || [vehicle.specs?.engine, vehicle.specs?.transmission, vehicle.specs?.drivetrain].filter(Boolean).join(' · ')}</p>
              <div className="detail-price"><span>Average asking price</span><strong>{formatCurrency(price?.average)}</strong><small>{price ? `Based on ${formatNumber(price.sampleSize)} listings · model-year level` : 'No supported market-price record'}</small></div>
              <div className="detail-actions">
                <button className={savedCars.isSaved(vehicle.id) ? 'primary-button saved' : 'primary-button'} type="button" onClick={handleSave}>
                  {savedCars.isSaved(vehicle.id) ? <Heart aria-hidden="true" fill="currentColor" /> : <Bookmark aria-hidden="true" />}{savedCars.isSaved(vehicle.id) ? 'Saved' : 'Save vehicle'}
                </button>
                <button className={compare.has(vehicle.id) ? 'secondary-button active' : 'secondary-button'} type="button" onClick={() => compare.toggle(vehicle.id)}>
                  {compare.has(vehicle.id) ? <Check aria-hidden="true" /> : <GitCompareArrows aria-hidden="true" />}{compare.has(vehicle.id) ? 'Added to compare' : 'Compare'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="detail-content-section">
        <div className="container detail-content-grid">
          <div className="detail-main">
            <section className="detail-panel budget-fit-panel">
              <div className="panel-heading"><div><span className="section-kicker">Budget fit</span><h2>{budgetDifference === null ? 'Price data needed' : budgetDifference >= 0 ? `${formatCurrency(budgetDifference)} under budget` : `${formatCurrency(Math.abs(budgetDifference))} over budget`}</h2></div><strong>{formatCurrency(budget)} budget</strong></div>
              {price ? <><div className="budget-meter"><span style={{ width: `${budgetPercent}%` }} className={budgetDifference! >= 0 ? 'fits' : 'over'} /></div><div className="budget-meter-labels"><span>$0</span><span>{formatCurrency(budget)}</span></div></> : <p>RoadFit leaves the fit score blank when no licensed market-price record exists.</p>}
              <Link to={`/?${adjustedBudgetParams.toString()}#catalog-results`} className="text-link">Adjust budget without losing discovery <span aria-hidden="true">→</span></Link>
            </section>

            {generation && generationParams ? (
              <section className="detail-panel">
                <div className="panel-heading"><div><span className="section-kicker">U.S. model generation</span><h2>{generation.name}</h2></div><span>{generation.startYear}–{generation.endYear}</span></div>
                <div className="detail-actions">
                  <Link className="text-link" to={`/?${generationParams}#catalog-results`}>Browse this generation</Link>
                  <a className="text-link" href={generation.sourceUrl} target="_blank" rel="noreferrer">Generation source <ExternalLink aria-hidden="true" /></a>
                </div>
              </section>
            ) : null}

            <section className="detail-panel">
              <div className="panel-heading"><div><span className="section-kicker">Configuration</span><h2>Specifications</h2></div><span className="data-source-chip">Sourced specs</span></div>
              <div className="spec-grid">
                <SpecItem label="Fuel" value={titleCase(vehicle.specs?.fuelType)} icon={Fuel} />
                <SpecItem label="Combined efficiency" value={vehicle.specs?.mpgCombined ? `${vehicle.specs.mpgCombined} ${efficiencyUnit}` : null} icon={Route} />
                <SpecItem label="Engine" value={vehicle.specs?.engine} icon={Gauge} />
                <SpecItem label="Transmission" value={vehicle.specs?.transmission} />
                <SpecItem label="Drivetrain" value={vehicle.specs?.drivetrain} />
                <SpecItem label="Cylinders" value={vehicle.specs?.cylinders} />
                <SpecItem label="Displacement" value={vehicle.specs?.displacementL ? `${vehicle.specs.displacementL} L` : null} />
                <SpecItem label={horsepowerLabel} value={vehicle.specs?.horsepower ? `${vehicle.specs.horsepower} hp` : null} />
                <SpecItem label="City / highway" value={vehicle.specs?.mpgCity && vehicle.specs?.mpgHighway ? `${vehicle.specs.mpgCity} / ${vehicle.specs.mpgHighway} ${efficiencyUnit}` : null} />
                <SpecItem label="Doors" value={vehicle.specs?.doors} />
                <SpecItem label="Seats" value={vehicle.specs?.seats} icon={UsersRound} />
                <SpecItem label="EPA class" value={vehicle.sourceDetails?.epaVehicleClass} />
                {epaDetails?.electricMotorDescription ? <SpecItem label="EPA motor specification" value={epaDetails.electricMotorDescription} /> : null}
              </div>
              {vehicle.sourceDetails?.seatingNote ? <p className="missing-note"><UsersRound aria-hidden="true" /> {vehicle.sourceDetails.seatingNote}</p> : null}
              <p className="missing-note"><Info aria-hidden="true" /> Specifications show available data for this configuration. See Sources for the evidence behind added horsepower, door, or seat counts.</p>
            </section>

            {epaDetails && (epaDetails.annualFuelCostUsd != null || epaDetails.tailpipeCo2GramsPerMile != null || epaDetails.electricRangeMiles != null) ? (
              <section className="detail-panel">
                <div className="panel-heading"><div><span className="section-kicker">EPA / DOE estimates</span><h2>Fuel and charging</h2></div></div>
                <div className="spec-grid">
                  {epaDetails.annualFuelCostUsd != null ? <SpecItem label="Estimated annual fuel cost" value={formatCurrency(epaDetails.annualFuelCostUsd)} /> : null}
                  {epaDetails.tailpipeCo2GramsPerMile != null ? <SpecItem label="Tailpipe CO₂" value={`${formatNumber(epaDetails.tailpipeCo2GramsPerMile)} g/mi`} /> : null}
                  {epaDetails.electricRangeMiles != null ? <SpecItem label={epaDetails.electricRangeScope === 'charge-depleting' ? 'Charge-depleting range' : 'Electric range'} value={`${epaDetails.electricRangeMiles} mi`} /> : null}
                  {epaDetails.electricityKwhPer100Miles != null ? <SpecItem label="Electricity use" value={`${epaDetails.electricityKwhPer100Miles} kWh / 100 mi`} /> : null}
                  {epaDetails.chargeTimeHours240V != null ? <SpecItem label="240 V charging time" value={`${epaDetails.chargeTimeHours240V} hr`} /> : null}
                </div>
                <p className="missing-note"><Info aria-hidden="true" /> Annual fuel estimates use EPA fuel prices, 15,000 miles, and 55% city driving. Tailpipe CO₂ excludes electricity and fuel production. Actual charging times vary.</p>
                {epaDetails.electricRangeScope === 'charge-depleting' ? <p className="missing-note"><Info aria-hidden="true" /> This plug-in hybrid can use gasoline while its battery is discharging.</p> : null}
                <a className="text-link" href="https://www.fueleconomy.gov/feg/ws/index.shtml" target="_blank" rel="noreferrer">EPA estimate definitions <ExternalLink aria-hidden="true" /></a>
              </section>
            ) : null}

            {alternatives.length ? <section className="detail-panel"><div className="panel-heading"><div><span className="section-kicker">Same model-year</span><h2>Alternative configurations</h2></div><span>{alternatives.length} shown</span></div><div className="alternative-list">{alternatives.map((candidate) => {
              const candidateParams = new URLSearchParams(discoveryParams);
              candidateParams.set('vy', String(candidate.year));
              return <Link key={candidate.id} to={`/vehicle/${candidate.id}?${candidateParams}`}><span>{candidate.specs?.engine || candidate.model}</span><strong>{[candidate.specs?.transmission, candidate.specs?.drivetrain].filter(Boolean).join(' · ') || 'Specs vary'}</strong><small>{candidate.specs?.mpgCombined ? `${candidate.specs.mpgCombined} ${candidate.sourceDetails?.efficiencyUnit || 'MPG'}` : 'Efficiency unavailable'}</small></Link>;
            })}</div></section> : null}
            {modelYears.length > 1 ? <section className="detail-panel"><div className="panel-heading"><div><span className="section-kicker">Across the catalog</span><h2>Available model years</h2></div><CalendarDays aria-hidden="true" /></div><div className="year-variant-list">{modelYears.map((year) => <Link className={year === vehicle.year ? 'current' : ''} key={year} to={`/?make=${encodeURIComponent(vehicle.make)}&model=${encodeURIComponent(vehicle.model)}&y0=${year}&y1=${year}`}>{year}</Link>)}</div></section> : null}
          </div>

          <aside className="detail-sidebar">
            <section className="detail-panel price-evidence-panel">
              <span className="section-kicker">Market evidence</span><h2>Price details</h2>
              <dl>
                <div><dt>Average asking</dt><dd>{formatCurrency(price?.average)}</dd></div>
                <div><dt>Observed range</dt><dd>{price ? `${formatCurrency(price.min)}–${formatCurrency(price.max)}` : 'Unavailable'}</dd></div>
                <div><dt>Average mileage</dt><dd>{price?.averageMileage ? `${formatNumber(price.averageMileage)} mi` : 'Unavailable'}</dd></div>
                <div><dt>Listing sample</dt><dd>{price ? formatNumber(price.sampleSize) : 'Unavailable'}</dd></div>
                <div><dt>Updated</dt><dd>{formatDate(price?.updatedAt)}</dd></div>
              </dl>
              {price ? <p>{price.methodology}</p> : <p>We found no licensed price aggregate that could be joined confidently to this model-year.</p>}
              <p className="scope-warning"><Info aria-hidden="true" /> This price belongs to the model-year, not this exact EPA powertrain or trim.</p>
            </section>
            <section className="detail-panel external-search-panel">
              <span className="section-kicker">Shop the open web</span><h2>Find actual listings</h2>
              <p>RoadFit is a discovery catalog, not a live marketplace. Use this search to look for current third-party listings.</p>
              <a className="primary-button" href={`https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`} target="_blank" rel="noreferrer">Search Google <ExternalLink aria-hidden="true" /></a>
            </section>
            <section className="detail-panel provenance-panel">
              <span className="section-kicker">Traceable record</span><h2>Sources</h2>
              {vehicle.provenance.map((source, index) => <a key={`${source.source}-${index}`} href={source.url || undefined} target="_blank" rel="noreferrer"><div><strong>{source.source}</strong><span>{source.fields?.length ? source.fields.join(', ') : source.license || 'License details unavailable'}</span></div>{source.url ? <ExternalLink aria-hidden="true" /> : null}</a>)}
              <Link to="/sources" className="text-link">Read methodology & limitations</Link>
            </section>
          </aside>
        </div>
      </section>

      {similar.length ? <section className="similar-section"><div className="container"><div className="section-heading"><div><span className="section-kicker">Same year, similar purpose</span><h2>Other cars to consider</h2></div></div><div className="vehicle-grid">{similar.map((candidate) => <VehicleCard key={candidate.id} vehicle={candidate} />)}</div></div></section> : null}
      <CompareTray />
    </>
  );
}
