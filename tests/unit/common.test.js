import { beforeAll, describe, expect, it } from 'vitest';
import { CommonKit, loadUtils } from '../helpers/load-utils.js';

beforeAll(loadUtils);

describe('CommonKit.escapeHtml', () => {
  it('转义 & < > "', () => {
    expect(CommonKit().escapeHtml('<a href="x&y">')).toBe('&lt;a href=&quot;x&amp;y&quot;&gt;');
  });
  it('空值返回空串', () => {
    expect(CommonKit().escapeHtml('')).toBe('');
    expect(CommonKit().escapeHtml(null)).toBe('');
    expect(CommonKit().escapeHtml(undefined)).toBe('');
  });
});

describe('CommonKit.getMatchTypeLabel', () => {
  it('四种类型中文标签', () => {
    for (const [type, label] of CommonKit().MATCH_TYPES) {
      expect(CommonKit().getMatchTypeLabel(type)).toBe(label);
    }
  });
  it('未知类型回退为 包含', () => {
    expect(CommonKit().getMatchTypeLabel('unknown')).toBe('包含');
  });
  it('MATCH_TYPES 顺序为 包含/精确/正则/通配', () => {
    expect(CommonKit().MATCH_TYPES.map((t) => t[0])).toEqual(['contains', 'exact', 'regex', 'wildcard']);
  });
});

describe('CommonKit.uid', () => {
  it('带前缀与不带前缀', () => {
    expect(CommonKit().uid('tmp_', 5)).toMatch(/^tmp_[0-9a-z]+$/);
    expect(CommonKit().uid()).toMatch(/^[0-9a-z]+$/);
    expect(CommonKit().uid('s_', 5)).toMatch(/^s_[0-9a-z]+$/);
  });
  it('随机段长度受 randomLen 控制', () => {
    const id = CommonKit().uid('', 5);
    // 时间戳段 36 进制 + 5 位随机
    expect(id.length).toBeGreaterThan(6);
  });
  it('两次生成不同', () => {
    expect(CommonKit().uid('x_')).not.toBe(CommonKit().uid('x_'));
  });
});