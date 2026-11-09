import { ArrowLeft, Check, GitCompareArrows, Info, Plus, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { VehicleArtwork } from '../components/VehicleArtwork';
import { useCompare } from '../contexts/CompareContext';
import { formatCurrency, formatNumber, titleCase } from '../lib/format';
import { findVehiclesByIds } from '../services/catalog';
import type { VehicleRecord } from '../types/vehicle';

type CompareRow = {
  label: string;
  get: (vehicle: VehicleRecord) => string | number | null | undefined;
  numeric?: (vehicle: VehicleRecord) => number | null | undefined;
  best?: 'min' | 'max';
};

const ROWS: CompareRow[] = [
  { label: 'Average asking price', get: (v) => formatCurrency(v.price?.average), numeric: (v) => v.price?.average, best: 'min' },
  { label: 'Observed price range', get: (v) => v.price ? `${formatCurrency(v.price.min)}–${formatCurrency(v.price.max)}` : 'Unavailable' },
  { label: 'Listing sample', get: (v) => v.price ? formatNumber(v.price.sampleSize) : 'Unavailable', numeric: (v) => v.price?.sampleSize, best: 'max' },
  { label: 'Average mileage', get: (v) => v.price?.averageMileage ? `${formatNumber(v.price.averageMileage)} mi` : 'Unavailable', numeric: (v) => v.price?.averageMileage, best: 'min' },
  { label: 'Model year', get: (v) => v.year, numeric: (v) => v.year, best: 'max' },
  { label: 'Body style', get: (v) => v.bodyStyle || v.category || 'Unavailable' },
  { label: 'Fuel', get: (v) => titleCase(v.specs?.fuelType) },
  { label: 'Engine', get: (v) => v.specs?.engine || 'Unavailable' },
  { label: 'Cylinders', get: (v) => v.specs?.cylinders ?? 'Unavailable' },
  { label: 'Transmission', get: (v) => v.specs?.transmission || 'Unavailable' },
  { label: 'Drivetrain', get: (v) => v.specs?.drivetrain || 'Unavailable' },
  { label: 'Combined efficiency', get: (v) => v.specs?.mpgCombined ? `${v.specs.mpgCombined} ${v.sourceDetails?.efficiencyUnit || (v.specs?.fuelType?.toLowerCase() === 'ev' ? 'MPGe' : 'MPG')}` : 'Unavailable', numeric: (v) => v.specs?.mpgCombined, best: 'max' },
  { label: 'City / highway', get: (v) => v.specs?.mpgCity && v.specs?.mpgHighway ? `${v.specs.mpgCity} / ${v.specs.mpgHighway}` : 'Unavailable' },
  { label: 'Horsepower', get: (v) => v.specs?.horsepower ? `${v.specs.horsepower} hp` : 'Unavailable', numeric: (v) => v.specs?.horsepower, best: 'max' },
  { label: 'Electric range', get: (v) => v.sourceDetails?.electricRangeMiles ? `${v.sourceDetails.electricRangeMiles} mi` : 'Unavailable', numeric: (v) => v.sourceDetails?.electricRangeMiles, best: 'max' },
];

export function ComparePage() {
  const compare = useCompare();
  const [searchParams, setSearchParams] = useSearchParams();
  const sharedIdsParam = searchParams.get('ids') ?? '';
  const sharedIds = useMemo(() => sharedIdsParam.split(',').map(decodeURIComponent).filter(Boolean).slice(0, 4), [sharedIdsParam]);
  const ids = useMemo(() => sharedIds.length ? sharedIds : compare.vehicleIds, [sharedIds, compare.vehicleIds]);
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [loading, setLoading] = useState(Boolean(ids.length));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ids.length) {
      setVehicles([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    void findVehiclesByIds(ids, controller.signal)
      .then((found) => { setVehicles(found); setLoading(false); })
      .catch((loadError) => { if (!controller.signal.aborted) { setError(loadError instanceof Error ? loadError.message : 'Comparison could not be loaded.'); setLoading(false); } });
    return () => controller.abort();
  }, [ids]);

  const remove = (id: string) => {
    compare.remove(id);
    if (sharedIds.length) {
      const next = ids.filter((candidate) => candidate !== id);
      setSearchParams(next.length ? { ids: next.join(',') } : {});
    }
  };

  const bestByRow = useMemo(() => ROWS.map((row) => {
    if (!row.numeric || !row.best) return null;
    const values = vehicles.map(row.numeric).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (values.length < 2 || new Set(values).size < 2) return null;
    return row.best === 'min' ? Math.min(...values) : Math.max(...values);
  }), [vehicles]);

  return (
    <section className="page-section compare-page">
      <div className="container">
        <Link className="back-link" to="/"><ArrowLeft aria-hidden="true" /> Back to discovery</Link>
        <div className="page-heading compare-heading">
          <div><span className="section-kicker">Decision mode</span><h1>Compare vehicles</h1><p>Put up to four configurations side by side. Highlighted cells show data-backed advantages, not subjective rankings.</p></div>
          {vehicles.length ? <button className="secondary-button" type="button" onClick={() => { compare.clear(); setSearchParams({}); }}><X aria-hidden="true" /> Clear comparison</button> : null}
        </div>
        {!ids.length ? (
          <div className="state-card compare-empty"><GitCompareArrows aria-hidden="true" /><h2>Your comparison is empty</h2><p>Add vehicles from any search result or detail page. Your picks stay on this device without requiring an account.</p><Link className="primary-button" to="/">Browse vehicles <Plus aria-hidden="true" /></Link></div>
        ) : null}
        {loading ? <div className="comparison-loading"><span className="spinner" /><p>Loading selected vehicle records…</p></div> : null}
        {error ? <div className="state-card error-state"><Info aria-hidden="true" /><h2>Could not load comparison</h2><p>{error}</p></div> : null}
        {!loading && !error && vehicles.length ? (
          <div className="comparison-scroll" tabIndex={0} aria-label="Vehicle comparison table">
            <table className="comparison-table">
              <thead><tr><th scope="col">Vehicle</th>{vehicles.map((vehicle) => <th scope="col" key={vehicle.id}><div className="compare-vehicle-head"><button type="button" onClick={() => remove(vehicle.id)} aria-label={`Remove ${vehicle.make} ${vehicle.model}`}><X aria-hidden="true" /></button><VehicleArtwork vehicle={vehicle} compact /><span>{vehicle.year}</span><strong>{vehicle.make} {vehicle.model}</strong><small>{vehicle.trim || [vehicle.specs?.transmission, vehicle.specs?.drivetrain].filter(Boolean).join(' · ') || 'Configuration'}</small><Link to={`/vehicle/${vehicle.id}?vy=${vehicle.year}`}>Full details</Link></div></th>)}</tr></thead>
              <tbody>{ROWS.map((row, rowIndex) => <tr key={row.label}><th scope="row">{row.label}</th>{vehicles.map((vehicle) => { const numeric = row.numeric?.(vehicle); const best = bestByRow[rowIndex] !== null && numeric === bestByRow[rowIndex]; return <td className={best ? 'best-cell' : ''} key={vehicle.id}>{best ? <Check aria-label="Best in this comparison" /> : null}<span>{row.get(vehicle) ?? 'Unavailable'}</span></td>; })}</tr>)}</tbody>
            </table>
          </div>
        ) : null}
        {vehicles.length ? <p className="comparison-note"><Info aria-hidden="true" /> Price comparisons use model-year asking-price aggregates. They do not establish a specific trim’s value or a completed-sale price.</p> : null}
      </div>
    </section>
  );
}
