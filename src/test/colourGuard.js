/**
 * The colour guard (docs/COLOURS.md): finds every colour literal in src/
 * that is not a token. src/colourGuard.test.js runs it and fails with each
 * file:line it finds.
 *
 * A colour literal is a hex value (#fff, #319795, or %23319795 in a data
 * URI), an rgb()/rgba()/hsl()/hsla() value, or a CSS named colour (white,
 * black, red ...) used as a colour. They may be written in two places only:
 *   - src/app/globals.css, inside a `:root` (or `@theme`) block: the tokens;
 *   - src/utils/chartTheme.js: the tokens' JS mirror.
 * `transparent`, `currentColor`, `inherit`, `none` and var(--token) are
 * always allowed, and so is a mask (mask-image): a mask's colour is only its
 * alpha, never seen.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import * as espree from "espree";

export const TOKEN_FILES = ["src/app/globals.css", "src/utils/chartTheme.js"];
const CSS_TOKEN_FILE = "src/app/globals.css";
const JS_TOKEN_FILE = "src/utils/chartTheme.js";
// The guard's own files describe the patterns they look for
const SELF = ["src/test/colourGuard.js", "src/colourGuard.test.js"];

// #rgb, #rgba, #rrggbb, #rrggbbaa (or URL-encoded as %23...), not followed
// by a word character or a hyphen, so "#fed-section" is not a colour
const HEX = /(?:#|%23)(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g;
const COLOUR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*[-\d.]/g;

// CSS named colours (CSS Color Module Level 4), less the always-allowed ones
export const NAMED_COLOURS = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue " +
    "blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk " +
    "crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki " +
    "darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen " +
    "darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue " +
    "dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite " +
    "gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki " +
    "lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan " +
    "lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen " +
    "lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen " +
    "magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen " +
    "mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream " +
    "mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid " +
    "palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum " +
    "powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown " +
    "seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen " +
    "steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen"
  ).split(" "),
);

// CSS properties whose value can hold a colour
const CSS_COLOUR_PROPERTY =
  /^(?:colou?r|background(?:-color|-image)?|border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-color)?|outline(?:-color)?|box-shadow|text-shadow|fill|stroke|stop-color|flood-color|lighting-color|caret-color|accent-color|column-rule(?:-color)?|text-decoration(?:-color)?|filter|--[\w-]+)$/i;

// JS/JSX keys and attributes that take a colour
const JS_COLOUR_KEY =
  /^(?:colou?r|fill|stroke|background(?:Color)?|border(?:Top|Right|Bottom|Left)?(?:Color)?|outline(?:Color)?|stopColor|floodColor|lightingColor|caretColor|accentColor|textDecorationColor|boxShadow|textShadow|stop-color)$/;

/** Hex and colour-function literals in `text` (a pure-digit #2616 is an issue number, not a colour). */
function literalColours(text) {
  const found = [];
  for (const match of text.matchAll(HEX)) {
    const digits = match[0].replace(/^(#|%23)/, "");
    if (/^\d+$/.test(digits) && digits.length !== 3 && digits.length !== 6) continue;
    if (match.index > 0 && text[match.index - 1] === "&") continue; // an HTML entity, &#160;
    found.push(match[0]);
  }
  for (const match of text.matchAll(COLOUR_FUNCTION)) found.push(match[0].replace(/\(.*$/, "()"));
  return found;
}

/** Named colours used as words in a CSS value (strings and url() left out). */
function namedColours(value) {
  const bare = value.replace(/url\([^)]*\)/gi, "").replace(/(["'])(?:\\.|(?!\1).)*\1/g, "");
  return [...bare.matchAll(/(?<![\w-])[a-zA-Z]+(?![\w-])/g)]
    .map(([word]) => word)
    .filter((word) => NAMED_COLOURS.has(word.toLowerCase()));
}

const lineOf = (text, index) => text.slice(0, index).split("\n").length;

/** Violations in a CSS file: [{ line, found }]. */
export function scanCss(text, { tokensAllowed = false } = {}) {
  // Comments become spaces, keeping line numbers
  const source = text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
  const violations = [];
  const stack = [];
  let start = 0;
  let depth = 0; // parentheses
  let quote = null;
  const inTokenBlock = () => {
    const rules = stack.filter((selector) => !selector.startsWith("@") || selector.startsWith("@theme"));
    const inner = rules.at(-1);
    return inner !== undefined && (inner.startsWith("@theme") || /^:root\b/.test(inner));
  };
  const declaration = (end) => {
    const text = source.slice(start, end);
    const colon = text.indexOf(":");
    if (colon === -1 || !text.trim()) return;
    const property = text.slice(0, colon).trim();
    const value = text.slice(colon + 1);
    if (/^(?:-webkit-)?mask(?:-image)?$/i.test(property)) return;
    if (tokensAllowed && property.startsWith("--") && inTokenBlock()) return;
    const found = [...literalColours(value)];
    if (CSS_COLOUR_PROPERTY.test(property)) found.push(...namedColours(value));
    if (found.length) {
      const offset = start + text.search(/\S/);
      violations.push({ line: lineOf(source, offset), found: `${property}: ${found.join(", ")}` });
    }
  };
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (depth > 0) continue;
    else if (ch === "{") {
      stack.push(source.slice(start, i).trim());
      start = i + 1;
    } else if (ch === ";") {
      declaration(i);
      start = i + 1;
    } else if (ch === "}") {
      declaration(i);
      stack.pop();
      start = i + 1;
    }
  }
  return violations;
}

const JS_OPTIONS = { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true }, loc: true };

/** A string, template or JSX attribute token's text, without its quotes. */
const unquote = (token) =>
  token.type === "Template"
    ? token.value.replace(/^[`}]|(?:`|\$\{)$/g, "")
    : token.value.slice(1, -1);

/** Violations in a JS/JSX file: [{ line, found }]. Only strings and templates are read, never comments. */
export function scanJs(text) {
  let tokens;
  try {
    tokens = espree.tokenize(text, JS_OPTIONS);
  } catch {
    // TypeScript espree cannot read: scan the text, comments removed
    const bare = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " ")).replace(/(^|[^:])\/\/.*$/gm, "$1");
    return bare
      .split("\n")
      .map((line, index) => ({ line: index + 1, found: literalColours(line).join(", ") }))
      .filter(({ found }) => found);
  }
  const violations = [];
  tokens.forEach((token, index) => {
    const isString = token.type === "String" || token.type === "Template";
    // A JSX attribute's value (x="..."); a JSX child's text is not styling
    const isAttribute = token.type === "JSXText" && /^["']/.test(token.value);
    if (!isString && !isAttribute) return;
    const value = unquote(token);
    const found = literalColours(value);
    // A named colour as the whole value of a colour key: { background: "white" }, fill="white"
    const key = tokens[index - 2];
    const joiner = tokens[index - 1];
    if (
      NAMED_COLOURS.has(value.trim().toLowerCase()) &&
      key &&
      /^(?:Identifier|JSXIdentifier|String)$/.test(key.type) &&
      JS_COLOUR_KEY.test(key.type === "String" ? key.value.slice(1, -1) : key.value) &&
      (joiner?.value === ":" || joiner?.value === "=")
    ) {
      found.push(value.trim());
    }
    // A named colour in a CSS declaration written as a string: "color: white"
    for (const [, property, cssValue] of value.matchAll(/([a-z-]+)\s*:\s*([^;"'{}]+)/gi)) {
      if (CSS_COLOUR_PROPERTY.test(property)) found.push(...namedColours(cssValue));
    }
    if (found.length) violations.push({ line: token.loc.start.line, found: found.join(", ") });
  });
  return violations;
}

/** Inline fill= / stroke= literals in JSX: every chart takes its colours from chartTheme or policyConfig. */
export function scanInlineFills(text) {
  const violations = [];
  const pattern = /\b(fill|stroke|stopColor|color)=(["'])([^"']*)\2/g;
  for (const match of text.matchAll(pattern)) {
    const value = match[3].trim();
    if (value.includes("${")) continue; // a template's interpolation, not a literal
    if (/^(?:none|transparent|currentColor|inherit|url\(#[\w-]+\))$/.test(value)) continue;
    violations.push({ line: lineOf(text, match.index), found: `${match[1]}="${value}"` });
  }
  return violations;
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Every colour violation under `root`/src, as "file:line  found" strings. */
export function findColourViolations(root) {
  const files = walk(join(root, "src"))
    .map((path) => relative(root, path).split(sep).join("/"))
    .filter((path) => /\.(?:js|jsx|ts|tsx|css)$/.test(path))
    .filter((path) => !SELF.includes(path));
  const report = [];
  for (const path of files) {
    if (path === JS_TOKEN_FILE) continue;
    const text = readFileSync(join(root, path), "utf8");
    const found = path.endsWith(".css")
      ? scanCss(text, { tokensAllowed: path === CSS_TOKEN_FILE })
      : [...scanJs(text), ...(/\.(?:jsx|tsx)$/.test(path) ? scanInlineFills(text) : [])];
    const seen = new Set();
    for (const { line, found: what } of found.sort((a, b) => a.line - b.line)) {
      const entry = `${path}:${line}  ${what}`;
      if (!seen.has(entry)) report.push(entry);
      seen.add(entry);
    }
  }
  return report;
}
