import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import Tip, { InfoTip } from "./Tip";

describe("Tip", () => {
  it("shows at once on hover and focus, names itself in aria-describedby, and closes on Escape and leaving", () => {
    render(
      <Tip content="No end date">
        <button type="button">Arrow</button>
      </Tip>,
    );
    const button = screen.getByRole("button", { name: "Arrow" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.mouseEnter(button);
    expect(document.getElementById(button.getAttribute("aria-describedby"))).toHaveTextContent("No end date");
    expect(screen.getByRole("tooltip")).toHaveTextContent("No end date");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(button);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.blur(button);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("toggles on a tap, and renders its child alone with no content", () => {
    const { container } = render(<InfoTip content="Absolute poverty: …" label="About children" />);
    const button = screen.getByRole("button", { name: "About children" });
    fireEvent.pointerDown(button, { pointerType: "touch" });
    expect(screen.getByRole("tooltip")).toHaveTextContent("Absolute poverty");
    fireEvent.pointerDown(button, { pointerType: "touch" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    render(<Tip content={null}><span className="bare">x</span></Tip>, { container });
    expect(container.querySelector(".bare").getAttribute("aria-describedby")).toBeNull();
  });

  it("shows no tip for a focus that follows a tap or click (the drawer's close button on a phone), but does after a key", () => {
    render(
      <Tip content="Close (Esc)">
        <button type="button">Close</button>
      </Tip>,
    );
    const button = screen.getByRole("button", { name: "Close" });
    fireEvent.pointerDown(document.body, { pointerType: "touch" });
    fireEvent.focus(button);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.blur(button);
    fireEvent.keyDown(document, { key: "Tab" });
    fireEvent.focus(button);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Close (Esc)");
  });
});

describe("Tip's layer", () => {
  it("sits above every layer it can be opened from (the sticky band and its pickers, the drawer)", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const src = join(fileURLToPath(import.meta.url), "..", "..");
    const zOf = (text, selector) => Number(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{[^}]*?z-index: (\\d+)`).exec(text)?.[1]);
    const tip = zOf(readFileSync(join(src, "components", "Tip.css"), "utf8"), ".tip");
    const others = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith(".css") && entry.name !== "Tip.css") {
          for (const [, z] of readFileSync(path, "utf8").matchAll(/z-index: (\d+)/g)) others.push(Number(z));
        }
      }
    };
    walk(src);
    expect(tip).toBeGreaterThan(Math.max(...others));
  });
});
