import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useToast } from './ToastContext';

const STORAGE_KEY = 'roadfit:compare:v1';
const MAX_COMPARE = 4;

interface CompareContextValue {
  vehicleIds: string[];
  add: (vehicleId: string) => boolean;
  remove: (vehicleId: string) => void;
  toggle: (vehicleId: string) => void;
  clear: () => void;
  has: (vehicleId: string) => boolean;
  full: boolean;
}

const CompareContext = createContext<CompareContextValue | null>(null);

function initialIds(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(stored) ? stored.filter((value): value is string => typeof value === 'string').slice(0, MAX_COMPARE) : [];
  } catch {
    return [];
  }
}

export function CompareProvider({ children }: { children: ReactNode }) {
  const [vehicleIds, setVehicleIds] = useState<string[]>(initialIds);
  const { showToast } = useToast();

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(vehicleIds));
  }, [vehicleIds]);

  const add = useCallback(
    (vehicleId: string) => {
      if (vehicleIds.includes(vehicleId)) return true;
      if (vehicleIds.length >= MAX_COMPARE) {
        showToast('Compare is limited to four vehicles.', 'info');
        return false;
      }
      setVehicleIds((current) => [...current, vehicleId]);
      showToast('Added to comparison.', 'success');
      return true;
    },
    [vehicleIds, showToast],
  );

  const remove = useCallback((vehicleId: string) => setVehicleIds((current) => current.filter((id) => id !== vehicleId)), []);
  const toggle = useCallback((vehicleId: string) => (vehicleIds.includes(vehicleId) ? remove(vehicleId) : add(vehicleId)), [vehicleIds, remove, add]);
  const clear = useCallback(() => setVehicleIds([]), []);

  const value = useMemo(
    () => ({ vehicleIds, add, remove, toggle, clear, has: (id: string) => vehicleIds.includes(id), full: vehicleIds.length >= MAX_COMPARE }),
    [vehicleIds, add, remove, toggle, clear],
  );

  return <CompareContext.Provider value={value}>{children}</CompareContext.Provider>;
}

export function useCompare(): CompareContextValue {
  const context = useContext(CompareContext);
  if (!context) throw new Error('useCompare must be used inside CompareProvider');
  return context;
}
