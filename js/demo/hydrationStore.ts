/**
 * Module-level store shared by the Hydration screen and the widget
 * timeline renderer: widgets render in the same JS instance as the app,
 * so the latest value is read straight from here at publish time.
 */
export const hydrationStore = {
  glasses: 0,
  goal: 8,
};
