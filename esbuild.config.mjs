import * as esbuild from 'esbuild';
import { mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isWatch = process.argv.includes('--watch');
const outputDir = 'static/build';

// One bundle per page: homepage.js for /, about.js for /me, edit.js for editors, project.js for /test.
const entryPoints = {
  homepage: 'static/ts/homepage/index.ts',
  about: 'static/ts/about/index.ts',
  edit: 'static/ts/edit/index.ts',
  project: 'static/ts/project/index.ts',
};

function prepareOutputDir() {
  const absoluteOutputDir = join(__dirname, outputDir);
  rmSync(absoluteOutputDir, { recursive: true, force: true });
  mkdirSync(absoluteOutputDir, { recursive: true });
}

/** @type {esbuild.BuildOptions} */
const buildOptions = {
  entryPoints,
  bundle: true,
  outdir: outputDir,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  sourcemap: isWatch,
  minify: !isWatch,
  metafile: true,
  logLevel: 'info',

  plugins: [
    {
      name: 'build-notifications',
      setup(build) {
        build.onStart(() => {
          console.log(`\n[${new Date().toLocaleTimeString()}] Building...`);
        });
        build.onEnd((result) => {
          if (result.errors.length > 0) {
            console.error(`Build failed with ${result.errors.length} error(s)`);
          } else {
            console.log(`Build completed successfully`);
            if (result.metafile) {
              const outputs = Object.entries(result.metafile.outputs);
              for (const [file, meta] of outputs) {
                if (file.endsWith('.js') || file.endsWith('.css')) {
                  const sizeKB = (meta.bytes / 1024).toFixed(1);
                  console.log(`  ${file}: ${sizeKB} KB`);
                }
              }
            }
          }
        });
      },
    },
  ],
};

async function build() {
  try {
    prepareOutputDir();
    if (isWatch) {
      const ctx = await esbuild.context(buildOptions);
      await ctx.watch();
      console.log('Watching for changes...');
    } else {
      await esbuild.build(buildOptions);
    }
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
