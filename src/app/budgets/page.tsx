import type { Metadata } from 'next';
import Link from 'next/link';
import { eventDate } from '@/utils/historical';
import { HISTORICAL_RELEASES } from '@/utils/publication/release';
import '@/components/historical/PastEvent.css';

export const metadata: Metadata = {
  title: 'Past UK fiscal events on today\'s model and data',
  description: 'Past UK Budgets and Statements, replayed on PolicyEngine UK\'s current model and data.',
};

// The past fiscal events this dashboard serves, newest first
export default function HistoricalReleases() {
  const releases = [...HISTORICAL_RELEASES].sort((a, b) => (a.date < b.date ? 1 : -1));
  return (
    <main className="historical-index">
      <h1>Past fiscal events</h1>
      <p>
        Each event's measures, costed on today's model and data rather than
        what was known at the time, with how much of the event they cover.
      </p>
      <ul>
        {releases.map((release) => (
          <li key={release.id}>
            <Link href={`/budgets/${release.id}`}>{release.name}</Link>
            <time dateTime={release.date}>{eventDate(release.date)}</time>
          </li>
        ))}
      </ul>
    </main>
  );
}
