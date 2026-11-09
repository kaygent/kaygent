import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Stage, Task } from './board';
import type { WorkspaceSettings } from './config';
import type { TerminalControl, TerminalSession } from './terminal';
import { sanitizeTitle } from './terminal/command';

export interface WorkspaceActivationResult {
  ok: boolean;
  session?: TerminalSession;
  error?: string;
}

export interface WorkspaceService {
  readonly enabled: boolean;
  /**
   * Write the selected task to a temporary JSON file and run the configured
   * script in a new terminal tab rooted at the workspaces directory.
   */
  activate(
    task: Task,
    fromStage: Stage,
    toStage: Stage,
  ): WorkspaceActivationResult;
}

export interface WorkspaceDeps {
  terminal?: TerminalControl;
  tmpDir?: string;
  now?: () => Date;
}

export function createWorkspaceService(
  settings: WorkspaceSettings,
  deps: WorkspaceDeps = {},
): WorkspaceService {
  const terminal = deps.terminal;
  const enabled = settings.command.length > 0 && Boolean(terminal);

  return {
    enabled,
    activate(task, fromStage, toStage) {
      if (!enabled || !terminal) {
        return {
          ok: false,
          error: 'Workspace scripts are not configured.',
        };
      }

      if (fromStage !== 'new' || toStage !== 'active') {
        return {
          ok: false,
          error: 'Workspace scripts run only when a task moves from New to Active.',
        };
      }

      try {
        const directory = mkdtempSync(
          join(deps.tmpDir ?? tmpdir(), 'kaygent-workspace-'),
        );
        const taskFile = join(directory, 'task.json');
        const payload = {
          generatedAt: (deps.now?.() ?? new Date()).toISOString(),
          previousStage: fromStage,
          stage: toStage,
          workspaceRoot: settings.root,
          taskFile,
          task: {
            id: task.id,
            title: task.title,
            ...(task.description ? { description: task.description } : {}),
            tags: task.tags,
            ...(task.parentId ? { parentId: task.parentId } : {}),
            ...(task.source ? { source: task.source } : {}),
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
          },
        };

        writeFileSync(
          taskFile,
          `${JSON.stringify(payload, null, 2)}\n`,
          'utf8',
        );

        mkdirSync(settings.root, { recursive: true });

        const title =
          sanitizeTitle(`Kaygent workspace · ${task.title}`) ||
          'Kaygent workspace';

        const usesPlaceholder = settings.command.some((token) =>
          token.includes('{taskFile}'),
        );
        const command = settings.command.map((token) =>
          token.replaceAll('{taskFile}', taskFile),
        );
        if (!usesPlaceholder) {
          command.push(taskFile);
        }

        return terminal.spawnCommand(command, {
          title,
          cwd: settings.root,
        });
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
