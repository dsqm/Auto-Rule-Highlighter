// 单元测试辅助：把 utils 下的全局脚本（var xx = ...）加载进 globalThis。
// utils 文件是浏览器全局脚本（无 module 导出），通过 indirect eval 执行，
// 顶层 var 声明会挂到 globalThis，与浏览器中的全局行为一致。
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
export const ROOT = path.resolve(require.resolve('../../package.json'), '..');

const FILES = ['common.js', 'matcher.js', 'style.js', 'storage.js', 'donate.js'];

let loaded = false;
export function loadUtils() {
  if (loaded) return;
  // indirect eval：顶层 var 进入 globalThis
  for (const f of FILES) {
    const code = readFileSync(path.join(ROOT, 'utils', f), 'utf8');
    (0, eval)(code);
  }
  loaded = true;
}

// 从 globalThis 取命名空间（IIFE 的导出对象）
export const Matcher = () => globalThis.Matcher;
export const StyleKit = () => globalThis.StyleKit;
export const CommonKit = () => globalThis.CommonKit;
export const StorageFromGlobal = () => globalThis.Storage;
export const DonateKit = () => globalThis.DonateKit;