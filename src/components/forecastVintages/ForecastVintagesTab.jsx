// The OBR forecasts tab (?tab=forecasts): the forecast vintages view
// (ForecastVintagesView) as a view of its own, beside Living standards. The
// same view can instead be a sub-tab of the pre-measures forecast view, as
// ?sub=vintages beside its Baseline outlook and Forecast changes; then this
// tab goes and that view links to its own Forecast changes sub-tab.

import ForecastVintagesView from "./ForecastVintagesView";

export default function ForecastVintagesTab({ active = true, onShowTab }) {
  return (
    <ForecastVintagesView
      active={active}
      related={{
        href: "?tab=living&sub=forecast",
        label: "Living standards: Forecast changes",
        onShow: onShowTab && (() => onShowTab("living", "forecast")),
      }}
    />
  );
}
