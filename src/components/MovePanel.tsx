import { Box, Text, useInput } from 'ink';
import type { Stage, Task } from '../board';
import { palette, stageUi, tagColor } from '../theme';
import { Panel, panelInnerWidth } from './Panel';

interface MovePanelProps {
  task: Task;
  fromStage: Stage;
  toStage: Stage;
  panelWidth: number;
  onCancel: () => void;
  onConfirm: () => void;
}

function consequence(fromStage: Stage, toStage: Stage): string {
  if (toStage === 'completed') {
    return 'This marks the task Completed and closes its terminal.';
  }
  if (toStage === 'new') {
    return 'This returns the task to New and closes its terminal.';
  }
  if (toStage === 'active') {
    return fromStage === 'new'
      ? 'This starts the workspace script or launches the agent.'
      : 'This resumes the task in Active.';
  }
  return 'This moves the task to Paused.';
}

export function MovePanel({
  task,
  fromStage,
  toStage,
  panelWidth,
  onCancel,
  onConfirm,
}: MovePanelProps) {
  const innerWidth = panelInnerWidth(panelWidth);
  const from = stageUi[fromStage];
  const to = stageUi[toStage];

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
    <Panel width={panelWidth} borderColor={palette.warning}>
      <Box width={innerWidth} height={1} justifyContent="space-between">
        <Text bold color={palette.warning}>
          ⇄  MOVE TASK
        </Text>
        <Text>
          <Text color={from.color}>
            {from.glyph} {from.label}
          </Text>
          <Text color={palette.dim}> → </Text>
          <Text color={to.color}>
            {to.glyph} {to.label}
          </Text>
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
        <Text color={palette.muted}>{consequence(fromStage, toStage)}</Text>
      </Box>
    </Panel>
  );
}
