/**
 * EDX Digital - Build for publishing
 *
 * Produces dist/, the only folder that goes to the hosting:
 *   - the whole app in one minified JavaScript file (instead of some thirty requests);
 *   - each stylesheet minified;
 *   - pages without their comments;
 *   - a service worker that lists exactly the files that exist.
 * The source files are not changed. Run with `npm run build`; `npm run deploy` runs it before publishing.
 */

import { build, transform } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const from = (...parts) => path.join(root, ...parts);
const to = (...parts) => path.join(dist, ...parts);

const PAGES = ['index.html', 'landing.html', 'termos.html', 'privacidade.html'];

async function sizeOf(dir) {
  let raw = 0;
  let compressed = 0;
  let files = 0;
  for (const entry of await fs.readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const content = await fs.readFile(path.join(entry.parentPath ?? entry.path, entry.name));
    raw += content.length;
    compressed += zlib.brotliCompressSync(content).length;
    files += 1;
  }
  return { raw, compressed, files };
}

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;

await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(to('js'), { recursive: true });
await fs.mkdir(to('css'), { recursive: true });

// 1. JavaScript: one file. The Firebase SDK keeps coming from Google's CDN, loaded on demand.
await build({
  entryPoints: [from('js', 'app.js')],
  outfile: to('js', 'app.js'),
  bundle: true,
  format: 'esm',
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  external: ['https://*'],
  logLevel: 'warning'
});

// 2. Stylesheets, each under its own name so the pages need no change
for (const file of (await fs.readdir(from('css'))).filter(name => name.endsWith('.css'))) {
  const { code } = await transform(await fs.readFile(from('css', file), 'utf8'), { loader: 'css', minify: true, legalComments: 'none' });
  await fs.writeFile(to('css', file), code);
}

// 3. Pages: comments out, nothing else touched (inline scripts and the text inside tags stay as written)
for (const page of PAGES) {
  const html = await fs.readFile(from(page), 'utf8');
  const clean = html
    .replace(/<!--(?!\[if)[\s\S]*?-->/g, '')
    .replace(/^[ \t]+$/gm, '')
    .replace(/(\r?\n){3,}/g, '\n\n');
  await fs.writeFile(to(page), clean);
}

// 4. Files copied as they are
await fs.cp(from('assets'), to('assets'), { recursive: true });
await fs.copyFile(from('manifest.json'), to('manifest.json'));

// 5. Service worker: its list of files to keep offline is rewritten to match dist/
const stylesheets = (await fs.readdir(to('css'))).map(name => `/css/${name}`);
const offline = ['/', ...PAGES.map(page => `/${page}`), '/landing', '/termos', '/privacidade', '/manifest.json', '/assets/icon.svg', ...stylesheets, '/js/app.js'];
const worker = await fs.readFile(from('sw.js'), 'utf8');
const listed = worker.replace(/const STATIC_ASSETS = \[[\s\S]*?\];/, `const STATIC_ASSETS = ${JSON.stringify(offline)};`);
if (listed === worker) throw new Error('sw.js: a lista STATIC_ASSETS não foi encontrada');
await fs.writeFile(to('sw.js'), (await transform(listed, { minify: true, legalComments: 'none' })).code);

// 6. What changed, measured the way the hosting sends it (Brotli)
const sources = { raw: 0, compressed: 0, files: 0 };
for (const dir of ['js', 'css']) {
  const part = await sizeOf(from(dir));
  for (const key of Object.keys(sources)) sources[key] += part[key];
}
const built = { raw: 0, compressed: 0, files: 0 };
for (const dir of ['js', 'css']) {
  const part = await sizeOf(to(dir));
  for (const key of Object.keys(built)) built[key] += part[key];
}
console.log(`JS e CSS: ${sources.files} arquivos, ${kb(sources.raw)} (${kb(sources.compressed)} comprimidos)`);
console.log(`       -> ${built.files} arquivos, ${kb(built.raw)} (${kb(built.compressed)} comprimidos)`);
console.log(`dist/ pronto.`);
