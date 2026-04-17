import { mkdir, rm, copyFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');

const staticFiles = [
  'index.html',
  'ai.html',
  'opc.html',
  'admin.html',
  'admin-ai.html',
  'admin-opc.html',
  'api-config.js'
];

async function main() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  for (const file of staticFiles) {
    await copyFile(path.join(ROOT, file), path.join(DIST, file));
  }

  console.log(`Cloudflare Pages build ready: ${DIST}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
