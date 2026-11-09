import { ArrowRight, BadgeDollarSign, Database, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatCurrency } from '../lib/format';
import type { VehicleFilters } from '../types/vehicle';

interface BudgetHeroProps {
  filters: VehicleFilters;
  onSubmit: (changes: Partial<VehicleFilters>) => void;
  catalogTotal?: number;
  pricedRecords?: number;
}

function parseMoney(value: string): number | null {
  const normalized = value.replace(/[^0-9.]/g, '');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
}

export function BudgetHero({ filters, onSubmit, catalogTotal, pricedRecords }: BudgetHeroProps) {
  const [maxBudget, setMaxBudget] = useState(String(filters.maxPrice ?? 25000));
  const [minBudget, setMinBudget] = useState(filters.minPrice === null ? '' : String(filters.minPrice));

  useEffect(() => setMaxBudget(String(filters.maxPrice ?? 25000)), [filters.maxPrice]);
  useEffect(() => setMinBudget(filters.minPrice === null ? '' : String(filters.minPrice)), [filters.minPrice]);

  const maxValue = parseMoney(maxBudget) ?? 0;
  const findCars = () => {
    onSubmit({ minPrice: parseMoney(minBudget), maxPrice: parseMoney(maxBudget), priceAvailable: true, page: 1 });
    window.setTimeout(() => document.getElementById('catalog-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  return (
    <section className="hero-section">
      <div className="hero-image" style={{ backgroundImage: `url("${import.meta.env.BASE_URL}assets/roadfit-hero.png")` }} aria-hidden="true" />
      <div className="hero-vignette" aria-hidden="true" />
      <div className="container hero-content">
        <div className="hero-copy">
          <div className="hero-kicker"><span /> Source-backed U.S. vehicle discovery</div>
          <h1>Find the cars that fit <em>your life.</em></h1>
          <p>Set a real budget. Explore decades of cars, trucks, SUVs, and EVs with transparent asking-price data—then compare the ones worth your time.</p>
          <div className="budget-panel">
            <div className="budget-heading">
              <div>
                <span className="field-label">Your maximum budget</span>
                <strong>{formatCurrency(maxValue)}</strong>
              </div>
              <BadgeDollarSign aria-hidden="true" />
            </div>
            <input
              className="budget-slider"
              type="range"
              min="0"
              max="500000"
              step={maxValue < 50000 ? 500 : 5000}
              value={Math.min(maxValue, 500000)}
              onChange={(event) => setMaxBudget(event.target.value)}
              aria-label="Maximum budget slider"
            />
            <div className="slider-labels" aria-hidden="true"><span>$0</span><span>$100k</span><span>$250k</span><span>$500k+</span></div>
            <div className="budget-fields">
              <label>
                <span>Minimum (optional)</span>
                <div className="money-input"><span>$</span><input inputMode="numeric" value={minBudget} placeholder="0" onChange={(event) => setMinBudget(event.target.value)} /></div>
              </label>
              <label>
                <span>Maximum</span>
                <div className="money-input"><span>$</span><input inputMode="numeric" value={maxBudget} onChange={(event) => setMaxBudget(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && findCars()} /></div>
              </label>
              <button className="primary-button hero-cta" type="button" onClick={findCars}>Find my cars <ArrowRight aria-hidden="true" /></button>
            </div>
          </div>
          <p className="hero-note"><ShieldCheck aria-hidden="true" /> No made-up prices. Missing market data is always labeled.</p>
        </div>
        <div className="hero-stats" aria-label="Catalog highlights">
          <div><Database aria-hidden="true" /><strong>{catalogTotal?.toLocaleString() ?? '50k+'}</strong><span>vehicle configurations</span></div>
          <div><SlidersHorizontal aria-hidden="true" /><strong>{pricedRecords?.toLocaleString() ?? '7k+'}</strong><span>model-years with price data</span></div>
        </div>
      </div>
    </section>
  );
}
