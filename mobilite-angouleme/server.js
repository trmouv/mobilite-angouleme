import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

function assemble(partsDir, destination) {
  const dir = path.join(root, partsDir);
  const content = fs.readdirSync(dir)
    .filter(name => name.endsWith('.part'))
    .sort()
    .map(name => fs.readFileSync(path.join(dir, name), 'utf8'))
    .join('');
  const output = path.join(root, destination);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, content, 'utf8');
}

assemble('.v19parts/server', '.runtime/server-v19.mjs');
assemble('.v19parts/app', 'public/app.js');
assemble('.v19parts/styles', 'public/styles.css');
assemble('.v19parts/index', 'public/index.html');

await import(`${pathToFileURL(path.join(root, '.runtime/server-v19.mjs')).href}?v=19`);
