import { chromium } from "playwright-core";
const [html, pdf, exe] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage();
await page.goto("file://" + html, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.pdf({ path: pdf, format: "A4", printBackground: true, preferCSSPageSize: true,
  displayHeaderFooter: true, headerTemplate: "<span></span>",
  footerTemplate: '<div style="font-family:Helvetica Neue,Helvetica,Arial,sans-serif;font-size:7pt;color:#6B7280;width:100%;padding:0 18mm;display:flex;justify-content:space-between"><span>PolicyEngine · Autumn Budget 2026 rehearsal · MOCK DATA, not a Budget analysis</span><span class="pageNumber"></span></div>' });
await browser.close();
