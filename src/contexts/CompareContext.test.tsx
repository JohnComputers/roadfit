import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { CompareProvider, useCompare } from './CompareContext';
import { ToastProvider } from './ToastContext';

const STORAGE_KEY = 'roadfit:compare:v1';

function Harness() {
  const compare = useCompare();
  return (
    <div>
      <output aria-label="selected vehicles">{compare.vehicleIds.join(',')}</output>
      <button type="button" onClick={() => compare.add('epa-100001')}>Add Ford</button>
      <button type="button" onClick={() => compare.add('epa-100002')}>Add Toyota</button>
      <button type="button" onClick={() => compare.remove('epa-100001')}>Remove Ford</button>
      <button type="button" onClick={compare.clear}>Clear</button>
    </div>
  );
}

function renderHarness() {
  return render(<ToastProvider><CompareProvider><Harness /></CompareProvider></ToastProvider>);
}

describe('guest comparison persistence', () => {
  beforeEach(() => localStorage.clear());

  it('restores saved comparison IDs without requiring an account', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['epa-100001', 'epa-100002']));
    renderHarness();
    expect(screen.getByLabelText('selected vehicles')).toHaveTextContent('epa-100001,epa-100002');
  });

  it('persists additions and removals to local storage', async () => {
    const user = userEvent.setup();
    renderHarness();
    await user.click(screen.getByRole('button', { name: 'Add Ford' }));
    await user.click(screen.getByRole('button', { name: 'Add Toyota' }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')).toEqual(['epa-100001', 'epa-100002']));

    await user.click(screen.getByRole('button', { name: 'Remove Ford' }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')).toEqual(['epa-100002']));
  });

  it('does not add more than four vehicles', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['a-00001', 'b-00002', 'c-00003', 'd-00004']));
    const user = userEvent.setup();
    renderHarness();
    await user.click(screen.getByRole('button', { name: 'Add Ford' }));
    expect(screen.getByLabelText('selected vehicles').textContent?.split(',')).toHaveLength(4);
  });
});
