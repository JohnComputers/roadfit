import { BookmarkPlus, Check, Grid2X2, List, Search, Share2, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { formatCurrency, titleCase } from '../lib/format';
import { requireSupabase } from '../services/supabase';
import type { SortKey, VehicleFilters } from '../types/vehicle';

interface CatalogToolbarProps {
  filters: VehicleFilters;
  total: number;
  suggestions: string[];
  activeCount: number;
  onChange: (changes: Partial<VehicleFilters>) => void;
  onOpenFilters: () => void;
}

const SORT_OPTIONS: Array<[SortKey, string]> = [
  ['fit', 'Best budget fit'],
  ['price-asc', 'Price: low to high'],
  ['price-desc', 'Price: high to low'],
  ['year-desc', 'Year: newest'],
  ['year-asc', 'Year: oldest'],
  ['name-asc', 'Make & model'],
  ['horsepower-desc', 'Highest horsepower'],
  ['mpg-desc', 'Best efficiency'],
  ['mileage-asc', 'Lowest average mileage'],
  ['sample-desc', 'Largest price sample'],
];

export function CatalogToolbar({ filters, total, suggestions, activeCount, onChange, onOpenFilters }: CatalogToolbarProps) {
  const [query, setQuery] = useState(filters.query);
  const [copied, setCopied] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [searchName, setSearchName] = useState('');
  const [makePreferred, setMakePreferred] = useState(false);
  const [saving, setSaving] = useState(false);
  const { user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => setQuery(filters.query), [filters.query]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (query !== filters.query) onChange({ query, page: 1 });
    }, 260);
    return () => window.clearTimeout(timer);
  }, [query, filters.query, onChange]);

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Copy this search URL', window.location.href);
    }
  };

  const openSave = () => {
    if (!user) {
      showToast('Sign in to save searches to your account.', 'info');
      navigate(`/account?return=${encodeURIComponent(location.pathname + location.search)}`);
      return;
    }
    setSearchName(`${filters.makes[0] || 'My'} ${filters.maxPrice ? `under ${formatCurrency(filters.maxPrice)}` : 'vehicle search'}`);
    setSaveOpen(true);
  };

  const saveSearch = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || !searchName.trim()) return;
    setSaving(true);
    const client = requireSupabase();
    const { error } = await client.from('saved_searches').insert({ user_id: user.id, name: searchName.trim(), filters });
    if (!error && makePreferred) {
      const profileResult = await client.from('profiles').update({ preferred_filters: filters, default_budget: filters.maxPrice }).eq('id', user.id);
      if (profileResult.error) {
        setSaving(false);
        showToast(profileResult.error.message, 'error');
        return;
      }
    }
    setSaving(false);
    if (error) showToast(error.message, 'error');
    else {
      showToast('Search saved to your garage.', 'success');
      setSaveOpen(false);
    }
  };

  return (
    <div className="catalog-toolbar">
      <div className="results-heading-row">
        <div>
          <p className="section-kicker">Your road-ready shortlist</p>
          <h2 aria-live="polite">{total.toLocaleString()} matching {total === 1 ? 'vehicle' : 'vehicles'}</h2>
          <p>{filters.maxPrice !== null ? `At or below ${formatCurrency(filters.maxPrice)} average asking price` : 'Across all supported price points'}</p>
        </div>
        <div className="toolbar-actions-top">
          <button className="secondary-button mobile-filter-button" type="button" onClick={onOpenFilters}>
            <SlidersHorizontal aria-hidden="true" /> Filters {activeCount ? <span>{activeCount}</span> : null}
          </button>
          <div className="save-search-wrap">
            <button className="secondary-button" type="button" onClick={openSave}><BookmarkPlus aria-hidden="true" /> Save search</button>
            {saveOpen ? <form className="save-search-popover" onSubmit={saveSearch}><button className="popover-close" type="button" onClick={() => setSaveOpen(false)} aria-label="Close save search"><X aria-hidden="true" /></button><strong>Save this search</strong><p>Keep these filters in your account and reopen them on any device.</p><label><span>Name</span><input autoFocus required maxLength={80} value={searchName} onChange={(event) => setSearchName(event.target.value)} /></label><label className="checkbox-row"><input type="checkbox" checked={makePreferred} onChange={(event) => setMakePreferred(event.target.checked)} /><span>Use as my preferred filters</span></label><button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save search'}</button></form> : null}
          </div>
          <button className="secondary-button share-button" type="button" onClick={share}>
            {copied ? <Check aria-hidden="true" /> : <Share2 aria-hidden="true" />}{copied ? 'Copied' : 'Share search'}
          </button>
        </div>
      </div>
      <div className="toolbar-controls">
        <label className="catalog-search">
          <Search aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search make, model, trim…" list="vehicle-search-suggestions" />
          <datalist id="vehicle-search-suggestions">{suggestions.slice(0, 60).map((suggestion) => <option value={suggestion} key={suggestion} />)}</datalist>
        </label>
        <label className="toolbar-select">Sort
          <select value={filters.sort} onChange={(event) => onChange({ sort: event.target.value as SortKey, page: 1 })}>
            {SORT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="toolbar-select compact-select">Per page
          <select value={filters.pageSize} onChange={(event) => onChange({ pageSize: Number(event.target.value), page: 1 })}>
            {[12, 24, 48, 96].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <div className="view-toggle" aria-label="Result layout">
          <button type="button" className={filters.view === 'grid' ? 'active' : ''} onClick={() => onChange({ view: 'grid' })} aria-label="Grid view" aria-pressed={filters.view === 'grid'}><Grid2X2 aria-hidden="true" /></button>
          <button type="button" className={filters.view === 'list' ? 'active' : ''} onClick={() => onChange({ view: 'list' })} aria-label="List view" aria-pressed={filters.view === 'list'}><List aria-hidden="true" /></button>
        </div>
      </div>
    </div>
  );
}

interface ActiveFilterChipsProps {
  filters: VehicleFilters;
  onChange: (changes: Partial<VehicleFilters>) => void;
  onReset: () => void;
}

export function ActiveFilterChips({ filters, onChange, onReset }: ActiveFilterChipsProps) {
  const chips: Array<{ key: string; label: string; remove: () => void }> = [];
  if (filters.minPrice !== null) chips.push({ key: 'min', label: `From ${formatCurrency(filters.minPrice)}`, remove: () => onChange({ minPrice: null, page: 1 }) });
  if (filters.maxPrice !== null) chips.push({ key: 'max', label: `Up to ${formatCurrency(filters.maxPrice)}`, remove: () => onChange({ maxPrice: null, page: 1 }) });
  if (filters.minYear !== null) chips.push({ key: 'y0', label: `${filters.minYear}+`, remove: () => onChange({ minYear: null, page: 1 }) });
  if (filters.maxYear !== null) chips.push({ key: 'y1', label: `Through ${filters.maxYear}`, remove: () => onChange({ maxYear: null, page: 1 }) });
  const arrays: Array<[keyof VehicleFilters, string[]]> = [
    ['makes', filters.makes], ['models', filters.models], ['trims', filters.trims], ['bodyStyles', filters.bodyStyles], ['categories', filters.categories], ['fuelTypes', filters.fuelTypes], ['transmissions', filters.transmissions], ['drivetrains', filters.drivetrains],
  ];
  arrays.forEach(([key, values]) => values.forEach((value) => chips.push({
    key: `${String(key)}-${value}`,
    label: titleCase(value),
    remove: () => onChange({ [key]: values.filter((candidate) => candidate !== value), page: 1 } as Partial<VehicleFilters>),
  })));
  if (filters.minHorsepower !== null) chips.push({ key: 'hp', label: `${filters.minHorsepower}+ hp`, remove: () => onChange({ minHorsepower: null, page: 1 }) });
  if (filters.minMpg !== null) chips.push({ key: 'mpg', label: `${filters.minMpg}+ MPG`, remove: () => onChange({ minMpg: null, page: 1 }) });
  if (filters.minSampleSize !== null) chips.push({ key: 'sample', label: `${filters.minSampleSize}+ listings`, remove: () => onChange({ minSampleSize: null, page: 1 }) });
  if (!chips.length) return null;
  return (
    <div className="active-chips" aria-label="Active filters">
      {chips.map((chip) => <button type="button" key={chip.key} onClick={chip.remove}>{chip.label}<span aria-hidden="true">×</span></button>)}
      <button className="clear-chips" type="button" onClick={onReset}>Clear all</button>
    </div>
  );
}
