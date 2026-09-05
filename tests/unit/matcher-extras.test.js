// Matcher.getMatches 缺失的组合 + CommonKit.isExclusiveCleared（独占清除纯函数）
import { beforeAll, describe, expect, it } from 'vitest';
import { CommonKit, loadUtils, Matcher } from '../helpers/load-utils.js';

beforeAll(loadUtils);
const M = () => Matcher();

describe('Matcher.getMatches（正则 / 通配 / 大小写组合）', () => {
  it('regex 区分大小写：caseSensitive=false 加 i，true 不加', () => {
    expect(M().getMatches('AAA', 'aaa', 'regex', false)).toHaveLength(1);
    expect(M().getMatches('AAA', 'aaa', 'regex', true)).toHaveLength(0);
  });

  it('regex 里正则元字符按正则语义（. 匹配任意字符）', () => {
    expect(M().getMatches('axb', 'a.b', 'regex', false)).toHaveLength(1);
    expect(M().getMatches('a.b', 'a.b', 'regex', false)).toHaveLength(1);
  });

  it('wildcard 的 ? 匹配恰好一个字符', () => {
    expect(M().getMatches('abcd', 'a?cd', 'wildcard', false)).toHaveLength(1);
    expect(M().getMatches('acd', 'a?cd', 'wildcard', false)).toHaveLength(0);
  });

  it('wildcard 区分大小写受 caseSensitive 控制', () => {
    expect(M().getMatches('ABC12', 'abc*', 'wildcard', false)).toHaveLength(1);
    expect(M().getMatches('ABC12', 'abc*', 'wildcard', true)).toHaveLength(0);
  });

  it('contains 关键字含正则特殊字符按字面匹配', () => {
    expect(M().getMatches('价(含税)', '(含税)', 'contains', false)).toHaveLength(1);
    expect(M().getMatches('价含税', '(含税)', 'contains', false)).toHaveLength(0);
  });

  it('exact 大小写不敏感时忽略大小写', () => {
    expect(M().getMatches('Foo', 'foo', 'exact', false)).toHaveLength(1);
    expect(M().getMatches('Foo', 'foo', 'exact', true)).toHaveLength(0);
  });

  it('重复出现全部返回且位置正确', () => {
    const ms = M().getMatches('ab ab ab', 'ab', 'contains', false);
    expect(ms.map((m) => m.start)).toEqual([0, 3, 6]);
  });
});

describe('CommonKit.isExclusiveCleared（独占清除核心判定）', () => {
  it('临时词豁免', () => {
    expect(CommonKit().isExclusiveCleared(99, true, 0)).toBe(false);
  });
  it('stopOrder < 0（无独占词）不生效', () => {
    expect(CommonKit().isExclusiveCleared(99, false, -1)).toBe(false);
  });
  it('order > stopOrder 被清除，<= 保留', () => {
    expect(CommonKit().isExclusiveCleared(5, false, 4)).toBe(true);
    expect(CommonKit().isExclusiveCleared(4, false, 4)).toBe(false);
    expect(CommonKit().isExclusiveCleared(3, false, 4)).toBe(false);
  });
  it('order 为数字字符串 / undefined / NaN 均不误判', () => {
    expect(CommonKit().isExclusiveCleared('7', false, 4)).toBe(true);
    expect(CommonKit().isExclusiveCleared('2', false, 4)).toBe(false);
    expect(CommonKit().isExclusiveCleared(undefined, false, 4)).toBe(false);
    expect(CommonKit().isExclusiveCleared('abc', false, 4)).toBe(false);
  });
});
