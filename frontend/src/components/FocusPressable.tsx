import React, { forwardRef, useState } from "react";
import { Pressable, type PressableProps, type View } from "react-native";

/**
 * Pressable whose style/children callbacks also receive `focused`.
 *
 * React Native only passes `focused` to those callbacks on web and tvOS; on Android TV
 * it is always undefined, so `({ focused }) => ...` focus rings never show up under a
 * remote. This tracks focus itself and hands it to the callbacks on every platform.
 */
export const FocusPressable = forwardRef<View, PressableProps>(function FocusPressable(
  { style, children, onFocus, onBlur, ...props },
  ref,
) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      ref={ref}
      focusable
      {...props}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      style={typeof style === "function" ? (state) => style({ ...state, focused } as any) : style}
    >
      {typeof children === "function" ? (state) => children({ ...state, focused } as any) : children}
    </Pressable>
  );
});
