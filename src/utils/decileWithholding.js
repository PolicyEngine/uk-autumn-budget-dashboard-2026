/** Whether a retained decile row has a withheld value. */
export const isWithheldDecileValue = (value) => value == null || (typeof value === "string" && value.trim() === "");
