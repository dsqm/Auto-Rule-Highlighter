// E2E：临时高亮跨网页（tab 范围跳转/新标签页继承/global 范围）
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  findTabIdByUrl, launchExtension, openExtPage, sendToTab
} from './helpers.js';

let ctx;
let host;

const TMP_TEXT = '发货通知';

/** 与右键「添加高亮」一致：经内容脚本真实链路，sender.tab 由浏览器填充 */
async function addTempKwViaContent(page) {
  const tabId = await findTabIdByUrl(host, page.url());
  return sendToTab(host, tabId, { type: 'CONTEXT_ADD_HIGHLIGHT', text: TMP_TEXT });
}

async function markCount(page) {
  return page.evaluate(() => {
    const marks = document.querySelectorAll('ah-mark');
    let n = 0;
    for (const m of marks) {
      if ((m.dataset.ahKeywordId || '').indexOf('tmp_') === 0) n++;
    }
    return n;
  });
}

async function waitTmpMarks(page, min = 1, timeout = 15000) {
  const start = Date.now();
  let last = -1;
  while (Date.now() - start < timeout) {
    last = await markCount(page);
    if (last >= min) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timeout waiting tmp marks, last=${last}`);
}

/** 新建页面并挂上控制台日志收集（内容脚本的日志会出现在页面控制台） */
let pageSeq = 0;
async function newPage() {
  const p = await ctx.browser.newPage();
  const label = `P${++pageSeq}`;
  p.on('console', (m) => {
    const t = m.text();
    if (t.indexOf('[AHTMP') >= 0) {
      let u = '';
      try { u = new URL(p.url()).pathname; } catch (e) {}
      console.log(`[${label}${u}]`, t);
    }
  });
  p.on('pageerror', (e) => console.log(`[${label}]`, 'pageerror', e.message));
  return p;
}

beforeAll(async () => {
  ctx = await launchExtension();
  host = await openExtPage(ctx.browser, ctx.extId, 'popup/popup.html');
}, 120000);

afterAll(async () => {
  if (ctx && ctx.browser) await ctx.browser.close();
  if (ctx && ctx.server) await ctx.server.close();
}, 60000);

describe('E2E：临时高亮跨网页（tab 范围）', () => {
  it('同标签页跳转后临时高亮仍在', async () => {
    const urlA = `${ctx.baseUrl}/test-page.html`;
    const page = await newPage();
    await page.goto(urlA, { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 1500)); // 等内容脚本初始化完成

    const resp = await addTempKwViaContent(page);
    console.log('[diag] CONTEXT_ADD resp =', JSON.stringify(resp));
    const stored = await host.evaluate(async () => {
      const d = await chrome.storage.local.get('ah_temp_keywords');
      return d.ah_temp_keywords || null;
    });
    console.log('[diag] storage =', JSON.stringify(stored));
    await waitTmpMarks(page);

    // 同标签页跳到另一个页面
    await page.goto(`${ctx.baseUrl}/cross-page.html`, { waitUntil: 'domcontentloaded' });
    await waitTmpMarks(page);
    expect(await markCount(page)).toBeGreaterThanOrEqual(1);
    await page.close();
  }, 30000);

  it('target=_blank 新标签页继承来源标签页的临时高亮', async () => {
    const urlA = `${ctx.baseUrl}/test-page.html`;
    const page = await newPage();
    await page.goto(urlA, { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 1500));

    await addTempKwViaContent(page);
    await waitTmpMarks(page);

    // 用 target=_blank 链接触发真实的「新标签页继承」链路
    await page.evaluate((href) => {
      const a = document.createElement('a');
      a.href = href;
      a.target = '_blank';
      a.id = '__inherit_link__';
      a.textContent = 'open new tab';
      a.style.display = 'block';
      a.style.width = '200px';
      a.style.height = '30px';
      document.body.appendChild(a);
    }, `${ctx.baseUrl}/cross-page.html`);
    await page.click('#__inherit_link__');
    // 等待新标签页出现（轮询 browser.pages，兼容各版本 puppeteer API）
    const crossUrl = `${ctx.baseUrl}/cross-page.html`;
    let newPg = null;
    for (let i = 0; i < 60 && !newPg; i++) {
      const pages = await ctx.browser.pages();
      newPg = pages.find((pg) => pg.url() === crossUrl && pg !== page) || null;
      if (!newPg) await new Promise((r) => setTimeout(r, 250));
    }
    expect(newPg).toBeTruthy();
    await waitTmpMarks(newPg);
    expect(await markCount(newPg)).toBeGreaterThanOrEqual(1);
    await newPg.close();
    await page.close();
  }, 30000);
});

describe('E2E：临时高亮跨网页（global 范围）', () => {
  it('全局范围：任一标签页添加后，其他标签页也能高亮', async () => {
    // 切到 global 范围（与 options 页保存方式一致）
    await host.evaluate(() => chrome.storage.sync.set({
      ah_settings: { showRail: true, tempScope: 'global' }
    }));

    const urlA = `${ctx.baseUrl}/test-page.html`;
    const page = await newPage();
    await page.goto(urlA, { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 1500));

    const resp = await addTempKwViaContent(page);
    console.log('[diag-global] CONTEXT_ADD resp =', JSON.stringify(resp));
    await waitTmpMarks(page, 1, 20000);

    // 另开一个全新标签页（不继承），global 范围下也应显示
    const pageB = await newPage();
    await pageB.goto(`${ctx.baseUrl}/cross-page.html`, { waitUntil: 'domcontentloaded' });
    await waitTmpMarks(pageB, 1, 20000);
    expect(await markCount(pageB)).toBeGreaterThanOrEqual(1);

    await page.close();
    await pageB.close();
    // 恢复默认范围
    await host.evaluate(() => chrome.storage.sync.set({
      ah_settings: { showRail: true, tempScope: 'tab' }
    }));
  }, 40000);
});
