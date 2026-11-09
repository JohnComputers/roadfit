import { Navigate, useLocation } from 'react-router-dom';

export function AccountPageRedirect() {
  const location = useLocation();
  return <Navigate to={`/garage${location.search}`} replace />;
}
