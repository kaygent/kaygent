import { createHash } from 'node:crypto';
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(projectRoot, 'dist', 'cli.mjs');
const releaseDir = resolve(projectRoot, 'release');
const pkgScript = require.resolve('@yao-pkg/pkg/lib-es5/bin.js');

const TARGETS = {
  win: {
    label: 'Windows x64',
    pkgTarget: 'node24-win-x64',
    output: 'Kaygent.exe',
  },
  linux: {
    label: 'Linux x64',
    pkgTarget: 'node24-linux-x64',
    output: 'Kaygent-linux-x64',
  },
};

function parsePlatforms(argv) {
  const inline = argv.find((arg) => arg.startsWith('--platform='));
  const index = argv.indexOf('--platform');
  const value =
    inline?.slice('--platform='.length) ??
    (index === -1 ? undefined : argv[index + 1]);

  if (!value || value === 'all') {
    return Object.keys(TARGETS);
  }

  const platforms = value
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

  for (const platform of platforms) {
    if (!TARGETS[platform]) {
      throw new Error(
        `Unknown platform "${platform}". Use win, linux, or all.`,
      );
    }
  }

  return [...new Set(platforms)];
}

const platforms = parsePlatforms(process.argv.slice(2));

await mkdir(releaseDir, { recursive: true });

// Enhanced SEA mode walks a package.json, so package the self-contained bundle
// as a tiny ESM project. Unlike pkg's standard mode, SEA embeds stock Node.js
// binaries with full ICU, which Ink's text measurement requires on Linux.
const seaDir = resolve(projectRoot, 'dist', 'sea');
await rm(seaDir, { recursive: true, force: true });
await mkdir(seaDir, { recursive: true });
await copyFile(entry, resolve(seaDir, 'cli.mjs'));
await writeFile(
  resolve(seaDir, 'package.json'),
  `${JSON.stringify(
    {
      name: 'kaygent-binary',
      private: true,
      type: 'module',
      bin: 'cli.mjs',
    },
    null,
    2,
  )}\n`,
);

for (const platform of platforms) {
  const target = TARGETS[platform];
  const output = resolve(releaseDir, target.output);

  console.log(
    `\nPackaging ${target.output} with @yao-pkg/pkg (Node 24 SEA, ${target.label})...\n`,
  );

  const args = [
    pkgScript,
    seaDir,
    '--sea',
    '--targets',
    target.pkgTarget,
    '--output',
    output,
    '--compress',
    'Brotli',
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

  if (platform === 'linux') {
    await chmod(output, 0o755);
  }

  const info = await stat(output);
  console.log(
    `\nBuilt ${output} (${(info.size / 1024 / 1024).toFixed(1)} MiB)`,
  );
}

await mkdir(resolve(releaseDir, 'assets'), { recursive: true });
await copyFile(
  resolve(projectRoot, 'assets', 'icon.svg'),
  resolve(releaseDir, 'assets', 'icon.svg'),
);
await copyFile(
  resolve(projectRoot, 'README.md'),
  resolve(releaseDir, 'README.md'),
);

const checksums = [];
for (const platform of platforms) {
  const output = resolve(releaseDir, TARGETS[platform].output);
  const digest = createHash('sha256')
    .update(await readFile(output))
    .digest('hex');
  checksums.push(`${digest}  ${TARGETS[platform].output}`);
}

const checksumFile = resolve(releaseDir, 'SHA256SUMS.txt');
await writeFile(checksumFile, `${checksums.join('\n')}\n`);

console.log(`\nCopied README.md to ${resolve(releaseDir, 'README.md')}`);
console.log(`Wrote ${checksumFile}`);
