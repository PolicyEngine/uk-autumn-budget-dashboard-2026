import type { Metadata } from 'next';
import HistoricalReleasePage from '@/components/historical/HistoricalReleasePage';
import { getHistoricalRelease, HISTORICAL_RELEASES } from '@/utils/publication/release';

// A past fiscal event's page, one per registered historical release
// (src/uk_budget_data/releases.json). Any other id is a 404: the route
// never serves a release the registry does not list.
export const dynamicParams = false;

type Params = { params: Promise<{ release: string }> };

export function generateStaticParams() {
  return HISTORICAL_RELEASES.map((release) => ({ release: release.id }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { name } = getHistoricalRelease((await params).release);
  return {
    title: `${name} on today's model and data`,
    description: `The measures of the ${name}, costed on PolicyEngine UK's current model and data, with their coverage and the OBR's costing at the time.`,
  };
}

export default async function HistoricalRelease({ params }: Params) {
  return <HistoricalReleasePage releaseId={(await params).release} />;
}
