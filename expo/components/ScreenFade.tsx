import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleProp, ViewStyle } from "react-native";

type ScreenFadeProps = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /**
   * Optional value that re-triggers the fade when it changes while the screen
   * stays mounted (e.g. switching to another video on the same route).
   */
  trigger?: string | number;
};

/**
 * Wraps a screen and plays a fade-in with a subtle upward rise on mount.
 * Re-triggers when `trigger` changes (e.g. switching videos on the same route).
 */
export default function ScreenFade({ children, style, trigger }: ScreenFadeProps) {
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    fade.setValue(0);
    const animation = Animated.timing(fade, {
      toValue: 1,
      duration: 450,
      easing: Easing.bezier(0.4, 0.0, 0.2, 1),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: fade,
          transform: [
            {
              translateY: fade.interpolate({
                inputRange: [0, 1],
                outputRange: [14, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
