export function CatalogSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="vehicle-grid" aria-label="Loading vehicles" aria-busy="true">
      {Array.from({ length: count }, (_, index) => (
        <div className="vehicle-card skeleton-card" key={index}>
          <div className="skeleton skeleton-art" />
          <div className="vehicle-card-content">
            <div className="skeleton skeleton-line small" />
            <div className="skeleton skeleton-line title" />
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line price" />
            <div className="skeleton skeleton-pills" />
          </div>
        </div>
      ))}
    </div>
  );
}
