import type { FC, ReactNode } from "react";

/**
 * Host components. Each renders to a SwiftUI view of the same name in
 * NodeView.swift. The string is the host-component type; the cast gives
 * JSX full prop type-checking.
 */

type TextContent = string | number | Array<string | number>;

/**
 * VoiceOver metadata supported by every primitive (applied as SwiftUI
 * .accessibilityLabel/.accessibilityHint in NodeView). Watch users rely
 * on VoiceOver, so author labels for icon-only or composite controls.
 */
export interface A11yProps {
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

/**
 * Layout/appearance modifiers every visual primitive supports (design-system
 * Tier 1). Values map 1:1 to SwiftUI modifiers and are applied in this fixed
 * order: padding → background+cornerRadius → frame → opacity → tint. Colors
 * take the same values as `color` (system name or #RRGGBB[AA] hex).
 */
export interface ModifierProps {
  /** Points on all edges, or per axis: `padding={{horizontal: 8, vertical: 2}}`. */
  padding?: number | { horizontal?: number; vertical?: number };
  /** Fixed and/or max dimensions; `"infinity"` = SwiftUI's fill idiom. */
  frame?: {
    width?: number;
    height?: number;
    maxWidth?: number | "infinity";
    maxHeight?: number | "infinity";
  };
  /** Fill color behind the content (rounded when cornerRadius is set). */
  background?: string;
  /** Rounds the background — or clips the content when there is none. */
  cornerRadius?: number;
  /** 0 (invisible) … 1 (opaque). */
  opacity?: number;
  /** Accent color for this subtree's controls (SwiftUI .tint). */
  tint?: string;
  /**
   * Animate this node's committed changes (SwiftUI `.animation(_:value:)`):
   * any prop or subtree change transitions with the given curve instead of
   * snapping. `duration` in seconds (omit for the curve's default). App
   * only — widgets are static snapshots and ignore it.
   */
  animation?: {
    kind: "spring" | "ease" | "easeIn" | "easeOut" | "linear";
    duration?: number;
  };
}

/**
 * Gestures any view can opt into (applied in NodeView like a11y). onSwipe
 * gets a direction. Avoid onSwipe on scroll containers — it competes with
 * scrolling and the system swipe-back.
 */
export interface GestureProps {
  onLongPress?: () => void;
  onSwipe?: (direction: "left" | "right" | "up" | "down") => void;
  /** Streamed drag translation (quantized to throttle the bridge) — for scrubbing. */
  onDrag?: (translation: { x: number; y: number }) => void;
  /** Make this view Crown/focus-addressable (watchOS focus traversal). */
  focusable?: boolean;
  /** Apply the watchOS 26 Liquid Glass effect (no-op on older OSes). */
  glass?: boolean;
}

/**
 * Swipe actions (SwiftUI `.swipeActions`), the watchOS-idiomatic way to act on
 * a row. Only meaningful on a row inside a `<List>`; unlike a raw `onSwipe`
 * gesture they don't fight the scroll view, and a full ("long") swipe triggers
 * the action without tapping its button. The `*Label` presence enables each
 * edge independently:
 *  - trailing (right-to-left): `swipeActionLabel` / `onSwipeAction`
 *  - leading (left-to-right): `leadingSwipeActionLabel` / `onLeadingSwipeAction`
 */
export interface SwipeActionProps {
  swipeActionLabel?: string;
  swipeActionSystemImage?: string;
  swipeActionTint?: string;
  onSwipeAction?: () => void;
  leadingSwipeActionLabel?: string;
  leadingSwipeActionSystemImage?: string;
  leadingSwipeActionTint?: string;
  onLeadingSwipeAction?: () => void;
}

export interface VStackProps extends A11yProps, GestureProps, ModifierProps {
  spacing?: number;
  /** Horizontal alignment of children (SwiftUI VStack(alignment:)). */
  alignment?: "leading" | "center" | "trailing";
  children?: ReactNode;
}

export interface HStackProps extends A11yProps, GestureProps, ModifierProps {
  spacing?: number;
  /** Vertical alignment of children (SwiftUI HStack(alignment:)). */
  alignment?: "top" | "center" | "bottom" | "firstTextBaseline";
  children?: ReactNode;
}

export interface TextProps extends A11yProps, ModifierProps {
  /**
   * Strings/numbers fold into one label; nested <Text> elements make RICH
   * text — segments concatenate into a single native Text, each styled
   * independently (`Bold <Text bold>this</Text>`). Only <Text> children are
   * meaningful; other elements are ignored by the interpreter.
   */
  children?: TextContent | ReactNode;
  bold?: boolean;
  /** Fixed point size. Prefer `textStyle` so text scales with Dynamic Type. */
  size?: number;
  /** Semantic font that scales with the user's Dynamic Type setting. */
  textStyle?:
    | "largeTitle"
    | "title"
    | "title2"
    | "title3"
    | "headline"
    | "body"
    | "callout"
    | "subheadline"
    | "footnote"
    | "caption";
  /** SwiftUI system color name ("green", "secondary") or "#RRGGBB"/"#RRGGBBAA". */
  color?: string;
  /** Use fixed-width digits for counters/timers to avoid layout jitter. */
  monospacedDigit?: boolean;
}

export interface ButtonProps
  extends A11yProps,
    GestureProps,
    SwipeActionProps,
    ModifierProps {
  onPress?: () => void;
  /** Bind this button to the Apple Watch double-tap gesture (watchOS 11+). */
  primaryAction?: boolean;
  /**
   * Makes this button interactive **inside a widget/complication** (watchOS
   * 11+): a tap runs the `registerIntent(name, …)` handler in the widget
   * extension (no app launch), which mutates Storage and reloads the timeline —
   * the same mechanism a Control uses. `onPress` is for the in-app UI and is
   * ignored in a widget; `intent` is for a widget and is ignored in the app. On
   * watchOS 10 a widget button falls back to its (non-interactive) content.
   */
  intent?: string;
  /**
   * Liquid Glass button styles (watchOS 26+; silently the default style on
   * older watches). "glassProminent" is the accented/filled variant.
   */
  buttonStyle?: "glass" | "glassProminent";
  children?: ReactNode;
}

export interface ToggleProps extends A11yProps, ModifierProps {
  value?: boolean;
  onChange?: (value: boolean) => void;
  label?: string;
}

export interface SpacerProps extends A11yProps, ModifierProps {}

export interface ImageProps extends A11yProps, ModifierProps {
  /** SF Symbol name — vector icons (tiny, themeable). */
  systemName?: string;
  /** Remote image URL — native loads & caches (best for photos/posters). */
  source?: string;
  /** Base64 PNG/JPEG for small inline bitmaps (bloats the tree — avoid for large). */
  data?: string;
  color?: string;
  size?: number;
}

export interface ZStackProps extends A11yProps, ModifierProps {
  /** Anchor for stacked children (SwiftUI ZStack(alignment:)). */
  alignment?:
    | "topLeading"
    | "top"
    | "topTrailing"
    | "leading"
    | "center"
    | "trailing"
    | "bottomLeading"
    | "bottom"
    | "bottomTrailing";
  children?: ReactNode;
}

export interface ScrollViewProps extends A11yProps, ModifierProps {
  children?: ReactNode;
}

export interface ListProps extends A11yProps, ModifierProps {
  children?: ReactNode;
}

export interface DividerProps extends A11yProps, ModifierProps {}

export interface GaugeProps extends A11yProps, ModifierProps {
  value: number;
  min?: number;
  max?: number;
  label?: string;
  /** "circular" | "linear"; widgets pick accessory styles by family. */
  style?: string;
  color?: string;
}

export interface ProgressViewProps extends A11yProps, ModifierProps {
  /** Fraction 0...1 when total omitted, else value out of total. */
  value?: number;
  total?: number;
  label?: string;
}

export interface NavigationStackProps extends A11yProps {
  title?: string;
  /**
   * Controlled native stack path. Root is represented by [] and pushed
   * routes are stable path strings such as ["/hydration"].
   */
  path?: string[];
  /** Fired when native back/link gestures mutate the NavigationStack path. */
  onPathChange?: (path: string[]) => void;
  children?: ReactNode;
}

export type NavigationLinkProps = A11yProps &
  (
    | {
        /** Stable route target declared by a matching NavigationRoute. */
        to: string;
        /** Simple text label. Use children for a custom row/chip layout. */
        label: string;
        children?: never;
      }
    | {
        /** Stable route target declared by a matching NavigationRoute. */
        to: string;
        /** Simple text label. Use children for a custom row/chip layout. */
        label?: string;
        children: ReactNode;
      }
  );

export interface NavigationRouteProps extends A11yProps {
  /** Stable path for links, deep links, notifications, and tests. */
  path: string;
  /** Native navigation title when this route is displayed. */
  title?: string;
  children?: ReactNode;
}

export interface TextFieldProps extends A11yProps, ModifierProps {
  value?: string;
  placeholder?: string;
  /** Fired on input commit (watchOS input is modal: dictation/scribble/QWERTY). */
  onChange?: (value: string) => void;
}

export interface PickerProps extends A11yProps, ModifierProps {
  label?: string;
  options: string[];
  /** Selected index into options. */
  value?: number;
  onChange?: (index: number) => void;
}

export interface TabViewProps extends A11yProps {
  /** Each child is one page. */
  children?: ReactNode;
  /**
   * Controlled selected page index (0-based). When set, the native TabView
   * binds to it optimistically (a swipe holds until React acks) — keep it in
   * state and update it from `onChange`, or the page snaps back. Omit both
   * for the uncontrolled TabView.
   */
  selection?: number;
  /** Fires with the new page index as the user swipes between pages. */
  onChange?: (index: number) => void;
}

/** A draggable value slider (also Crown-adjustable when focused). */
export interface SliderProps extends A11yProps, ModifierProps {
  value: number;
  from?: number;
  through?: number;
  step?: number;
  onChange?: (value: number) => void;
}

/** Numeric +/- stepper. */
export interface StepperProps extends A11yProps, ModifierProps {
  value: number;
  from?: number;
  through?: number;
  step?: number;
  label?: string;
  onChange?: (value: number) => void;
}

export interface MapAnnotation {
  lat: number;
  lon: number;
  title?: string;
  /** SF Symbol for the marker. */
  systemImage?: string;
  tint?: string;
}

/** A MapKit map (watchOS 26): a region with markers and an optional route. */
export interface MapProps extends A11yProps, ModifierProps {
  /** Region center + span (degrees). Defaults to fit the annotations. */
  latitude?: number;
  longitude?: number;
  span?: number;
  annotations?: MapAnnotation[];
  /** Polyline route as lat/lon points. */
  route?: Array<{ lat: number; lon: number }>;
  height?: number;
}

/** Date/time picker. value and onChange are epoch milliseconds. */
export interface DatePickerProps extends A11yProps, ModifierProps {
  value: number;
  label?: string;
  /** "date" | "hourAndMinute" | "dateAndTime" (default). */
  mode?: "date" | "hourAndMinute" | "dateAndTime";
  onChange?: (value: number) => void;
}

/**
 * Binds the Digital Crown to a numeric value over its children (SwiftUI
 * `digitalCrownRotation`). The wrapped view becomes crown-focusable;
 * rotating the Crown fires `onChange` with the new value. Use for volume,
 * zoom, scrubbing — anything the Crown should drive directly (vs. the
 * Crown's implicit role inside Picker/ScrollView).
 */
export interface CrownRotationProps extends A11yProps {
  value: number;
  /** Range lower bound (default 0). */
  from?: number;
  /** Range upper bound (default 100). */
  through?: number;
  /** Detent size (default 1). */
  step?: number;
  /** Crown haptic detents (default true). */
  haptic?: boolean;
  onChange?: (value: number) => void;
  children?: ReactNode;
}

/**
 * A self-ticking time label. React renders this ONCE with a start/end
 * timestamp and SwiftUI animates the digits natively (Text(timerInterval:)),
 * so a stopwatch/countdown costs zero per-frame JS. For a paused/stopped
 * value, render a plain <Text> with the frozen string instead.
 */
export interface TimerTextProps extends A11yProps, ModifierProps {
  /** Count up from this epoch-ms start (elapsed time). */
  since?: number;
  /** Count down to this epoch-ms deadline. Takes precedence over `since`. */
  until?: number;
  /** Show mm:ss.SSS using native SwiftUI ticking instead of JS intervals.
   *  Watch-only: in a widget this degrades to the seconds timer (WidgetKit
   *  can't live-tick sub-second). */
  milliseconds?: boolean;
  bold?: boolean;
  size?: number;
  color?: string;
}

/** An action inside <Alert> / <ConfirmationDialog>. The system dismisses the
 *  presentation automatically when an action is tapped; `onPress` fires for
 *  the tapped action and the presentation's `onChange(false)` fires too. */
export interface AlertActionProps extends A11yProps {
  label: string;
  /** "destructive" renders red; "cancel" gets the cancel slot/placement. */
  role?: "destructive" | "cancel";
  onPress?: () => void;
}

/**
 * System alert (SwiftUI `.alert`), React-controlled like Toggle: you present
 * it with `presented`, the system dismisses it (action tap), and
 * `onChange(false)` tells React to drop its state. Children must be
 * <AlertAction> elements; with none, the system adds a default OK.
 */
export interface AlertProps {
  presented?: boolean;
  title: string;
  message?: string;
  /**
   * REQUIRED for the alert to actually present: without it React could never
   * observe the system's dismissal and the seq-ack would re-present forever,
   * so a handler-less presentation stays hidden (the controlled-input rule).
   */
  onChange?: (presented: boolean) => void;
  children?: ReactNode;
}

/** Action-sheet-style dialog (SwiftUI `.confirmationDialog`); same controlled
 *  contract as <Alert>, children are <AlertAction> elements. */
export interface ConfirmationDialogProps {
  presented?: boolean;
  title: string;
  onChange?: (presented: boolean) => void;
  children?: ReactNode;
}

/**
 * Modal sheet (SwiftUI `.sheet`; effectively full-screen on watchOS).
 * Controlled like <Alert>: present with `presented`, the user's swipe-down /
 * system dismissal fires `onChange(false)`. Children are the sheet content.
 */
export interface SheetProps {
  presented?: boolean;
  onChange?: (presented: boolean) => void;
  children?: ReactNode;
}

/** Grouped rows with an optional header/footer — meaningful inside <List>
 *  (SwiftUI `Section`). */
export interface SectionProps extends A11yProps, ModifierProps {
  header?: string;
  footer?: string;
  children?: ReactNode;
}

/** Icon + text as one primitive (SwiftUI `Label(_:systemImage:)`). */
export interface LabelProps extends A11yProps, ModifierProps {
  label: string;
  /** SF Symbol name. */
  systemName: string;
  color?: string;
}

/** Aligned rows/columns (SwiftUI `Grid`); children must be <GridRow>. */
export interface GridProps extends A11yProps, ModifierProps {
  horizontalSpacing?: number;
  verticalSpacing?: number;
  children?: ReactNode;
}

/** One row of a <Grid>; each child is a cell. */
export interface GridRowProps extends A11yProps {
  children?: ReactNode;
}

/** System share sheet (SwiftUI `ShareLink`). Children are the custom
 *  tappable label; omit them for the system's default share label. */
export interface ShareLinkProps extends A11yProps, ModifierProps {
  /** The text or URL to share. */
  item: string;
  children?: ReactNode;
}

/** One <Chart> data point: `y` is required; `x` is a numeric position or a
 *  category label (strings chart as discrete categories). Omit `x` to plot
 *  by array index. */
export interface ChartPoint {
  x?: number | string;
  y: number;
}

/** Swift Charts (watchOS 9+), minimal declarative form: one mark type over
 *  one series. For dashboards-on-the-wrist, not full Charts composition. */
export interface ChartProps extends A11yProps, ModifierProps {
  type: "line" | "bar" | "area" | "point";
  points: ChartPoint[];
  /** Series color (system name or hex); defaults to the accent. */
  color?: string;
}

/** A label:value row (SwiftUI `LabeledContent`); children are the value
 *  view, or pass the simple `value` string. */
export interface LabeledContentProps extends A11yProps, ModifierProps {
  label: string;
  value?: string;
  children?: ReactNode;
}

/** Standard empty-state placeholder (SwiftUI `ContentUnavailableView`). */
export interface ContentUnavailableProps extends A11yProps, ModifierProps {
  title: string;
  /** SF Symbol name. */
  systemName: string;
  description?: string;
}

/** Screen toolbar (SwiftUI `.toolbar`); children must be <ToolbarItem>.
 *  Place it anywhere inside the screen's content. */
export interface ToolbarProps {
  children?: ReactNode;
}

/** One toolbar slot; the child is its content (usually a <Button>). */
export interface ToolbarItemProps {
  placement: "topBarLeading" | "topBarTrailing" | "bottomBar";
  children?: ReactNode;
}

export const VStack = "VStack" as unknown as FC<VStackProps>;
export const HStack = "HStack" as unknown as FC<HStackProps>;
export const Text = "Text" as unknown as FC<TextProps>;
export const Button = "Button" as unknown as FC<ButtonProps>;
export const Toggle = "Toggle" as unknown as FC<ToggleProps>;
export const Spacer = "Spacer" as unknown as FC<SpacerProps>;
export const Image = "Image" as unknown as FC<ImageProps>;
export const ZStack = "ZStack" as unknown as FC<ZStackProps>;
export const ScrollView = "ScrollView" as unknown as FC<ScrollViewProps>;
export const List = "List" as unknown as FC<ListProps>;
export const Divider = "Divider" as unknown as FC<DividerProps>;
export const Gauge = "Gauge" as unknown as FC<GaugeProps>;
export const ProgressView = "ProgressView" as unknown as FC<ProgressViewProps>;
export const NavigationLink =
  "NavigationLink" as unknown as FC<NavigationLinkProps>;
// NavigationStack and NavigationRoute are function components (they expose
// route params via useParams); see ./navigation.
export const TextField = "TextField" as unknown as FC<TextFieldProps>;
export const Picker = "Picker" as unknown as FC<PickerProps>;
export const TabView = "TabView" as unknown as FC<TabViewProps>;
export const TimerText = "TimerText" as unknown as FC<TimerTextProps>;
export const CrownRotation =
  "CrownRotation" as unknown as FC<CrownRotationProps>;
export const Slider = "Slider" as unknown as FC<SliderProps>;
export const Stepper = "Stepper" as unknown as FC<StepperProps>;
export const DatePicker = "DatePicker" as unknown as FC<DatePickerProps>;
// Exported as MapView to avoid shadowing the global `Map`; node type "Map".
export const MapView = "Map" as unknown as FC<MapProps>;
export const Alert = "Alert" as unknown as FC<AlertProps>;
export const AlertAction = "AlertAction" as unknown as FC<AlertActionProps>;
export const ConfirmationDialog =
  "ConfirmationDialog" as unknown as FC<ConfirmationDialogProps>;
export const Sheet = "Sheet" as unknown as FC<SheetProps>;
export const Section = "Section" as unknown as FC<SectionProps>;
export const Label = "Label" as unknown as FC<LabelProps>;
export const Grid = "Grid" as unknown as FC<GridProps>;
export const GridRow = "GridRow" as unknown as FC<GridRowProps>;
export const ShareLink = "ShareLink" as unknown as FC<ShareLinkProps>;
export const Chart = "Chart" as unknown as FC<ChartProps>;
export const LabeledContent =
  "LabeledContent" as unknown as FC<LabeledContentProps>;
export const ContentUnavailable =
  "ContentUnavailable" as unknown as FC<ContentUnavailableProps>;
export const Toolbar = "Toolbar" as unknown as FC<ToolbarProps>;
export const ToolbarItem = "ToolbarItem" as unknown as FC<ToolbarItemProps>;
