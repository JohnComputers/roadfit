import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SavedCarsProvider, useSavedCars } from './SavedCarsContext';

const state = vi.hoisted(() => ({
  saved: [] as Array<Record<string, unknown>>,
  collections: [] as Array<Record<string, unknown>>,
  items: [] as Array<Record<string, unknown>>,
}));

const client = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock('./AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('../services/supabase', () => ({
  requireSupabase: () => client,
}));

function selection(table: string) {
  const data = table === 'saved_vehicles' ? state.saved : table === 'collections' ? state.collections : state.items;
  const builder: { order: ReturnType<typeof vi.fn>; then: PromiseLike<{ data: Array<Record<string, unknown>>; error: null }>['then'] } = {
    order: vi.fn(() => builder),
    then: (resolve, reject) => Promise.resolve({ data: [...data], error: null }).then(resolve, reject),
  };
  return builder;
}

function Harness() {
  const garage = useSavedCars();
  return (
    <div>
      <output aria-label="saved vehicle IDs">{garage.saved.map((item) => item.vehicle_id).join(',')}</output>
      <output aria-label="collection vehicle IDs">{garage.collections.flatMap((item) => item.item_vehicle_ids ?? []).join(',')}</output>
      <button type="button" onClick={() => void garage.save('epa-200002')}>Save another</button>
    </div>
  );
}

describe('cloud saved-car persistence', () => {
  beforeEach(() => {
    state.saved = [{ id: 'save-1', user_id: 'user-1', vehicle_id: 'epa-100001', notes: null, created_at: '2026-01-01', updated_at: '2026-01-01' }];
    state.collections = [{ id: 'collection-1', user_id: 'user-1', name: 'Considering', color: '#ffb54a', is_default: true, created_at: '2026-01-01' }];
    state.items = [{ collection_id: 'collection-1', saved_vehicle_id: 'save-1' }];
    client.from.mockReset();
    client.from.mockImplementation((table: string) => ({
      select: vi.fn(() => selection(table)),
      upsert: vi.fn(async (payload: Record<string, unknown>) => {
        if (table === 'saved_vehicles' && !state.saved.some((row) => row.vehicle_id === payload.vehicle_id)) {
          state.saved.unshift({ id: 'save-2', notes: null, created_at: '2026-01-02', updated_at: '2026-01-02', ...payload });
        }
        return { error: null };
      }),
    }));
  });

  it('hydrates saved vehicles and collection membership, then persists a new save across remounts', async () => {
    const user = userEvent.setup();
    const firstMount = render(<SavedCarsProvider><Harness /></SavedCarsProvider>);
    await waitFor(() => expect(screen.getByLabelText('saved vehicle IDs')).toHaveTextContent('epa-100001'));
    expect(screen.getByLabelText('collection vehicle IDs')).toHaveTextContent('epa-100001');

    await user.click(screen.getByRole('button', { name: 'Save another' }));
    await waitFor(() => expect(screen.getByLabelText('saved vehicle IDs')).toHaveTextContent('epa-200002'));
    firstMount.unmount();

    render(<SavedCarsProvider><Harness /></SavedCarsProvider>);
    await waitFor(() => expect(screen.getByLabelText('saved vehicle IDs')).toHaveTextContent('epa-200002'));
  });
});
