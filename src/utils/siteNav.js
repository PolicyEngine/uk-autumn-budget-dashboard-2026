// The PolicyEngine site header's UK menu, as policyengine.org/uk has it
// (policyengine-app-v2 website/src/components/Header.tsx): Research, Tools,
// Model, API, Python, About, Donate. Passed to @policyengine/ui-kit's
// PolicyEngineShell (layout.tsx), whose own UK default lacks Tools,
// Python, the Model menu and Events. The ui-kit menus are one level deep,
// so Model's sub-pages (Coverage, Parameters, Pipeline, ...) are reached
// from Rules and Data rather than listed under them. The Tools menu is
// app-v2's: the main app, then the UK tools in apps.json, by label. Like
// app-v2's menus, the rows have no descriptions.

const SITE = "https://policyengine.org/uk";

/** @type {Array<{label: string, href: string, children?: Array<{label: string, href: string}>}>} */
export const SITE_NAV_ITEMS = [
  { label: "Research", href: `${SITE}/research` },
  {
    label: "Tools",
    href: "https://app.policyengine.org/uk",
    children: [
      { label: "PolicyEngine app", href: "https://app.policyengine.org/uk" },
      { label: "Marriage calculator", href: `${SITE}/marriage` },
      { label: "Student loan calculator", href: `${SITE}/uk-student-loan-calculator` },
      { label: "UK CliffWatch", href: `${SITE}/uk-cliff-watch` },
    ],
  },
  {
    label: "Model",
    href: `${SITE}/model`,
    children: [
      { label: "Rules", href: `${SITE}/model/rules` },
      { label: "Data", href: `${SITE}/model/data` },
      { label: "Behavioral responses", href: `${SITE}/model/behavioral` },
    ],
  },
  { label: "API", href: `${SITE}/api` },
  { label: "Python", href: `${SITE}/python` },
  {
    label: "About",
    href: `${SITE}/team`,
    children: [
      { label: "Team", href: `${SITE}/team` },
      { label: "Supporters", href: `${SITE}/supporters` },
      { label: "Citations", href: `${SITE}/citations` },
      { label: "Events", href: `${SITE}/events` },
    ],
  },
  { label: "Donate", href: `${SITE}/donate` },
];

/** The header's side padding, as app-v2's: 16px on a phone up to 32px. */
export const SITE_HEADER_STYLES = {
  root: { padding: "8px clamp(16px, 4vw, 32px)" },
};
