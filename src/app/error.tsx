"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="shell small-shell"><h1>Something went wrong</h1><p className="muted mt-3">Please try loading the page again.</p><button className="button mt-5" onClick={reset}>Try again</button></main>;
}
