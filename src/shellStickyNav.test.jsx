import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PolicyEngineShell } from "@policyengine/ui-kit/layout";

const SELECTOR =
  '.min-h-screen.flex.flex-col > div:first-child[style*="sticky"]';

describe("the ui-kit shell's sticky site nav", () => {
  it("is still matched by the selector globals.css un-sticks it with", () => {
    const { container } = render(
      <PolicyEngineShell country="uk" showFooter={false}>
        <p>content</p>
      </PolicyEngineShell>,
    );
    expect(container.querySelector(SELECTOR)).not.toBeNull();
  });

  it("uses the same selector in globals.css and App.jsx", () => {
    const css = readFileSync(join(__dirname, "app", "globals.css"), "utf8");
    const app = readFileSync(join(__dirname, "App.jsx"), "utf8");
    expect(css).toContain(SELECTOR);
    expect(app).toContain(`'${SELECTOR}'`);
  });
});
