import { ArrowRight, Bookmark, CarFront, Check, FolderPlus, GitCompareArrows, LogOut, PencilLine, Plus, Search, Settings, Trash2, UserRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { VehicleArtwork } from '../components/VehicleArtwork';
import { useAuth } from '../contexts/AuthContext';
import { useCompare } from '../contexts/CompareContext';
import { useSavedCars } from '../contexts/SavedCarsContext';
import { useToast } from '../contexts/ToastContext';
import { DEFAULT_FILTERS, filtersToSearchParams } from '../lib/filters';
import { formatCurrency, formatNumber } from '../lib/format';
import { findVehiclesByIds } from '../services/catalog';
import { requireSupabase } from '../services/supabase';
import type { VehicleFilters, VehicleRecord } from '../types/vehicle';

interface Profile {
  id: string;
  display_name: string | null;
  default_budget: number | null;
  preferred_filters: Record<string, unknown>;
}

interface SavedSearch {
  id: string;
  name: string;
  filters: Partial<VehicleFilters>;
  updated_at: string;
}

export function GaragePage() {
  const { user, loading: authLoading, signOut, deleteAccount } = useAuth();
  const savedCars = useSavedCars();
  const compare = useCompare();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'saved' | 'price' | 'year' | 'name'>('saved');
  const [collectionId, setCollectionId] = useState<string>('all');
  const [newCollection, setNewCollection] = useState('');
  const [showCollectionForm, setShowCollectionForm] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const savedVehicleIds = useMemo(() => savedCars.saved.map((item) => item.vehicle_id), [savedCars.saved]);

  useEffect(() => {
    if (!user) return;
    const client = requireSupabase();
    void Promise.all([
      client.from('profiles').select('*').eq('id', user.id).single(),
      client.from('saved_searches').select('*').order('updated_at', { ascending: false }),
    ]).then(([profileResult, searchesResult]) => {
      setProfile(profileResult.data as Profile | null);
      setSavedSearches((searchesResult.data ?? []) as SavedSearch[]);
    });
  }, [user]);

  useEffect(() => {
    if (!savedVehicleIds.length) { setVehicles([]); return; }
    const controller = new AbortController();
    setCatalogLoading(true);
    void findVehiclesByIds(savedVehicleIds, controller.signal).then((result) => { setVehicles(result); setCatalogLoading(false); }).catch(() => setCatalogLoading(false));
    return () => controller.abort();
  }, [savedVehicleIds]);

  const displayed = useMemo(() => {
    const allowedIds = collectionId === 'all' ? null : new Set(savedCars.collections.find((item) => item.id === collectionId)?.item_vehicle_ids ?? []);
    const filtered = vehicles.filter((vehicle) => {
      if (allowedIds && !allowedIds.has(vehicle.id)) return false;
      const text = `${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim || ''}`.toLowerCase();
      return text.includes(query.toLowerCase());
    });
    return [...filtered].sort((a, b) => {
      if (sort === 'price') return (a.price?.average ?? Infinity) - (b.price?.average ?? Infinity);
      if (sort === 'year') return b.year - a.year;
      if (sort === 'name') return a.make.localeCompare(b.make) || a.model.localeCompare(b.model);
      return savedCars.saved.findIndex((item) => item.vehicle_id === a.id) - savedCars.saved.findIndex((item) => item.vehicle_id === b.id);
    });
  }, [vehicles, collectionId, savedCars.collections, savedCars.saved, query, sort]);

  const createCollection = async () => {
    if (!newCollection.trim()) return;
    try {
      const created = await savedCars.createCollection(newCollection.trim());
      setCollectionId(created.id);
      setNewCollection('');
      setShowCollectionForm(false);
      showToast('Collection created.', 'success');
    } catch (error) { showToast(error instanceof Error ? error.message : 'Could not create collection.', 'error'); }
  };

  const saveProfile = async () => {
    if (!profile || !user) return;
    setProfileBusy(true);
    const { error } = await requireSupabase().from('profiles').update({ display_name: profile.display_name?.trim() || null, default_budget: profile.default_budget }).eq('id', user.id);
    setProfileBusy(false);
    if (error) showToast(error.message, 'error'); else showToast('Profile updated.', 'success');
  };

  const removeSaved = async (vehicleId: string) => {
    try { await savedCars.remove(vehicleId); showToast('Removed from your garage.', 'info'); } catch (error) { showToast(error instanceof Error ? error.message : 'Could not remove vehicle.', 'error'); }
  };

  const requestDeletion = async () => {
    if (deleteConfirm !== 'DELETE') return;
    setProfileBusy(true);
    try { await deleteAccount(); showToast('Your account and private data were deleted.', 'success'); navigate('/', { replace: true }); } catch (error) { showToast(error instanceof Error ? error.message : 'Account deletion failed.', 'error'); } finally { setProfileBusy(false); }
  };

  const openSavedSearch = (savedSearch: SavedSearch) => {
    const filters = { ...DEFAULT_FILTERS, ...savedSearch.filters, page: 1 } as VehicleFilters;
    navigate(`/?${filtersToSearchParams(filters).toString()}#catalog-results`);
  };

  const removeSavedSearch = async (id: string) => {
    const { error } = await requireSupabase().from('saved_searches').delete().eq('id', id);
    if (error) showToast(error.message, 'error');
    else {
      setSavedSearches((current) => current.filter((search) => search.id !== id));
      showToast('Saved search removed.', 'info');
    }
  };

  if (authLoading) return <section className="page-section container"><div className="comparison-loading"><span className="spinner" /><p>Loading your garage…</p></div></section>;
  if (!user) {
    return <section className="page-section container"><div className="garage-guest"><div className="garage-guest-art"><CarFront aria-hidden="true" /></div><span className="section-kicker">Your private garage</span><h1>Save the cars worth remembering.</h1><p>Browsing and comparing never require an account. Sign in when you want favorites, collections, budgets, and notes to follow you across devices.</p><div><Link className="primary-button" to="/account?return=%2Fgarage">Sign in <ArrowRight aria-hidden="true" /></Link><Link className="secondary-button" to="/account?mode=signup&return=%2Fgarage">Create free account</Link></div></div></section>;
  }

  return (
    <section className="page-section garage-page">
      <div className="container">
        <div className="page-heading garage-heading">
          <div><span className="section-kicker">Personal workspace</span><h1>{profile?.display_name ? `${profile.display_name}’s garage` : 'My garage'}</h1><p aria-live="polite">{savedCars.saved.length} saved {savedCars.saved.length === 1 ? 'vehicle' : 'vehicles'} · synced securely to your account</p></div>
          <div><button className="secondary-button" type="button" onClick={() => setProfileOpen((open) => !open)}><Settings aria-hidden="true" /> Profile</button><button className="secondary-button" type="button" onClick={() => void signOut()}><LogOut aria-hidden="true" /> Sign out</button></div>
        </div>

        {profileOpen ? <section className="profile-panel"><div className="panel-heading"><div><span className="section-kicker">Account preferences</span><h2>Profile & budget</h2></div><UserRound aria-hidden="true" /></div><div className="profile-fields"><label><span>Display name</span><input value={profile?.display_name ?? ''} onChange={(event) => setProfile((current) => current ? { ...current, display_name: event.target.value } : current)} /></label><label><span>Default budget</span><div className="money-input"><span>$</span><input type="number" min="0" value={profile?.default_budget ?? ''} onChange={(event) => setProfile((current) => current ? { ...current, default_budget: event.target.value ? Number(event.target.value) : null } : current)} /></div></label><button className="primary-button" type="button" disabled={profileBusy} onClick={saveProfile}>{profileBusy ? 'Saving…' : 'Save preferences'}</button></div><div className="danger-zone"><div><strong>Delete account</strong><p>Permanently removes your profile, saved vehicles, notes, collections, and authentication account.</p></div><label><span>Type DELETE to confirm</span><input value={deleteConfirm} onChange={(event) => setDeleteConfirm(event.target.value)} placeholder="DELETE" /></label><button className="danger-button" type="button" disabled={deleteConfirm !== 'DELETE' || profileBusy} onClick={requestDeletion}><Trash2 aria-hidden="true" /> Delete account</button></div></section> : null}

        {savedSearches.length ? <section className="saved-searches-panel"><div><span className="section-kicker">Reusable filters</span><h2>Saved searches</h2></div><div className="saved-search-list">{savedSearches.map((savedSearch) => <div key={savedSearch.id}><button type="button" onClick={() => openSavedSearch(savedSearch)}><Search aria-hidden="true" /><span>{savedSearch.name}</span><ArrowRight aria-hidden="true" /></button><button type="button" onClick={() => void removeSavedSearch(savedSearch.id)} aria-label={`Delete saved search ${savedSearch.name}`}><Trash2 aria-hidden="true" /></button></div>)}</div></section> : null}

        <div className="garage-toolbar">
          <div className="collection-tabs" aria-label="Filter saved vehicles by collection">
            <button type="button" className={collectionId === 'all' ? 'active' : ''} onClick={() => setCollectionId('all')}>All <span>{savedCars.saved.length}</span></button>
            {savedCars.collections.map((collection) => <button type="button" key={collection.id} className={collectionId === collection.id ? 'active' : ''} onClick={() => setCollectionId(collection.id)}><i style={{ backgroundColor: collection.color }} />{collection.name}<span>{collection.item_vehicle_ids?.length ?? 0}</span></button>)}
            <button className="new-collection-button" type="button" onClick={() => setShowCollectionForm((open) => !open)}><FolderPlus aria-hidden="true" /> New</button>
          </div>
          {showCollectionForm ? <div className="new-collection-form"><input autoFocus value={newCollection} onChange={(event) => setNewCollection(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void createCollection()} maxLength={60} placeholder="Collection name" /><button className="primary-button" type="button" onClick={createCollection}><Plus aria-hidden="true" /> Create</button></div> : null}
          <div className="garage-controls"><label><Search aria-hidden="true" /><input aria-label="Search saved vehicles" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search saved vehicles" /></label><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label="Sort saved vehicles"><option value="saved">Recently saved</option><option value="price">Price: low to high</option><option value="year">Newest year</option><option value="name">Make & model</option></select></div>
        </div>

        {(savedCars.loading || catalogLoading) ? <div className="comparison-loading"><span className="spinner" /><p>Syncing your garage…</p></div> : null}
        {savedCars.error ? <div className="form-message error">{savedCars.error}</div> : null}
        {!savedCars.loading && !catalogLoading && !savedCars.saved.length ? <div className="state-card garage-empty"><Bookmark aria-hidden="true" /><h2>Your garage is ready</h2><p>Save a vehicle from any result card. You can then add notes, organize it into collections, and compare it here.</p><Link className="primary-button" to="/">Find cars that fit <ArrowRight aria-hidden="true" /></Link></div> : null}
        {!savedCars.loading && !catalogLoading && savedCars.saved.length && !displayed.length ? <div className="state-card"><Search aria-hidden="true" /><h2>No saved cars match</h2><p>Try another collection or clear the search field.</p></div> : null}
        <div className="garage-grid">
          {displayed.map((vehicle) => {
            const saved = savedCars.saved.find((item) => item.vehicle_id === vehicle.id)!;
            const detailHref = `/vehicle/${vehicle.id}?vy=${vehicle.year}`;
            return <article className="garage-card" key={vehicle.id}><VehicleArtwork vehicle={vehicle} linkTo={detailHref} /><div className="garage-card-main"><div className="card-eyebrow"><span>{vehicle.year}</span><span>{vehicle.bodyStyle || vehicle.category}</span></div><Link to={detailHref}><h2>{vehicle.make} {vehicle.model}</h2></Link><p>{vehicle.trim || [vehicle.specs?.transmission, vehicle.specs?.drivetrain].filter(Boolean).join(' · ') || 'Configuration'}</p><div className="garage-price"><strong>{formatCurrency(vehicle.price?.average)}</strong><span>{vehicle.price ? `${formatNumber(vehicle.price.sampleSize)} listing sample` : 'Price unavailable'}</span></div><div className="garage-card-actions"><button aria-label={`${compare.has(vehicle.id) ? 'Remove' : 'Add'} ${vehicle.year} ${vehicle.make} ${vehicle.model} ${compare.has(vehicle.id) ? 'from' : 'to'} comparison`} className={compare.has(vehicle.id) ? 'active' : ''} type="button" onClick={() => compare.toggle(vehicle.id)}>{compare.has(vehicle.id) ? <Check aria-hidden="true" /> : <GitCompareArrows aria-hidden="true" />}{compare.has(vehicle.id) ? 'Selected' : 'Compare'}</button><button aria-label={`Remove ${vehicle.year} ${vehicle.make} ${vehicle.model} from saved vehicles`} type="button" onClick={() => void removeSaved(vehicle.id)}><Trash2 aria-hidden="true" /> Remove</button></div></div><div className="garage-organize"><label><span><PencilLine aria-hidden="true" /> Notes</span><textarea aria-label={`Notes for ${vehicle.year} ${vehicle.make} ${vehicle.model}`} defaultValue={saved.notes ?? ''} maxLength={10000} placeholder="What do you like? What should you check?" onBlur={(event) => void savedCars.updateNotes(vehicle.id, event.target.value).then(() => showToast('Note saved.', 'success')).catch((error) => showToast(error.message, 'error'))} /></label><div className="collection-checks"><span>Add to collection</span>{savedCars.collections.map((collection) => { const included = collection.item_vehicle_ids?.includes(vehicle.id) ?? false; return <label key={collection.id}><input type="checkbox" checked={included} onChange={(event) => void savedCars.setInCollection(vehicle.id, collection.id, event.target.checked).catch((error) => showToast(error.message, 'error'))} /><i style={{ backgroundColor: collection.color }} />{collection.name}</label>; })}</div></div></article>;
          })}
        </div>
      </div>
    </section>
  );
}
