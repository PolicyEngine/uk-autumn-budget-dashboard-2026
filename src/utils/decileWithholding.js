export const WITHHELD_DECILE_MESSAGE = "Not published: fewer than 3 survey households";

/** Whether a retained decile row has a withheld value. */
export const isWithheldDecileValue = (value) => value == null || (typeof value === "string" && value.trim() === "");
