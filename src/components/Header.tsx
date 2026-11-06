import { Box, Text } from 'ink';
import { useMemo } from 'react';
import { formatHeaderDate } from '../text-utils';
import { palette } from '../theme';

interface HeaderProps {
  columns: number;
  openCount: number;
  doneCount: number;
  totalCount: number;
}

export function Header({ columns, openCount, doneCount, totalCount }: HeaderProps) {
  const date = useMemo(() => formatHeaderDate(), []);

  return (
    <Box
      height={2}
      paddingX={2}
      alignItems="center"
      borderStyle="single"
      borderTop={false}
      borderLeft={false}
      borderRight={false}
      borderBottom
      borderBottomColor={palette.border}
      backgroundColor={palette.background}
    >
      <Text bold color={palette.brand}>
        ◈ KAYGENT
      </Text>
      {columns >= 86 ? (
        <Text color={palette.dim}>  /  terminal kanban</Text>
      ) : null}

      <Box flexGrow={1} />

      {columns >= 108 ? (
        <Text color={palette.dim}>{date}   </Text>
      ) : null}

      {columns >= 80 ? (
        <>
          <Text color={palette.success}>{openCount} open</Text>
          <Text color={palette.dim}>  ·  </Text>
          <Text color={palette.muted}>{doneCount} done</Text>
        </>
      ) : (
        <Text color={palette.muted}>
          {totalCount} {totalCount === 1 ? 'task' : 'tasks'}
        </Text>
      )}
    </Box>
  );
}
