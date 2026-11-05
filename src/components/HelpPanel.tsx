import { Box, Text, useInput } from 'ink';
import { palette } from '../theme';
import { Panel, panelInnerWidth } from './Panel';

interface HelpPanelProps {
  panelWidth: number;
  onClose: () => void;
}

interface ShortcutSection {
  title: string;
  color: string;
  shortcuts: ReadonlyArray<readonly [key: string, description: string]>;
}

const sections: ShortcutSection[] = [
  {
    title: 'NAVIGATE',
    color: palette.accent,
    shortcuts: [
      ['←→', 'columns'],
      ['↑↓', 'select task'],
      ['Tab', 'next column'],
      ['1–4', 'jump column'],
    ],
  },
  {
    title: 'ORGANIZE',
    color: palette.brand,
    shortcuts: [
      ['a', 'add task'],
      ['e', 'edit task'],
      ['t', 'edit tags'],
      ['d', 'delete task'],
    ],
  },
  {
    title: 'MOVE',
    color: palette.warning,
    shortcuts: [
      ['<>', 'change stage'],
      ['Spc', 'advance stage'],
      ['[]', 'reorder'],
      ['?', 'show help'],
    ],
  },
];

export function HelpPanel({ panelWidth, onClose }: HelpPanelProps) {
  const innerWidth = panelInnerWidth(panelWidth);

  useInput((input, key) => {
    if (key.escape || input === '?') {
      onClose();
    }
  });

  return (
    <Panel width={panelWidth} borderColor={palette.brand}>
      <Box width={innerWidth} height={1} justifyContent="space-between">
        <Text bold color={palette.brand}>
          ⌨  KEYBOARD SHORTCUTS
        </Text>
        <Text color={palette.dim}>Esc to close</Text>
      </Box>

      <Box height={1} />

      <Box flexDirection="row" width={innerWidth} gap={2}>
        {sections.map((section) => (
          <Box
            key={section.title}
            flexDirection="column"
            flexGrow={1}
            flexBasis={0}
          >
            <Text bold color={section.color}>
              {section.title}
            </Text>
            {section.shortcuts.map(([key, description]) => (
              <Box key={`${section.title}-${key}`} height={1}>
                <Text wrap="truncate-end">
                  <Text bold color={palette.text}>
                    {key.padEnd(5)}
                  </Text>
                  <Text color={palette.muted}>{description}</Text>
                </Text>
              </Box>
            ))}
          </Box>
        ))}
      </Box>

      <Box height={1} />

      <Box height={1} width={innerWidth}>
        <Text color={palette.muted} wrap="truncate-end">
          ↵ on an Active task focuses its terminal  ·  moving to Active launches it
        </Text>
      </Box>

      <Box height={1} />

      <Box height={1} width={innerWidth}>
        <Text color={palette.dim} wrap="truncate-end">
          Esc or ? closes  ·  changes save automatically
        </Text>
      </Box>
    </Panel>
  );
}
