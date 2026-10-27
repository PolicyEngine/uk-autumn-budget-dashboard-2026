import { useState } from "react";
import ControlBar from "./ControlBar";
import WaterfallChart from "./WaterfallChart";
import DistributionalChart from "./DistributionalChart";
import { METHOD_ANCHORS } from "./methodology/anchors";

// The address keeps the choice when it is not the default (?decile=relative)
const PARAM = "decile";
const VIEWS = [
  { value: "absolute", label: "£ per household (absolute)", summary: "£ per household" },
  { value: "relative", label: "% of net income (relative)", summary: "% of net income" },
];

// About this chart for both views, each fact once (the two cards' own
// were WaterfallChart's ABSOLUTE_INFO and DistributionalChart's RELATIVE_INFO)
export const DECILE_INFO = {
  how: [
    "Each bar stacks the selected policies' own effects; the line marks their total.",
    "As a % of net income: the decile's total change over its total net income, so larger incomes weigh more than in an average of percentages.",
  ],
  method: { anchor: METHOD_ANCHORS.byIncome, label: "How we group households by income" },
};

function readView() {
  if (typeof window === "undefined") return "absolute";
  return new URLSearchParams(window.location.search).get(PARAM) === "relative" ? "relative" : "absolute";
}

function writeView(value) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (value === "relative") params.set(PARAM, value);
  else params.delete(PARAM);
  const search = params.toString();
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`);
}

/**
 * Impact by income decile: one card, the change shown in £ per household
 * (WaterfallChart) or as a % of net income (DistributionalChart), chosen in
 * its Options. The title, sentence, axis, download and tooltips follow the
 * choice; About this chart covers both.
 */
export default function DecileImpactCard({ winnersLosers, distributional, selectedPolicies, selectedYear }) {
  const [view, setView] = useState(readView);
  const controls = (
    <ControlBar
      name="Impact by income decile"
      options={[
        {
          label: "Show the change as",
          value: view,
          onChange: (value) => {
            setView(value);
            writeView(value);
          },
          options: VIEWS,
        },
      ]}
    />
  );
  const shared = { selectedPolicies, selectedYear, title: "Impact by income decile", controls, info: DECILE_INFO };
  return view === "relative" ? (
    <DistributionalChart rawData={distributional} {...shared} />
  ) : (
    <WaterfallChart rawData={winnersLosers} {...shared} />
  );
}
