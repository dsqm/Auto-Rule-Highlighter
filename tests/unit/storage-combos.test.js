// Storage 层的各种设置与组合测试：
// - CommonKit.normalizeTempScope / isTempKwId（统一后的唯一校验入口）
// - Storage.getMatchedRules（优先级 / enabled / 四种匹配类型组合）
// - Storage.getSettings（默认值完整性 / 部分覆盖）
// - 存储模式（sync ↔ local）与 QUOTA 溢出自动降级
// - 规则与关键词 CRUD 的默认字段填充
// - spot 变体方法（跨 frame 合并 / 删除 / 改样式）
import { beforeEach, describe, expect, it } from 'vitest';
import { CommonKit, loadUtils, StorageFromGlobal } from '../helpers/load-utils.js';

loadUtils();

const S = () => StorageFromGlobal();

// 每个 case 重建干净的 chrome mock 与 Storage 单例状态
// （_fallbackChecked / _isLocal 是单例字段，测试间必须复位）
let syncStore;
let localStore;
let syncSetShouldThrow = null;

function makeBackend(store, isLocal) {
  return {
    get: async (keys) => {
      if (typeof keys === 'string') keys = [keys];
      const out = {};
      for (const k of keys) if (k in store) out[k] = JSON.parse(JSON.stringify(store[k]));
      return out;
    },
    set: async (obj) => {
      if (isLocal === 'sync' && syncSetShouldThrow) throw syncSetShouldThrow;
      Object.assign(store, JSON.parse(JSON.stringify(obj)));
    },
    remove: async (keys) => {
      for (const k of [].concat(keys)) delete store[k];
    },
    getBytesInUse: async (keys, cb) => { cb(0); }
  };
}

beforeEach(() => {
  syncStore = {};
  localStore = {};
  syncSetShouldThrow = null;
  globalThis.chrome = {
    storage: { sync: makeBackend(syncStore, 'sync'), local: makeBackend(localStore, 'local') },
    runtime: {}
  };
  S()._fallbackChecked = false;
  S()._isLocal = false;
});

describe('CommonKit.normalizeTempScope（生效范围唯一校验）', () => {
  it('三个合法值原样通过', () => {
    expect(CommonKit().normalizeTempScope('page')).toBe('page');
    expect(CommonKit().normalizeTempScope('tab')).toBe('tab');
    expect(CommonKit().normalizeTempScope('global')).toBe('global');
  });
  it('非法值全部回退 tab', () => {
    for (const v of [undefined, null, '', 'PAGE', 'tab ', 'all', 0, true, {}]) {
      expect(CommonKit().normalizeTempScope(v)).toBe('tab');
    }
  });
});

describe('CommonKit.isTempKwId（临时关键词唯一判定）', () => {
  it('tmp_ 前缀为真', () => {
    expect(CommonKit().isTempKwId('tmp_abc123')).toBe(true);
  });
  it('规则关键词 id / 空串 / 前缀变体为假', () => {
    expect(CommonKit().isTempKwId('kw_abc')).toBe(false);
    expect(CommonKit().isTempKwId('tmp')).toBe(false);
    expect(CommonKit().isTempKwId('tmpX')).toBe(false);
    expect(CommonKit().isTempKwId(' tmp_x')).toBe(false);
    expect(CommonKit().isTempKwId('')).toBe(false);
  });
  it('非字符串（null / undefined / 数字）为假，不抛错', () => {
    for (const v of [null, undefined, 123, {}]) {
      expect(CommonKit().isTempKwId(v)).toBe(false);
    }
  });
});

