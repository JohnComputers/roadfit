import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { AccountPageRedirect } from './components/RouteHelpers';
import { AuthPage } from './pages/AuthPage';
import { CatalogPage } from './pages/CatalogPage';
import { ComparePage } from './pages/ComparePage';
import { GaragePage } from './pages/GaragePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { SourcesPage } from './pages/SourcesPage';
import { VehicleDetailPage } from './pages/VehicleDetailPage';

function ScrollManager() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (!window.location.hash) window.scrollTo({ top: 0, behavior: 'auto' });
  }, [pathname]);
  return null;
}

interface ErrorBoundaryState { error: Error | null }

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };
  static getDerivedStateFromError(error: Error): ErrorBoundaryState { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('RoadFit rendering error', error, info); }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="fatal-error"><AlertTriangle aria-hidden="true" /><h1>RoadFit hit an unexpected turn.</h1><p>{this.state.error.message}</p><button className="primary-button" type="button" onClick={() => window.location.assign(import.meta.env.BASE_URL)}>Reload the app</button></div>;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <ScrollManager />
      <Layout>
        <Routes>
          <Route path="/" element={<CatalogPage />} />
          <Route path="/vehicle/:vehicleId" element={<VehicleDetailPage />} />
          <Route path="/compare" element={<ComparePage />} />
          <Route path="/garage" element={<GaragePage />} />
          <Route path="/account" element={<AuthPage />} />
          <Route path="/profile" element={<AccountPageRedirect />} />
          <Route path="/sources" element={<SourcesPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Layout>
    </ErrorBoundary>
  );
}
