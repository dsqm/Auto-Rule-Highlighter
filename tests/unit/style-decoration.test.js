// StyleKit 装饰（下划线/删除线）与 resolveStyle 全样式组合
// 覆盖：decorationOf 的组合、resolveStyle 各字段覆写/继承、resolveTextColor 边界
import { beforeAll, describe, expect, it } from 'vitest';
import { loadUtils, StyleKit } from '../helpers/load-utils.js';

beforeAll(loadUtils);
const K = () => StyleKit();

const SETTINGS = { stylePresets: [{ bgColor: '#111111', textColor: null }], showRail: true };

describe('StyleKit.decorationOf（下划线/删除线可叠加）', () => {
  it('都不设置 → 空串', () => {
    expect(K().decorationOf({})).toBe('');
  });
  it('仅下划线 / 仅删除线', () => {
    expect(K().decorationOf({ underline: true })).toBe('underline');
    expect(K().decorationOf({ strike: true })).toBe('line-through');
  });
  it('两者叠加：underline line-through', () => {
    expect(K().decorationOf({ underline: true, strike: true })).toBe('underline line-through');
  });
  it('falsy 值（false / undefined / 0）视为不设置', () => {
    expect(K().decorationOf({ underline: false, strike: false })).toBe('');
    expect(K().decorationOf({ underline: 0, strike: undefined })).toBe('');
  });
});

describe('StyleKit.resolveStyle（关键词覆写 + 全局默认组合）', () => {
  it('关键词无样式字段 → 继承背景与装饰默认，文字色不继承（保持页面原色）', () => {
    const s = K().resolveStyle({ text: '词', id: 'k' }, SETTINGS);
    expect(s.bgColor).toBe('#111111');
    // textColor 明确不做全局默认继承：未设置 = undefined（渲染时按页面原色）
    expect(s.textColor).toBeUndefined();
    expect(s.fontSize).toBe(1);
    expect(s.bold).toBe(false);
    expect(s.italic).toBe(false);
  });

  it('全字段覆写：背景/文字色/字号/粗斜体/下划线/删除线', () => {
    const kw = {
      text: '词', id: 'k',
      color: '#ff0000', textColor: '#0000ff', fontSize: 1.5,
      bold: true, italic: true, underline: true, strike: true
    };
    const s = K().resolveStyle(kw, SETTINGS);
    expect(s.bgColor).toBe('#ff0000');
    expect(s.textColor).toBe('#0000ff');
    expect(s.fontSize).toBe(1.5);
    expect(s.bold).toBe(true);
    expect(s.italic).toBe(true);
    expect(s.underline).toBe(true);
    expect(s.strike).toBe(true);
  });

  it('部分覆写：只改背景，装饰字段回落默认（false/1），文字色保持不继承', () => {
    const s = K().resolveStyle({ text: '词', id: 'k', color: '#00ff00' }, SETTINGS);
    expect(s.bgColor).toBe('#00ff00');
    expect(s.fontSize).toBe(1);
    expect(s.bold).toBe(false);
    expect(s.italic).toBe(false);
    expect(s.textColor).toBeUndefined();
  });

  it('背景空串 = 显式「无背景」，覆盖默认背景', () => {
    const s = K().resolveStyle({ text: '词', id: 'k', color: '' }, SETTINGS);
    expect(s.bgColor).toBe('');
  });

  it('resolveStyle 返回克隆，修改结果不影响入参与默认样式', () => {
    const kw = { text: '词', id: 'k' };
    const s1 = K().resolveStyle(kw, SETTINGS);
    s1.bgColor = '#123456';
    expect(K().resolveStyle(kw, SETTINGS).bgColor).toBe('#111111');
    expect(SETTINGS.stylePresets[0].bgColor).toBe('#111111');
  });
});

describe('StyleKit.resolveTextColor（文字色边界）', () => {
  it('自定义色 #xxx 直接返回', () => {
    expect(K().resolveTextColor({ textColor: '#ff0000', bgColor: '#000' })).toBe('#ff0000');
  });
  it('null = 自动黑白：暗背景白字、亮背景黑字', () => {
    expect(K().resolveTextColor({ textColor: null, bgColor: '#000000' })).toBe('#ffffff');
    expect(K().resolveTextColor({ textColor: null, bgColor: '#ffffff' })).toBe('#000000');
  });
  it('null 且无背景 → 黑字兜底', () => {
    expect(K().resolveTextColor({ textColor: null, bgColor: '' })).toBe('#000000');
  });
  it('undefined / inherit → 保持原色', () => {
    expect(K().resolveTextColor({ textColor: undefined })).toBe('inherit');
    expect(K().resolveTextColor({ textColor: 'inherit' })).toBe('inherit');
  });
  it('预览模式传 fallback：无背景用 fallback，有背景用对比色', () => {
    expect(K().resolveTextColor({ textColor: null, bgColor: '' }, '#333333')).toBe('#333333');
    expect(K().resolveTextColor({ textColor: null, bgColor: '#000000' }, '#333333')).toBe('#ffffff');
  });
});
