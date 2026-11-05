import { Box, Text } from 'ink';
import type { Notice, SaveState } from '../notice';
import { palette } from '../theme';

interface FooterProps {
  notice: Notice;
  saveState: SaveState;
  keyHints: string;
  columns: number;
}

const noticeColors = {
  info: palette.muted,
  success: palette.success,
  warning: palette.warning,
  error: palette.danger,
} as const;

const noticeGlyphs = {
  info: '·',
  success: '✓',
  warning: '!',
  error: '×',
} as const;

export function Footer({ notice, saveState, keyHints, columns }: FooterProps) {
  const saveColor =
    saveState === 'error'
      ? palette.danger
      : saveState === 'demo'
        ? palette.warning
        : palette.success;

  const saveLabel =
    saveState === 'error'
      ? columns >= 84
        ? 'save failed'
        : 'unsaved'
      : saveState === 'demo'
        ? 'demo'
        : columns >= 84
          ? 'autosaved'
          : 'saved';

  return (
    <Box
      flexDirection="column"
      height={3}
      paddingX={2}
      borderStyle="single"
      borderTop
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      borderTopColor={palette.border}
      backgroundColor={palette.background}
    >
      <Box height={1} justifyContent="space-between">
        <Box flexGrow={1} flexShrink={1}>
          <Text
            wrap="truncate-end"
            color={noticeColors[notice.tone]}
            bold={notice.tone === 'error'}
          >
            {noticeGlyphs[notice.tone]} {notice.text}
          </Text>
        </Box>
        <Box flexShrink={0} marginLeft={2}>
          <Text color={saveColor}>●</Text>
          <Text color={palette.dim}> {saveLabel}</Text>
        </Box>
      </Box>

      <Box height={1}>
        <Text wrap="truncate-end" color={palette.dim}>
          {keyHints}
        </Text>
      </Box>
    </Box>
  );
}
