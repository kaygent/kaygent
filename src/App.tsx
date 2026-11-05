import { Box, Text, useApp, useInput } from 'ink';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addTask,
  clamp,
  collectTags,
  countOpenTasks,
  countTasks,
  moveTask,
  removeTask,
  reorderTask,
  setTaskSession,
  STAGE_IDS,
  updateTask,
  type Board,
  type Stage,
  type Task,
} from './board';
import { BoardColumn } from './components/BoardColumn';
import { DeletePanel } from './components/DeletePanel';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { HelpPanel } from './components/HelpPanel';
import { StageTabs } from './components/StageTabs';
import { TaskForm } from './components/TaskForm';
import { useTerminalSize, type Viewport } from './hooks/use-terminal-size';
import { getKeyHints } from './key-hints';
import { computeLayout, MIN_COLUMNS, MIN_ROWS } from './layout';
import type { Notice, SaveState } from './notice';
import type { TerminalControl } from './terminal';
import { palette, stageUi } from './theme';

type FieldName = 'title' | 'tags';

type ModalState =
  | { kind: 'add'; initialFocus: FieldName }
  | {
      kind: 'edit';
      stage: Stage;
      task: Task;
      initialFocus: FieldName;
    }
  | { kind: 'delete'; stage: Stage; task: Task }
  | { kind: 'help' };

interface AppProps {
  initialBoard: Board;
  saveBoard?: (board: Board) => void;
  initialNotice?: Notice;
  /** Used by tests and static renderers to provide a deterministic viewport. */
  viewport?: Viewport;
  /** Terminal launcher/focuser. Omitted in demo mode and unit tests. */
  terminal?: TerminalControl;
}

function emptyCursors(): Record<Stage, number> {
  return { new: 0, active: 0, paused: 0, completed: 0 };
}

interface PlayState {
  board: Board;
  focusedStage: Stage;
  cursors: Record<Stage, number>;
}

function selectedIndexFor(state: PlayState, stage: Stage): number {
  const length = state.board.columns[stage].length;
  if (length === 0) {
    return 0;
  }
  return clamp(state.cursors[stage], 0, length - 1);
}

