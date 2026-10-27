/**
 * A link to a chart view (?tab=outlook, ?tab=dashboard&sub=all, ...) needs
 * the chart views' chunk (components/chartViews.js), which App.jsx imports
 * only once the page's own code has loaded and run. The root layout finds
 * that chunk's files in the build's output, and an inline script in the
 * document head preloads them for such a link, so they download beside the
 * page's code instead of after it. The landing page and the text views
 * (Policies, Methodology) request none of it.
 *
 * Only the requests move earlier: the bundler's runtime still loads and runs
 * the chunk, finding the preloaded responses in the browser's cache. If the
 * files cannot be found (another bundler's output, a dev server), the head
 * preloads nothing and the page loads as before.
 */

// Kept in the chart chunk by chartViews.js's export of it
export const CHART_VIEWS_MARKER = "ab26-chart-views-chunk";

// The views whose code is not in the chart chunk (App.jsx VIEW_CODE)
const TEXT_TABS = ["policies", "methodology"];

// A chunk loader's file list: ["static/chunks/a.js","static/chunks/b.css"]
const FILE_LIST = /\[("static\/chunks\/[^"\\]+"(?:,"static\/chunks\/[^"\\]+")*)\]/g;
const CHUNK_FILE = /^static\/chunks\/[A-Za-z0-9_.~-]+\.(?:js|css)$/;

/**
 * The files the chart views' dynamic import loads, as the bundler names them
 * ("static/chunks/<name>.js" or ".css"), from the built client chunks
 * ({ "<name>.js": source }). Empty unless exactly one chunk carries the
 * marker and exactly one file list names that chunk.
 */
export function chartChunkFiles(chunks) {
  const marked = Object.keys(chunks).filter((name) => name.endsWith(".js") && chunks[name].includes(CHART_VIEWS_MARKER));
  if (marked.length !== 1) return [];
  const target = `"static/chunks/${marked[0]}"`;
  const lists = new Set();
  for (const source of Object.values(chunks)) {
    for (const match of source.matchAll(FILE_LIST)) {
      if (match[1].split(",").includes(target)) lists.add(match[1]);
    }
  }
  if (lists.size !== 1) return [];
  const files = [...lists][0].split(",").map((file) => file.slice(1, -1));
  return files.every((file) => CHUNK_FILE.test(file)) ? files : [];
}

/**
 * The inline script: for a link to a chart view, preloads the chart chunk's
 * files. Runs after the scripts that mark <html data-deep-link> and
 * data-boot-view (utils/landing.js, utils/bootView.js). A preload's address
 * must be the one the runtime will request, so it takes the query (a
 * deployment id) from the page's own chunk scripts.
 */
export function chartChunkScript(basePath, files) {
  if (!files.length) return "";
  return (
    "(function(){try{var d=document,h=d.documentElement,v=h.getAttribute(\"data-boot-view\")||\"\";" +
    `if(!h.hasAttribute("data-deep-link")||${JSON.stringify(TEXT_TABS)}.indexOf(v.split(":")[0])>=0)return;` +
    'var s=d.querySelector(\'script[src*="/_next/static/chunks/"]\'),q="";' +
    'if(s){var a=s.getAttribute("src"),i=a.indexOf("?");if(i>=0)q=a.slice(i);}' +
    `var f=${JSON.stringify(files)};for(var k=0;k<f.length;k++){var l=d.createElement("link");` +
    'l.rel="preload";l.setAttribute("as",/\\.css$/.test(f[k])?"style":"script");' +
    `l.href=${JSON.stringify(`${basePath}/_next/`)}+f[k]+q;d.head.appendChild(l);}` +
    "}catch(e){}})();"
  );
}
