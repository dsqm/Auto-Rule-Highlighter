import { beforeAll, describe, expect, it } from 'vitest';
import { loadUtils, StyleKit } from '../helpers/load-utils.js';

beforeAll(loadUtils);
const K = () => StyleKit();

describe('StyleKit.contrastColor（自动黑白亮度逻辑）', () => {
  it('亮背景 → 黑字', () => {
    expect(K().contrastColor('#ffffff')).toBe('#000000');
    expect(K().contrastColor('#ffeb3b')).toBe('#000000'); // 黄
    expect(K().contrastColor('#ffd93d')).toBe('#000000');
  });
  it('暗背景 → 白字', () => {
    expect(K().contrastColor('#000000')).toBe('#ffffff');
    expect(K().contrastColor('#1a1a2e')).toBe('#ffffff');
  });
  it('3 位 hex 展开', () => {
    expect(K().contrastColor('#fff')).toBe('#000000');
    expect(K().contrastColor('#000')).toBe('#ffffff');
  });
  it('空值/非法值回退黑字', () => {
    expect(K().contrastColor('')).toBe('#000000');
    expect(K().contrastColor('rgb(1,2,3)')).toBe('#000000');
  });
});

describe('StyleKit.resolveTextColor', () => {
  it('自定义色直接返回', () => {
    expect(K().resolveTextColor({ textColor: '#c0392b', bgColor: '#fff' })).toBe('#c0392b');
  });
  it('自动黑白（null）按背景取反', () => {
    expect(K().resolveTextColor({ textColor: null, bgColor: '#ffffff' })).toBe('#000000');
    expect(K().resolveTextColor({ textColor: null, bgColor: '#000000' })).toBe('#ffffff');
  });
  it('inherit/undefined 保持原色', () => {
    expect(K().resolveTextColor({ textColor: 'inherit', bgColor: '#fff' })).toBe('inherit');
    expect(K().resolveTextColor({ bgColor: '#fff' })).toBe('inherit');
  });
  it('预览模式（传 fallback）：有背景取对比色，无背景用 fallback', () => {
    expect(K().resolveTextColor({ textColor: 'inherit', bgColor: '#000000' }, '#333333')).toBe('#ffffff');
    expect(K().resolveTextColor({ bgColor: '' }, '#333333')).toBe('#333333');
    expect(K().resolveTextColor({ textColor: null, bgColor: '#000000' }, '#333333')).toBe('#ffffff');
  });
});

describe('StyleKit.autoInvertPair（预览双色）', () => {
  it('自动黑白：A 取黑/白结果，a 用相反色', () => {
    const pair = K().autoInvertPair({ textColor: null, bgColor: '#ffffff' }, '#333333');
    expect(pair.main).toBe('#000000');
    expect(pair.alt).toBe('#ffffff');
    const pairDark = K().autoInvertPair({ textColor: null, bgColor: '#000000' }, '#333333');
    expect(pairDark.main).toBe('#ffffff');
    expect(pairDark.alt).toBe('#000000');
  });
  it('固定色：单色同值', () => {
    const pair = K().autoInvertPair({ textColor: '#c0392b', bgColor: '#000' }, '#333333');
    expect(pair.main).toBe('#c0392b');
    expect(pair.alt).toBe('#c0392b');
  });
  it('无背景固定色不参与自动黑白', () => {
    const pair = K().autoInvertPair({ textColor: '#c0392b', bgColor: '' }, '#333333');
    expect(pair.main).toBe('#c0392b');
  });
});

