import { useState, type ReactNode } from 'react';
import { CarFront, GitCompareArrows, Heart, Info, LogIn, Menu, Search, UserRound, X } from 'lucide-react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useCompare } from '../contexts/CompareContext';

const navigation = [
  { to: '/', label: 'Discover', icon: Search },
  { to: '/compare', label: 'Compare', icon: GitCompareArrows },
  { to: '/garage', label: 'Saved', icon: Heart },
  { to: '/sources', label: 'Data & sources', icon: Info },
];

export function Layout({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, loading } = useAuth();
  const { vehicleIds } = useCompare();
  const repositoryUrl = import.meta.env.VITE_REPOSITORY_URL?.trim();

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="site-header">
        <div className="container header-inner">
          <Link className="brand" to="/" aria-label="RoadFit home">
            <span className="brand-mark"><CarFront aria-hidden="true" size={21} /></span>
            <span>ROAD<span>FIT</span></span>
          </Link>
          <nav className="desktop-nav" aria-label="Primary navigation">
            {navigation.map(({ to, label }) => (
              <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
                {label}
                {to === '/compare' && vehicleIds.length > 0 ? <span className="nav-count">{vehicleIds.length}</span> : null}
              </NavLink>
            ))}
          </nav>
          <div className="header-actions">
            <Link className="account-link" to={user ? '/garage' : '/account'}>
              {user ? <UserRound aria-hidden="true" size={18} /> : <LogIn aria-hidden="true" size={18} />}
              <span>{loading ? 'Loading…' : user ? 'My garage' : 'Sign in'}</span>
            </Link>
            <button className="mobile-menu-button" type="button" onClick={() => setMobileOpen((open) => !open)} aria-expanded={mobileOpen} aria-label="Toggle navigation">
              {mobileOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
            </button>
          </div>
        </div>
        {mobileOpen ? (
          <nav className="mobile-nav" aria-label="Mobile navigation">
            {navigation.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} onClick={() => setMobileOpen(false)} className={({ isActive }) => (isActive ? 'mobile-nav-link active' : 'mobile-nav-link')}>
                <Icon aria-hidden="true" size={18} /> {label}
                {to === '/compare' && vehicleIds.length > 0 ? <span className="nav-count">{vehicleIds.length}</span> : null}
              </NavLink>
            ))}
          </nav>
        ) : null}
      </header>
      <main id="main-content">{children}</main>
      <footer className="site-footer">
        <div className="container footer-grid">
          <div>
            <Link className="brand footer-brand" to="/">
              <span className="brand-mark"><CarFront aria-hidden="true" size={19} /></span>
              <span>ROAD<span>FIT</span></span>
            </Link>
            <p>Source-transparent vehicle discovery for real-world budgets. Free to browse, compare, and share.</p>
          </div>
          <div>
            <p className="footer-heading">Explore</p>
            <Link to="/">Budget finder</Link>
            <Link to="/compare">Compare vehicles</Link>
            <Link to="/garage">Saved garage</Link>
          </div>
          <div>
            <p className="footer-heading">Trust</p>
            <Link to="/sources">Data & methodology</Link>
            {repositoryUrl ? <a href={repositoryUrl} target="_blank" rel="noreferrer">Source code</a> : <span>MIT-licensed application</span>}
            <span>Prices are asking-price averages, not offers.</span>
          </div>
        </div>
        <div className="container footer-bottom">
          <span>© {new Date().getFullYear()} RoadFit</span>
          <span>No ads. No paid data APIs. No invented prices.</span>
        </div>
      </footer>
    </div>
  );
}