export function App({
  initialBoard,
  saveBoard,
  initialNotice,
  viewport: viewportOverride,
  terminal,
}: AppProps) {
  const viewport = useTerminalSize(viewportOverride);
  const layout = computeLayout(viewport.columns, viewport.rows);
  const { exit } = useApp();

  const [play, setPlay] = useState<PlayState>({
    board: initialBoard,
    focusedStage: 'new',
    cursors: emptyCursors(),
  });
  const playRef = useRef(play);
  const commitPlay = (next: PlayState) => {
    playRef.current = next;
    setPlay(next);
  };
  const [modal, setModal] = useState<ModalState | null>(null);
  const [saveState, setSaveState] = useState<SaveState>(
    saveBoard ? 'saved' : 'demo',
  );
  const [notice, setNotice] = useState<Notice>(
    () =>
      initialNotice ?? {
        text:
          countTasks(initialBoard) === 0
            ? 'Press a to add your first task.'
            : 'Ready. Press ? for shortcuts.',
        tone: 'info',
      },
  );

  const initialRender = useRef(true);
  const saveHandler = useRef(saveBoard);
  saveHandler.current = saveBoard;
  const terminalControl = useRef(terminal);
  terminalControl.current = terminal;

  useEffect(() => {
    if (initialRender.current) {
      initialRender.current = false;
      return;
    }

    const save = saveHandler.current;
    if (!save) {
      return;
    }

    try {
      save(play.board);
      setSaveState('saved');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSaveState('error');
      setNotice({
        text: `Could not save the board: ${message}`,
        tone: 'error',
      });
    }
  }, [play.board]);

  const board = play.board;
  const focusedStage = play.focusedStage;
  const allTags = useMemo(() => collectTags(board), [board]);
  const totalCount = countTasks(board);
  const openCount = countOpenTasks(board);
  const doneCount = board.columns.completed.length;

  const selectedIndex = selectedIndexFor(play, focusedStage);

  const focusOffset = (offset: -1 | 1, wrap = false) => {
    const currentState = playRef.current;
    const current = STAGE_IDS.indexOf(currentState.focusedStage);
    let next = current + offset;

    if (wrap) {
      next = (next + STAGE_IDS.length) % STAGE_IDS.length;
    }

    if (next < 0 || next >= STAGE_IDS.length) {
      return;
    }

    commitPlay({
      ...currentState,
      focusedStage: STAGE_IDS[next] as Stage,
    });
  };

  const jumpToStage = (index: number) => {
    const stage = STAGE_IDS[index];
    if (!stage) {
      return;
    }

    commitPlay({ ...playRef.current, focusedStage: stage });
  };

  const moveSelection = (delta: number) => {
    const currentState = playRef.current;
    const stage = currentState.focusedStage;
    const tasks = currentState.board.columns[stage];
    if (tasks.length === 0) {
      return;
    }

    const current = selectedIndexFor(currentState, stage);
    const next = clamp(current + delta, 0, tasks.length - 1);
    commitPlay({
      ...currentState,
      cursors: { ...currentState.cursors, [stage]: next },
    });
  };

  const openAdd = () => {
    setModal({ kind: 'add', initialFocus: 'title' });
  };

  const openEdit = (initialFocus: FieldName = 'title') => {
    const currentState = playRef.current;
    const stage = currentState.focusedStage;
    const index = selectedIndexFor(currentState, stage);
    const task = currentState.board.columns[stage][index];

    if (!task) {
      setNotice({
        text: `No task selected in ${stageUi[stage].name}.`,
        tone: 'info',
      });
      return;
    }

    setModal({
      kind: 'edit',
      stage,
      task,
      initialFocus,
    });
  };

  const openDelete = () => {
    const currentState = playRef.current;
    const stage = currentState.focusedStage;
    const index = selectedIndexFor(currentState, stage);
    const task = currentState.board.columns[stage][index];

    if (!task) {
      setNotice({
        text: `No task selected in ${stageUi[stage].name}.`,
        tone: 'info',
      });
      return;
    }

    setModal({ kind: 'delete', stage, task });
  };

  const focusSelectedTerminal = (): boolean => {
    const terminal = terminalControl.current;
    if (!terminal || !terminal.focusOnEnter) {
      return false;
    }

    const currentState = playRef.current;
    if (currentState.focusedStage !== 'active') {
      return false;
    }

    const index = selectedIndexFor(currentState, 'active');
    const task = currentState.board.columns.active[index];
    if (!task?.session) {
      return false;
    }

    const result = terminal.focus(task.session);
    if (result.ok) {
      setNotice({
        text: `Focused ${task.session.provider} for “${task.title}”.`,
        tone: 'success',
      });
    } else {
      setNotice({
        text: `Could not focus the terminal: ${result.error ?? 'unknown error'}. Press e to edit this task.`,
        tone: 'warning',
      });
    }

    return true;
  };

  const moveSelectedTo = (direction: -1 | 1) => {
    const currentState = playRef.current;
    const stage = currentState.focusedStage;
    const tasks = currentState.board.columns[stage];
    const index = selectedIndexFor(currentState, stage);
    const task = tasks[index];

    if (!task) {
      setNotice({
        text: `No task selected in ${stageUi[stage].name}.`,
        tone: 'info',
      });
      return;
    }

    const currentStageIndex = STAGE_IDS.indexOf(stage);
    const targetStage = STAGE_IDS[currentStageIndex + direction];

    if (!targetStage) {
      setNotice({
        text:
          direction < 0
            ? 'This task is already in the first column.'
            : 'This task is already completed.',
        tone: 'info',
      });
      return;
    }

    const result = moveTask(currentState.board, stage, index, targetStage);
    if (!result.moved) {
      return;
    }

    const terminal = terminalControl.current;
    let nextBoard = result.board;
    let terminalText = '';
    let tone: Notice['tone'] = 'success';

    if (terminal) {
      if (targetStage === 'active') {
        if (task.session) {
          const focused = terminal.focus(task.session);
          if (focused.ok) {
            terminalText = `Focused ${task.session.provider} for “${task.title}”.`;
          } else {
            terminalText = `Could not focus the terminal: ${focused.error ?? 'unknown error'}.`;
            tone = 'warning';
          }
        } else {
          const spawned = terminal.spawn(task);
          if (spawned.ok && spawned.session) {
            nextBoard = setTaskSession(
              nextBoard,
              targetStage,
              task.id,
              spawned.session,
            );
            terminalText = `Launched ${terminal.provider} for “${task.title}”.`;
          } else {
            terminalText = `Could not launch a terminal: ${spawned.error ?? 'unknown error'}.`;
            tone = 'warning';
          }
        }
      } else if (task.session) {
        const closeOnPause =
          targetStage === 'paused' && terminal.pauseBehavior === 'close';
        const closeOnFinish =
          targetStage === 'completed' || targetStage === 'new';

        if (closeOnPause || closeOnFinish) {
          const closed = terminal.close(task.session);
          if (closed.ok) {
            nextBoard = setTaskSession(
              nextBoard,
              targetStage,
              task.id,
              undefined,
            );
            terminalText = 'Terminal closed.';
          } else {
            terminalText = `Could not close the terminal: ${closed.error ?? 'unknown error'}.`;
            tone = 'warning';
          }
        } else if (targetStage === 'paused') {
          terminalText = 'Terminal kept open.';
        }
      }
    }

    const baseText =
      targetStage === 'completed'
        ? `Completed “${task.title}”.`
        : `Moved “${task.title}” to ${stageUi[targetStage].name}.`;

    commitPlay({
      board: nextBoard,
      focusedStage: targetStage,
      cursors: {
        ...currentState.cursors,
        [stage]: Math.min(
          currentState.cursors[stage],
          Math.max(0, tasks.length - 2),
        ),
        [targetStage]: result.toIndex,
      },
    });
    setNotice({
      text: [baseText, terminalText].filter(Boolean).join(' '),
      tone,
    });
  };

  const reorderSelected = (delta: -1 | 1) => {
    const currentState = playRef.current;
    const stage = currentState.focusedStage;
    const index = selectedIndexFor(currentState, stage);
    const task = currentState.board.columns[stage][index];

    if (!task) {
      setNotice({
        text: `No task selected in ${stageUi[stage].name}.`,
        tone: 'info',
      });
      return;
    }

    const result = reorderTask(currentState.board, stage, index, delta);

    if (!result.moved) {
      setNotice({
        text:
          delta < 0
            ? 'This task is already at the top of the column.'
            : 'This task is already at the bottom of the column.',
        tone: 'info',
      });
      return;
    }

    commitPlay({
      ...currentState,
      board: result.board,
      cursors: { ...currentState.cursors, [stage]: result.index },
    });
    setNotice({
      text: `Moved “${task.title}” ${delta < 0 ? 'up' : 'down'}.`,
      tone: 'success',
    });
  };

  const handleFormSubmit = (draft: { title: string; tags: string[] }) => {
    if (!modal) {
      return;
    }

    const currentState = playRef.current;

    if (modal.kind === 'add') {
      const result = addTask(currentState.board, draft);
      commitPlay({
        board: result.board,
        focusedStage: 'new',
        cursors: { ...currentState.cursors, new: result.index },
      });
      setModal(null);
      setNotice({ text: `Added “${result.task.title}” to New.`, tone: 'success' });
      return;
    }

    if (modal.kind === 'edit') {
      const currentIndex = currentState.board.columns[modal.stage].findIndex(
        (task) => task.id === modal.task.id,
      );

      if (currentIndex === -1) {
        setModal(null);
        setNotice({ text: 'That task no longer exists.', tone: 'error' });
        return;
      }

      commitPlay({
        ...currentState,
        board: updateTask(currentState.board, modal.stage, currentIndex, {
          title: draft.title,
          tags: draft.tags,
        }),
      });
      setModal(null);
      setNotice({ text: `Updated “${draft.title}”.`, tone: 'success' });
    }
  };

  const confirmDelete = (target: Extract<ModalState, { kind: 'delete' }>) => {
    const currentState = playRef.current;
    const currentIndex = currentState.board.columns[target.stage].findIndex(
      (task) => task.id === target.task.id,
    );

    if (currentIndex === -1) {
      setModal(null);
      return;
    }

    const terminal = terminalControl.current;
    let terminalText = '';
    let tone: Notice['tone'] = 'success';
    if (terminal && target.task.session) {
      const closed = terminal.close(target.task.session);
      if (closed.ok) {
        terminalText = ' Terminal closed.';
      } else {
        terminalText = ` Could not close the terminal: ${closed.error ?? 'unknown error'}.`;
        tone = 'warning';
      }
    }

    const nextBoard = removeTask(currentState.board, target.stage, currentIndex);
    const remaining = nextBoard.columns[target.stage].length;
    commitPlay({
      ...currentState,
      board: nextBoard,
      cursors: {
        ...currentState.cursors,
        [target.stage]: clamp(
          currentState.cursors[target.stage],
          0,
          Math.max(0, remaining - 1),
        ),
      },
    });
    setModal(null);
    setNotice({
      text: `Deleted “${target.task.title}”.${terminalText}`,
      tone,
    });
  };

  useInput(
    (input, key) => {
      if (layout.tooSmall) {
        if (input.toLowerCase() === 'q' && !key.ctrl && !key.meta) {
          exit();
        } else if (key.escape && modal) {
          setModal(null);
        }
        return;
      }

      if (modal) {
        return;
      }

      if (key.leftArrow) {
        if (key.shift) {
          moveSelectedTo(-1);
        } else {
          focusOffset(-1);
        }
        return;
      }

      if (key.rightArrow) {
        if (key.shift) {
          moveSelectedTo(1);
        } else {
          focusOffset(1);
        }
        return;
      }

      if (key.upArrow) {
        if (key.shift) {
          reorderSelected(-1);
        } else {
          moveSelection(-1);
        }
        return;
      }

      if (key.downArrow) {
        if (key.shift) {
          reorderSelected(1);
        } else {
          moveSelection(1);
        }
        return;
      }

      if (key.pageUp) {
        moveSelection(-5);
        return;
      }

      if (key.pageDown) {
        moveSelection(5);
        return;
      }

      if (key.tab) {
        focusOffset(key.shift ? -1 : 1, true);
        return;
      }

      if (key.return) {
        if (focusSelectedTerminal()) {
          return;
        }
        openEdit('title');
        return;
      }

      if (key.delete) {
        openDelete();
        return;
      }

      if (key.escape) {
        return;
      }

      if (key.ctrl || key.meta) {
        return;
      }

      if (input.toLowerCase() === 'q') {
        exit();
        return;
      }

      if (input === '?') {
        setModal({ kind: 'help' });
        return;
      }

      if (input === 'a') {
        openAdd();
        return;
      }

      if (input === 'e') {
        openEdit('title');
        return;
      }

      if (input === 't') {
        openEdit('tags');
        return;
      }

      if (input === 'd') {
        openDelete();
        return;
      }

      if (input === ' ') {
        moveSelectedTo(1);
        return;
      }

      if (input === '[') {
        reorderSelected(-1);
        return;
      }

      if (input === ']') {
        reorderSelected(1);
        return;
      }

      if (input === '<') {
        moveSelectedTo(-1);
        return;
      }

      if (input === '>') {
        moveSelectedTo(1);
        return;
      }

      if (/^[1-4]$/.test(input)) {
        jumpToStage(Number(input) - 1);
      }
    },
    { isActive: !modal || layout.tooSmall },
  );

  if (layout.tooSmall) {
    return (
      <Box
        width={layout.columns}
        height={layout.rows}
        flexDirection="column"
        justifyContent="center"
        alignItems="center"
        backgroundColor={palette.background}
      >
        <Text bold color={palette.brand}>
          ◈ QANBAN
        </Text>
        <Text color={palette.warning}>Terminal window is too small.</Text>
        <Text color={palette.muted}>
          Needs {MIN_COLUMNS} × {MIN_ROWS}; current size is {layout.columns} ×{' '}
          {layout.rows}.
        </Text>
        <Text color={palette.dim}>Resize the window to continue · q quits</Text>
      </Box>
    );
  }

  const showModal = modal !== null;
  const keyHints = getKeyHints(modal?.kind ?? null, layout.columns);
  const formWidth = Math.min(76, layout.columns - 6);
  const helpWidth = Math.min(88, layout.columns - 6);
  const deleteWidth = Math.min(60, layout.columns - 6);

  let modalContent = null;

  if (modal?.kind === 'help') {
    modalContent = (
      <HelpPanel panelWidth={helpWidth} onClose={() => setModal(null)} />
    );
  } else if (modal?.kind === 'delete') {
    modalContent = (
      <DeletePanel
        task={modal.task}
        stage={modal.stage}
        panelWidth={deleteWidth}
        onCancel={() => setModal(null)}
        onConfirm={() => confirmDelete(modal)}
      />
    );
  } else if (modal?.kind === 'add') {
    modalContent = (
      <TaskForm
        mode="add"
        stage="new"
        initialTitle=""
        initialTags={[]}
        initialFocus={modal.initialFocus}
        existingTags={allTags}
        panelWidth={formWidth}
        onSubmit={handleFormSubmit}
        onCancel={() => setModal(null)}
      />
    );
  } else if (modal?.kind === 'edit') {
    modalContent = (
      <TaskForm
        mode="edit"
        stage={modal.stage}
        initialTitle={modal.task.title}
        initialTags={modal.task.tags}
        initialFocus={modal.initialFocus}
        createdAt={modal.task.createdAt}
        existingTags={allTags}
        panelWidth={formWidth}
        onSubmit={handleFormSubmit}
        onCancel={() => setModal(null)}
      />
    );
  }

  return (
    <Box
      width={layout.columns}
      height={layout.rows}
      flexDirection="column"
      backgroundColor={palette.background}
    >
      <Header
        columns={layout.columns}
        openCount={openCount}
        doneCount={doneCount}
        totalCount={totalCount}
      />

      {layout.compact && !showModal ? (
        <StageTabs board={board} focusedStage={focusedStage} />
      ) : null}

      {showModal ? (
        <Box
          flexGrow={1}
          width="100%"
          paddingX={2}
          paddingY={1}
          justifyContent="center"
          alignItems="center"
          backgroundColor={palette.background}
        >
          {modalContent}
        </Box>
      ) : (
        <Box
          flexGrow={1}
          width="100%"
          paddingX={2}
          paddingY={1}
          backgroundColor={palette.background}
        >
          <Box
            flexDirection="row"
            width="100%"
            height={layout.columnContentHeight + 3}
            gap={2}
          >
            {layout.compact ? (
              <BoardColumn
                stage={focusedStage}
                tasks={board.columns[focusedStage]}
                selectedIndex={selectedIndex}
                focused
                contentHeight={layout.columnContentHeight}
                cardAreaHeight={layout.cardAreaHeight}
              />
            ) : (
              STAGE_IDS.map((stage) => (
                <BoardColumn
                  key={stage}
                  stage={stage}
                  tasks={board.columns[stage]}
                  selectedIndex={selectedIndexFor(play, stage)}
                  focused={stage === focusedStage}
                  contentHeight={layout.columnContentHeight}
                  cardAreaHeight={layout.cardAreaHeight}
                />
              ))
            )}
          </Box>
        </Box>
      )}

      <Footer
        notice={notice}
        saveState={saveState}
        keyHints={keyHints}
        columns={layout.columns}
      />
    </Box>
  );
}
