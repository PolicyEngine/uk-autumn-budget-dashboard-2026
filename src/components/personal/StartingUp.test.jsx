// What the reader sees while a cold calculator starts up, and if it never
// does: calm words, never an empty card.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SingleYearError, SingleYearHeadline, STARTING_UP_TEXT, STARTING_UP_TITLE, STILL_STARTING_TITLE } from "./SingleYearResults";
import { HouseholdApiError } from "../../utils/householdImpactApi";

afterEach(cleanup);

const loading = { status: "loading", data: null, error: null, stale: false, detailStatus: "loading", detailError: null, retry: () => {} };

describe("the starting-up state", () => {
  it("says the calculator is starting up, at once, while the hook asks again", () => {
    render(<SingleYearHeadline result={{ ...loading, startingUp: true }} year={2029} startedAt={Date.now()} />);
    const panel = screen.getByRole("status");
    expect(panel).toHaveTextContent(STARTING_UP_TITLE);
    expect(panel).toHaveTextContent(STARTING_UP_TEXT);
    expect(panel).toHaveAttribute("data-starting-up", "true");
  });

  it("says nothing of starting up on an ordinary calculation", () => {
    const { container } = render(<SingleYearHeadline result={{ ...loading, startingUp: false }} year={2029} startedAt={Date.now()} />);
    expect(container).not.toHaveTextContent(STARTING_UP_TITLE);
  });

  it("ends calmly, with Try again, when the service never answered", () => {
    const retry = vi.fn();
    const error = new HouseholdApiError("server", "The calculation service sent an answer this page cannot read.", { status: 200, empty: true });
    render(<SingleYearError error={error} onRetry={retry} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(STILL_STARTING_TITLE);
    expect(alert).not.toHaveTextContent("cannot read");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("keeps the API's own words for an answer it refused", () => {
    const error = new HouseholdApiError("invalid", "Some answers are outside what the calculation accepts.", { status: 422 });
    render(<SingleYearError error={error} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Some answers are outside");
    expect(screen.getByRole("alert")).not.toHaveTextContent(STILL_STARTING_TITLE);
  });
});
