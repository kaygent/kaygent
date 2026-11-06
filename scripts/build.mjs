import { build } from 'esbuild';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputFile = resolve(projectRoot, 'dist', 'cli.mjs');

await rm(outputFile, { force: true });
await mkdir(dirname(outputFile), { recursive: true });

await build({
  entryPoints: [resolve(projectRoot, 'src', 'cli.tsx')],
  outfile: outputFile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  jsx: 'automatic',
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  logLevel: 'info',
  banner: {
    js: [
      "import { createRequire as __kaygentCreateRequire } from 'node:module';",
      "const require = __kaygentCreateRequire(import.meta.url);",
    ].join('\n'),
  },
  define: {
    'process.env.NODE_ENV': '"production"',
    'process.env.DEV': '"false"',
  },
  plugins: [
    {
      name: 'exclude-ink-devtools',
      setup(builder) {
        builder.onResolve({ filter: /(^|\/)devtools\.js$/ }, (args) => {
          if (!args.importer.replaceAll('\\', '/').includes('/ink/build/')) {
            return undefined;
          }

          return { path: 'ink-devtools-stub', namespace: 'stub' };
        });
        builder.onLoad(
          { filter: /^ink-devtools-stub$/, namespace: 'stub' },
          () => ({
            contents: 'export default {};\n',
            loader: 'js',
          }),
        );
      },
    },
  ],
});

const bundleSize = (await stat(outputFile)).size;
console.log(`\nBundled ${outputFile} (${(bundleSize / 1024).toFixed(1)} KiB)`);
