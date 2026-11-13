/** Header mark. Decorative: the brand name stays on the parent aria-label. */
export function BrandMark() {
  return (
    <svg className="logo" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.5 20L12 4l7.5 16" />
      <circle cx="8.3" cy="13.5" r="1.7" fill="currentColor" />
      <circle cx="15.7" cy="13.5" r="1.7" />
      <path d="M10 13.5h4" strokeDasharray="1.6 1.4" />
    </svg>
  );
}
