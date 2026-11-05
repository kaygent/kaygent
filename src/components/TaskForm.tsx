import { Box, Text, useInput } from 'ink';
import { useRef, useState } from 'react';
import { normalizeTitle, parseTags, type Stage } from '../board';
import { formatShortDate, getInputWindow } from '../text-utils';
import { palette, stageUi, tagColor } from '../theme';
import { Panel, panelInnerWidth } from './Panel';

type FieldName = 'title' | 'tags';

interface TaskFormProps {
  mode: 'add' | 'edit';
  stage: Stage;
  initialTitle: string;
  initialTags: string[];
  initialFocus?: FieldName;
  createdAt?: string;
  existingTags: string[];
  panelWidth: number;
  onSubmit: (draft: { title: string; tags: string[] }) => void;
  onCancel: () => void;
}

interface FieldProps {
  value: string;
  cursor: number;
  active: boolean;
  width: number;
  placeholder: string;
}

interface FormState {
  title: string;
  tags: string;
  cursors: Record<FieldName, number>;
  activeField: FieldName;
  error: string | null;
}

function Field({ value, cursor, active, width, placeholder }: FieldProps) {
  if (!active) {
    return (
      <Box height={1}>
        <Text wrap="truncate-end" color={value ? palette.textSoft : palette.dim}>
          {value || placeholder}
        </Text>
      </Box>
    );
  }

  const view = getInputWindow(value, cursor, width);

  return (
    <Box height={1}>
      <Text wrap="truncate-end" color={palette.text}>
        {view.hasLeft ? <Text color={palette.dim}>…</Text> : null}
        {view.before}
        <Text backgroundColor={palette.accent} color={palette.background}>
          {view.cursorChar}
        </Text>
        {view.after}
        {view.hasRight ? <Text color={palette.dim}>…</Text> : null}
        {value.length === 0 ? <Text color={palette.dim}>{placeholder}</Text> : null}
      </Text>
    </Box>
  );
}

