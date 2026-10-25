import { chartMargin } from "../../utils/chartTheme";

/**
 * Every chart in the Young people section has the same room above the plot
 * and the same x-axis height (ticks, then the axis title), so in two cards
 * side by side the plots, x axes and axis titles line up. Legends and logos
 * sit in the card's own rows below the plot (see .charts-grid in
 * globals.css), so a longer legend in one card never moves the other's plot.
 */
export const PLOT_TOP = 16;
export const X_AXIS_HEIGHT = 44;

/** The plot's margins: PLOT_TOP above, room below for the axis title's descenders. */
export const plotMargin = (narrow, extra = {}) => ({
  ...chartMargin(narrow, { top: PLOT_TOP }),
  bottom: 6,
  ...extra,
});
