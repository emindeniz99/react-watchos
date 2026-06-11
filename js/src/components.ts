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

export const VStack = "VStack" as unknown as FC<VStackProps>;
export const HStack = "HStack" as unknown as FC<HStackProps>;
export const Text = "Text" as unknown as FC<TextProps>;
export const Button = "Button" as unknown as FC<ButtonProps>;
export const Toggle = "Toggle" as unknown as FC<ToggleProps>;
export const Spacer = "Spacer" as unknown as FC<SpacerProps>;
export const Image = "Image" as unknown as FC<ImageProps>;