describe('StyleKit.getDefaultPresets', () => {
  it('出厂 16 个预设', () => {
    expect(K().getDefaultPresets()).toHaveLength(16);
  });
  it('前 8 个为背景色 + 自动黑白，后 8 个为纯文字色', () => {
    const presets = K().getDefaultPresets();
    for (let i = 0; i < 8; i++) {
      expect(presets[i].bgColor).toMatch(/^#/);
      expect(presets[i].textColor).toBeNull();
    }
    for (let i = 8; i < 16; i++) {
      expect(presets[i].bgColor).toBe('');
      expect(presets[i].textColor).toMatch(/^#/);
    }
  });
});

describe('StyleKit.normalizePreset / normalizePresets', () => {
  it('hex 字符串转为完整样式对象', () => {
    const p = K().normalizePreset('#ffeb3b');
    expect(p.bgColor).toBe('#ffeb3b');
    expect(p.textColor).toBe('inherit');
    expect(p.fontSize).toBe(1);
    expect(p.bold).toBe(false);
    expect(p.id).toBeTruthy();
  });
  it('补齐缺失字段，非法 textColor 归为 inherit', () => {
    const p = K().normalizePreset({ bgColor: '#ff6b6b', textColor: 'rgb(1,2,3)' });
    expect(p.textColor).toBe('inherit');
    expect(p.fontSize).toBe(1);
  });
  it('textColor null（自动黑白）与 #xxx 保留', () => {
    expect(K().normalizePreset({ bgColor: '#f00', textColor: null }).textColor).toBeNull();
    expect(K().normalizePreset({ bgColor: '#f00', textColor: '#123456' }).textColor).toBe('#123456');
  });
  it('字号越界被钳制', () => {
    expect(K().normalizePreset({ fontSize: 99 }).fontSize).toBe(3);
    expect(K().normalizePreset({ fontSize: 0.1 }).fontSize).toBe(0.5);
  });
  it('normalizePresets 过滤非数组', () => {
    expect(K().normalizePresets('not-array')).toEqual([]);
  });
});

describe('StyleKit.resolveFrom / keywordOverrides / applyStyleToKeyword', () => {
  it('关键词覆写叠加到基底，未设置字段继承', () => {
    const base = { bgColor: '#ffeb3b', textColor: null, fontSize: 1, bold: false, italic: false, underline: false, strike: false };
    const over = { color: '#f00', textColor: '#123' };
    const s = K().resolveFrom(base, over);
    expect(s.bgColor).toBe('#f00');
    expect(s.textColor).toBe('#123');
    expect(s.fontSize).toBe(1);
  });
  it('keywordOverrides 只取显式字段，兼容 color/bgColor 两种字段名', () => {
    const o = K().keywordOverrides({ color: '#f00', textColor: null, bold: true, fontSize: 2 });
    expect(o).toEqual({ bgColor: '#f00', textColor: null, bold: true, fontSize: 2 });
  });
  it('背景空串是显式「无背景」', () => {
    expect(K().keywordOverrides({ color: '' })).toEqual({ bgColor: '' });
  });
  it('applyStyleToKeyword 写回并清除旧值', () => {
    const kw = {};
    K().applyStyleToKeyword(kw, { bgColor: '#fff', textColor: '#000', bold: true });
    expect(kw).toMatchObject({ color: '#fff', textColor: '#000', bold: true });
    K().applyStyleToKeyword(kw, {});
    expect(kw.color).toBeUndefined();
    expect(kw.textColor).toBeUndefined();
  });
});

describe('StyleKit.styleEquals / serialize', () => {
  it('自动黑白与固定黑色文字不等（null vs #000000）', () => {
    expect(K().styleEquals({ textColor: null, bgColor: '#fff' }, { textColor: '#000000', bgColor: '#fff' })).toBe(false);
  });
  it('相同样式相等（字号浮点容差）', () => {
    expect(K().styleEquals({ bgColor: '#ffeb3b', textColor: null }, { bgColor: '#ffeb3b', textColor: null })).toBe(true);
  });
  it('serialize 稳定性：相同样式序列同样本', () => {
    const s = () => K().serialize({ bgColor: '#f00', textColor: null, fontSize: 1.2, bold: true });
    expect(s()).toBe(s());
  });
});

describe('StyleKit.isInheriting / getDefaultStyle / clearKeywordStyle', () => {
  it('无样式字段的关键词视为跟随全局默认', () => {
    expect(K().isInheriting({})).toBe(true);
    expect(K().isInheriting({ color: '#f00' })).toBe(false);
    expect(K().isInheriting({ textColor: null })).toBe(false); // 自动黑白是显式设置
    expect(K().isInheriting({ fontSize: 1.5 })).toBe(false);
  });
  it('getDefaultStyle：取预设第一项；空列表回退内置默认', () => {
    const settings = { stylePresets: [{ bgColor: '#123456', textColor: null }] };
    const d = K().getDefaultStyle(settings);
    expect(d.bgColor).toBe('#123456');
    expect(d.textColor).toBeNull();
    const fallback = K().getDefaultStyle({ stylePresets: [] });
    expect(fallback.bgColor).toBe(K().BUILTIN_DEFAULT.bgColor);
  });
  it('resolveStyle：把默认样式与关键词覆写合并，返回克隆；文字色不继承默认', () => {
    const settings = { stylePresets: [{ bgColor: '#ffeb3b', textColor: null }] };
    const s = K().resolveStyle({ color: '#f00' }, settings);
    expect(s.bgColor).toBe('#f00');
    // 文字颜色不做全局默认继承：关键词没设 → 保持页面原色（undefined）
    expect(s.textColor).toBeUndefined();
    // 关键词显式设文字色才生效
    const s2 = K().resolveStyle({ color: '#f00', textColor: '#000' }, settings);
    expect(s2.textColor).toBe('#000');
    // 不污染默认预设对象
    expect(settings.stylePresets[0].bgColor).toBe('#ffeb3b');
    expect(settings.stylePresets[0].textColor).toBeNull();
  });
  it('clearKeywordStyle 清除全部样式字段', () => {
    const kw = { color: '#f00', textColor: '#000', bold: true, fontSize: 1.2 };
    K().clearKeywordStyle(kw);
    expect(kw).toEqual({});
  });
  it('blankStyle / cloneStyle 补全字段且不共享引用', () => {
    const b = K().blankStyle();
    expect(b.textColor).toBe('inherit');
    expect(b.bold).toBe(false);
    const c = K().cloneStyle({ bgColor: '#f00', textColor: null });
    expect(c.bgColor).toBe('#f00');
    expect(c.textColor).toBeNull();
    c.bgColor = '#000';
    expect(c.bgColor).not.toBe(K().cloneStyle({ bgColor: '#f00', textColor: null }).bgColor);
  });
});