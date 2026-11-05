import { Box, Text, useInput } from 'ink';
import type { Stage, Task } from '../board';
import { palette, stageUi, tagColor } from '../theme';
import { Panel, panelInnerWidth } from './Panel';

interface DeletePanelProps {
  task: Task;
  stage: Stage;
  panelWidth: number;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeletePanel({
  task,
  stage,
  panelWidth,
  onCancel,
  onConfirm,
}: DeletePanelProps) {
  const innerWidth = panelInnerWidth(panelWidth);
  const details = stageUi[stage];

  useInput((input, key) => {
    if (key.escape || input.toLowerCase() === 'n') {
      onCancel();
      return;
    }

    if (key.return || input.toLowerCase() === 'y') {
      onConfirm();
    }
  });

  return (
    <Panel width={panelWidth} borderColor={palette.danger}>
      <Box width={innerWidth} height={1} justifyContent="space-between">
        <Text bold color={palette.danger}>
          ⌫  DELETE TASK
        </Text>
        <Text color={details.color}>
          {details.glyph} {details.label}
        </Text>
      </Box>

      <Box height={1} />

      <Box height={1} width={innerWidth}>
        <Text color={palette.white} wrap="truncate-end">
          “{task.title}”
        </Text>
      </Box>

      <Box height={1} width={innerWidth}>
        <Text wrap="truncate-end" color={palette.dim}>
          {task.tags.length > 0
            ? task.tags.map((tag, index) => (
                <Text key={tag} color={tagColor(tag)}>
                  {index > 0 ? ' ' : ''}
                  #{tag}
                </Text>
              ))
            : 'untagged'}
        </Text>
      </Box>

      <Box height={1} />

      <Box height={1} width={innerWidth}>
        <Text color={palette.muted}>This action cannot be undone.</Text>
      </Box>
    </Panel>
  );
}
