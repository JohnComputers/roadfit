import { MapPinOff } from 'lucide-react';
import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return <section className="page-section container"><div className="state-card not-found"><MapPinOff aria-hidden="true" /><span className="section-kicker">404 · Wrong turn</span><h1>That road doesn’t go anywhere.</h1><p>The page may have moved, or the shared link is incomplete.</p><Link className="primary-button" to="/">Return to car discovery</Link></div></section>;
}
