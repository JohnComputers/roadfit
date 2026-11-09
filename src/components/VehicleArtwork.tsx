import { Car, Gauge, Mountain, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { loadVehicleImages, vehicleImageUrl } from '../services/vehicleImages';
import type { VehicleImage, VehicleRecord } from '../types/vehicle';

function artworkTone(make: string): number {
  return [...make].reduce((total, character) => total + character.charCodeAt(0), 0) % 5;
}

function photoScope(image: VehicleImage): string {
  if (image.scope === 'model-year') return 'Model year photo · trim may vary';
  if (image.scope === 'generation') return image.depictedYear ? `Same generation · ${image.depictedYear} shown` : 'Same generation · year and trim may vary';
  return image.representsExactVehicle ? '' : 'Representative photo · trim may vary';
}

function Placeholder({ vehicle }: { vehicle: VehicleRecord }) {
  const tone = artworkTone(vehicle.make);
  const Icon = vehicle.specs?.fuelType === 'ev' ? Zap : tone === 0 ? Mountain : tone === 1 ? Gauge : Car;
  return (
    <div className={`art-placeholder tone-${tone}`} role="img" aria-label={`Branded placeholder for ${vehicle.make} ${vehicle.model}`}>
      <div className="art-grid" aria-hidden="true" />
      <span className="art-make">{vehicle.make}</span>
      <Icon className="art-icon" aria-hidden="true" strokeWidth={1.2} />
      <span className="art-body">{vehicle.bodyStyle || vehicle.category || 'Vehicle'}</span>
      <span className="art-model">{vehicle.model}</span>
    </div>
  );
}

interface VehicleArtworkProps {
  vehicle: VehicleRecord;
  compact?: boolean;
  detail?: boolean;
  linkTo?: string;
}

export function VehicleArtwork({ vehicle, compact = false, detail = false, linkTo }: VehicleArtworkProps) {
  const [imageIndex, setImageIndex] = useState<Awaited<ReturnType<typeof loadVehicleImages>>>(null);
  const [failedUrl, setFailedUrl] = useState<string>();

  useEffect(() => {
    let mounted = true;
    void loadVehicleImages().then((index) => { if (mounted) setImageIndex(index); });
    return () => { mounted = false; };
  }, []);

  const imageId = imageIndex?.vehicles[vehicle.id];
  const image = (imageId ? imageIndex?.images[imageId] : undefined) ?? vehicle.image;
  const url = image?.url ? vehicleImageUrl(image.url) : undefined;
  const showPhoto = Boolean(url && url !== failedUrl);
  const scope = image && showPhoto ? photoScope(image) : '';
  const modelName = `${vehicle.make} ${vehicle.model}`;
  const depictedYear = image?.depictedYear ?? (image?.scope === 'generation' ? undefined : vehicle.year);
  const alt = image?.alt || `${depictedYear ? `${depictedYear} ` : ''}${modelName}`;
  const creditTitle = image?.title || `${alt} photo`;
  const shortCredit = [image?.creator, image?.license].filter(Boolean).join(' · ');
  const standardCredits = [image?.creator, [image?.creator, 'Wikimedia Commons', image?.license].filter(Boolean).join(' / ')];
  const customCredit = image?.creditText && !standardCredits.includes(image.creditText) ? image.creditText : null;
  const artwork = (
    <div className={`vehicle-artwork${showPhoto ? ' has-image' : ''}${compact ? ' compact' : ''}`}>
      {showPhoto ? (
        <img key={url} src={url} alt={alt} loading={detail ? 'eager' : 'lazy'} decoding="async" onError={() => setFailedUrl(url)} />
      ) : <Placeholder vehicle={vehicle} />}
      {linkTo ? <Link className="artwork-link" to={linkTo} aria-label={`View ${vehicle.year} ${modelName}`} /> : null}
      {showPhoto && !detail && (scope || image?.sourceUrl) ? (
        <div className="image-overlay">
          {scope ? <span className="image-disclosure">{scope}</span> : null}
          {image?.sourceUrl ? (
            <a className="image-disclosure image-source" href={image.sourceUrl} target="_blank" rel="noreferrer" aria-label={`Photo credit for ${alt}${shortCredit ? ` · ${shortCredit}` : ''}`} title={[creditTitle, shortCredit].filter(Boolean).join(' · ')}>{shortCredit || 'Photo credit'}</a>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  if (!detail) return artwork;
  return (
    <figure className="detail-art">
      {artwork}
      {showPhoto && image ? (
        <figcaption className="image-caption">
          {scope ? <span>{scope}{image.scope === 'generation' && image.depictedYear ? ' · trim may vary' : ''}{image.generationSource ? <> · <a href={image.generationSource} target="_blank" rel="noreferrer">Generation reference</a></> : null}</span> : null}
          <span>
            {image.sourceUrl ? <a href={image.sourceUrl} target="_blank" rel="noreferrer">{creditTitle}</a> : creditTitle}
            {image.creator ? <> by {image.creatorUrl ? <a href={image.creatorUrl} target="_blank" rel="noreferrer">{image.creator}</a> : image.creator}</> : null}
            {image.license ? <> · {image.licenseUrl ? <a href={image.licenseUrl} target="_blank" rel="noreferrer">{image.license}</a> : image.license}</> : null}
            {image.url.endsWith('.webp') ? ' · Resized and served as WebP' : null}
          </span>
          {customCredit ? <span>{customCredit}</span> : null}
          {image.copyrightNotice ? <span>{image.copyrightNotice}</span> : null}
        </figcaption>
      ) : null}
    </figure>
  );
}
