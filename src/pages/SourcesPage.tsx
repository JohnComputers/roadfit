import { AlertTriangle, CheckCircle2, Database, ExternalLink, FileCheck2, GitBranch, ImageOff, RefreshCw, Scale, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { compactNumber, formatDate } from '../lib/format';
import { loadManifest } from '../services/catalog';
import type { CatalogManifest } from '../types/vehicle';

const sources = [
  {
    name: 'EPA / DOE FuelEconomy.gov',
    label: 'Specifications & powertrain configurations',
    url: 'https://www.fueleconomy.gov/feg/download.shtml',
    licenseUrl: 'https://pasteur.epa.gov/license/sciencehub-license.html',
    license: 'U.S. federal government public data',
    description: 'Model years 1984–present, including engine displacement, cylinders, transmission, drivetrain, fuel type, MPG/MPGe, electric range, and EPA vehicle class where populated.',
  },
  {
    name: 'NHTSA vPIC',
    label: 'Make / model name matching',
    url: 'https://vpic.nhtsa.dot.gov/api/',
    licenseUrl: 'https://vpic.nhtsa.dot.gov/api/Home/Index/FAQ',
    license: 'Free U.S. government open data',
    description: 'Matches manufacturer and model names for relevant passenger cars, multipurpose vehicles, and trucks. The current pipeline does not treat an all-years name match as model-year verification.',
  },
  {
    name: 'ForCar Open Data',
    label: 'Used-vehicle asking-price aggregates',
    url: 'https://forcar.org/open-data/',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    license: 'CC BY 4.0',
    description: 'Model-year average asking price, observed minimum and maximum, average mileage, and listing sample size. Rows require at least five listings in the source dataset.',
  },
];

export function SourcesPage() {
  const [manifest, setManifest] = useState<CatalogManifest | null>(null);
  useEffect(() => { void loadManifest().then(setManifest).catch(() => undefined); }, []);
  const total = manifest?.totalRecords ?? manifest?.total;
  const priced = manifest?.pricedRecords ?? manifest?.pricedCount;
  const unpriced = manifest?.unpricedCount;

  return (
    <section className="sources-page page-section">
      <div className="container narrow-container">
        <div className="sources-hero">
          <span className="section-kicker">Trust through traceability</span>
          <h1>Every number should have a paper trail.</h1>
          <p>RoadFit combines free, legally reusable datasets into a static catalog. It does not scrape dealer listings, invent missing specifications, or turn model-level averages into trim-level claims.</p>
          <div className="source-stats">
            <div><Database aria-hidden="true" /><strong>{total ? compactNumber(total) : '—'}</strong><span>configurations</span></div>
            <div><FileCheck2 aria-hidden="true" /><strong>{priced ? compactNumber(priced) : '—'}</strong><span>priced records</span></div>
            <div><GitBranch aria-hidden="true" /><strong>{manifest?.shards.length ?? '—'}</strong><span>lazy-loaded shards</span></div>
            <div><RefreshCw aria-hidden="true" /><strong>{formatDate(manifest?.generatedAt)}</strong><span>published catalog</span></div>
          </div>
        </div>

        <section className="source-section"><div className="section-heading"><div><span className="section-kicker">Primary datasets</span><h2>Where the catalog comes from</h2></div></div><div className="source-cards">{sources.map((source, index) => <article key={source.name} className="source-card"><div className="source-number">0{index + 1}</div><span>{source.label}</span><h3>{source.name}</h3><p>{source.description}</p><div className="source-links"><a href={source.url} target="_blank" rel="noreferrer">Official source <ExternalLink aria-hidden="true" /></a><a href={source.licenseUrl} target="_blank" rel="noreferrer">{source.license} <Scale aria-hidden="true" /></a></div></article>)}</div></section>

        <section className="source-section methodology-section"><div className="section-heading"><div><span className="section-kicker">Reproducible pipeline</span><h2>How records are assembled</h2></div></div><ol className="methodology-steps"><li><span>1</span><div><h3>Fetch with a last-known-good cache</h3><p>Scheduled GitHub Actions conditionally download the official EPA, NHTSA, and ForCar sources. Checksums, timestamps, retries, and cached fallbacks keep the published site working when an upstream source is unavailable.</p></div></li><li><span>2</span><div><h3>Normalize conservatively</h3><p>Make and model names are standardized with explicit rules. EPA configurations keep their distinct engine, transmission, drivetrain, and fuel variants instead of collapsing meaningful differences.</p></div></li><li><span>3</span><div><h3>Join prices at the supported scope</h3><p>ForCar publishes make/model/model-year aggregates. RoadFit joins only exact normalized matches or documented descriptor-stripped matches and marks the result as <code>model-year</code> scope. It never presents the aggregate as an exact trim price.</p></div></li><li><span>4</span><div><h3>Validate, shard, then publish atomically</h3><p>The build rejects duplicate IDs, invalid currencies, impossible ranges, broken provenance, and unsafe price joins. Only a complete validated catalog replaces the previous static version.</p></div></li></ol></section>

        <section className="source-section limitations-section"><div className="section-heading"><div><span className="section-kicker">Read before shopping</span><h2>Important limitations</h2></div></div><div className="limitations-grid"><article><AlertTriangle aria-hidden="true" /><h3>Asking price is not sale price</h3><p>ForCar values summarize advertised asking prices. They are not completed transactions, appraisals, offers, or a guarantee that you can purchase a specific vehicle for that amount.</p></article><article><ShieldCheck aria-hidden="true" /><h3>Not live inventory</h3><p>Catalog records describe vehicle configurations. RoadFit never claims a car is currently for sale. External Google links are searches, not verified listings.</p></article><article><ImageOff aria-hidden="true" /><h3>Images are deliberately cautious</h3><p>Vehicles use branded placeholders unless an image has individually verified licensing and provenance. Representative images are labeled and never assumed to depict an exact trim.</p></article><article><CheckCircle2 aria-hidden="true" /><h3>Missing stays missing</h3><p>Horsepower, seats, doors, trim, body style, and market price may be absent. RoadFit displays “Unavailable” rather than generating estimates or inheriting unsupported values.</p></article></div></section>

        <section className="source-section coverage-panel"><div><span className="section-kicker">Current build</span><h2>Catalog coverage</h2><p>{total?.toLocaleString() ?? 'The published catalog'} distinct configurations are represented. {priced?.toLocaleString() ?? 'Some'} carry a supported model-year asking-price aggregate; {unpriced?.toLocaleString() ?? 'others'} intentionally remain unpriced. NHTSA coverage should not be interpreted as complete for vehicles before 1996, while EPA coverage begins in 1984.</p></div><Link className="primary-button" to="/">Explore the catalog</Link></section>

        <section className="attribution-panel"><h2>Attribution</h2><p>Vehicle specifications include data from the U.S. Environmental Protection Agency and U.S. Department of Energy FuelEconomy.gov program. All-years make/model name matching includes NHTSA vPIC open data and is not model-year validation. Used-vehicle asking-price aggregates are provided by <a href="https://forcar.org/open-data/" target="_blank" rel="noreferrer">ForCar</a> under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>. RoadFit is not affiliated with or endorsed by those organizations.</p><p>Source URLs, retrieval timestamps, license labels, and source identifiers are retained with each vehicle record whenever available.</p></section>
      </div>
    </section>
  );
}