describe('Storage.getMatchedRules（规则匹配组合）', () => {
  const rule = (name, urlPattern, urlMatchType, enabled = true) => ({
    id: `r-${name}`, name, urlPattern, urlMatchType, enabled, keywords: []
  });

  it('顺序即优先级：多条规则命中时只有最上方一条生效', async () => {
    syncStore.ah_rules = [
      rule('第一条', 'github.com', 'contains'),
      rule('第二条', 'github', 'contains')
    ];
    const matched = await S().getMatchedRules('https://github.com/a');
    expect(matched).toHaveLength(1);
    expect(matched[0].name).toBe('第一条');
  });

  it('禁用的规则跳过，继续往后匹配', async () => {
    syncStore.ah_rules = [
      rule('禁用规则', 'github.com', 'contains', false),
      rule('可用规则', 'github', 'contains')
    ];
    const matched = await S().getMatchedRules('https://github.com/a');
    expect(matched).toHaveLength(1);
    expect(matched[0].name).toBe('可用规则');
  });

  it('四种匹配类型各自生效', async () => {
    syncStore.ah_rules = [rule('r', 'x', 'contains')];
    const m = async (pattern, type, url) => {
      syncStore.ah_rules = [rule('r', pattern, type)];
      return (await S().getMatchedRules(url)).length === 1;
    };
    expect(await m('example.com', 'contains', 'https://example.com/a')).toBe(true);
    expect(await m('https://example.com', 'exact', 'https://example.com')).toBe(true);
    expect(await m('https://example\\.com/\\d+', 'regex', 'https://example.com/123')).toBe(true);
    expect(await m('https://*.example.com/*', 'wildcard', 'https://a.example.com/b')).toBe(true);
    // 反向：各自类型不命中的样例
    expect(await m('example.org', 'contains', 'https://example.com')).toBe(false);
    expect(await m('https://example.com', 'exact', 'https://example.com/')).toBe(false);
    expect(await m('https://example\\.com/\\d+', 'regex', 'https://example.com/abc')).toBe(false);
    expect(await m('https://*.example.com/*', 'wildcard', 'https://example.com/b')).toBe(false);
  });

  it('全部未命中返回空数组', async () => {
    syncStore.ah_rules = [rule('r', 'nomatch', 'contains')];
    expect(await S().getMatchedRules('https://example.com')).toEqual([]);
  });

  it('空规则表返回空数组', async () => {
    expect(await S().getMatchedRules('https://example.com')).toEqual([]);
  });

  it('wildcard 中正则特殊字符按字面匹配（+ . 等需转义）', async () => {
    syncStore.ah_rules = [rule('r', 'a+b.c/*', 'wildcard')];
    expect((await S().getMatchedRules('a+b.c/x')).length).toBe(1);
    // 'a+b.c' 里 + 是字面量：'aab.c' 不应命中
    expect(await S().getMatchedRules('aab.c/x')).toEqual([]);
  });

  it('regex 默认区分大小写', async () => {
    syncStore.ah_rules = [rule('r', 'GitHub', 'regex')];
    expect((await S().getMatchedRules('https://GitHub.com')).length).toBe(1);
    expect(await S().getMatchedRules('https://github.com')).toEqual([]);
  });
});

describe('Storage.getSettings（默认值完整性与部分覆盖）', () => {
  it('默认值包含全部关键设置字段', async () => {
    const s = await S().getSettings();
    for (const key of ['showRail', 'stylePresets', 'tempStyle', 'historyEnabled', 'tempHistory',
      'tempScope', 'defaultMatchType', 'defaultCaseSensitive', 'defaultAcrossElements',
      'contextMenuEnabled', 'openPopupOnAdd', 'donateDismissed', 'donateLastVisitAt']) {
      expect(s).toHaveProperty(key);
    }
    expect(s.tempScope).toBe('tab');
    expect(s.defaultMatchType).toBe('contains');
  });

  it('部分覆盖：只存一个字段，其余取默认', async () => {
    syncStore.ah_settings = { tempScope: 'global' };
    const s = await S().getSettings();
    expect(s.tempScope).toBe('global');
    expect(s.showRail).toBe(true);
    expect(s.historyEnabled).toBe(true);
  });

  it('覆盖值为 falsy 但显式存在时不被默认值吞掉（false / 0 / 空串）', async () => {
    syncStore.ah_settings = { showRail: false, donateLastVisitAt: 0 };
    const s = await S().getSettings();
    expect(s.showRail).toBe(false);
    expect(s.donateLastVisitAt).toBe(0);
  });
});

describe('Storage 存储模式与 QUOTA 降级', () => {
  it('默认走 sync 读写', async () => {
    await S().saveRules([{ id: 'a' }]);
    expect(syncStore.ah_rules).toHaveLength(1);
    expect(localStore.ah_rules).toBeUndefined();
    expect(await S().getRules()).toHaveLength(1);
  });

  it('STORAGE_MODE=local 时读写都走 local', async () => {
    localStore.ah_storage_mode = 'local'; // 模式标记存 local
    await S().saveRules([{ id: 'a' }]);
    expect(localStore.ah_rules).toHaveLength(1);
    expect(syncStore.ah_rules).toBeUndefined();
    expect(await S().getRules()).toHaveLength(1);
  });

  it('sync 写入溢出（QUOTA）：自动降级 local 并清理 sync 中的规则与设置', async () => {
    syncSetShouldThrow = new Error('QUOTA_BYTES exceeded');
    await S().saveRules([{ id: 'big' }]);
    expect(S().isLocal()).toBe(true);
    expect(localStore.ah_storage_mode).toBe('local'); // 模式标记写 local
    expect(localStore.ah_rules).toHaveLength(1);
    expect(syncStore.ah_rules).toBeUndefined();
    // 降级是持久的：后续读写继续走 local
    await S().saveSettings({ tempScope: 'page' });
    expect(localStore.ah_settings.tempScope).toBe('page');
    expect((await S().getSettings()).tempScope).toBe('page');
  });

  it('sync 写入其他错误：原样抛出，不降级', async () => {
    syncSetShouldThrow = new Error('network down');
    await expect(S().saveRules([{ id: 'x' }])).rejects.toThrow('network down');
    expect(S().isLocal()).toBe(false);
  });
});

