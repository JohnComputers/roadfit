import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { vehicles } from '../test/fixtures/vehicles';
import { VehicleCard } from './VehicleCard';

const compare = vi.hoisted(() => ({ has: () => false, toggle: vi.fn() }));

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../contexts/CompareContext', () => ({ useCompare: () => compare }));
vi.mock('../contexts/SavedCarsContext', () => ({ useSavedCars: () => ({ isSaved: () => false }) }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('./VehicleArtwork', () => ({ VehicleArtwork: () => null }));

it('keeps details and compare pointed at the selected configuration ID', async () => {
  const highest = vehicles[0]!;
  const alternative = { ...highest, id: 'epa-100005', trim: 'EcoBoost', specs: { ...highest.specs, horsepower: 310 } };
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={['/?sort=horsepower-desc']}>
      <VehicleCard vehicle={highest} configurations={[highest, alternative]} />
    </MemoryRouter>,
  );

  const picker = screen.getByRole('combobox', { name: '2 matching configurations for 2018 Ford Mustang' });
  expect(picker).toHaveValue(highest.id);
  expect(screen.getByText('460 hp', { exact: true })).toBeVisible();

  await user.selectOptions(picker, alternative.id);
  expect(screen.getByText('310 hp', { exact: true })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Details' })).toHaveAttribute('href', `/vehicle/${alternative.id}?sort=horsepower-desc&vy=2018`);

  await user.click(screen.getByRole('button', { name: 'Compare' }));
  expect(compare.toggle).toHaveBeenCalledWith(alternative.id);
});
