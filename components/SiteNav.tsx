import Link from "next/link";

export function SiteNav() {
  return (
    <header className="nav">
      <Link href="/" className="wordmark" aria-label="Daily Teardown, home">
        <svg viewBox="0 0 28 28" width="26" height="26" aria-hidden="true">
          <rect x="2" y="2" width="11" height="11" rx="2" fill="currentColor" />
          <rect x="16" y="3.5" width="9" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="2" transform="rotate(12 20.5 8)" />
          <rect x="3.5" y="16" width="9" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="2" transform="rotate(-9 8 20.5)" />
          <rect x="15" y="15" width="11" height="11" rx="2" fill="var(--mark)" />
        </svg>
        <span>Daily Teardown</span>
      </Link>
      <nav aria-label="Main">
        <Link href="/">Today</Link>
        <Link href="/archive">All objects</Link>
        <Link href="/make" className="nav-cta">
          Make your own
        </Link>
      </nav>
    </header>
  );
}
