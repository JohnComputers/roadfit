import { Car, Gauge, Mountain, Zap } from 'lucide-react';
import type { VehicleRecord } from '../types/vehicle';

function artworkTone(make: string): number {
  return [...make].reduce((total, character) => total + character.charCodeAt(0), 0) % 5;
}

export function VehicleArtwork({ vehicle, compact = false }: { vehicle: VehicleRecord; compact?: boolean }) {
  if (vehicle.image?.url) {
    return (
      <div className={`vehicle-artwork has-image ${compact ? 'compact' : ''}`}>
        <img
          src={vehicle.image.url}
          alt={vehicle.image.alt || `${vehicle.year} ${vehicle.make} ${vehicle.model}; image may not depict the exact trim`}
          loading="lazy"
          decoding="async"
        />
        {!vehicle.image.representsExactVehicle ? <span className="image-disclosure">Representative image</span> : null}
      </div>
    );
  }

  const tone = artworkTone(vehicle.make);
  const Icon = vehicle.specs?.fuelType === 'ev' ? Zap : tone === 0 ? Mountain : tone === 1 ? Gauge : Car;
  return (
    <div className={`vehicle-artwork placeholder tone-${tone} ${compact ? 'compact' : ''}`} role="img" aria-label={`Branded placeholder for ${vehicle.make} ${vehicle.model}`}>
      <div className="art-grid" />
      <span className="art-make">{vehicle.make}</span>
      <Icon className="art-icon" aria-hidden="true" strokeWidth={1.2} />
      <span className="art-body">{vehicle.bodyStyle || vehicle.category || 'Vehicle'}</span>
      <span className="art-model">{vehicle.model}</span>
    </div>
  );
}
