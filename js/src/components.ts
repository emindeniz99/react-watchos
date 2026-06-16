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

export interface VStackProps extends A11yProps {
  spacing?: number;
  children?: ReactNode;
}

export interface HStackProps extends A11yProps {
  spacing?: number;
  children?: ReactNode;
}

export interface TextProps extends A11yProps {
  /** Text children must be strings/numbers; nested elements are not supported. */
  children?: TextContent;
  bold?: boolean;
  size?: number;
  /** SwiftUI system color name, e.g. "green", "secondary". */
  color?: string;
}

export interface ButtonProps extends A11yProps {
  onPress?: () => void;
  children?: ReactNode;
}

export interface ToggleProps extends A11yProps {
  value?: boolean;
  onChange?: (value: boolean) => void;
  label?: string;
}

export interface SpacerProps {}

export interface ImageProps extends A11yProps {
  /** SF Symbol name — vector icons (tiny, themeable). */
  systemName?: string;
  /** Remote image URL — native loads & caches (best for photos/posters). */
  source?: string;
  /** Base64 PNG/JPEG for small inline bitmaps (bloats the tree — avoid for large). */
  data?: string;
  color?: string;
  size?: number;
}

export interface ZStackProps {
  children?: ReactNode;
}

export interface ScrollViewProps {
  children?: ReactNode;
}

export interface ListProps {
  children?: ReactNode;
}

export interface DividerProps {}

export interface GaugeProps extends A11yProps {
  value: number;
  min?: number;
  max?: number;
  label?: string;
  /** "circular" | "linear"; widgets pick accessory styles by family. */
  style?: string;
  color?: string;
}

export interface ProgressViewProps extends A11yProps {
  /** Fraction 0...1 when total omitted, else value out of total. */
  value?: number;
  total?: number;
  label?: string;
}

export interface NavigationStackProps {
  title?: string;
  children?: ReactNode;
}

export interface NavigationLinkProps {
  /** Link label; children are the destination screen. */
  title: string;
  children?: ReactNode;
}

export interface TextFieldProps extends A11yProps {
  value?: string;
  placeholder?: string;
  /** Fired on input commit (watchOS input is modal: dictation/scribble/QWERTY). */
  onChange?: (value: string) => void;
}

export interface PickerProps extends A11yProps {
  label?: string;
  options: string[];
  /** Selected index into options. */
  value?: number;
  onChange?: (index: number) => void;
}

export interface TabViewProps {
  /** Each child is one page. */
  children?: ReactNode;
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
export interface TimerTextProps extends A11yProps {
  /** Count up from this epoch-ms start (elapsed time). */
  since?: number;
  /** Count down to this epoch-ms deadline. Takes precedence over `since`. */
  until?: number;
  bold?: boolean;
  size?: number;
  color?: string;
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
export const NavigationStack =
  "NavigationStack" as unknown as FC<NavigationStackProps>;
export const NavigationLink =
  "NavigationLink" as unknown as FC<NavigationLinkProps>;
export const TextField = "TextField" as unknown as FC<TextFieldProps>;
export const Picker = "Picker" as unknown as FC<PickerProps>;
export const TabView = "TabView" as unknown as FC<TabViewProps>;
export const TimerText = "TimerText" as unknown as FC<TimerTextProps>;
export const CrownRotation =
  "CrownRotation" as unknown as FC<CrownRotationProps>;
