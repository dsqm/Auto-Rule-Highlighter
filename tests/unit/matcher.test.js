import { beforeAll, describe, expect, it } from 'vitest';
import { loadUtils, Matcher } from '../helpers/load-utils.js';

beforeAll(loadUtils);
const M = () => Matcher();

describe('Matcher.matchUrl（URL 匹配）', () => {
  it('contains：子串包含', () => {
    expect(M().matchUrl('https://github.com/a/b', 'github.com', 'contains')).toBe(true);
    expect(M().matchUrl('https://a.com', 'b.com', 'contains')).toBe(false);
  });
  it('exact：完全相等', () => {
    expect(M().matchUrl('https://github.com', 'https://github.com', 'exact')).toBe(true);
    expect(M().matchUrl('https://github.com/', 'https://github.com', 'exact')).toBe(false);
  });
  it('regex：正则匹配，非法正则不抛错', () => {
    expect(M().matchUrl('abc123def', '\\d+', 'regex')).toBe(true);
    expect(M().matchUrl('abcdef', '\\d+', 'regex')).toBe(false);
    expect(M().matchUrl('abc', '([', 'regex')).toBe(false);
  });
  it('wildcard：* 与 ?', () => {
    expect(M().matchUrl('https://x.github.com/page', '*github.com*', 'wildcard')).toBe(true);
    // ? 匹配恰好一个字符
    expect(M().matchUrl('https://github.comx', 'https://github.com?', 'wildcard')).toBe(true);
    expect(M().matchUrl('https://github.com', 'https://github.com?', 'wildcard')).toBe(false);
  });
  it('空 pattern 一律不匹配', () => {
    expect(M().matchUrl('anything', '', 'contains')).toBe(false);
  });
  it('未知匹配类型回退为 contains', () => {
    expect(M().matchUrl('abc', 'b', 'weird')).toBe(true);
  });
});

describe('Matcher.getMatches（文本匹配）', () => {
  it('contains 大小写不敏感默认', () => {
    const ms = M().getMatches('Hello Hello', 'hello', 'contains', false);
    expect(ms).toHaveLength(2);
    expect(ms[0]).toEqual({ start: 0, end: 5, text: 'Hello' });
  });
  it('contains 区分大小写', () => {
    expect(M().getMatches('Hello hello', 'hello', 'contains', true)).toHaveLength(1);
  });
  it('精确匹配不命中子串', () => {
    const ms = M().getMatches('aaa', 'a', 'exact', false);
    expect(ms).toHaveLength(0);
    expect(M().getMatches('foo', 'foo', 'exact', false)).toHaveLength(1);
  });
  it('regex 全部命中并给出 start/end/text', () => {
    const ms = M().getMatches('a1b22', '\\d+', 'regex', false);
    expect(ms).toHaveLength(2);
    expect(ms[0]).toEqual({ start: 1, end: 2, text: '1' });
    expect(ms[1]).toEqual({ start: 3, end: 5, text: '22' });
  });
  it('wildcard 与关键字一致', () => {
    const ms = M().getMatches('abc12', 'abc*', 'wildcard', false);
    expect(ms).toHaveLength(1);
    expect(ms[0].text).toBe('abc12');
  });
  it('空关键字 / 空文本返回空数组', () => {
    expect(M().getMatches('', 'x', 'contains', false)).toEqual([]);
    expect(M().getMatches('text', '', 'contains', false)).toEqual([]);
  });
  it('零宽匹配不产生死循环', () => {
    // 空正则或 ^ 锚点会产生零宽匹配，必须跳进避免死循环
    const ms = M().getMatches('abc', '^', 'regex', false);
    expect(Array.isArray(ms)).toBe(true);
  });
});

describe('Matcher.hasMatch', () => {
  it('等价于 getMatches 的非空判断', () => {
    const cases = [
      ['abc', 'b', 'contains', false],
      ['abc', 'B', 'contains', true],
      ['abc', 'b', 'contains', true],
      ['foo bar', 'foo*', 'wildcard', false]
    ];
    for (const [text, kw, type, cs] of cases) {
      expect(M().hasMatch(text, kw, type, cs)).toBe(M().getMatches(text, kw, type, cs).length > 0);
    }
  });
});