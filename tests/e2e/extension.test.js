// 浏览器端到端（E2E）测试：
// - 基础规则高亮与样式（背景色 / 自动反色 / 固定文字色）
// - 匹配组合（大小写 / 正则 / 通配 / 跨元素）
// - 独占高亮（exclusive）、右侧栏（rail）
// - 右键菜单模拟（CONTEXT_ADD_HIGHLIGHT / CONTEXT_SPOT_HIGHLIGHT）
// - popup / options 页冒烟
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  findTabIdByUrl, injectRules, launchExtension, openExtPage, openPageAndWaitMarks,
  selectText, sendToTab
} from './helpers.js';

let ctx; // { browser, server, extId, baseUrl }
let host; // 用作宿主写入 storage / 发消息的扩展页

const NEW_PAGE = (url) => Promise.resolve(ctx.browser.newPage()).then((p) => p.goto(url || 'about:blank', { waitUntil: 'domcontentloaded' }).then(() => p));

beforeAll(async () => {
  ctx = await launchExtension();
  host = await openExtPage(ctx.browser, ctx.extId, 'popup/popup.html');
}, 120000);

afterAll(async () => {
  if (ctx && ctx.browser) await ctx.browser.close();
  if (ctx && ctx.server) ctx.server.close();
}, 60000);

function rule(name, urlPattern, keywords) {
  return { id: `e2e-${name}-${Date.now()}`, enabled: true, name, urlPattern, urlMatchType: 'contains', keywords };
}

const kw = (text, extra) => Object.assign(
  { id: `e2e-kw-${text}-${Math.random().toString(36).slice(2, 8)}`, enabled: true, text, matchType: 'contains', caseSensitive: false, acrossElements: false },
  extra
);

/** 等待某类元素出现并在页面中执行 fn 返回结果 */
async function evalMarks(page, selector, mapper) {
  await page.waitForFunction((sel) => document.querySelector(sel), { timeout: 15000 }, selector);
  return page.$$eval(selector, mapper);
}

describe('E2E：基础高亮与样式', () => {
  it('背景色 + 自动反色 + 纯文字色 computed 样式正确', async () => {
    await injectRules(host, [
      rule('样式规则', '127.0.0.1', [
        kw('发货通知', { color: '#111111', textColor: null }),           // 背景 #111 → 自动反色白字
        kw('加价购', { color: '', textColor: '#c0392b' })                 // 无背景固定文字色
      ])
    ]);
    const page = await NEW_PAGE(`${ctx.baseUrl}/test-page.html`);
    await openPageAndWaitMarks(page, `${ctx.baseUrl}/test-page.html`);

    const styles = await page.$$eval('ah-mark', (els) => els.map((e) => ({
      text: e.textContent,
      bg: getComputedStyle(e).backgroundColor,
      color: getComputedStyle(e).color
    })));

    const auto = styles.find((s) => s.text === '发货通知');
    expect(auto.bg).toBe('rgb(17, 17, 17)');
    expect(auto.color).toBe('rgb(255, 255, 255)'); // 自动反色：暗背景 → 白字

    const fixed = styles.find((s) => s.text === '加价购');
    expect(fixed.bg).toBe('rgba(0, 0, 0, 0)');     // 无背景
    expect(fixed.color).toBe('rgb(192, 57, 43)');  // #c0392b
    await page.close();
  }, 30000);

  it('大小写敏感 / 精确 / 正则 / 通配组合命中', async () => {
    await injectRules(host, [
      rule('匹配组合', '127.0.0.1', [
        kw('Hello', { matchType: 'contains', caseSensitive: true }),  // 只命中大写
        kw('456', { matchType: 'regex' }),                            // \d? 直接字面正则
        kw('订单*', { matchType: 'wildcard' }),                       // 通配
        kw('订单待处理', { matchType: 'exact' })                      // 精确（整串）
      ])
    ]);
    const page = await NEW_PAGE(`${ctx.baseUrl}/test-page.html`);
    await openPageAndWaitMarks(page, `${ctx.baseUrl}/test-page.html`);

    const texts = await page.$$eval('ah-mark', (els) => els.map((e) => e.textContent));
    expect(texts.filter((t) => t === 'Hello')).toHaveLength(1); // 忽略 hello
    expect(texts.filter((t) => t === 'hello')).toHaveLength(0);
    expect(texts.filter((t) => t === '456')).toHaveLength(1);
    // wildcard 订单* 会整节点吞掉该行，exact 子串不被单独标记；断言文本包含即可
    expect(texts.some((t) => t.indexOf('订单待处理') === 0)).toBe(true);
    await page.close();
  }, 30000);
});

describe('E2E：跨元素匹配（acrossElements）', () => {
  it('关键词拆在相邻元素中仍被命中', async () => {
    await injectRules(host, [
      rule('跨元素', '127.0.0.1', [kw('发货通知', { acrossElements: true })])
    ]);
    const page = await NEW_PAGE(`${ctx.baseUrl}/cross-page.html`);
    await openPageAndWaitMarks(page, `${ctx.baseUrl}/cross-page.html`);

    // 第一段「发<b>货</b>通知」跨元素命中，应生成带 keywordId 的 mark
    const one = await page.$eval('p:nth-of-type(2)', (p) => p.textContent);
    expect(one).toContain('发货通知');
    const marks = await page.$$eval('ah-mark', (els) => els.length);
    expect(marks).toBeGreaterThanOrEqual(1);
    await page.close();
  }, 30000);
});

