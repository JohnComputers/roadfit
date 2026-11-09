import { ChevronDown, RotateCcw, Search, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { titleCase } from '../lib/format';
import type { FilterFacets, VehicleFilters } from '../types/vehicle';

interface FilterSidebarProps {
  filters: VehicleFilters;
  facets: FilterFacets;
  open: boolean;
  onClose: () => void;
  onChange: (changes: Partial<VehicleFilters>) => void;
  onReset: () => void;
}

function NumberField({ label, value, onChange, suffix }: { label: string; value: number | null; onChange: (value: number | null) => void; suffix?: string }) {
  return (
    <label className="filter-number-field">
      <span>{label}</span>
      <div><input type="number" value={value ?? ''} min="0" onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))} />{suffix ? <small>{suffix}</small> : null}</div>
    </label>
  );
}

function MultiChoice({ label, options, selected, onChange, searchable = false, format = titleCase }: { label: string; options: string[]; selected: string[]; onChange: (value: string[]) => void; searchable?: boolean; format?: (value: string) => string }) {
  const [query, setQuery] = useState('');
  const visible = useMemo(() => options.filter((option) => option.toLowerCase().includes(query.toLowerCase())).slice(0, 80), [options, query]);
  const toggle = (option: string) => onChange(selected.includes(option) ? selected.filter((value) => value !== option) : [...selected, option]);
  return (
    <details className="filter-group" open={selected.length > 0}>
      <summary>{label}{selected.length ? <span>{selected.length}</span> : null}<ChevronDown aria-hidden="true" /></summary>
      <div className="filter-group-content">
        {searchable && options.length > 8 ? (
          <label className="facet-search"><Search aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${label.toLowerCase()}`} /></label>
        ) : null}
        <div className="choice-list">
          {visible.map((option) => (
            <label key={option} className="checkbox-row">
              <input type="checkbox" checked={selected.includes(option)} onChange={() => toggle(option)} />
              <span>{format(option)}</span>
            </label>
          ))}
          {!visible.length ? <p className="filter-empty">No options match.</p> : null}
        </div>
      </div>
    </details>
  );
}

export function FilterSidebar({ filters, facets, open, onClose, onChange, onReset }: FilterSidebarProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    closeButtonRef.current?.focus();
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  return (
    <>
      {open ? <button className="filter-backdrop" type="button" onClick={onClose} aria-label="Close filters" /> : null}
      <aside className={`filter-sidebar ${open ? 'open' : ''}`} aria-label="Vehicle filters" role={open ? 'dialog' : undefined} aria-modal={open || undefined}>
        <div className="filter-header">
          <div><SlidersHorizontal aria-hidden="true" /><strong>Filters</strong></div>
          <button ref={closeButtonRef} className="mobile-filter-close" type="button" onClick={onClose} aria-label="Close filters"><X aria-hidden="true" /></button>
        </div>
        <button className="reset-button" type="button" onClick={onReset}><RotateCcw aria-hidden="true" /> Reset all</button>
        <div className="filter-section always-open">
          <span className="filter-section-title">Price</span>
          <div className="two-fields">
            <NumberField label="Minimum" value={filters.minPrice} onChange={(minPrice) => onChange({ minPrice, page: 1 })} />
            <NumberField label="Maximum" value={filters.maxPrice} onChange={(maxPrice) => onChange({ maxPrice, page: 1 })} />
          </div>
          <label className="select-label">Price records
            <select value={filters.priceAvailable === null ? 'any' : filters.priceAvailable ? 'priced' : 'missing'} onChange={(event) => { const value = event.target.value; onChange({ priceAvailable: value === 'any' ? null : value === 'priced', ...(value === 'missing' ? { minPrice: null, maxPrice: null } : {}), page: 1 }); }}>
              <option value="priced">Price available</option><option value="any">All records</option><option value="missing">Price unavailable only</option>
            </select>
          </label>
          <NumberField label="Minimum listing sample" value={filters.minSampleSize} onChange={(minSampleSize) => onChange({ minSampleSize, page: 1 })} />
        </div>
        <div className="filter-section always-open">
          <span className="filter-section-title">Model year</span>
          <div className="two-fields">
            <NumberField label="From" value={filters.minYear} onChange={(minYear) => onChange({ minYear, page: 1 })} />
            <NumberField label="To" value={filters.maxYear} onChange={(maxYear) => onChange({ maxYear, page: 1 })} />
          </div>
        </div>
        <MultiChoice label="Make" options={facets.makes} selected={filters.makes} searchable onChange={(makes) => onChange({ makes, models: [], trims: [], page: 1 })} format={(value) => value} />
        <MultiChoice label="Model" options={facets.models} selected={filters.models} searchable onChange={(models) => onChange({ models, trims: [], page: 1 })} format={(value) => value} />
        <MultiChoice label="Trim / configuration" options={facets.trims} selected={filters.trims} searchable onChange={(trims) => onChange({ trims, page: 1 })} format={(value) => value} />
        <MultiChoice label="Body style" options={facets.bodyStyles} selected={filters.bodyStyles} onChange={(bodyStyles) => onChange({ bodyStyles, page: 1 })} />
        <MultiChoice label="Category" options={facets.categories} selected={filters.categories} onChange={(categories) => onChange({ categories, page: 1 })} />
        <MultiChoice label="Fuel" options={facets.fuelTypes} selected={filters.fuelTypes} onChange={(fuelTypes) => onChange({ fuelTypes, page: 1 })} />
        <MultiChoice label="Drivetrain" options={facets.drivetrains} selected={filters.drivetrains} onChange={(drivetrains) => onChange({ drivetrains, page: 1 })} format={(value) => value.toUpperCase()} />
        <MultiChoice label="Transmission" options={facets.transmissions} selected={filters.transmissions} searchable onChange={(transmissions) => onChange({ transmissions, page: 1 })} format={(value) => value} />
        <details className="filter-group advanced-group">
          <summary>Power & efficiency<ChevronDown aria-hidden="true" /></summary>
          <div className="filter-group-content stacked-fields">
            <div className="two-fields">
              <NumberField label="Min horsepower" value={filters.minHorsepower} onChange={(minHorsepower) => onChange({ minHorsepower, page: 1 })} suffix="hp" />
              <NumberField label="Max horsepower" value={filters.maxHorsepower} onChange={(maxHorsepower) => onChange({ maxHorsepower, page: 1 })} suffix="hp" />
            </div>
            <NumberField label="Minimum combined MPG / MPGe" value={filters.minMpg} onChange={(minMpg) => onChange({ minMpg, page: 1 })} />
            <div className="two-fields">
              <NumberField label="Min cylinders" value={filters.minCylinders} onChange={(minCylinders) => onChange({ minCylinders, page: 1 })} />
              <NumberField label="Max cylinders" value={filters.maxCylinders} onChange={(maxCylinders) => onChange({ maxCylinders, page: 1 })} />
            </div>
            <div className="two-fields">
              <NumberField label="Min displacement" value={filters.minDisplacement} onChange={(minDisplacement) => onChange({ minDisplacement, page: 1 })} suffix="L" />
              <NumberField label="Max displacement" value={filters.maxDisplacement} onChange={(maxDisplacement) => onChange({ maxDisplacement, page: 1 })} suffix="L" />
            </div>
            <div className="two-fields">
              <NumberField label="Min doors" value={filters.minDoors} onChange={(minDoors) => onChange({ minDoors, page: 1 })} />
              <NumberField label="Min seats" value={filters.minSeats} onChange={(minSeats) => onChange({ minSeats, page: 1 })} />
            </div>
          </div>
        </details>
        <button className="primary-button mobile-apply" type="button" onClick={onClose}>Show results</button>
      </aside>
    </>
  );
}
