import { Box, Text } from 'ink';
import type { Task } from '../board';
import { palette, tagColor } from '../theme';

interface TaskCardProps {
  task: Task;
  stageColor: string;
  highlighted: boolean;
  completed: boolean;
  marginBottom: number;
}

export function TaskCard({
  task,
  stageColor,
  highlighted,
  completed,
  marginBottom,
}: TaskCardProps) {
  const titleColor = completed
    ? palette.dim
    : highlighted
      ? palette.white
      : palette.textSoft;

  return (
    <Box
      flexDirection="column"
      width="100%"
      height={2}
      paddingX={1}
      marginBottom={marginBottom}
      backgroundColor={highlighted ? palette.surfaceSelected : undefined}
    >
      <Text wrap="truncate-end" bold={highlighted} color={titleColor} strikethrough={completed}>
        <Text color={highlighted ? stageColor : palette.dim}>
          {highlighted ? '▌' : ' '}
        </Text>
        {' '}
        {task.title}
      </Text>

      <Text wrap="truncate-end">
        <Text color={highlighted ? stageColor : palette.dim}>
          {highlighted ? '▌' : ' '}
        </Text>
        {'  '}
        {task.tags.length > 0 ? (
          task.tags.map((tag, index) => (
            <Text key={`${task.id}-${tag}`} color={tagColor(tag)}>
              {index > 0 ? ' ' : ''}
              #{tag}
            </Text>
          ))
        ) : (
          <Text color={palette.dim}>untagged</Text>
        )}
      </Text>
    </Box>
  );
}
