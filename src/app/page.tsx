import App from '@/App';
import { publicationBoot } from './publicationBoot';

// Prerendered once per build, with the publication the build verified
// (publicationBoot.ts) baked into the HTML
export const dynamic = 'force-static';

export default async function HomePage() {
  return <App boot={await publicationBoot()} />;
}
