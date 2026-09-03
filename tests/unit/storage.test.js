import { beforeAll, describe, expect, it } from 'vitest';
import { loadUtils, StorageFromGlobal } from '../helpers/load-utils.js';

beforeAll(() => {
  loadUtils();
  // 未设置存储模式 → 默认 sync；两个后端初始为空
  globalThis.chrome = {
    storage: {
      local: { get: async () => ({}), set: async () => {} },
      sync: { get: async () => ({}), set: async () => {}, remove: async () => {} }
    },
    runtime: {}
  };
});

const S = () => StorageFromGlobal();

describe('Storage._resolvePresets（预设迁移）', () => {
  it('版本完全不存在（新装）：返回出厂 16 个预设', () => {
    const presets = S()._resolvePresets({});
    expect(presets).toHaveLength(16);
  });
  it('旧字段 colorPresets（hex 数组）迁移为 stylePresets', () => {
    const presets = S()._resolvePresets({ colorPresets: ['#ff0000', '#00ff00'] });
    expect(presets).toHaveLength(2);
    expect(presets[0].bgColor).toBe('#ff0000');
    expect(presets[0].textColor).toBe('inherit');
    expect(presets[0].id).toBeTruthy();
  });
  it('explicit stylePresets 优先', () => {
    const presets = S()._resolvePresets({ stylePresets: [{ bgColor: '#123456' }], colorPresets: ['#ff0000'] });
    expect(presets).toHaveLength(1);
    expect(presets[0].bgColor).toBe('#123456');
  });
  it('显式空数组保持空（不做出厂填充）', () => {
    expect(S()._resolvePresets({ stylePresets: [] })).toEqual([]);
  });
});

describe('Storage.getSettings（通过 chrome.storage mock）', () => {
  it('全新安装：合并默认值并填充出厂预设', async () => {
    const s = await S().getSettings();
    expect(s.showRail).toBe(true);
    expect(s.stylePresets).toHaveLength(16);
  });
  it('已存储设置保留并覆盖默认；stylePresets 用存储值', async () => {
    // 第一次调用后 _fallbackChecked 已置位，直接局部覆盖 mock 返回值即可
    globalThis.chrome.storage.sync.get = async () => ({
      ah_settings: { showRail: false, stylePresets: [{ bgColor: '#abcdef' }] }
    });
    const s = await S().getSettings();
    expect(s.showRail).toBe(false);
    expect(s.stylePresets).toHaveLength(1);
    expect(s.stylePresets[0].bgColor).toBe('#abcdef');
  });
});