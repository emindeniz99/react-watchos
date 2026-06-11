import type { FC, ReactNode } from "react";

/**
 * Host components. Each renders to a SwiftUI view of the same name in
 * NodeView.swift. The string is the host-component type; the cast gives
 * JSX full prop type-checking.
 */

type TextContent = string | number | Array<string | number>;

export interface VStackProps {
  spacing?: number;
  children?: ReactNode;
}

export interface HStackProps {
  spacing?: number;
  children?: ReactNode;
}

export interface TextProps {
  /** Text children must be strings/numbers; nested elements are not supported. */
  children?: TextContent;
  bold?: boolean;
  size?: number;
  /** SwiftUI system color name, e.g. "green", "secondary". */
  color?: string;
}

export interface ButtonProps {
  onPress?: () => void;
  children?: ReactNode;
}

export interface ToggleProps {
  value?: boolean;
  onChange?: (value: boolean) => void;
  label?: string;
}

export interface SpacerProps {}

export interface ImageProps {
  /** SF Symbol name, e.g. "heart.fill". */
  systemName: string;
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

export interface GaugeProps {
  value: number;
  min?: number;
  max?: number;
  label?: string;
  /** "circular" | "linear"; widgets pick accessory styles by family. */
  style?: string;
  color?: string;
}

export interface ProgressViewProps {
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

export interface TextFieldProps {
  value?: string;
  placeholder?: string;
  /** Fired on input commit (watchOS input is modal: dictation/scribble/QWERTY). */
  onChange?: (value: string) => void;
}

export interface PickerProps {
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
