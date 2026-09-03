// E2E 公共工具：启动带扩展的浏览器、注入规则、向测试页发送扩展消息
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '../..'); // tests/e2e -> 项目根
export const FIXTURES = path.join(__dirname, 'fixtures');

export function startStaticServer(dir) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const file = path.join(dir, req.url === '/' ? 'index.html' : path.basename(req.url));
      if (!fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
      const ext = path.extname(file);
      const type = ext === '.html' ? 'text/html; charset=utf-8' : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type });
      res.end(fs.readFileSync(file));
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

export async function launchExtension() {
  const server = await startStaticServer(FIXTURES);
  const browser = await puppeteer.launch({
    headless: true, // v22+ 新无头模式，支持扩展
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--window-size=800,600',
      `--disable-extensions-except=${ROOT}`,
      `--load-extension=${ROOT}`
    ]
  });
  // MV3 后台是 service worker target，加载后可见；host 即扩展 id
  const sw = await browser.waitForTarget(
    (t) => t.type() === 'service_worker' && t.url().includes('chrome-extension://'),
    { timeout: 30000 }
  );
  const extId = new URL(sw.url()).host;
  return {
    browser,
    server,
    extId,
    baseUrl: `http://127.0.0.1:${server.address().port}`
  };
}

export async function openExtPage(browser, extId, file) {
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extId}/${file}`, { waitUntil: 'domcontentloaded' });
  return page;
}

/** 用扩展自己的页面作宿主，向 chrome.storage 写入规则（默认存储模式为 sync） */
export async function injectRules(extPage, rules) {
  await extPage.evaluate((r) => chrome.storage.sync.set({ ah_rules: r }), rules);
}

/** 按完整 URL 精确匹配测试 tab 的 tabId（多条同名 tab 时取最新创建的那个） */
export async function findTabIdByUrl(extPage, url) {
  return extPage.evaluate(async (u) => {
    const tabs = await chrome.tabs.query({});
    const matched = tabs.filter((tab) => tab.url === u);
    return matched.length ? matched[matched.length - 1].id : null;
  }, url);
}

/** 模拟 background 的 contextMenus 消息通道：向测试 tab 发送扩展消息 */
export async function sendToTab(extPage, tabId, msg) {
  return extPage.evaluate(
    (id, m) => chrome.tabs.sendMessage(id, m).catch((e) => ({ __error: String(e && e.message || e) })),
    tabId, msg
  );
}

/** 打开测试页并等待其规则关键词开始高亮 */
export async function openPageAndWaitMarks(page, url, waitFn) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(waitFn || 'document.querySelector("ah-mark")', { timeout: 15000 });
}

/** 在测试页中选中包含 target 子串的文本节点区域（用于 CONTEXT_SPOT_HIGHLIGHT） */
export async function selectText(page, target) {
  return page.evaluate((t) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) { return n.textContent && n.textContent.indexOf(t) >= 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT; }
    });
    const node = walker.nextNode();
    if (!node) return false;
    const idx = node.textContent.indexOf(t);
    const range = document.createRange();
    range.setStart(node, idx);
    range.setEnd(node, idx + t.length);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  }, target);
}