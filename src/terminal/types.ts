/**
 * A terminal session spawned for a task. Sessions are provider-specific and
 * persisted with the board so focus/close still work after a restart.
 */
export interface TerminalSession {
  /** Provider that created the session, e.g. "wezterm" or "tmux". */
  provider: string;
  /** Primary provider handle: pane id, window id, tab id, or process id. */
  id: string;
  title?: string;
  /** Herdr tab id when the session lives in a tab. */
  tabId?: string;
  /** Herdr pane id when the session lives in a pane. */
  paneId?: string;
  /** PID file written by the Windows Terminal wrapper process. */
  pidFile?: string;
  /** Named Windows Terminal window, set when the session opened in a window. */
  windowName?: string;
  createdAt: string;
}

export interface SpawnTask {
  id: string;
  title: string;
  tags: string[];
}

export interface TerminalResult {
  ok: boolean;
  session?: TerminalSession;
  error?: string;
  /** True when the provider cannot perform this action at all. */
  unsupported?: boolean;
}

export interface TerminalControl {
  /** The concrete provider in use after `auto` detection. */
  readonly provider: string;
  readonly pauseBehavior: 'keep' | 'close';
  readonly focusOnEnter: boolean;
  spawn(task: SpawnTask): TerminalResult;
  focus(session: TerminalSession): TerminalResult;
  close(session: TerminalSession): TerminalResult;
}