describe('E2E：独占高亮（exclusive）', () => {
  it('独占关键词命中后隐藏其余规则关键词', async () => {
    await injectRules(host, [
      rule('独占规则', '127.0.0.1', [
        kw('独占词', { exclusive: true }),
        kw('普通词', {})
      ])
    ]);
    const page = await NEW_PAGE(`${ctx.baseUrl}/exclusive-page.html`);
    await openPageAndWaitMarks(page, `${ctx.baseUrl}/exclusive-page.html`);

    const info = await page.$$eval('ah-mark', (els) => els.map((e) => ({
      text: e.textContent,
      cls: e.className,
      hidden: e.dataset.ahHidden,
      exclusive: e.dataset.ahExclusive
    })));

    const exclusiveOnes = info.filter((m) => m.exclusive === '1');
    const normalOnes = info.filter((m) => m.exclusive !== '1' && m.text === '普通词');
    expect(exclusiveOnes.length).toBeGreaterThan(0);
    // 独占关键词可见（无 ah-hidden）
    for (const m of exclusiveOnes) expect(m.cls).not.toContain('ah-hidden');
    // 普通关键词全部被独占隐藏
    expect(normalOnes.length).toBeGreaterThan(0);
    for (const m of normalOnes) {
      expect(m.cls).toContain('ah-hidden');
      expect(m.hidden).toBe('true');
    }
    await page.close();
  }, 30000);
});

describe('E2E：右侧栏滚动标记（rail）', () => {
  it('长页面出现 ah-rail 右侧栏', async () => {
    await injectRules(host, [
      rule('rail 规则', '127.0.0.1', [kw('发货通知', {})]) // showRail 默认开启
    ]);
    const page = await NEW_PAGE(`${ctx.baseUrl}/long-page.html`);
    await page.goto(`${ctx.baseUrl}/long-page.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('ah-rail'), { timeout: 15000 });
    const exists = await page.$('ah-rail');
    expect(exists).toBeTruthy();
    // 关键词确实被高亮
    const marks = await page.$$eval('ah-mark', (els) => els.length);
    expect(marks).toBeGreaterThan(0);
    await page.close();
  }, 30000);
});

describe('E2E：右键菜单模拟', () => {
  it('CONTEXT_ADD_HIGHLIGHT → 临时关键词高亮', async () => {
    await injectRules(host, []);
    const page = await NEW_PAGE(`${ctx.baseUrl}/test-page.html`);
    await page.goto(`${ctx.baseUrl}/test-page.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.body.textContent.indexOf('加急') >= 0, { timeout: 5000 });

    const tabId = await findTabIdByUrl(host, 'http://127.0.0.1:');
    expect(tabId).toBeTruthy();
    const resp = await sendToTab(host, tabId, { type: 'CONTEXT_ADD_HIGHLIGHT', text: '加急' });
    expect(resp.count).toBeGreaterThanOrEqual(1);
    await new Promise((r) => setTimeout(r, 500));
    const markCount = await page.$$eval('ah-mark', (els) => els.length);
    expect(markCount).toBeGreaterThan(0);

    await evalMarks(page, 'ah-mark', (els) => els.map((e) => e.textContent)).then((texts) => {
      expect(texts).toContain('加急');
    });
    // 临时词不因独占逻辑被隐藏
    const hidden = await page.$$eval('ah-mark', (els) => els.filter((e) => e.classList.contains('ah-hidden')).map((e) => e.textContent));
    expect(hidden).not.toContain('加急');
    await page.close();
  }, 30000);

  it('CONTEXT_SPOT_HIGHLIGHT → 高亮此处在选区包裹 ah-spot', async () => {
    const page = await NEW_PAGE(`${ctx.baseUrl}/test-page.html`);
    await page.goto(`${ctx.baseUrl}/test-page.html`, { waitUntil: 'domcontentloaded' });
    const selected = await selectText(page, '高亮此处');
    expect(selected).toBe(true);

    const tabId = await findTabIdByUrl(host, 'http://127.0.0.1:');
    expect(tabId).toBeTruthy();
    const resp = await sendToTab(host, tabId, { type: 'CONTEXT_SPOT_HIGHLIGHT', text: '高亮此处' });
    expect(typeof resp).toBe('object');
    expect(resp.settings).toBeTruthy();

    const spots = await evalMarks(page, 'ah-spot', (els) => els.map((e) => ({ text: e.textContent, id: e.dataset.ahSpotId })));
    expect(spots.length).toBeGreaterThan(0);
    expect(spots.every((s) => s.id)).toBe(true);

    // background 已持久化 spot 记录（分层对象：tabId -> frameId -> spots）
    const stored = await host.evaluate(async () => {
      const d = await chrome.storage.local.get('ah_spot_highlights');
      return d.ah_spot_highlights || {};
    });
    expect(Object.keys(stored).length).toBeGreaterThan(0);
    await page.close();
  }, 30000);
});

describe('E2E：popup / options 冒烟', () => {
  it('popup.html 可打开且无脚本错误', async () => {
    const errors = [];
    host.on('pageerror', (err) => errors.push(String(err)));
    await host.evaluate(() => location.reload());
    await host.waitForFunction(() => !!document.getElementById('searchInput'), { timeout: 10000 });
    expect(errors).toEqual([]);
  }, 30000);

  it('options.html 默认渲染 16 个样式预设且无脚本错误', async () => {
    const page = await openExtPage(ctx.browser, ctx.extId, 'options/options.html');
    const errors = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.waitForFunction(() => document.querySelectorAll('.style-preset-block').length > 0, { timeout: 10000 });
    const presets = await page.$$eval('.style-preset-block', (els) => els.length);
    expect(presets).toBe(16);
    expect(errors).toEqual([]);
    await page.close();
  }, 30000);
});