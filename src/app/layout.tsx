import { PolicyEngineShell } from "@policyengine/ui-kit/layout";
import "@policyengine/ui-kit/styles.css";

import type { Metadata, Viewport } from 'next';
import './globals.css';
// The PolicyEngine tokens, bundled with the page instead of fetched from
// unpkg. After globals.css, as the unpkg sheet was: its spacing values win,
// so the page lays out as before. Values match design-system 0.4.0's for
// every token the page uses (it differs only in colours nothing here reads).
import '@policyengine/ui-kit/legacy/tokens.css';
import './fonts.css';
import localFont from 'next/font/local';
import SiteFooter from '@/components/SiteFooter';
import { DEEP_LINK_SCRIPT } from '@/utils/landing';
import { earlyManifestScript } from '@/utils/publication/early';
import { BOOT_VIEW_SCRIPT } from '@/utils/bootView';

const TITLE = 'UK Autumn Budget 2026 dashboard';
const DESCRIPTION =
  'This dashboard uses PolicyEngine UK to show how Autumn Budget 2026 policies would affect the public finances and households: by income, area and age, and for your own household, alongside the pre-measures forecast.';

// Inter, committed with the page (fonts/: the variable face, every weight,
// Latin subset; SIL Open Font License in fonts/OFL.txt): the
// build fetches nothing from Google, and the page asks no third party for a
// font. Preloaded, swapped in when it arrives, over an Arial fallback sized
// to Inter's metrics so the swap does not move the text.
const inter = localFont({
  src: './fonts/inter-latin-variable.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  variable: '--font-inter',
  adjustFontFallback: 'Arial',
});

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1.0,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // The inline script marks a link to a view on <html> before hydration
    <html lang="en-GB" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Before the first paint: a link to a view (?tab=, ?sub=, ...)
            keeps the server's landing page hidden (utils/landing.js) */}
        <script dangerouslySetInnerHTML={{ __html: DEEP_LINK_SCRIPT }} />
        {/* ...and which view it opens, for that view's placeholder
            (utils/bootView.js) */}
        <script dangerouslySetInnerHTML={{ __html: BOOT_VIEW_SCRIPT }} />
        {/* The manifest request starts here, not after the page's code has
            loaded (utils/publication/early.js) */}
        <script dangerouslySetInnerHTML={{ __html: earlyManifestScript(process.env.NEXT_PUBLIC_BASE_PATH || '') }} />
      </head>
      <body>
        <PolicyEngineShell country="uk" showFooter={false}>
          {children}
          <SiteFooter />
        </PolicyEngineShell>
      </body>
    </html>
  );
}
