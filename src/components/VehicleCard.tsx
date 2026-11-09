import { Bookmark, Check, Fuel, GitCompareArrows, Gauge, Heart, Route } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useCompare } from '../contexts/CompareContext';
import { useSavedCars } from '../contexts/SavedCarsContext';
import { useToast } from '../contexts/ToastContext';
import { formatCurrency, formatNumber, joinDefined, titleCase } from '../lib/format';
import type { VehicleRecord } from '../types/vehicle';
import { VehicleArtwork } from './VehicleArtwork';

function configurationLabel(vehicle: VehicleRecord, referenceModel: string) {
  const { specs } = vehicle;
  return joinDefined([
    vehicle.model !== referenceModel ? vehicle.model : null,
    vehicle.trim || vehicle.variantLabel,
    specs?.engine,
    vehicle.sourceDetails?.transmissionRaw || specs?.transmission,
    specs?.drivetrain,
    specs?.mpgCombined != null ? `${specs.mpgCombined} ${specs.efficiencyUnit || vehicle.sourceDetails?.efficiencyUnit || 'MPG'}` : null,
    specs?.horsepower != null ? `${specs.horsepower} hp` : null,
  ]) || 'Configuration details unavailable';
}

export function VehicleCard({ vehicle: firstVehicle, view = 'grid', configurations }: {
  vehicle: VehicleRecord;
  view?: 'grid' | 'list';
  configurations?: VehicleRecord[];
}) {
  const [selectedId, setSelectedId] = useState<string>();
  const vehicle = configurations?.find((record) => record.id === selectedId) ?? firstVehicle;
  const { user } = useAuth();
  const { isSaved, save, remove } = useSavedCars();
  const compare = useCompare();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const saved = isSaved(vehicle.id);
  const compared = compare.has(vehicle.id);
  const detailParams = new URLSearchParams(location.search);
  detailParams.set('vy', String(vehicle.year));
  const detailHref = `/vehicle/${encodeURIComponent(vehicle.id)}?${detailParams.toString()}`;

  const handleSave = async () => {
    if (!user) {
      showToast('Sign in to sync saved vehicles across devices.', 'info');
      navigate(`/account?return=${encodeURIComponent(location.pathname + location.search)}`);
      return;
    }
    try {
      if (saved) {
        await remove(vehicle.id);
        showToast('Removed from your garage.', 'info');
      } else {
        await save(vehicle.id);
        showToast('Saved to your garage.', 'success');
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not update saved vehicles.', 'error');
    }
  };

  return (
    <article className={`vehicle-card ${view === 'list' ? 'vehicle-card-list' : ''}`}>
      <VehicleArtwork vehicle={vehicle} linkTo={detailHref} />
      <div className="vehicle-card-content">
        <div className="card-eyebrow">
          <span>{vehicle.year}</span>
          <span>{vehicle.bodyStyle || vehicle.category || 'Body type unavailable'}</span>
          {vehicle.generation?.name ? <span className="card-generation">{vehicle.generation.name}</span> : null}
        </div>
        <Link to={detailHref} className="vehicle-title-link"><h3>{vehicle.make} {vehicle.model}</h3></Link>
        {configurations && configurations.length > 1 ? (
          <label className="vehicle-configuration-picker">
            <span>{configurations.length} matching configurations</span>
            <select aria-label={`${configurations.length} matching configurations for ${firstVehicle.year} ${firstVehicle.make} ${firstVehicle.model}`} value={vehicle.id} onChange={(event) => setSelectedId(event.target.value)}>
              {configurations.map((record, index) => (
                <option key={record.id} value={record.id}>{index + 1}. {configurationLabel(record, firstVehicle.model)}</option>
              ))}
            </select>
          </label>
        ) : <p className="vehicle-variant">{vehicle.trim || vehicle.variantLabel || vehicle.specs?.engine || 'Configuration details unavailable'}</p>}
        <div className="price-block">
          <strong>{formatCurrency(vehicle.price?.average)}</strong>
          <span>{vehicle.price ? `Avg asking · ${formatNumber(vehicle.price.sampleSize)} listings` : 'No supported market-price record'}</span>
        </div>
        <div className="spec-pills" aria-label="Key specifications">
          {vehicle.specs?.fuelType ? <span><Fuel aria-hidden="true" />{titleCase(vehicle.specs.fuelType)}</span> : null}
          {vehicle.specs?.mpgCombined ? <span><Route aria-hidden="true" />{vehicle.specs.mpgCombined} {vehicle.specs.efficiencyUnit || vehicle.sourceDetails?.efficiencyUnit || (vehicle.specs.fuelType?.toLowerCase() === 'ev' ? 'MPGe' : 'MPG')}</span> : null}
          {vehicle.specs?.horsepower ? <span><Gauge aria-hidden="true" />{formatNumber(vehicle.specs.horsepower)} hp</span> : null}
          {vehicle.specs?.drivetrain ? <span>{vehicle.specs.drivetrain}</span> : null}
        </div>
        <p className="card-meta">
          {vehicle.price
            ? joinDefined([
                vehicle.price.min !== null ? `${formatCurrency(vehicle.price.min)} low` : null,
                vehicle.price.max !== null ? `${formatCurrency(vehicle.price.max)} high` : null,
              ]) || 'Range unavailable'
            : 'Price unavailable'}
        </p>
        <div className="card-actions">
          <button type="button" className={saved ? 'icon-action active' : 'icon-action'} onClick={handleSave} aria-label={saved ? `Remove ${vehicle.year} ${vehicle.make} ${vehicle.model} from saved vehicles` : `Save ${vehicle.year} ${vehicle.make} ${vehicle.model}`} aria-pressed={saved}>
            {saved ? <Heart aria-hidden="true" fill="currentColor" /> : <Bookmark aria-hidden="true" />}
          </button>
          <button type="button" className={compared ? 'compare-action active' : 'compare-action'} onClick={() => compare.toggle(vehicle.id)} aria-pressed={compared}>
            {compared ? <Check aria-hidden="true" /> : <GitCompareArrows aria-hidden="true" />}
            {compared ? 'Added' : 'Compare'}
          </button>
          <Link to={detailHref} className="card-detail-link">Details <span aria-hidden="true">→</span></Link>
        </div>
      </div>
    </article>
  );
}
