import { Bookmark, Check, Fuel, GitCompareArrows, Gauge, Heart, Route } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useCompare } from '../contexts/CompareContext';
import { useSavedCars } from '../contexts/SavedCarsContext';
import { useToast } from '../contexts/ToastContext';
import { formatCurrency, formatNumber, joinDefined, titleCase } from '../lib/format';
import type { VehicleRecord } from '../types/vehicle';
import { VehicleArtwork } from './VehicleArtwork';

export function VehicleCard({ vehicle, view = 'grid' }: { vehicle: VehicleRecord; view?: 'grid' | 'list' }) {
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
      <Link to={detailHref} className="card-art-link" aria-label={`View ${vehicle.year} ${vehicle.make} ${vehicle.model}`}>
        <VehicleArtwork vehicle={vehicle} />
      </Link>
      <div className="vehicle-card-content">
        <div className="card-eyebrow">
          <span>{vehicle.year}</span>
          <span>{vehicle.bodyStyle || vehicle.category || 'Body type unavailable'}</span>
        </div>
        <Link to={detailHref} className="vehicle-title-link"><h3>{vehicle.make} {vehicle.model}</h3></Link>
        <p className="vehicle-variant">{vehicle.trim || vehicle.variantLabel || 'Configuration varies by source record'}</p>
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
