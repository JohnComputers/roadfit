import { ArrowRight, GitCompareArrows, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCompare } from '../contexts/CompareContext';

export function CompareTray() {
  const { vehicleIds, clear } = useCompare();
  if (!vehicleIds.length) return null;
  return (
    <aside className="compare-tray" aria-label="Comparison selection">
      <div className="container compare-tray-inner">
        <div><GitCompareArrows aria-hidden="true" /><span><strong>{vehicleIds.length}/4</strong> vehicles ready to compare</span></div>
        <div>
          <button type="button" className="tray-clear" onClick={clear}><X aria-hidden="true" /> Clear</button>
          <Link className="primary-button" to={`/compare?ids=${vehicleIds.map(encodeURIComponent).join(',')}`}>Compare now <ArrowRight aria-hidden="true" /></Link>
        </div>
      </div>
    </aside>
  );
}
