import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const baleybotsRoot = path.join(projectRoot, 'vendor', 'baleybots', 'typescript');

const distMarkers = [
  ['@baleybots/core', 'packages/core/dist/esm/index.js'],
  ['@baleybots/core', 'packages/core/dist/types/index.d.ts'],
  ['@baleybots/chat', 'packages/chat/dist/esm/index.js'],
  ['@baleybots/chat', 'packages/chat/dist/types/index.d.ts'],
  ['@baleybots/react', 'packages/react/dist/esm/index.js'],
  ['@baleybots/react', 'packages/react/dist/types/index.d.ts'],
];

const run = (command, args, cwd) => {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
};

const missingDist = distMarkers.filter(([, relativePath]) => {
  return !fs.existsSync(path.join(baleybotsRoot, relativePath));
});

if (missingDist.length === 0) {
  console.log('BaleyBots build artifacts present. Skipping build.');
  process.exit(0);
}

if (!fs.existsSync(path.join(baleybotsRoot, 'node_modules'))) {
  console.log('Installing BaleyBots dependencies...');
  run('bun', ['install'], baleybotsRoot);
}

console.log('Building BaleyBots packages...');
run('bun', ['run', 'build'], baleybotsRoot);
