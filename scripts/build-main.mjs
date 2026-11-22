import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';

mkdirSync('dist/main', { recursive: true });
mkdirSync('dist/core', { recursive: true });

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  sourcemap: false,
  logLevel: 'error',
};

// Electron 主进程
await build({
  ...common,
  entryPoints: ['src/main/main.ts'],
  format: 'cjs',
  external: ['electron'],
  outfile: 'dist/main/main.cjs',
});

// preload 脚本
await build({
  ...common,
  entryPoints: ['src/main/preload.ts'],
  format: 'cjs',
  external: ['electron'],
  outfile: 'dist/main/preload.cjs',
});

// 元数据解析核心（供 Node 测试直接 import）
await build({
  ...common,
  entryPoints: ['src/core/metadata.ts'],
  format: 'esm',
  outfile: 'dist/core/metadata.mjs',
});

console.log('✔ dist/main/main.cjs  dist/main/preload.cjs  dist/core/metadata.mjs');