export function TaskForm({
  mode,
  stage,
  initialTitle,
  initialTags,
  initialFocus = 'title',
  createdAt,
  existingTags,
  panelWidth,
  onSubmit,
  onCancel,
}: TaskFormProps) {
  const initialTagsText = initialTags.join(', ');
  const [form, setForm] = useState<FormState>({
    title: initialTitle,
    tags: initialTagsText,
    cursors: {
      title: Array.from(initialTitle).length,
      tags: Array.from(initialTagsText).length,
    },
    activeField: initialFocus,
    error: null,
  });
  const formRef = useRef(form);

  const commit = (updater: (current: FormState) => FormState) => {
    const next = updater(formRef.current);
    formRef.current = next;
    setForm(next);
  };

  const innerWidth = panelInnerWidth(panelWidth);
  const stageDetails = stageUi[stage];

  const switchField = () => {
    commit((current) => ({
      ...current,
      activeField: current.activeField === 'title' ? 'tags' : 'title',
      error: null,
    }));
  };

  const submit = () => {
    const current = formRef.current;
    const title = normalizeTitle(current.title);

    if (!title) {
      commit((state) => ({
        ...state,
        error: 'A title is required.',
        activeField: 'title',
      }));
      return;
    }

    onSubmit({ title, tags: parseTags(current.tags) });
  };

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.return) {
      submit();
      return;
    }

    if (key.tab || key.upArrow || key.downArrow) {
      switchField();
      return;
    }

    const current = formRef.current;
    const activeField = current.activeField;
    const activeValue = activeField === 'title' ? current.title : current.tags;
    const chars = Array.from(activeValue);
    const cursor = Math.min(current.cursors[activeField], chars.length);

    if (key.leftArrow) {
      commit((state) => ({
        ...state,
        cursors: { ...state.cursors, [activeField]: Math.max(0, cursor - 1) },
      }));
      return;
    }

    if (key.rightArrow) {
      commit((state) => ({
        ...state,
        cursors: {
          ...state.cursors,
          [activeField]: Math.min(chars.length, cursor + 1),
        },
      }));
      return;
    }

    if (key.home) {
      commit((state) => ({
        ...state,
        cursors: { ...state.cursors, [activeField]: 0 },
      }));
      return;
    }

    if (key.end) {
      commit((state) => ({
        ...state,
        cursors: { ...state.cursors, [activeField]: chars.length },
      }));
      return;
    }

    if (key.backspace) {
      if (cursor > 0) {
        chars.splice(cursor - 1, 1);
        commit((state) => ({
          ...state,
          [activeField]: chars.join(''),
          cursors: { ...state.cursors, [activeField]: cursor - 1 },
          error: null,
        }));
      }
      return;
    }

    if (key.delete) {
      if (cursor < chars.length) {
        chars.splice(cursor, 1);
        commit((state) => ({
          ...state,
          [activeField]: chars.join(''),
          cursors: { ...state.cursors, [activeField]: cursor },
          error: null,
        }));
      }
      return;
    }

    if (key.ctrl || key.meta) {
      return;
    }

    const printable = input.replace(/[\r\n\t]/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '');
    if (!printable) {
      return;
    }

    const inserted = Array.from(printable);
    chars.splice(cursor, 0, ...inserted);
    commit((state) => ({
      ...state,
      [activeField]: chars.join(''),
      cursors: {
        ...state.cursors,
        [activeField]: cursor + inserted.length,
      },
      error: null,
    }));
  });

  const titleLabelColor = form.activeField === 'title' ? palette.accent : palette.dim;
  const tagsLabelColor = form.activeField === 'tags' ? palette.accent : palette.dim;

  const subtitle =
    mode === 'add'
      ? 'Added to the New column.'
      : `Created ${createdAt ? formatShortDate(createdAt) : 'recently'} · edit title and tags.`;

  return (
    <Panel width={panelWidth} borderColor={palette.accent}>
      <Box width={innerWidth} justifyContent="space-between" height={1}>
        <Text bold color={palette.brand}>
          {mode === 'add' ? '✚  NEW TASK' : '✎  EDIT TASK'}
        </Text>
        <Text bold color={stageDetails.color}>
          {stageDetails.glyph} {stageDetails.label}
        </Text>
      </Box>

      <Box height={1}>
        <Text color={palette.dim} wrap="truncate-end">
          {subtitle}
        </Text>
      </Box>

      <Box height={1} />

      <Box height={1} width={innerWidth} justifyContent="space-between">
        <Text bold color={titleLabelColor}>
          TITLE
        </Text>
        <Text color={palette.dim}>required</Text>
      </Box>
      <Field
        value={form.title}
        cursor={form.cursors.title}
        active={form.activeField === 'title'}
        width={innerWidth}
        placeholder="A clear, actionable next step…"
      />
      <Text color={form.activeField === 'title' ? palette.accent : palette.borderSoft}>
        {'─'.repeat(innerWidth)}
      </Text>

      <Box height={1} />

      <Box height={1} width={innerWidth} justifyContent="space-between">
        <Text bold color={tagsLabelColor}>
          TAGS
        </Text>
        <Text color={palette.dim}>comma separated</Text>
      </Box>
      <Field
        value={form.tags}
        cursor={form.cursors.tags}
        active={form.activeField === 'tags'}
        width={innerWidth}
        placeholder="work, urgent, design…"
      />
      <Text color={form.activeField === 'tags' ? palette.accent : palette.borderSoft}>
        {'─'.repeat(innerWidth)}
      </Text>

      <Box height={1}>
        {form.error ? (
          <Text color={palette.danger} wrap="truncate-end">
            ! {form.error}
          </Text>
        ) : (
          <Text wrap="truncate-end" color={palette.dim}>
            {existingTags.length > 0 ? (
              <>
                <Text color={palette.dim}>SUGGESTED  </Text>
                {existingTags.map((tag, index) => (
                  <Text key={tag} color={tagColor(tag)}>
                    {index > 0 ? ' ' : ''}
                    #{tag}
                  </Text>
                ))}
              </>
            ) : (
              'Tag ideas: work, home, urgent. # is optional.'
            )}
          </Text>
        )}
      </Box>
    </Panel>
  );
}
