import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import UpdateToast, { UPDATE_TOAST_TEXT } from "./UpdateToast";

afterEach(() => vi.useRealTimers());

describe("the update toast", () => {
  it("shows nothing until the figures are updated", () => {
    render(<UpdateToast show={false} />);
    expect(screen.queryByText(UPDATE_TOAST_TEXT)).toBeNull();
  });

  it("announces the update politely and goes after about four seconds", () => {
    vi.useFakeTimers();
    const { container } = render(<UpdateToast show />);
    expect(screen.getByText(UPDATE_TOAST_TEXT)).toBeInTheDocument();
    expect(container.querySelector("[aria-live='polite']")).not.toBeNull();
    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.queryByText(UPDATE_TOAST_TEXT)).toBeNull();
  });

  it("can be dismissed", () => {
    render(<UpdateToast show />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(UPDATE_TOAST_TEXT)).toBeNull();
  });

  it("shows once per session, however often the figures change", () => {
    const first = render(<UpdateToast show />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    first.unmount();
    // The page remounts its views on each newer snapshot
    render(<UpdateToast show />);
    expect(screen.queryByText(UPDATE_TOAST_TEXT)).toBeNull();
  });

  it("is never a full-width bar on the page", () => {
    render(<UpdateToast show />);
    expect(screen.queryByText(/Newer results were published/)).toBeNull();
  });
});
