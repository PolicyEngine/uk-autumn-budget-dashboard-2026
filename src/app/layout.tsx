import { PolicyEngineShell } from "@policyengine/ui-kit/layout";
import "@policyengine/ui-kit/styles.css";

import type { Metadata, Viewport } from 'next';
import './globals.css';
import SiteFooter from '@/components/SiteFooter';
import { DEEP_LINK_SCRIPT } from '@/utils/landing';

const TITLE = 'UK Autumn Budget 2026 dashboard';
const DESCRIPTION =
  'This dashboard uses PolicyEngine UK to show how Autumn Budget 2026 measures would affect the public finances and households: by income, area and age, and for your own household, alongside the OBR forecast.';

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
    <html lang="en-GB" suppressHydrationWarning>
      <head>
        {/* Before the first paint: a link to a view (?tab=, ?sub=, ...)
            keeps the server's landing page hidden (utils/landing.js) */}
        <script dangerouslySetInnerHTML={{ __html: DEEP_LINK_SCRIPT }} />
        <link
          rel="stylesheet"
          href="https://unpkg.com/@policyengine/design-system/dist/tokens.css"
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
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
