import { spawnSync } from 'node:child_process';

export interface RunOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

export type CommandRunner = (
  file: string,
  args: string[],
  options?: RunOptions,
) => RunResult;

export type ShellRunner = (
  command: string,
  options?: RunOptions,
) => RunResult;

export interface TemplateValues {
  title: string;
  tags: string;
  id: string;
  cwd: string;
  command?: string;
  session?: string;
}

const TEMPLATE_KEYS = new Set([
  'title',
  'tags',
  'id',
  'cwd',
  'command',
  'session',
]);

export function sanitizeTitle(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

export function expandTemplate(
  template: string,
  values: TemplateValues,
): string {
  return template.replace(/\{([a-z]+)\}/gi, (match, key: string) => {
    if (!TEMPLATE_KEYS.has(key)) {
      return match;
    }
    return values[key as keyof TemplateValues] ?? '';
  });
}

export function resolveCommandTokens(
  command: readonly string[],
  values: TemplateValues,
): string[] {
  return command.map((token) => expandTemplate(token, values)).filter(Boolean);
}

export function posixQuote(value: string): string {
  if (value.length === 0) {
    return "''";
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function windowsQuote(value: string): string {
  if (value.length === 0) {
    return '""';
  }
  // Keep backslashes intact (paths), and double embedded quotes for both
  // cmd.exe and PowerShell double-quoted strings.
  return `"${value.replace(/"/g, '""')}"`;
}

export type ShellPlatform = NodeJS.Platform | 'posix';

export function shellQuote(
  value: string,
  platform: ShellPlatform = process.platform,
): string {
  return platform === 'win32' ? windowsQuote(value) : posixQuote(value);
}

export function buildShellCommand(
  tokens: readonly string[],
  platform: ShellPlatform = process.platform,
): string {
  return tokens.map((token) => shellQuote(token, platform)).join(' ');
}

export function powershellQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function defaultRun(
  file: string,
  args: string[],
  options: RunOptions = {},
): RunResult {
  const result = spawnSync(file, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 15_000,
    windowsHide: true,
    env: options.env ?? process.env,
    maxBuffer: 8 * 1024 * 1024,
  });

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error ? result.error.message : undefined,
  };
}

export function defaultShellRun(
  command: string,
  options: RunOptions = {},
): RunResult {
  const result = spawnSync(command, [], {
    cwd: options.cwd,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 30_000,
    windowsHide: true,
    env: options.env ?? process.env,
    shell: true,
    maxBuffer: 8 * 1024 * 1024,
  });

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error ? result.error.message : undefined,
  };
}

export function failureMessage(
  label: string,
  result: RunResult,
): string {
  const detail =
    result.error ||
    result.stderr.trim() ||
    result.stdout.trim() ||
    (result.status === null ? 'process did not start' : `exit code ${result.status}`);
  return `${label}: ${detail}`;
}
