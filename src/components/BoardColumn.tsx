import { Box, Text } from 'ink';
import type { Stage, Task } from '../board';
import { getCardWindow } from '../layout';
import { palette, stageUi } from '../theme';
import { TaskCard } from './TaskCard';

interface BoardColumnProps {
  stage: Stage;
  tasks: Task[];
  selectedIndex: number;
  focused: boolean;
  contentHeight: number;
  cardAreaHeight: number;
}

export function BoardColumn({
  stage,
  tasks,
  selectedIndex,
  focused,
  contentHeight,
  cardAreaHeight,
}: BoardColumnProps) {
  const ui = stageUi[stage];
  const window = getCardWindow(tasks.length, selectedIndex, cardAreaHeight);
  const visibleTasks = tasks.slice(
    window.start,
    window.start + window.visibleCount,
  );
  const above = window.start;
  const below = tasks.length - window.start - visibleTasks.length;
  const overflowParts: string[] = [];

  if (above > 0) {
    overflowParts.push(`↑${above}`);
  }
  if (below > 0) {
    overflowParts.push(`↓${below}`);
  }

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      flexBasis={0}
      height={contentHeight + 3}
      borderStyle="round"
      borderColor={focused ? ui.color : palette.border}
      backgroundColor={palette.surface}
      overflow="hidden"
    >
      <Box
        height={1}
        paddingX={1}
        justifyContent="space-between"
        alignItems="center"
        backgroundColor={focused ? ui.color : undefined}
      >
        <Text bold color={focused ? palette.black : ui.color}>
          {ui.glyph} {ui.label}
        </Text>
        <Text bold color={focused ? palette.black : palette.dim}>
          {tasks.length}
        </Text>
      </Box>

      <Box
        flexDirection="column"
        height={cardAreaHeight}
        overflow="hidden"
        flexShrink={0}
      >
        {visibleTasks.length === 0 ? (
          <Box flexDirection="column" paddingX={1} paddingTop={1}>
            <Text color={ui.color} dimColor={!focused}>
              {ui.emptyTitle}
            </Text>
            <Text color={palette.dim} wrap="truncate-end">
              {ui.emptyHint}
            </Text>
          </Box>
        ) : (
          <>
            <Box flexDirection="column">
              {visibleTasks.map((task, index) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  stageColor={ui.color}
                  highlighted={focused && window.start + index === selectedIndex}
                  completed={stage === 'completed'}
                  marginBottom={index === visibleTasks.length - 1 ? 0 : 1}
                />
              ))}
            </Box>

            <Box flexGrow={1} />

            {window.showOverflow ? (
              <Box height={1} paddingX={1}>
                <Text color={palette.dim} wrap="truncate-end">
                  {overflowParts.join('  ')} more
                </Text>
              </Box>
            ) : null}
          </>
        )}
      </Box>
    </Box>
  );
}
