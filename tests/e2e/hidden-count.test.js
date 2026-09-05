// E2E：隐藏区域内的命中不应计入 popup 计数与箭头跳转（与 Ctrl+F 口径一致）
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  findTabIdByUrl, launchExtension, openExtPage, sendToTab
} from './helpers.js';

let ctx;
let host;

const TMP_TEXT = '发货通知';

async function newPage() {
  return ctx.browser.newPage();
}

beforeAll(async () => {
  ctx = await launchExtension();
  host = await openExtPage(ctx.browser, ctx.extId, 'popup/popup.html');
}, 120000);

afterAll(async () => {
  if (ctx && ctx.browser) await ctx.browser.close();
  if (ctx && ctx.server) await ctx.server.close();
}, 60000);

describe('E2E：隐藏区域内命中不计入计数与跳转', () => {
  it('display:none 区域内的命中不计入 popup 计数，箭头也跳不到', async () => {
    const url = `${ctx.baseUrl}/hidden-page.html`;
    const page = await newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 1500));

    // 右键菜单路径添加临时关键词
    const tabId = await findTabIdByUrl(host, url);
    await sendToTab(host, tabId, { type: 'CONTEXT_ADD_HIGHLIGHT', text: TMP_TEXT });

    // 等到 3 个 mark 全部建出来（含隐藏区域那个）
    await page.waitForFunction(() => document.querySelectorAll('ah-mark').length >= 3, { timeout: 15000 });

    const kwId = await page.evaluate(() => {
      const m = document.querySelector('ah-mark');
      return m && m.dataset.ahKeywordId;
    });
    expect(kwId).toBeTruthy();
    expect(kwId.indexOf('tmp_')).toBe(0);

    // 内容脚本口径的计数（popup 计数 = 各 frame 此口径聚合）
    const countResp = await sendToTab(host, tabId, { type: 'GET_HIGHLIGHT_COUNT' });
    const counted = countResp.byKeyword[kwId] || 0;

    // 箭头跳转目标数（GET_KW_COUNT → getVisibleKwGroups）
    const navResp = await sendToTab(host, tabId, { type: 'GET_KW_COUNT', kwId: kwId });

    // 图标角标（updateBadge → UPDATE_BADGE → chrome.action.setBadgeText）
    await new Promise((r) => setTimeout(r, 500));
    const badge = await host.evaluate((tid) => chrome.action.getBadgeText({ tabId: tid }), tabId);

    // 可见命中只有 2 处：隐藏区域那处不应计数、不应可跳转、不应计入角标
    expect(counted).toBe(2);
    expect(navResp.count).toBe(2);
    expect(badge).toBe('2');

    // rail（右侧栏）也不应包含隐藏区域里的命中
    await new Promise((r) => setTimeout(r, 500));
    const railDots = await page.evaluate(() => {
      const rail = document.querySelector('#ah-rail');
      if (!rail) return -1;
      return rail.querySelectorAll('.ah-rail-mark').length;
    });
    expect(railDots).toBe(2);

    await page.close();
  }, 30000);

  it('iframe 里的命中也计入图标角标（后台按 frame 求和）', async () => {
    const url = `${ctx.baseUrl}/iframe-page.html`;
    const page = await newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 2500)); // 等主框架 + iframe 两个内容脚本就绪

    // sendToTab 广播到所有 frame：主框架与 iframe 各自走一遍右键添加链路
    const tabId = await findTabIdByUrl(host, url);
    await sendToTab(host, tabId, { type: 'CONTEXT_ADD_HIGHLIGHT', text: TMP_TEXT });

    // 主框架 1 处 + iframe（test-page.html）1 处 = 2 个 mark
    await page.waitForFunction(() => document.querySelectorAll('ah-mark').length >= 1, { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 800)); // 等 iframe frame 的角标上报

    const badge = await host.evaluate((tid) => chrome.action.getBadgeText({ tabId: tid }), tabId);
    expect(badge).toBe('2');

    await page.close();
  }, 30000);
});
