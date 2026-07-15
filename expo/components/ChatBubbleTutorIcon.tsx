import React from "react";
import Svg, { Path, Rect } from "react-native-svg";

import Colors from "@/constants/colors";

/**
 * Custom filled chat-bubble icon used for the tutor CTA buttons.
 * The bubble body is rendered in `color` (white by default) and the two
 * internal lines are rendered in `backgroundColor` so they appear as cut-outs
 * against the purple button background.
 *
 * Shape matches the supplied image: a rounded rectangle with a triangular
 * tail at the bottom-left, a long rounded line at the top and a shorter one
 * near the bottom.
 */
export function ChatBubbleTutorIcon({
  size = 26,
  color = "#FFFFFF",
  backgroundColor = Colors.light.purple,
}: {
  size?: number;
  color?: string;
  backgroundColor?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {/* Filled bubble body with rounded corners and a tail. */}
      <Path
        d="M3 18.3 L4.7 17 L19.25 17 C20.77 17 22 15.77 22 14.25 L22 6.75 C22 5.23 20.77 4 19.25 4 L6.75 4 C5.23 4 4 5.23 4 6.75 L4 18.3 Z"
        fill={color}
      />
      {/* Upper long rounded line. */}
      <Rect x="7" y="8.25" width="11.5" height="2.2" rx="1.1" fill={backgroundColor} />
      {/* Lower short rounded line. */}
      <Rect x="7" y="13.05" width="6.5" height="2.2" rx="1.1" fill={backgroundColor} />
    </Svg>
  );
}
