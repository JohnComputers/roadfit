import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { loadVehicleImages } from '../services/vehicleImages';
import { vehicles } from '../test/fixtures/vehicles';
import type { VehicleImage } from '../types/vehicle';
import { VehicleArtwork } from './VehicleArtwork';

vi.mock('../services/vehicleImages', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/vehicleImages')>();
  return { ...original, loadVehicleImages: vi.fn() };
});

const mustang = vehicles[0]!;
const prius = vehicles[1]!;
const photo: VehicleImage = {
  url: 'vehicle-images/mustang.webp',
  scope: 'generation',
  depictedYear: 2019,
  title: 'Ford Mustang coupe',
  creator: 'Example photographer',
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  sourceUrl: 'https://commons.wikimedia.org/wiki/File:Example.jpg',
};

describe('vehicle artwork', () => {
  it('uses an ID match for the photo and separates credit from card navigation', async () => {
    vi.mocked(loadVehicleImages).mockResolvedValue({ vehicles: { [mustang.id]: 'photo' }, images: { photo } });
    render(<MemoryRouter><VehicleArtwork vehicle={mustang} linkTo={`/vehicle/${mustang.id}`} /><VehicleArtwork vehicle={prius} /></MemoryRouter>);

    const image = await screen.findByRole('img', { name: '2019 Ford Mustang' });
    expect(image).toHaveAttribute('src', `${import.meta.env.BASE_URL}vehicle-images/mustang.webp`);
    expect(screen.getByText('Same generation · 2019 shown')).toBeVisible();
    const credit = screen.getByRole('link', { name: /Photo credit for 2019 Ford Mustang/ });
    const vehicleLink = screen.getByRole('link', { name: 'View 2018 Ford Mustang' });
    expect(credit).toHaveAttribute('href', photo.sourceUrl);
    expect(credit).toHaveTextContent('Example photographer · CC BY-SA 4.0');
    expect(vehicleLink).toHaveAttribute('href', `/vehicle/${mustang.id}`);
    expect(vehicleLink).not.toContainElement(credit);
    expect(screen.getByRole('img', { name: 'Branded placeholder for Toyota Prius' })).toBeVisible();
  });

  it('shows the detail photo attribution and restores the placeholder when the image fails', async () => {
    vi.mocked(loadVehicleImages).mockResolvedValue({
      vehicles: { [mustang.id]: 'photo' },
      images: { photo: { ...photo, depictedYear: mustang.year, scope: 'model-year' } },
    });
    render(<VehicleArtwork vehicle={mustang} detail />);

    const image = await screen.findByRole('img', { name: '2018 Ford Mustang' });
    expect(screen.getByText('Model year photo · trim may vary')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Ford Mustang coupe' })).toHaveAttribute('href', photo.sourceUrl);
    expect(screen.getByRole('link', { name: 'CC BY-SA 4.0' })).toHaveAttribute('href', photo.licenseUrl);

    fireEvent.error(image);
    expect(screen.getByRole('img', { name: 'Branded placeholder for Ford Mustang' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'CC BY-SA 4.0' })).toBeNull();
  });
});
