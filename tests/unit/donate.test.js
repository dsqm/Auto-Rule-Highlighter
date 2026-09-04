import { beforeAll, describe, expect, it } from 'vitest';
import { DonateKit, loadUtils } from '../helpers/load-utils.js';

beforeAll(() => {
  loadUtils();
});

const D = () => DonateKit();

/** 造 n 条规则，第 index 条规则带 kw 个关键词 */
function makeRules(n, kwPerRule) {
  const rules = [];
  for (let i = 0; i < n; i++) {
    const kws = [];
    for (let j = 0; j < (kwPerRule || 0); j++) kws.push({ id: 'k' + i + j, text: 't' + i + j });
    rules.push({ id: 'r' + i, urlPattern: 'example' + i + '.com', keywords: kws });
  }
  return rules;
}

describe('DonateKit.evaluate（规则规模与触发判断）', () => {
  it('空规则：不触发', () => {
    const st = D().evaluate([]);
    expect(st.ruleCount).toBe(0);
    expect(st.totalKeywords).toBe(0);
    expect(st.maxKeywords).toBe(0);
    expect(st.triggered).toBe(false);
  });

  it('4 条规则 + 每站 4 个关键词：不触发（刚好差一个）', () => {
    const st = D().evaluate(makeRules(4, 4));
    expect(st.ruleCount).toBe(4);
    expect(st.totalKeywords).toBe(16);
    expect(st.maxKeywords).toBe(4);
    expect(st.triggered).toBe(false);
  });

  it('满 5 条规则：触发', () => {
    const st = D().evaluate(makeRules(5, 0));
    expect(st.ruleCount).toBe(5);
    expect(st.triggered).toBe(true);
  });

  it('仅 1 条规则但该站 5 个关键词：触发', () => {
    const st = D().evaluate(makeRules(1, 5));
    expect(st.ruleCount).toBe(1);
    expect(st.maxKeywords).toBe(5);
    expect(st.triggered).toBe(true);
  });

  it('多站时：总数累加、上限取最大值，且缺 keywords 字段不报错', () => {
    const rules = makeRules(2, 3);            // 3 + 3
    rules[1].keywords = makeRules(1, 6)[0].keywords; // 第二个站改为 6 个
    rules.push({ id: 'rx', urlPattern: 'x.com' });   // 无 keywords
    const st = D().evaluate(rules);
    expect(st.ruleCount).toBe(3);
    expect(st.totalKeywords).toBe(9);  // 3 + 6 + 0
    expect(st.maxKeywords).toBe(6);
    expect(st.triggered).toBe(true);
  });
});

describe('DonateKit.isDismissed（关闭与冷却）', () => {
  it('默认设置：不关闭', () => {
    expect(D().isDismissed({})).toBe(false);
    expect(D().isDismissed({ donateDismissed: false, donateLastVisitAt: 0 })).toBe(false);
  });

  it('点过「不再提示」：永久关闭', () => {
    expect(D().isDismissed({ donateDismissed: true })).toBe(true);
  });

  it('刚点过「去看看」：冷却期内关闭', () => {
    expect(D().isDismissed({ donateLastVisitAt: Date.now() - 1000 })).toBe(true);
  });

  it('冷却期过后：重新允许提醒', () => {
    const past = Date.now() - D().COOLDOWN_MS - 1000;
    expect(D().isDismissed({ donateLastVisitAt: past })).toBe(false);
  });

  it('donateDismissed 优先于冷却期计算', () => {
    expect(D().isDismissed({ donateDismissed: true, donateLastVisitAt: 0 })).toBe(true);
  });
});
