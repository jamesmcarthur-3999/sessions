import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const baleybotsRoot = path.join(projectRoot, 'vendor', 'baleybots', 'typescript');
const coreFile = path.join(baleybotsRoot, 'packages', 'core', 'src', 'baleybot.ts');

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

const ensurePatched = () => {
  const content = fs.readFileSync(coreFile, 'utf8');
  if (content.includes("'__TAURI__' in window")) {
    return false;
  }

  const blockRegex = /if \(!proxyUrl && typeof window !== 'undefined' && window\.location\) {\n\s*proxyUrl = window\.location\.origin;\n\s*}/;
  const replacement = [
    "if (!proxyUrl && typeof window !== 'undefined' && window.location) {",
    "      const isTauri = '__TAURI__' in window;",
    "      if (!isTauri) {",
    "        proxyUrl = window.location.origin;",
    "      }",
    "    }",
  ].join('\n');

  const updated = content.replace(blockRegex, replacement);
  if (updated === content) {
    throw new Error('Unable to apply BaleyBots Tauri proxy patch. Pattern not found.');
  }

  fs.writeFileSync(coreFile, updated);
  return true;
};

const missingDist = distMarkers.filter(([, relativePath]) => {
  return !fs.existsSync(path.join(baleybotsRoot, relativePath));
});

const patched = ensurePatched();
const needsBuild = patched || missingDist.length > 0;

if (!needsBuild) {
  console.log('BaleyBots build artifacts present. Skipping build.');
  process.exit(0);
}

if (!fs.existsSync(path.join(baleybotsRoot, 'node_modules'))) {
  console.log('Installing BaleyBots dependencies...');
  run('bun', ['install'], baleybotsRoot);
}

console.log('Building BaleyBots packages...');
run('bun', ['run', 'build'], baleybotsRoot);
