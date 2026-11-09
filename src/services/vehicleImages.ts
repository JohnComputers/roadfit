import type { VehicleImage } from '../types/vehicle';

interface VehicleImageIndex {
  vehicles: Record<string, string>;
  images: Record<string, VehicleImage>;
}

let imageIndexPromise: Promise<VehicleImageIndex | null> | undefined;

export function vehicleImageUrl(path: string): string {
  return path.startsWith('https://') ? path : `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`;
}

export function loadVehicleImages(): Promise<VehicleImageIndex | null> {
  imageIndexPromise ??= fetch(vehicleImageUrl('data/vehicle-images.json'), { cache: 'no-cache' })
    .then(async (response) => {
      if (!response.ok) return null;
      const index: VehicleImageIndex | null = await response.json();
      return index?.vehicles && index?.images ? index : null;
    })
    .catch(() => null);
  return imageIndexPromise;
}
