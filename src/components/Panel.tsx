import { Box } from 'ink';
import type { ReactNode } from 'react';
import { palette } from '../theme';

interface PanelProps {
  width: number;
  borderColor?: string;
  children: ReactNode;
}

export function Panel({
  width,
  borderColor = palette.accent,
  children,
}: PanelProps) {
  return (
    <Box
      width={width}
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor}
      paddingX={2}
      paddingY={1}
      backgroundColor={palette.surface}
    >
      {children}
    </Box>
  );
}

export function panelInnerWidth(width: number): number {
  return Math.max(8, width - 6);
}
