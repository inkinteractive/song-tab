/**
 * Copies Basic Pitch's bundled TensorFlow.js model into public/ so it is served
 * beside the app. The model ships inside the npm package (it is not fetched
 * from a CDN at runtime), which keeps the Full tier working offline.
 */
import { cp, mkdir, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const from = resolve(root, 'node_modules/@spotify/basic-pitch/model');
const to = resolve(root, 'public/models/basic-pitch');

try {
  await access(from);
} catch {
  console.warn('[copy-models] @spotify/basic-pitch is not installed; skipping.');
  process.exit(0);
}

await mkdir(to, { recursive: true });
await cp(from, to, { recursive: true });
console.log(`[copy-models] basic-pitch model -> ${to}`);
