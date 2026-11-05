import { copyFile, mkdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(projectRoot, 'dist', 'cli.mjs');
const output = resolve(projectRoot, 'release', 'Qanban.exe');
const pkgScript = require.resolve('@yao-pkg/pkg/lib-es5/bin.js');

await mkdir(dirname(output), { recursive: true });

console.log('Packaging Qanban.exe with @yao-pkg/pkg (Node 24, Windows x64)...\n');

const args = [
  pkgScript,
  entry,
  '--targets',
  'node24-win-x64',
  '--output',
  output,
  '--compress',
  'Brotli',
  '--no-bytecode',
  '--public',
];

const result = spawnSync(process.execPath, args, {
  cwd: projectRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    PKG_CACHE_PATH: resolve(projectRoot, '.pkg-cache'),
  },
  windowsHide: false,
});

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  throw new Error(`pkg exited with status ${result.status}`);
}

await mkdir(resolve(projectRoot, 'release', 'assets'), { recursive: true });
await copyFile(
  resolve(projectRoot, 'assets', 'icon.svg'),
  resolve(projectRoot, 'release', 'assets', 'icon.svg'),
);
await copyFile(
  resolve(projectRoot, 'README.md'),
  resolve(projectRoot, 'release', 'README.md'),
);

const info = await stat(output);
console.log(
  `\nBuilt ${output} (${(info.size / 1024 / 1024).toFixed(1)} MiB)`,
);
console.log(`Copied README.md to ${resolve(projectRoot, 'release', 'README.md')}`);
