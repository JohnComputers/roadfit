import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { requireSupabase } from '../services/supabase';

export interface SavedVehicle {
  id: string;
  user_id: string;
  vehicle_id: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Collection {
  id: string;
  user_id: string;
  name: string;
  color: string;
  is_default: boolean;
  created_at: string;
  item_vehicle_ids?: string[];
}

interface SavedCarsContextValue {
  saved: SavedVehicle[];
  collections: Collection[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  isSaved: (vehicleId: string) => boolean;
  save: (vehicleId: string) => Promise<void>;
  remove: (vehicleId: string) => Promise<void>;
  updateNotes: (vehicleId: string, notes: string) => Promise<void>;
  createCollection: (name: string, color?: string) => Promise<Collection>;
  setInCollection: (vehicleId: string, collectionId: string, included: boolean) => Promise<void>;
}

const SavedCarsContext = createContext<SavedCarsContextValue | null>(null);

export function SavedCarsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [saved, setSaved] = useState<SavedVehicle[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshGeneration = useRef(0);
  const activeUserId = useRef<string | null>(user?.id ?? null);
  activeUserId.current = user?.id ?? null;

  const refresh = useCallback(async () => {
    const requestGeneration = ++refreshGeneration.current;
    const requestUserId = user?.id ?? null;
    if (!user) {
      setSaved([]);
      setCollections([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const client = requireSupabase();
    const [savedResult, collectionResult, itemResult] = await Promise.all([
      client.from('saved_vehicles').select('*').order('created_at', { ascending: false }),
      client.from('collections').select('*').order('is_default', { ascending: false }).order('created_at'),
      client.from('collection_items').select('collection_id, saved_vehicle_id'),
    ]);
    if (requestGeneration !== refreshGeneration.current || activeUserId.current !== requestUserId) return;
    const firstError = savedResult.error ?? collectionResult.error ?? itemResult.error;
    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }
    const savedRows = (savedResult.data ?? []) as SavedVehicle[];
    const savedById = new Map(savedRows.map((row) => [row.id, row.vehicle_id]));
    const membership = new Map<string, string[]>();
    for (const row of itemResult.data ?? []) {
      const vehicleId = savedById.get(row.saved_vehicle_id as string);
      if (!vehicleId) continue;
      membership.set(row.collection_id as string, [...(membership.get(row.collection_id as string) ?? []), vehicleId]);
    }
    setSaved(savedRows);
    setCollections(
      ((collectionResult.data ?? []) as Collection[]).map((collection) => ({
        ...collection,
        item_vehicle_ids: membership.get(collection.id) ?? [],
      })),
    );
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (vehicleId: string) => {
      if (!user) throw new Error('Sign in to save vehicles.');
      const { error: saveError } = await requireSupabase().from('saved_vehicles').upsert(
        { user_id: user.id, vehicle_id: vehicleId },
        { onConflict: 'user_id,vehicle_id', ignoreDuplicates: true },
      );
      if (saveError) throw saveError;
      await refresh();
    },
    [user, refresh],
  );

  const remove = useCallback(
    async (vehicleId: string) => {
      if (!user) return;
      const { error: removeError } = await requireSupabase().from('saved_vehicles').delete().eq('user_id', user.id).eq('vehicle_id', vehicleId);
      if (removeError) throw removeError;
      await refresh();
    },
    [user, refresh],
  );

  const updateNotes = useCallback(
    async (vehicleId: string, notes: string) => {
      if (!user) throw new Error('Sign in to edit notes.');
      const { error: updateError } = await requireSupabase()
        .from('saved_vehicles')
        .update({ notes: notes.trim() || null })
        .eq('user_id', user.id)
        .eq('vehicle_id', vehicleId);
      if (updateError) throw updateError;
      setSaved((current) => current.map((item) => (item.vehicle_id === vehicleId ? { ...item, notes: notes.trim() || null } : item)));
    },
    [user],
  );

  const createCollection = useCallback(
    async (name: string, color = '#ffb54a') => {
      if (!user) throw new Error('Sign in to create a collection.');
      const { data, error: createError } = await requireSupabase()
        .from('collections')
        .insert({ user_id: user.id, name: name.trim(), color })
        .select('*')
        .single();
      if (createError) throw createError;
      const collection = { ...(data as Collection), item_vehicle_ids: [] };
      setCollections((current) => [...current, collection]);
      return collection;
    },
    [user],
  );

  const setInCollection = useCallback(
    async (vehicleId: string, collectionId: string, included: boolean) => {
      if (!user) throw new Error('Sign in to organize saved vehicles.');
      let savedVehicle = saved.find((item) => item.vehicle_id === vehicleId);
      if (!savedVehicle) {
        await save(vehicleId);
        const { data, error: lookupError } = await requireSupabase()
          .from('saved_vehicles')
          .select('*')
          .eq('user_id', user.id)
          .eq('vehicle_id', vehicleId)
          .single();
        if (lookupError) throw lookupError;
        savedVehicle = data as SavedVehicle;
      }
      const client = requireSupabase();
      const result = included
        ? await client.from('collection_items').upsert(
            { collection_id: collectionId, saved_vehicle_id: savedVehicle.id, user_id: user.id },
            { onConflict: 'collection_id,saved_vehicle_id', ignoreDuplicates: true },
          )
        : await client.from('collection_items').delete().eq('collection_id', collectionId).eq('saved_vehicle_id', savedVehicle.id);
      if (result.error) throw result.error;
      await refresh();
    },
    [user, saved, save, refresh],
  );

  const value = useMemo<SavedCarsContextValue>(
    () => ({ saved, collections, loading, error, refresh, isSaved: (id) => saved.some((item) => item.vehicle_id === id), save, remove, updateNotes, createCollection, setInCollection }),
    [saved, collections, loading, error, refresh, save, remove, updateNotes, createCollection, setInCollection],
  );

  return <SavedCarsContext.Provider value={value}>{children}</SavedCarsContext.Provider>;
}

export function useSavedCars(): SavedCarsContextValue {
  const context = useContext(SavedCarsContext);
  if (!context) throw new Error('useSavedCars must be used inside SavedCarsProvider');
  return context;
}
