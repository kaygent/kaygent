import { Box, Text } from 'ink';
import { STAGE_IDS, type Board, type Stage } from '../board';
import { palette, stageUi } from '../theme';

interface StageTabsProps {
  board: Board;
  focusedStage: Stage;
}

export function StageTabs({ board, focusedStage }: StageTabsProps) {
  return (
    <Box height={1} paddingX={2} gap={1} backgroundColor={palette.background}>
      {STAGE_IDS.map((stage, index) => {
        const ui = stageUi[stage];
        const focused = stage === focusedStage;
        const count = board.columns[stage].length;

        return (
          <Box
            key={stage}
            flexGrow={1}
            justifyContent="center"
            height={1}
            backgroundColor={focused ? ui.color : palette.surface}
          >
            <Text
              bold={focused}
              color={focused ? palette.black : palette.dim}
            >
              {index + 1}{' '}
            </Text>
            <Text bold={focused} color={focused ? palette.black : ui.color}>
              {ui.glyph} {ui.shortLabel}
            </Text>
            <Text
              bold={focused}
              color={focused ? palette.black : palette.muted}
            >
              {' '}
              {count}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