describe('Storage 规则与关键词 CRUD 默认值', () => {
  it('addRule 填充 id / enabled / 空关键词表', async () => {
    const r = await S().addRule({ name: '测试', urlPattern: 'example.com', urlMatchType: 'contains' });
    expect(r.id).toBeTruthy();
    expect(r.enabled).toBe(true);
    expect(r.keywords).toEqual([]);
    expect((await S().getRules())).toHaveLength(1);
  });

  it('addKeyword 补齐缺省匹配字段，样式字段不设值（跟随全局默认）', async () => {
    const r = await S().addRule({ name: 'x', urlPattern: 'a', urlMatchType: 'contains' });
    const kw = await S().addKeyword(r.id, { text: '词' });
    expect(kw.enabled).toBe(true);
    expect(kw.matchType).toBe('contains');
    expect(kw.caseSensitive).toBe(false);
    expect(kw.acrossElements).toBe(false);
    expect(kw.showRail).toBe(true);
    expect(kw.exclusive).toBe(false);
    // 样式字段（color / textColor / fontSize / bold ...）不出现默认值
    expect('color' in kw).toBe(false);
    expect('textColor' in kw).toBe(false);
    // 显式传入的值不被覆盖
    const kw2 = await S().addKeyword(r.id, { text: 'b', matchType: 'regex', caseSensitive: true });
    expect(kw2.matchType).toBe('regex');
    expect(kw2.caseSensitive).toBe(true);
  });

  it('updateKeyword / deleteKeyword 只影响目标', async () => {
    const r = await S().addRule({ name: 'x', urlPattern: 'a', urlMatchType: 'contains' });
    const k1 = await S().addKeyword(r.id, { text: '一' });
    const k2 = await S().addKeyword(r.id, { text: '二' });
    await S().updateKeyword(r.id, k1.id, { text: '一改' });
    let rules = await S().getRules();
    expect(rules[0].keywords.find((k) => k.id === k1.id).text).toBe('一改');
    expect(rules[0].keywords.find((k) => k.id === k2.id).text).toBe('二');
    await S().deleteKeyword(r.id, k1.id);
    rules = await S().getRules();
    expect(rules[0].keywords).toHaveLength(1);
    expect(rules[0].keywords[0].id).toBe(k2.id);
  });

  it('updateRule / deleteRule 行为正确', async () => {
    const r = await S().addRule({ name: 'x', urlPattern: 'a', urlMatchType: 'contains' });
    await S().updateRule(r.id, { enabled: false, name: '改名' });
    let rules = await S().getRules();
    expect(rules[0].enabled).toBe(false);
    expect(rules[0].name).toBe('改名');
    await S().deleteRule(r.id);
    expect(await S().getRules()).toEqual([]);
  });
});

describe('Storage spot 变体方法（background 共用层）', () => {
  const data = (text) => ({ text, color: '#ffcc00', textColor: null, fontSize: 1, bold: false, italic: false, underline: false, strike: false });

  it('storeSpotHighlight：按 frame 分 key 写入，id 用调用方给的', async () => {
    await S().storeSpotHighlight(100, 0, 's_aaa', data('主框架'));
    await S().storeSpotHighlight(100, 2, 's_bbb', data('子框架'));
    const main = await S().getSpotHighlights(100, 0);
    expect(main).toHaveLength(1);
    expect(main[0].id).toBe('s_aaa');
    expect(main[0].bold).toBe(false);
  });

  it('getAllSpotHighlightsForTab：合并该 tab 下所有 frame 的 spot', async () => {
    await S().storeSpotHighlight(100, 0, 's_a', data('1'));
    await S().storeSpotHighlight(100, 2, 's_b', data('2'));
    await S().storeSpotHighlight(200, 0, 's_c', data('别的标签页'));
    const all = await S().getAllSpotHighlightsForTab(100);
    expect(all.map((s) => s.id).sort()).toEqual(['s_a', 's_b']);
  });

  it('deleteSpotHighlightForTab：扫遍所有 frame，跨 frame 删干净', async () => {
    await S().storeSpotHighlight(100, 0, 's_a', data('1'));
    await S().storeSpotHighlight(100, 2, 's_a', data('重复 id 在子 frame'));
    await S().storeSpotHighlight(100, 2, 's_b', data('留下'));
    await S().deleteSpotHighlightForTab(100, 's_a');
    const all = await S().getAllSpotHighlightsForTab(100);
    expect(all.map((s) => s.id)).toEqual(['s_b']);
  });

  it('updateSpotStyle：跨 frame 找到目标并合入样式；bgColor 空串表示清除背景', async () => {
    await S().storeSpotHighlight(100, 2, 's_a', data('1'));
    await S().updateSpotStyle(100, 's_a', { bgColor: '', textColor: '#ffffff', bold: true });
    const [spot] = await S().getSpotHighlights(100, 2);
    expect(spot.color).toBe('');
    expect(spot.textColor).toBe('#ffffff');
    expect(spot.bold).toBe(true);
    // style 中 undefined 的字段保持原值
    expect(spot.italic).toBe(false);
  });
});
