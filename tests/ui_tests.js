// 卡通农场 UI 自动化测试
// 运行方式: node tests/ui_tests.js
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { createServer } = require("../server");

const FILE_URL = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
const SNAPSHOT_PATH = path.join(__dirname, "ui_snapshot.png");
const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const EMBEDDED_IMAGE_DATA_URLS = {
  gold_voucher: `data:image/webp;base64,${fs.readFileSync(path.join(__dirname, "..", "icons", "gold_voucher.webp")).toString("base64")}`,
  peanuts: `data:image/webp;base64,${fs.readFileSync(path.join(__dirname, "..", "icons", "peanuts.webp")).toString("base64")}`,
};
const results = { passed: 0, failed: 0, tests: [] };

function check(name, ok, detail = "") {
  if (ok) {
    results.passed++;
    console.log(`  ✓ ${name}`);
  } else {
    results.failed++;
    console.log(`  ✗ ${name} — ${detail}`);
  }
  results.tests.push({ name, ok, detail });
}

async function testSyncRetry(browser) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const syncPage = await browser.newPage();
  let attempts = 0;
  try {
    await syncPage.route("**/api/save", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      attempts++;
      if (attempts === 1) await route.abort("failed");
      else await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    });
    const port = server.address().port;
    await syncPage.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
    await syncPage.evaluate(() => persistText("hd_review_sync", "saved"));
    await syncPage.waitForTimeout(1700);
    const state = await syncPage.evaluate(() => ({
      local: localStorage.getItem("hd_review_sync"),
      pending: Object.keys(_serverPending),
      persistedQueue: localStorage.getItem(SERVER_PENDING_STORAGE),
    }));
    check("同步失败后自动重试", attempts >= 2, `请求次数: ${attempts}`);
    check("同步成功后清空持久队列", state.local === "saved" && state.pending.length === 0 && state.persistedQueue === null, JSON.stringify(state));

    const attemptsBeforeConflict = attempts;
    await syncPage.evaluate(() => {
      localStorage.setItem('hd_inv', '{"wheat":{"n":0}}');
      localStorage.setItem(SERVER_PENDING_STORAGE, JSON.stringify({ hd_inv: '{"wheat":{"n":0}}' }));
      localStorage.setItem(SERVER_REVISION_STORAGE, 'stale-browser-revision');
    });
    await syncPage.reload({ waitUntil: "networkidle" });
    await syncPage.waitForTimeout(500);
    const conflictState = await syncPage.evaluate(() => ({
      conflict: _serverConflict,
      localInventory: localStorage.getItem('hd_inv'),
      pending: JSON.parse(localStorage.getItem(SERVER_PENDING_STORAGE) || '{}'),
      status: document.querySelector('#saveStatus')?.textContent || '',
    }));
    check("旧浏览器待同步数据不会覆盖较新的服务器版本", conflictState.conflict && conflictState.localInventory.includes('"n":0') && conflictState.pending.hd_inv === conflictState.localInventory && attempts === attemptsBeforeConflict && conflictState.status.includes('同步冲突'), JSON.stringify({ conflictState, attempts, attemptsBeforeConflict }));
    const migrationSyncState = await syncPage.evaluate(() => {
      _serverPending = {};
      persistServerPending();
      localStorage.removeItem('hd_filter_order_version');
      migrateFilterOrderV2();
      return {
        marker: localStorage.getItem('hd_filter_order_version'),
        pending: Object.keys(_serverPending).sort(),
      };
    });
    check("筛选顺序迁移进入服务器同步队列", migrationSyncState.marker === '2' && migrationSyncState.pending.includes('hd_filter_order') && migrationSyncState.pending.includes('hd_order') && migrationSyncState.pending.includes('hd_filter_order_version'), JSON.stringify(migrationSyncState));
  } finally {
    await syncPage.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testPublicShowcaseDefaults(browser) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const showcasePage = await browser.newPage();
  try {
    await showcasePage.route("**/api/save", (route) =>
      route.fulfill({ status: 404, contentType: "text/plain", body: "not found" }),
    );
    await showcasePage.route("**/data.json", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          hd_catalog_id_version: "2",
          hd_edits: '{"mod":{},"add":[],"del":[]}',
        }),
      }),
    );
    const port = server.address().port;
    await showcasePage.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
    const showcaseState = await showcasePage.evaluate(() => {
      const siloIds = D.items.filter((item) => item.st.indexOf("silo") === 0).map((item) => item.id);
      const barnIds = D.items.filter((item) => item.st.indexOf("silo") !== 0).map((item) => item.id);
      const siloValues = siloIds.map(gs);
      const barnValues = barnIds.map(gs);
      return {
        siloCap: S._sc,
        barnCap: S._bc,
        siloTotal: siloValues.reduce((sum, value) => sum + value, 0),
        barnTotal: barnValues.reduce((sum, value) => sum + value, 0),
        siloSpread: Math.max(...siloValues) - Math.min(...siloValues),
        barnSpread: Math.max(...barnValues) - Math.min(...barnValues),
        persisted: localStorage.getItem("hd_inv") !== null,
      };
    });
    check(
      "静态网页新访客获得两仓各 8000 的均匀展示库存",
      showcaseState.siloCap === 8000 &&
        showcaseState.barnCap === 8000 &&
        showcaseState.siloTotal === 8000 &&
        showcaseState.barnTotal === 8000 &&
        showcaseState.siloSpread <= 1 &&
        showcaseState.barnSpread <= 1 &&
        showcaseState.persisted,
      JSON.stringify(showcaseState),
    );

    await showcasePage.evaluate(() => {
      localStorage.setItem("hd_inv", JSON.stringify({
        wheat: { n: 7, tg: 30 },
        _sc: 321,
        _bc: 654,
        _gtSilo: 10,
        _gtBarn: 5,
      }));
    });
    await showcasePage.reload({ waitUntil: "networkidle" });
    const existingState = await showcasePage.evaluate(() => ({
      wheat: gs("wheat"),
      siloCap: S._sc,
      barnCap: S._bc,
    }));
    check(
      "静态网页已有库存不会被展示默认值覆盖",
      existingState.wheat === 7 && existingState.siloCap === 321 && existingState.barnCap === 654,
      JSON.stringify(existingState),
    );
  } finally {
    await showcasePage.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function run() {
  console.log("=== 卡通农场 UI 测试 ===\n");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  const consoleErrors = [];

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  try {
    await page.goto(FILE_URL, { waitUntil: "networkidle", timeout: 30000 });
    await page.evaluate(async () => {
      localStorage.clear();
      if (window.HayDayItemImages && HayDayItemImages.supported()) {
        await new Promise((resolve) => {
          const request = indexedDB.deleteDatabase(HayDayItemImages.DB_NAME);
          request.onsuccess = request.onerror = request.onblocked = () => resolve();
        });
      }
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    const title = await page.title();
    check("页面标题", title.includes("卡通农场"));
    const staticRuntimeState = await page.evaluate(() => ({
      pinyinLoaded: typeof pinyinPro !== 'undefined' && _pyFL('小麦') === 'xm',
      handPiesIcon: ICONS.hand_pies,
      lambMultiplier: PROD_MULTIPLIERS.lamb_chop,
      staleMuttonMultiplier: Object.prototype.hasOwnProperty.call(PROD_MULTIPLIERS,'mutton'),
    }));
    check("静态发布资源包含可用的拼音运行时", staticRuntimeState.pinyinLoaded, JSON.stringify(staticRuntimeState));
    check("手抓酥皮派使用自己的专用图片", staticRuntimeState.handPiesIcon === 'icons/hand_pies.png', JSON.stringify(staticRuntimeState));
    check("羊排来源倍率使用实际物品编号", staticRuntimeState.lambMultiplier === 10 && !staticRuntimeState.staleMuttonMultiplier, JSON.stringify(staticRuntimeState));
    const overviewToggleInitial = await page.evaluate(() => ({
      text: document.querySelector('#infoToggle')?.textContent?.trim(),
      expanded: document.querySelector('#infoToggle')?.getAttribute('aria-expanded'),
      visible: getComputedStyle(document.querySelector('#infoBar')).display !== 'none',
    }));
    check("库存助手顶部概览按钮使用明确的收起文字", overviewToggleInitial.text === '收起' && overviewToggleInitial.expanded === 'true' && overviewToggleInitial.visible, JSON.stringify(overviewToggleInitial));
    await page.click('#infoToggle');
    const overviewToggleCollapsed = await page.evaluate(() => ({
      text: document.querySelector('#infoToggle')?.textContent?.trim(),
      expanded: document.querySelector('#infoToggle')?.getAttribute('aria-expanded'),
      hidden: getComputedStyle(document.querySelector('#infoBar')).display === 'none',
      bodyClass: document.body.classList.contains('info-collapsed'),
    }));
    check("库存助手概览收起后按钮改为展开文字", overviewToggleCollapsed.text === '展开' && overviewToggleCollapsed.expanded === 'false' && overviewToggleCollapsed.hidden && overviewToggleCollapsed.bodyClass, JSON.stringify(overviewToggleCollapsed));
    await page.click('#infoToggle');
    const collapseControlSystem = await page.evaluate(() => {
      // 约束所有现在和未来的展开/收起按钮，而不是维护一份容易遗漏的选择器名单。
      const controls = Array.from(document.querySelectorAll('button[aria-expanded],button.collapse-toggle'));
      const standard = controls.filter((button) => !button.classList.contains('collapse-toggle-compact'));
      const signatures = Array.from(new Set(standard.map((button) => {
        const style = getComputedStyle(button);
        return [style.height, style.borderRadius, style.borderStyle, style.fontSize].join('|');
      })));
      return {
        count: controls.length,
        missingClass: controls.filter((button) => !button.classList.contains('collapse-toggle')).length,
        invalidText: controls.filter((button) => !['展开','收起'].includes(button.textContent.trim())).map((button) => button.textContent.trim()),
        missingState: controls.filter((button) => !['true','false'].includes(button.getAttribute('aria-expanded'))).length,
        signatures,
      };
    });
    check("全局展开收起按钮使用同一组件、汉字和状态规则", collapseControlSystem.count > 35 && collapseControlSystem.missingClass === 0 && collapseControlSystem.invalidText.length === 0 && collapseControlSystem.missingState === 0 && collapseControlSystem.signatures.length === 1, JSON.stringify(collapseControlSystem));
    await page.click('#buyBanner .overview-toggle');
    const overviewSectionExpanded = await page.evaluate(() => ({
      expanded: document.querySelector('#buyBanner')?.classList.contains('expanded'),
      text: document.querySelector('#buyBanner .overview-toggle')?.textContent?.trim(),
      aria: document.querySelector('#buyBanner .overview-toggle')?.getAttribute('aria-expanded'),
    }));
    check("建议模块展开后统一显示收起文字", overviewSectionExpanded.expanded && overviewSectionExpanded.text === '收起' && overviewSectionExpanded.aria === 'true', JSON.stringify(overviewSectionExpanded));
    await page.click('#buyBanner .overview-toggle');
    check("侧栏标签包含可访问状态", await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('.tab[role="tab"]'));
      return tabs.length === 3 && tabs.filter((tab) => tab.getAttribute("aria-selected") === "true").length === 1;
    }));
    check("主视图可在库存与关系网间切换", await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('.app-view-tab[role="tab"]'));
      return tabs.length === 2 && tabs.filter((tab) => tab.getAttribute("aria-selected") === "true").length === 1;
    }));
    const inventoryUrl = page.url();
    await page.click('.app-view-tab[data-app-view="relations"]');
    const relationOverview = await page.evaluate(() => ({
      sameUrl: location.href,
      inventoryHidden: document.querySelector('#inventoryView').hidden,
      relationsVisible: !document.querySelector('#relationsView').hidden,
      nodeCount: document.querySelectorAll('[data-network-node]').length,
      edgeCount: document.querySelectorAll('.network-edge-wrap').length,
      finalCount: document.querySelectorAll('.network-node.final').length,
      bandCount: document.querySelectorAll('[data-network-band]').length,
      standaloneCount: document.querySelectorAll('#standaloneExternalList .relation-unplaced-item').length,
      breadIsFinal: document.querySelector('[data-network-node="bread"]')?.classList.contains('final'),
      viewportWidth: document.documentElement.clientWidth,
      viewWidth: document.querySelector('#relationsView').getBoundingClientRect().width,
      graphHeight: document.querySelector('#relationGraphViewport')?.getBoundingClientRect().height || 0,
      scale: _relationGraphView.scale,
      layoutNodeCount: _relationsLayout?.nodes.length || 0,
      layoutEdgeCount: _relationsLayout?.edges.length || 0,
    }));
    check("关系网在当前网页全宽显示", relationOverview.sameUrl === inventoryUrl && relationOverview.inventoryHidden && relationOverview.relationsVisible && relationOverview.viewWidth >= relationOverview.viewportWidth - 2, JSON.stringify(relationOverview));
    check("所有入网物品与关系同时显示在一张图中", relationOverview.nodeCount > 400 && relationOverview.edgeCount > 800 && relationOverview.nodeCount === relationOverview.layoutNodeCount && relationOverview.edgeCount === relationOverview.layoutEdgeCount && relationOverview.finalCount > 200 && relationOverview.bandCount >= 4, JSON.stringify(relationOverview));
    check("最终产物按是否被作为原料判定，无关系物品单列", relationOverview.standaloneCount > 0 && !relationOverview.breadIsFinal, JSON.stringify(relationOverview));
    await page.setViewportSize({ width: 2560, height: 1440 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await page.waitForTimeout(320);
    const largeScreenRelations = await page.evaluate(() => ({
      graphHeight: document.querySelector('#relationGraphViewport')?.getBoundingClientRect().height || 0,
      viewportHeight: innerHeight,
      scale: _relationGraphView.scale,
    }));
    check("大屏关系网使用可用高度并自动放大", largeScreenRelations.graphHeight > 1100 && largeScreenRelations.graphHeight >= largeScreenRelations.viewportHeight - 240 && largeScreenRelations.scale > relationOverview.scale * 1.5, JSON.stringify({ relationOverview, largeScreenRelations }));
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await page.waitForTimeout(320);
    const relationAccessibility = await page.evaluate(() => ({
      graphRole: document.querySelector('#relationsGraph')?.getAttribute('role'),
      buttonNodes: document.querySelectorAll('.network-node[role="button"]').length,
      tabbableNodes: document.querySelectorAll('.network-node[tabindex="0"]').length,
      exportLabel: document.querySelector('button[aria-label="导出数据"]')?.getAttribute('aria-label'),
      importLabel: document.querySelector('button[aria-label="导入数据"]')?.getAttribute('aria-label'),
      fullscreenLabel: document.querySelector('#relationFullscreenButton')?.getAttribute('aria-label'),
    }));
    check("关系网节点可由键盘访问且工具按钮有明确名称", relationAccessibility.graphRole === 'group' && relationAccessibility.buttonNodes > 400 && relationAccessibility.tabbableNodes === 1 && relationAccessibility.exportLabel === '导出数据' && relationAccessibility.importLabel === '导入数据' && relationAccessibility.fullscreenLabel === '全屏显示关系网', JSON.stringify(relationAccessibility));

    const relationPanelCoverage = await page.evaluate(() => ({
      keys: Array.from(document.querySelectorAll('[data-relation-panel]')).map((panel) => panel.getAttribute('data-relation-panel')),
      missingToggles: Array.from(document.querySelectorAll('[data-relation-panel]')).filter((panel) => !panel.hidden && !panel.querySelector('.relation-panel-toggle')).map((panel) => panel.getAttribute('data-relation-panel')),
      readyPanels: Array.from(document.querySelectorAll('[data-relation-panel]')).filter((panel) => panel.querySelector('.relation-panel-toggle')).length,
      expandedToggles: document.querySelectorAll('[data-relation-panel] .relation-panel-toggle[aria-expanded="true"]').length,
    }));
    check("关系网每个辅助功能模块都有独立收起按钮", ['tools','guide','demand','selection','standalone'].every((key) => relationPanelCoverage.keys.includes(key)) && relationPanelCoverage.missingToggles.length === 0 && relationPanelCoverage.expandedToggles === relationPanelCoverage.readyPanels, JSON.stringify(relationPanelCoverage));

    const standardLayout = await page.evaluate(() => ({
      height: _relationsLayout.height,
      width: _relationsLayout.width,
      rows: _relationsLayout.rowsPerColumn,
      nodes: _relationsLayout.nodes.length,
      edges: _relationsLayout.edges.length,
    }));
    await page.click('#relationCompactButton');
    await page.waitForTimeout(180);
    const compactLayout = await page.evaluate(() => ({
      height: _relationsLayout.height,
      width: _relationsLayout.width,
      rows: _relationsLayout.rowsPerColumn,
      nodes: _relationsLayout.nodes.length,
      edges: _relationsLayout.edges.length,
      pressed: document.querySelector('#relationCompactButton')?.getAttribute('aria-pressed'),
      label: document.querySelector('#relationCompactButton')?.textContent?.trim(),
    }));
    check("低高度排列减少纵向跨度且不丢失节点和关系", compactLayout.height < standardLayout.height && compactLayout.width > standardLayout.width && compactLayout.rows < standardLayout.rows && compactLayout.nodes === standardLayout.nodes && compactLayout.edges === standardLayout.edges && compactLayout.pressed === 'true' && compactLayout.label === '标准排列', JSON.stringify({ standardLayout, compactLayout }));
    await page.click('#relationCompactButton');
    await page.waitForTimeout(180);

    const panelsBeforeCollapse = await page.evaluate(() => ({
      top: document.querySelector('#relationGraphViewport')?.getBoundingClientRect().top || 0,
      height: document.querySelector('#relationGraphViewport')?.getBoundingClientRect().height || 0,
    }));
    await page.click('#relationToolsPanel > .relation-panel-toggle');
    await page.click('#relationGuidePanel > .relation-panel-toggle');
    await page.click('#relationDemandPlanner .relation-panel-toggle');
    await page.waitForTimeout(320);
    const panelsAfterCollapse = await page.evaluate(() => ({
      top: document.querySelector('#relationGraphViewport')?.getBoundingClientRect().top || 0,
      height: document.querySelector('#relationGraphViewport')?.getBoundingClientRect().height || 0,
      collapsed: ['tools','guide','demand'].every((key) => document.querySelector('[data-relation-panel="'+key+'"]')?.classList.contains('is-collapsed')),
      allClosed: ['tools','guide','demand'].every((key) => document.querySelector('[data-relation-panel="'+key+'"] .relation-panel-toggle')?.getAttribute('aria-expanded') === 'false'),
      nodes: document.querySelectorAll('.network-node').length,
    }));
    check("收起辅助模块会把释放的纵向空间补给关系图", panelsAfterCollapse.collapsed && panelsAfterCollapse.allClosed && panelsAfterCollapse.top < panelsBeforeCollapse.top && panelsAfterCollapse.height > panelsBeforeCollapse.height && panelsAfterCollapse.nodes > 400, JSON.stringify({ panelsBeforeCollapse, panelsAfterCollapse }));
    await page.click('#relationToolsPanel > .relation-panel-toggle');
    await page.click('#relationGuidePanel > .relation-panel-toggle');
    await page.click('#relationDemandPlanner .relation-panel-toggle');
    await page.waitForTimeout(320);

    await page.evaluate(() => selectRelationNode('honey_toast', true));
    const selectionPanelBefore = await page.evaluate(() => ({
      height: document.querySelector('#relationGraphViewport')?.getBoundingClientRect().height || 0,
      panelHeight: document.querySelector('#relationSelection')?.getBoundingClientRect().height || 0,
      detailVisible: !document.querySelector('#relationSelection')?.hidden,
      toggle: document.querySelector('#relationSelection .relation-panel-toggle')?.getAttribute('aria-expanded'),
    }));
    await page.click('#relationSelection .relation-panel-toggle');
    await page.waitForTimeout(220);
    const selectionPanelCollapsed = await page.evaluate(() => ({
      height: document.querySelector('#relationGraphViewport')?.getBoundingClientRect().height || 0,
      panelHeight: document.querySelector('#relationSelection')?.getBoundingClientRect().height || 0,
      recordedExpandedHeight: _relationPanelExpandedHeights.selection || 0,
      viewportHeightStyle: getComputedStyle(document.querySelector('#relationGraphViewport')).height,
      collapsed: document.querySelector('#relationSelection')?.classList.contains('is-collapsed'),
      copyDisplay: getComputedStyle(document.querySelector('#relationSelection .relation-selection-copy')).display,
      selected: document.querySelector('[data-network-node="honey_toast"]')?.classList.contains('is-selected'),
      toggle: document.querySelector('#relationSelection .relation-panel-toggle')?.getAttribute('aria-expanded'),
    }));
    check("物品详情可独立收起且不清除当前关系", selectionPanelBefore.detailVisible && selectionPanelBefore.toggle === 'true' && selectionPanelCollapsed.collapsed && selectionPanelCollapsed.copyDisplay === 'none' && selectionPanelCollapsed.selected && selectionPanelCollapsed.toggle === 'false' && selectionPanelCollapsed.height > selectionPanelBefore.height, JSON.stringify({ selectionPanelBefore, selectionPanelCollapsed }));
    await page.click('#relationSelection .relation-panel-toggle');
    await page.waitForTimeout(220);
    const editActionBeforeFullscreen = await page.evaluate(() => {
      const button = document.querySelector('#relationSelection [data-edit-id="honey_toast"]');
      return Boolean(button && getComputedStyle(button).display !== 'none');
    });
    await page.click('#relationFullscreenButton');
    await page.waitForTimeout(220);
    const fullscreenState = await page.evaluate(() => ({
        active: document.fullscreenElement === document.querySelector('#relationsView') || document.querySelector('#relationsView')?.classList.contains('is-pseudo-fullscreen'),
        pressed: document.querySelector('#relationFullscreenButton')?.getAttribute('aria-pressed'),
        label: document.querySelector('#relationFullscreenButton')?.textContent?.trim(),
        viewWidth: document.querySelector('#relationsView')?.getBoundingClientRect().width || 0,
        viewHeight: document.querySelector('#relationsView')?.getBoundingClientRect().height || 0,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        editActionDisplay: getComputedStyle(document.querySelector('#relationSelection [data-edit-id="honey_toast"]')).display,
        editModalHidden: document.querySelector('#editModal')?.classList.contains('hidden'),
    }));
    check("全屏按钮让关系网占满屏幕并切换为退出状态", fullscreenState.active && fullscreenState.pressed === 'true' && fullscreenState.label === '退出全屏' && fullscreenState.viewWidth >= fullscreenState.viewportWidth - 2 && fullscreenState.viewHeight >= fullscreenState.viewportHeight - 2, JSON.stringify(fullscreenState));
    check("全屏专注查看时隐藏编辑物品入口", editActionBeforeFullscreen && fullscreenState.editActionDisplay === 'none' && fullscreenState.editModalHidden, JSON.stringify({ editActionBeforeFullscreen, fullscreenState }));
    await page.evaluate(() => openEditModal('honey_toast'));
    const fullscreenEditGuard = await page.evaluate(() => ({
      modalHidden: document.querySelector('#editModal')?.classList.contains('hidden'),
      message: document.querySelector('#toast')?.textContent || '',
    }));
    check("全屏期间不会在关系网后方打开编辑对话框", fullscreenEditGuard.modalHidden && fullscreenEditGuard.message.includes('退出关系网全屏'), JSON.stringify(fullscreenEditGuard));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(220);
    if (await page.evaluate(() => Boolean(document.fullscreenElement || document.querySelector('#relationsView')?.classList.contains('is-pseudo-fullscreen')))) {
      await page.click('#relationFullscreenButton');
      await page.waitForTimeout(220);
    }
    const restoredFullscreenState = await page.evaluate(() => ({
        active: Boolean(document.fullscreenElement || document.querySelector('#relationsView')?.classList.contains('is-pseudo-fullscreen')),
        pressed: document.querySelector('#relationFullscreenButton')?.getAttribute('aria-pressed'),
        label: document.querySelector('#relationFullscreenButton')?.textContent?.trim(),
        editActionDisplay: getComputedStyle(document.querySelector('#relationSelection [data-edit-id="honey_toast"]')).display,
    }));
    check("再次操作或 Escape 可退出关系网全屏并恢复编辑入口", !restoredFullscreenState.active && restoredFullscreenState.pressed === 'false' && restoredFullscreenState.label === '全屏' && restoredFullscreenState.editActionDisplay !== 'none', JSON.stringify(restoredFullscreenState));

    const fishingSources = await page.evaluate(() => ({
      red: D.items.find((item) => item.id === 'red_lure')?.ing,
      green: D.items.find((item) => item.id === 'green_lure')?.ing,
      blue: D.items.find((item) => item.id === 'blue_lure')?.ing,
      purple: D.items.find((item) => item.id === 'purple_lure')?.ing,
      gold: D.items.find((item) => item.id === 'gold_lure')?.ing,
      net: D.items.find((item) => item.id === 'fishing_net')?.ing,
    }));
    check("鱼饵使用对应颜色礼券，红饵和渔网无原料", JSON.stringify(fishingSources) === JSON.stringify({
      red: [], green: [{ i: 'green_voucher', q: 1 }], blue: [{ i: 'blue_voucher', q: 1 }], purple: [{ i: 'purple_voucher', q: 1 }], gold: [{ i: 'gold_voucher', q: 1 }], net: [],
    }), JSON.stringify(fishingSources));

    await page.fill('#relationsSearch', '蜂蜜吐司');
    await page.press('#relationsSearch', 'Enter');
    const cheeseNetwork = await page.evaluate(() => {
      const root = document.querySelector('[data-network-node="honey_toast"]');
      const milk = document.querySelector('[data-network-node="milk"]');
      const activeLabels = Array.from(document.querySelectorAll('.network-edge-wrap.show-label .network-edge-label')).map((label) => label.textContent || '');
      return {
        allNodesRemain: document.querySelectorAll('[data-network-node]').length,
        selected: root?.classList.contains('is-selected'),
        activeIds: Array.from(document.querySelectorAll('.network-node.is-active')).map((node) => node.dataset.networkNode),
        hasSemanticQty: activeLabels.some((label) => /\d/.test(label)),
        leftToRight: Boolean(root && milk && Number(milk.dataset.depth) > Number(root.dataset.depth)),
        detail: document.querySelector('#relationSelection')?.textContent || '',
        mode: document.querySelector('#relationZoomMode')?.textContent,
        detailAboveGraph: document.querySelector('#relationSelection')?.getBoundingClientRect().bottom <= document.querySelector('#relationGraphViewport')?.getBoundingClientRect().top + 1,
        scale: _relationGraphView.scale,
      };
    });
    check("搜索只高亮并聚焦关系，不会把其他物品从全图移除", cheeseNetwork.allNodesRemain > 400 && cheeseNetwork.selected && cheeseNetwork.detail.includes('蜂蜜吐司'), JSON.stringify(cheeseNetwork));
    check("聚焦后显示完整动物饲料来源、数量与左右层级", ['milk','cow_feed','corn','soyabean'].every((id) => cheeseNetwork.activeIds.includes(id)) && cheeseNetwork.hasSemanticQty && cheeseNetwork.leftToRight, JSON.stringify(cheeseNetwork));
    check("聚焦详情在图上方并直接显示配方", cheeseNetwork.mode === '聚焦' && cheeseNetwork.detailAboveGraph && cheeseNetwork.detail.includes('配方：') && cheeseNetwork.scale >= .9, JSON.stringify(cheeseNetwork));
    const graphDragStart = await page.evaluate(() => {
      const rect = document.querySelector('#relationGraphViewport').getBoundingClientRect();
      return { x: rect.left + 12, y: rect.top + 12, viewX: _relationGraphView.x, viewY: _relationGraphView.y };
    });
    await page.mouse.move(graphDragStart.x, graphDragStart.y);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(graphDragStart.x + 70, graphDragStart.y + 35, { steps: 5 });
    await page.mouse.up({ button: 'left' });
    const afterLeftDrag = await page.evaluate(() => ({
      selectedId: _relationsSelectedId,
      selectedNode: document.querySelector('.network-node.is-selected')?.getAttribute('data-network-node'),
      viewX: _relationGraphView.x,
      viewY: _relationGraphView.y,
    }));
    check("鼠标左键拖动不会平移或误清除已选物品", afterLeftDrag.selectedId === 'honey_toast' && afterLeftDrag.selectedNode === 'honey_toast' && Math.abs(afterLeftDrag.viewX - graphDragStart.viewX) < .01 && Math.abs(afterLeftDrag.viewY - graphDragStart.viewY) < .01, JSON.stringify({ graphDragStart, afterLeftDrag }));
    await page.mouse.move(graphDragStart.x, graphDragStart.y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(graphDragStart.x + 90, graphDragStart.y + 45, { steps: 5 });
    await page.mouse.up({ button: 'right' });
    const afterRightDrag = await page.evaluate(() => {
      const viewport = document.querySelector('#relationGraphViewport');
      const contextEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
      const dispatchResult = viewport.dispatchEvent(contextEvent);
      return {
        selectedId: _relationsSelectedId,
        selectedNode: document.querySelector('.network-node.is-selected')?.getAttribute('data-network-node'),
        viewX: _relationGraphView.x,
        viewY: _relationGraphView.y,
        contextMenuPrevented: contextEvent.defaultPrevented && dispatchResult === false,
        hint: document.querySelector('.relation-graph-hint')?.textContent || '',
      };
    });
    check("鼠标右键可平移关系网并保持当前物品焦点", afterRightDrag.selectedId === 'honey_toast' && afterRightDrag.selectedNode === 'honey_toast' && afterRightDrag.viewX > afterLeftDrag.viewX + 70 && afterRightDrag.viewY > afterLeftDrag.viewY + 30, JSON.stringify({ afterLeftDrag, afterRightDrag }));
    check("关系网内屏蔽浏览器右键菜单并明确显示拖动说明", afterRightDrag.contextMenuPrevented && afterRightDrag.hint.includes('鼠标右键') && afterRightDrag.hint.includes('触屏单指'), JSON.stringify(afterRightDrag));
    const demandStorageBefore = await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map((key) => [key, localStorage.getItem(key)]))));
    await page.fill('#relationDemandQty', '6');
    await page.click('#relationDemandRun');
    const demandSimulation = await page.evaluate(() => ({
      quantity: _relationDemandResult?.quantity,
      targetId: _relationDemandResult?.rootId,
      taskCount: _relationDemandResult?.tasks.length || 0,
      materialCount: Object.keys(_relationDemandResult?.totalsById || {}).length,
      nodeCount: document.querySelectorAll('[data-network-node]').length,
      activeCount: document.querySelectorAll('.network-node.is-active').length,
      resultText: document.querySelector('#relationDemandResult')?.textContent || '',
      storage: JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map((key) => [key, localStorage.getItem(key)]))),
    }));
    check("需求模拟按指定数量递归列出逐层材料与生产顺序", demandSimulation.quantity === 6 && demandSimulation.targetId === 'honey_toast' && demandSimulation.taskCount > 3 && demandSimulation.materialCount > 5 && demandSimulation.resultText.includes('蜂蜜吐司 × 6') && demandSimulation.resultText.includes('逐层总需求') && demandSimulation.resultText.includes('生产顺序'), JSON.stringify(demandSimulation));
    check("需求模拟只高亮相关路径且完整关系网仍保留", demandSimulation.nodeCount > 400 && demandSimulation.activeCount > 5 && demandSimulation.activeCount < demandSimulation.nodeCount, JSON.stringify(demandSimulation));
    check("需求模拟只读库存，不改写任何本地存储", demandSimulation.storage === demandStorageBefore, JSON.stringify({ before: demandStorageBefore, after: demandSimulation.storage }));
    await page.locator('[data-network-node="honey_toast"]').press('ArrowRight');
    const keyboardRelation = await page.evaluate(() => ({
      activeId: document.activeElement?.getAttribute('data-network-node'),
      selectedId: document.querySelector('.network-node.is-selected')?.getAttribute('data-network-node'),
      tabbableNodes: document.querySelectorAll('.network-node[tabindex="0"]').length,
    }));
    check("方向键可沿关系移动且始终只有一个键盘入口", keyboardRelation.activeId && keyboardRelation.activeId !== 'honey_toast' && keyboardRelation.selectedId === keyboardRelation.activeId && keyboardRelation.tabbableNodes === 1, JSON.stringify(keyboardRelation));
    await page.press('#relationsSearch', 'Enter');

    const previousEdits = await page.evaluate(() => localStorage.getItem('hd_edits'));
    await page.click('#relationSelection [data-edit-id="honey_toast"]');
    check("物品编辑框不再显示历史遗留的备用图标输入项", await page.locator('#emEmoji').count() === 0);
    await page.evaluate(() => {
      const index = _ingRows.findIndex((row) => row.i === 'milk');
      _ingRows[index].q = 7;
      refreshIngUI();
      updateEditSaveState();
    });
    await page.click('#emSave');
    await page.waitForTimeout(150);
    const liveEditState = await page.evaluate(() => ({
      quantity: _relationsNetwork.ingredientsById.honey_toast.find((edge) => edge.to === 'milk')?.q,
      label: Array.from(document.querySelectorAll('.network-edge-wrap.show-label .network-edge-label')).map((node) => node.textContent || '').find((text) => text.includes('7')),
      selected: document.querySelector('[data-network-node="honey_toast"]')?.classList.contains('is-selected'),
      simulatedMilk: _relationDemandResult?.totalsById?.milk?.requested,
      emoji: loadEdits().mod.honey_toast?.emoji,
    }));
    check("物品编辑保存后立即重算关系网、连线数量与需求模拟", liveEditState.quantity === 7 && Boolean(liveEditState.label) && liveEditState.selected && liveEditState.simulatedMilk === 42, JSON.stringify(liveEditState));
    check("新保存的物品编辑统一使用箱子图标", liveEditState.emoji === '📦', JSON.stringify(liveEditState));
    await page.evaluate((saved) => {
      if (saved === null) localStorage.removeItem('hd_edits');
      else localStorage.setItem('hd_edits', saved);
      applyEdits();
      renderRelations();
    }, previousEdits);
    await page.waitForTimeout(150);
    await page.click('#relationSelection button:first-child');
    const restoredOverview = await page.evaluate(() => ({
      selectionHidden: document.querySelector('#relationSelection')?.hidden,
      mode: document.querySelector('#relationZoomMode')?.textContent,
      allNodesRemain: document.querySelectorAll('[data-network-node]').length,
      lowZoom: document.querySelector('#relationGraphViewport')?.classList.contains('is-low-zoom'),
      selectedCount: document.querySelectorAll('.network-node.is-selected').length,
    }));
    check("返回全景会清除聚焦但保留完整关系网", restoredOverview.selectionHidden && restoredOverview.mode === '全景' && restoredOverview.allNodesRemain > 400 && restoredOverview.lowZoom && restoredOverview.selectedCount === 0, JSON.stringify(restoredOverview));
    const alternativeInventory = await page.evaluate(() => {
      const saved = { fish_fillet: S.fish_fillet, red_lure: S.red_lure, fishing_net: S.fishing_net };
      S.fish_fillet = { n: 0, tg: 5 };S.red_lure = { n: 5, tg: 5 };S.fishing_net = { n: 0, tg: 5 };
      selectRelationNode('fish_fillet', true);
      document.querySelector('#relationDemandQty').value = '5';
      runRelationDemandSimulation();
      const state = {
        choice: _relationDemandResult?.alternatives?.[0],
        redActive: document.querySelector('[data-network-node="red_lure"]')?.classList.contains('is-active'),
        netActive: document.querySelector('[data-network-node="fishing_net"]')?.classList.contains('is-active'),
        allNodesRemain: document.querySelectorAll('[data-network-node]').length,
        text: document.querySelector('#relationDemandResult')?.textContent || '',
      };
      for (const [id, value] of Object.entries(saved)) {
        if (value == null) delete S[id]; else S[id] = value;
      }
      relationGraphFit(false);
      return state;
    });
    check("多种来源不会重复相加，并优先采用当前库存可覆盖的路线", alternativeInventory.choice?.to === 'red_lure' && alternativeInventory.choice?.quantity === 5 && alternativeInventory.redActive && !alternativeInventory.netActive && alternativeInventory.allNodesRemain > 400 && alternativeInventory.text.includes('种来源择一'), JSON.stringify(alternativeInventory));
    await page.click('.app-view-tab[data-app-view="inventory"]');
    check("至少30个分组", (await page.$$(".section-header")).length >= 30);
    check("至少200个物品tile", (await page.$$(".item-tile")).length >= 200);
    const firstGroupToggle = await page.$('.section-header .group-collapse-toggle');
    await firstGroupToggle.click();
    const groupCollapsed = await page.evaluate(() => {
      const header=document.querySelector('.section-header'),body=header?.nextElementSibling,button=header?.querySelector('.group-collapse-toggle');
      return {
        hiddenClass:body?.classList.contains('hidden'),
        visuallyHidden:body ? getComputedStyle(body).display === 'none' && body.getClientRects().length === 0 : false,
        text:button?.textContent?.trim(),
        aria:button?.getAttribute('aria-expanded')
      };
    });
    check("物品分组收起后内容实际隐藏且按钮状态正确", groupCollapsed.hiddenClass && groupCollapsed.visuallyHidden && groupCollapsed.text === '展开' && groupCollapsed.aria === 'false', JSON.stringify(groupCollapsed));
    await firstGroupToggle.click();
    const groupExpanded = await page.evaluate(() => {
      const header=document.querySelector('.section-header'),body=header?.nextElementSibling,button=header?.querySelector('.group-collapse-toggle');
      return {
        hiddenClass:body?.classList.contains('hidden'),
        visuallyVisible:body ? getComputedStyle(body).display !== 'none' && body.getClientRects().length > 0 : false,
        text:button?.textContent?.trim(),
        aria:button?.getAttribute('aria-expanded')
      };
    });
    check("物品分组再次展开后内容恢复且按钮状态正确", !groupExpanded.hiddenClass && groupExpanded.visuallyVisible && groupExpanded.text === '收起' && groupExpanded.aria === 'true', JSON.stringify(groupExpanded));

    const firstInput = await page.$(".tile-input");
    check("存在库存输入框", firstInput !== null);

    const firstId = await page.$eval(".item-tile", (el) => el.dataset.id);

    await firstInput.click();
    const focusedInput = await page.evaluate(() => document.activeElement?.classList.contains("tile-input"));
    check("点击输入框后聚焦", focusedInput);

    await firstInput.fill("5");
    await firstInput.press("Enter");
    await page.waitForTimeout(600);

    const saved = await page.$eval(`[data-id="${firstId}"] .tile-input`, (el) => el.value);
    check("回车后库存值保存", saved === "5");

    const focusedAfterEnter = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || !el.classList.contains("tile-input")) return null;
      return el.closest(".item-tile")?.dataset.id;
    });
    check("回车后焦点移到下一个输入框", focusedAfterEnter !== null && focusedAfterEnter !== firstId);

    const spinnerCss = await page.evaluate(() => {
      const css = Array.from(document.querySelectorAll("style"))
        .map((style) => style.textContent || "")
        .join("\n");
      return css.includes("::-webkit-inner-spin-button") && css.includes("-moz-appearance:textfield");
    });
    check("输入框隐藏浏览器数字箭头 CSS 存在", spinnerCss);

    const priorityItems = await page.$$("#priorityList .prio-item");
    check("优先级面板有缺货物品", priorityItems.length > 0);

    const hasBar = await page.$("#priorityList .prio-item .prio-bar");
    check("优先级物品前有颜色条", hasBar !== null);

    const priorityText = await page.$eval("#priorityList .prio-item", (el) => el.textContent || "");
    check("优先级面板显示'缺N个'", priorityText.includes("缺") && /\d+个/.test(priorityText), priorityText.substring(0, 60));

    const priorityHtml = await page.$eval("#priorityList", (el) => el.innerHTML);
    check("不显示优先级评分数值", !/score|评分|分数/i.test(priorityHtml));
    check("优先级解释生产链缺口", /安全库存缺|生产链需|用于 \d+ 种产品/.test(priorityText), priorityText.substring(0, 90));

    await page.click('.tab[data-tab="plan"]');
    const rawPlanText = await page.textContent("#planResults");
    check("基础原料按独立来源安排", rawPlanText.includes("独立来源") && !rawPlanText.includes("动物与基础原料"));
    const chainBadge = page.locator('#planResults .chain-depth-badge').filter({ hasText: /层级 [2-9]/ }).first();
    if (await chainBadge.count()) {
      const chainToggle = chainBadge.locator('..').locator('.chain-toggle');
      await chainToggle.click();
      const chainState = await chainToggle.evaluate((toggle) => {
        const tree = toggle.parentElement.querySelector('.chain-expanded');
        const rows = Array.from(tree.querySelectorAll('.chain-tree-row'));
        return {
          hasUndefined: tree.textContent.includes('undefined'),
          depths: rows.map((row) => Number(row.dataset.depth)),
          lefts: rows.map((row) => row.getBoundingClientRect().left),
          toggleText: toggle.textContent.trim(),
          expanded: toggle.getAttribute('aria-expanded'),
          unified: toggle.classList.contains('collapse-toggle'),
        };
      });
      check("生产链展开按钮遵循全局样式和文字规则", chainState.unified && chainState.toggleText === '收起' && chainState.expanded === 'true', JSON.stringify(chainState));
      check("生产链不显示 undefined", !chainState.hasUndefined, JSON.stringify(chainState));
      const alignedByDepth = chainState.depths.every((depth, index) =>
        chainState.lefts[index] === chainState.lefts[chainState.depths.indexOf(depth)]);
      check("生产链同级对齐并逐级缩进", alignedByDepth && chainState.depths.some((depth) => depth > 0), JSON.stringify(chainState));
    }
    await page.click('.plan-mode-btn[data-mode="offline"]');
    await page.fill('#offlineHours', '10');
    await page.locator('#offlineHours').blur();
    await page.waitForTimeout(200);
    check("离线模式显示时间窗口", (await page.textContent('#planModeNote')).includes('10 小时'));
    check("生产模式保存在本地", await page.evaluate(() => localStorage.getItem('hd_plan_mode') === 'offline' && localStorage.getItem('hd_offline_hours') === '10'));
    await page.click('.tab[data-tab="items"]');
    const itemListLayout = await page.evaluate(() => {
      const tab = document.querySelector('.tab[data-tab="items"]').getBoundingClientRect();
      const list = document.querySelector('#itemsList').getBoundingClientRect();
      const panel = document.querySelector('.side-panel').getBoundingClientRect();
      const columns = getComputedStyle(document.querySelector('.items-columns')).gridTemplateColumns.split(' ');
      return { sameSide: list.left >= panel.left && list.right <= panel.right, belowTab: list.top >= tab.bottom - 1, columns: columns.length };
    });
    check("物品清单在右侧标签正下方", itemListLayout.sameSide && itemListLayout.belowTab, JSON.stringify(itemListLayout));
    check("物品清单保持粮仓货仓两栏", itemListLayout.columns === 2, JSON.stringify(itemListLayout));
    const userDataBeforeImage = await page.evaluate(() => ({
      edits: localStorage.getItem('hd_edits'),
      inventory: localStorage.getItem('hd_inv'),
    }));
    await page.click('#itemsList .items-review-entry button');
    const reviewWorkspace = await page.evaluate(() => ({
      visible: !document.querySelector('#dataReviewPanel').hidden,
      inventoryHidden: document.querySelector('#inventoryMainLayout').hidden,
      filters: document.querySelectorAll('#dataReviewFilters .review-filter').length,
      summary: document.querySelector('#dataReviewSummary').textContent,
      missing: getDataReviewCounts().missing,
      honeyToast: getDataReviewState(im.honey_toast, loadEdits(), loadChecked()),
      goldVoucher: getDataReviewState(im.gold_voucher, loadEdits(), loadChecked()),
    }));
    check("数据校对从物品清单进入且不增加主导航", reviewWorkspace.visible && reviewWorkspace.inventoryHidden && reviewWorkspace.filters === 5 && reviewWorkspace.summary.includes('图片覆盖率'), JSON.stringify(reviewWorkspace));
    check("已确认目录图片被识别为真实内置图片", reviewWorkspace.missing > 0 && !reviewWorkspace.honeyToast.placeholderImage && !reviewWorkspace.honeyToast.missingImage && !reviewWorkspace.goldVoucher.placeholderImage && !reviewWorkspace.goldVoucher.missingImage, JSON.stringify(reviewWorkspace));
    const editRecoveryBefore = await page.evaluate(() => ({
      historyCount: loadEditHistory().length,
      name: im.bread.nameCN,
      target: gt('bread'),
      stock: gs('bread'),
      inventory: localStorage.getItem('hd_inv'),
    }));
    await page.evaluate(() => openEditModal('bread'));
    await page.fill('#emName', `${editRecoveryBefore.name}恢复测试`);
    await page.fill('#emTg', String(editRecoveryBefore.target + 3));
    await page.click('#emSave');
    await page.waitForTimeout(120);
    const editRecoverySaved = await page.evaluate(() => ({
      historyCount: loadEditHistory().length,
      latestLabel: loadEditHistory()[0]?.label || '',
      editedName: im.bread.nameCN,
      editedTarget: gt('bread'),
      localOnlyKey: !EDIT_HISTORY_STORAGE.startsWith('hd_'),
      queuedForServer: Object.prototype.hasOwnProperty.call(_serverPending, EDIT_HISTORY_STORAGE),
    }));
    check("物品保存前自动创建本地恢复点", editRecoverySaved.historyCount === editRecoveryBefore.historyCount + 1 && editRecoverySaved.latestLabel.includes(editRecoveryBefore.name) && editRecoverySaved.editedName.endsWith('恢复测试') && editRecoverySaved.editedTarget === editRecoveryBefore.target + 3, JSON.stringify(editRecoverySaved));
    await page.click('.edit-history-panel .collapse-toggle');
    const editHistoryPanelState = await page.evaluate(() => ({
      expanded: document.querySelector('.edit-history-panel .collapse-toggle')?.getAttribute('aria-expanded'),
      unified: document.querySelector('.edit-history-panel .collapse-toggle')?.classList.contains('collapse-toggle'),
      bodyVisible: !document.querySelector('#editHistoryBody')?.hidden,
      localOnlyKey: !EDIT_HISTORY_STORAGE.startsWith('hd_'),
      queuedForServer: Object.prototype.hasOwnProperty.call(_serverPending, EDIT_HISTORY_STORAGE),
    }));
    check("修改恢复使用统一按钮且记录不进入服务器同步", editHistoryPanelState.expanded === 'true' && editHistoryPanelState.unified && editHistoryPanelState.bodyVisible && editHistoryPanelState.localOnlyKey && !editHistoryPanelState.queuedForServer, JSON.stringify(editHistoryPanelState));
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#editHistoryList .edit-history-entry .btn').first().click();
    await page.waitForTimeout(120);
    const editRecoveryRestored = await page.evaluate(async () => {
      const backup = await buildBackupData();
      return {
        name: im.bread.nameCN,
        target: gt('bread'),
        stock: gs('bread'),
        inventory: localStorage.getItem('hd_inv'),
        historyCount: loadEditHistory().length,
        backupVersion: backup.version,
        catalogIdVersion: backup.catalogIdVersion,
        backupHasHistory: Object.prototype.hasOwnProperty.call(backup, 'editHistory'),
      };
    });
    check("恢复物品编辑和目标时保持库存数量不变", editRecoveryRestored.name === editRecoveryBefore.name && editRecoveryRestored.target === editRecoveryBefore.target && editRecoveryRestored.stock === editRecoveryBefore.stock && editRecoveryRestored.inventory === editRecoveryBefore.inventory && editRecoveryRestored.historyCount === editRecoverySaved.historyCount + 1, JSON.stringify(editRecoveryRestored));
    check("修改恢复记录不进入 v4 备份结构", editRecoveryRestored.backupVersion === 4 && editRecoveryRestored.catalogIdVersion === 2 && !editRecoveryRestored.backupHasHistory, JSON.stringify(editRecoveryRestored));
    const editHistoryClearBefore = await page.evaluate(() => ({
      edits: localStorage.getItem('hd_edits'),
      inventory: localStorage.getItem('hd_inv'),
      name: im.bread.nameCN,
    }));
    page.once('dialog', (dialog) => dialog.accept());
    await page.click('#editHistoryList .edit-history-clear');
    const editHistoryCleared = await page.evaluate(() => ({
      historyCount: loadEditHistory().length,
      edits: localStorage.getItem('hd_edits'),
      inventory: localStorage.getItem('hd_inv'),
      name: im.bread.nameCN,
    }));
    check("清空恢复记录不改动物品和库存", editHistoryCleared.historyCount === 0 && editHistoryCleared.edits === editHistoryClearBefore.edits && editHistoryCleared.inventory === editHistoryClearBefore.inventory && editHistoryCleared.name === editHistoryClearBefore.name, JSON.stringify(editHistoryCleared));
    await page.evaluate(() => setDataReviewFilter('all'));
    await page.evaluate(() => chooseItemImage('bread'));
    const imageInput = page.locator('input[type="file"][accept*="image/png"]');
    check("上传按钮只接受常见图片格式", await imageInput.count() === 1);
    await imageInput.setInputFiles({ name: 'bread.png', mimeType: 'image/png', buffer: TINY_PNG });
    await page.waitForFunction(() => hasCustomItemImage('bread'));
    const uploadedImageState = await page.evaluate(async (before) => {
      const backup = await buildBackupData();
      return {
        custom: hasCustomItemImage('bread'),
        source: itemImageSrc('bread').slice(0, 22),
        version: backup.version,
        backupHasImage: Boolean(backup.itemImages.bread?.dataUrl),
        editsUntouched: localStorage.getItem('hd_edits') === before.edits,
        inventoryUntouched: localStorage.getItem('hd_inv') === before.inventory,
        detailUsesUpload: document.querySelector('#dataReviewDetail img')?.src.startsWith('data:image/'),
      };
    }, userDataBeforeImage);
    check("用户图片保存在独立图片库并立即显示", uploadedImageState.custom && uploadedImageState.source.startsWith('data:image/') && uploadedImageState.detailUsesUpload, JSON.stringify(uploadedImageState));
    check("上传图片不改写物品编辑和库存", uploadedImageState.editsUntouched && uploadedImageState.inventoryUntouched, JSON.stringify(uploadedImageState));
    check("新备份使用 v4 并包含用户图片", uploadedImageState.version === 4 && uploadedImageState.backupHasImage, JSON.stringify(uploadedImageState));
    const embeddedImageMigration = await page.evaluate(async ({ embeddedImages, differentImage }) => {
      const beforeEdits = localStorage.getItem('hd_edits');
      const beforeInventory = localStorage.getItem('hd_inv');
      const record = (id, dataUrl) => ({ id, dataUrl, mimeType: dataUrl.startsWith('data:image/webp') ? 'image/webp' : 'image/png', width: 256, height: 256, updatedAt: '2026-07-18T00:00:00.000Z' });
      await HayDayItemImages.put(record('gold_voucher', embeddedImages.gold_voucher));
      await HayDayItemImages.put(record('peanuts', embeddedImages.peanuts));
      localStorage.removeItem(EMBEDDED_ITEM_IMAGE_MIGRATION_STORAGE);
      const removed = await migrateEmbeddedItemImages();
      const repeated = await migrateEmbeddedItemImages();
      await refreshItemImageCache();
      const backup = await buildBackupData();
      await HayDayItemImages.put(record('gold_voucher', differentImage));
      localStorage.removeItem(EMBEDDED_ITEM_IMAGE_MIGRATION_STORAGE);
      const unmatchedRemoved = await migrateEmbeddedItemImages();
      await refreshItemImageCache();
      const unmatchedKept = hasCustomItemImage('gold_voucher');
      await HayDayItemImages.remove('gold_voucher');
      await refreshItemImageCache();
      return {
        removed,
        repeated,
        unmatchedRemoved,
        unmatchedKept,
        goldCustom: hasCustomItemImage('gold_voucher'),
        peanutsCustom: hasCustomItemImage('peanuts'),
        goldBuiltIn: itemImageSrc('gold_voucher') === ICONS.gold_voucher,
        peanutsBuiltIn: itemImageSrc('peanuts') === ICONS.peanuts,
        breadKept: Boolean(backup.itemImages.bread),
        imageCount: Object.keys(backup.itemImages).length,
        editsUntouched: localStorage.getItem('hd_edits') === beforeEdits,
        inventoryUntouched: localStorage.getItem('hd_inv') === beforeInventory,
      };
    }, { embeddedImages: EMBEDDED_IMAGE_DATA_URLS, differentImage: `data:image/png;base64,${TINY_PNG.toString('base64')}` });
    check("测试上传图片迁入内置资源后仅清理对应两条用户图片", embeddedImageMigration.removed === 2 && embeddedImageMigration.repeated === 0 && !embeddedImageMigration.goldCustom && !embeddedImageMigration.peanutsCustom && embeddedImageMigration.goldBuiltIn && embeddedImageMigration.peanutsBuiltIn && embeddedImageMigration.breadKept && embeddedImageMigration.imageCount === 1, JSON.stringify(embeddedImageMigration));
    check("同一物品编号下内容不同的用户图片不会被迁移误删", embeddedImageMigration.unmatchedRemoved === 0 && embeddedImageMigration.unmatchedKept, JSON.stringify(embeddedImageMigration));
    check("清理测试图片不会修改物品编辑或库存", embeddedImageMigration.editsUntouched && embeddedImageMigration.inventoryUntouched, JSON.stringify(embeddedImageMigration));
    const failedEmbeddedImageMigration = await page.evaluate(async () => {
      const beforeEdits = localStorage.getItem('hd_edits');
      const beforeInventory = localStorage.getItem('hd_inv');
      const originalGetAll = HayDayItemImages.getAll;
      localStorage.removeItem(EMBEDDED_ITEM_IMAGE_MIGRATION_STORAGE);
      HayDayItemImages.getAll = () => Promise.reject(new Error('模拟图片库读取失败'));
      const result = await migrateEmbeddedItemImagesSafely();
      HayDayItemImages.getAll = originalGetAll;
      return {
        result,
        marker: localStorage.getItem(EMBEDDED_ITEM_IMAGE_MIGRATION_STORAGE),
        editsUntouched: localStorage.getItem('hd_edits') === beforeEdits,
        inventoryUntouched: localStorage.getItem('hd_inv') === beforeInventory,
      };
    });
    check("图片库迁移失败时继续启动并保留下次重试机会", failedEmbeddedImageMigration.result === 0 && failedEmbeddedImageMigration.marker === null && failedEmbeddedImageMigration.editsUntouched && failedEmbeddedImageMigration.inventoryUntouched, JSON.stringify(failedEmbeddedImageMigration));
    const staleImageState = await page.evaluate(async (tinyPng) => {
      const before = itemImageSrc('bread');
      const stale = await buildBackupData();
      stale.itemImages.bread.dataUrl = tinyPng;
      stale.itemImages.bread.updatedAt = '2000-01-01T00:00:00.000Z';
      const merged = await importBackupImages(stale);
      await refreshItemImageCache();
      return { merged, unchanged: itemImageSrc('bread') === before };
    }, `data:image/png;base64,${TINY_PNG.toString('base64')}`);
    check("旧备份图片不能覆盖较新的本地图片", staleImageState.merged === 0 && staleImageState.unchanged, JSON.stringify(staleImageState));
    const imageMergeState = await page.evaluate(async () => {
      const backup = await buildBackupData();
      await HayDayItemImages.remove('bread');
      await refreshItemImageCache();
      const removed = !hasCustomItemImage('bread');
      const merged = await importBackupImages(backup);
      await refreshItemImageCache();
      return { removed, merged, restored: hasCustomItemImage('bread') };
    });
    check("新版备份以合并方式恢复图片", imageMergeState.removed && imageMergeState.merged === 1 && imageMergeState.restored, JSON.stringify(imageMergeState));
    const failedBundleImport = await page.evaluate(async (tinyPng) => {
      const beforeImages = await HayDayItemImages.exportMap();
      const beforeEdits = localStorage.getItem('hd_edits');
      const beforeInventory = localStorage.getItem('hd_inv');
      const backup = await buildBackupData();
      backup.items = {};
      backup.itemImages.bread = {
        dataUrl: tinyPng,
        mimeType: 'image/png',
        width: 1,
        height: 1,
        updatedAt: '2099-01-01T00:00:00.000Z',
      };
      const originalRecordEditHistory = recordEditHistory;
      let message = '';
      recordEditHistory = () => false;
      try {
        await importBackupBundle(backup);
      } catch (error) {
        message = error.message;
      } finally {
        recordEditHistory = originalRecordEditHistory;
      }
      const afterImages = await HayDayItemImages.exportMap();
      return {
        failed: message.includes('恢复点'),
        imageRestored: afterImages.bread?.dataUrl === beforeImages.bread?.dataUrl && afterImages.bread?.updatedAt === beforeImages.bread?.updatedAt,
        editsRestored: localStorage.getItem('hd_edits') === beforeEdits,
        inventoryRestored: localStorage.getItem('hd_inv') === beforeInventory,
      };
    }, `data:image/png;base64,${TINY_PNG.toString('base64')}`);
    check("数据导入失败时同时回滚图片库和本地数据", failedBundleImport.failed && failedBundleImport.imageRestored && failedBundleImport.editsRestored && failedBundleImport.inventoryRestored, JSON.stringify(failedBundleImport));
    const failedDataCommit = await page.evaluate(async () => {
      const before = {
        edits:localStorage.getItem('hd_edits'),
        inventory:localStorage.getItem('hd_inv'),
        filterOrder:localStorage.getItem('hd_filter_order'),
        buildings:D.buildings.map((building) => building.id).join(','),
        history:localStorage.getItem(EDIT_HISTORY_STORAGE),
      };
      const backup = await buildBackupData();
      backup.filterOrder = [{st:'',bld:'net_maker'},{st:'',bld:'bakery'}];
      const originalSaveInventory = sv;
      let message = '';
      sv = () => {throw new Error('模拟库存保存失败');};
      try{importBackupData(backup);}catch(error){message=error.message;}finally{sv=originalSaveInventory;}
      return {
        failed:message.includes('模拟库存保存失败'),
        edits:localStorage.getItem('hd_edits')===before.edits,
        inventory:localStorage.getItem('hd_inv')===before.inventory,
        filterOrder:localStorage.getItem('hd_filter_order')===before.filterOrder,
        buildings:D.buildings.map((building) => building.id).join(',')===before.buildings,
        history:localStorage.getItem(EDIT_HISTORY_STORAGE)===before.history,
      };
    });
    check("本地写入中途失败时恢复库存、编辑、排序和恢复记录", failedDataCommit.failed && failedDataCommit.edits && failedDataCommit.inventory && failedDataCommit.filterOrder && failedDataCommit.buildings && failedDataCommit.history, JSON.stringify(failedDataCommit));
    await page.click('#dataReviewPanel .data-review-heading .btn');
    check("退出校对后恢复原库存界面", await page.evaluate(() => document.querySelector('#dataReviewPanel').hidden && !document.querySelector('#inventoryMainLayout').hidden));
    await page.click('.tab[data-tab="priority"]');

    const tileMetaTexts = await page.$$eval(".tile-meta", (els) => els.map((el) => el.textContent));
    check("物品 tile 显示需求数量", tileMetaTexts.some((text) => /需产?\d+个/.test(text)));

    const dragHeaders = await page.$$(".section-header[draggable='true']");
    check("分组标题可拖拽", dragHeaders.length >= 30);

    const productDrag = await page.evaluate(() => {
      const grid = Array.from(document.querySelectorAll(".item-grid"))
        .find((candidate) => candidate.querySelectorAll(".item-tile").length >= 2);
      if (!grid) return null;
      const ids = Array.from(grid.querySelectorAll(".item-tile")).slice(0, 2).map((tile) => tile.dataset.id);
      return { group: grid.dataset.grp, first: ids[0], second: ids[1] };
    });
    check("产品卡片可拖拽", productDrag !== null && (await page.$$(".item-tile[draggable='true']")).length >= 200);
    if (productDrag) {
      await page.locator(`[data-id="${productDrag.first}"]`).dragTo(page.locator(`[data-id="${productDrag.second}"]`));
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForTimeout(300);
      const persistedFirstTwo = await page.$$eval(`.item-grid[data-grp="${productDrag.group}"] .item-tile`,
        (tiles) => tiles.slice(0, 2).map((tile) => tile.dataset.id));
      check("产品拖动顺序刷新后保留", persistedFirstTwo[0] === productDrag.second && persistedFirstTwo[1] === productDrag.first,
        persistedFirstTwo.join(","));
    }

    const onfocusAttr = await page.$eval(".tile-input", (el) => el.getAttribute("onfocus"));
    check("输入框 onfocus 包含 select()", onfocusAttr && onfocusAttr.includes("select"));

    await page.fill("#searchInput", "小麦");
    check("搜索时显示结果数量", /^找到 \d+ 项$/.test(await page.textContent("#searchResult")));
    check("搜索时显示清除按钮", await page.locator("#searchClear").isVisible());
    await page.click("#searchClear");
    check("清除搜索恢复完整清单", (await page.inputValue("#searchInput")) === "" && (await page.$$(".item-tile")).length >= 200);

    const migrationState = await page.evaluate(() => {
      localStorage.removeItem("hd_migrate_peanut_milkshake");
      localStorage.removeItem("hd_migrate_fish_and_chips");
      localStorage.setItem("hd_edits", JSON.stringify({
        mod: {
          peanut_milkshake: { nameCN: "花生奶昔", bld: "milkshake_bar", t: 5100, ing: [{ i: "peanut", q: 1 }] },
          fish_and_chips: { nameCN: "旧名称", bld: "deep_fryer", t: 4560, ing: [{ i: "fish_fillet", q: 2 }] },
        },
        add: [],
        del: [],
      }));
      const edits = loadEdits();
      return { peanut: edits.mod.peanut_milkshake, fish: edits.mod.fish_and_chips };
    });
    check("历史迁移保留人工时间和配方", migrationState.peanut.t === 5100 && migrationState.peanut.ing.length === 1 && migrationState.fish.t === 4560 && migrationState.fish.ing.length === 1, JSON.stringify(migrationState));
    check("历史迁移仅修正名称和设备", migrationState.peanut.bld === "ice_cream_maker" && migrationState.fish.bld === "bbq_grill" && migrationState.fish.nameCN === "炸鱼薯条", JSON.stringify(migrationState));

    const importState = await page.evaluate(() => {
      if(!S.wheat)S.wheat={n:0,tg:(im.wheat&&im.wheat.tg)||5};
      S.wheat.n=37;
      sv();
      const historyBefore = loadEditHistory().length;
      const restored = importBackupData({
        gtSilo: 12,
        gtBarn: 9,
        siloCap: 500,
        barnCap: 600,
        items: { custom_review_item: { n: 7, tg: 9 } },
        edits: {
          mod: {},
          add: [{ id: "custom_review_item", nameCN: "测试自定义物品", emoji: "box", bld: "bakery", ing: [{ i: "wheat", q: 1 }, { i: "wheat", q: 2 }], t: 1800, tg: 9, st: "barn" }],
          del: ["lavender"],
        },
      });
      const savedEdits = JSON.parse(localStorage.getItem("hd_edits"));
      return {
        restored,
        stock: gs("custom_review_item"),
        target: gt("custom_review_item"),
        ingredients: savedEdits.add[0].ing,
        emoji: savedEdits.add[0].emoji,
        deletions: savedEdits.del,
        historyBefore,
        historyAfter: loadEditHistory().length,
        preservedWheat: gs('wheat'),
      };
    });
    check("自定义物品备份完整恢复", importState.restored === 1 && importState.stock === 7 && importState.target === 9, JSON.stringify(importState));
    check("不完整备份不会清空未包含物品的库存", importState.preservedWheat === 37, JSON.stringify(importState));
    check("导入时规范重复原料和依赖删除", importState.ingredients.length === 1 && importState.ingredients[0].q === 3 && !importState.deletions.includes("lavender"), JSON.stringify(importState));
    check("导入旧备份时统一历史物品图标", importState.emoji === '📦', JSON.stringify(importState));
    const exportedEmojiState = await page.evaluate(async () => {
      const backup = await buildBackupData();
      const records = Object.values(backup.edits.mod || {}).concat(backup.edits.add || []);
      return {
        records: records.length,
        allBoxes: records.every((item) => item?.emoji === '📦'),
      };
    });
    check("重新导出的编辑数据全部使用箱子图标", exportedEmojiState.records > 0 && exportedEmojiState.allBoxes, JSON.stringify(exportedEmojiState));
    check("导入物品编辑前自动创建恢复点", importState.historyAfter === importState.historyBefore + 1, JSON.stringify(importState));
    check("导入旧版备份不会清空已有用户图片", await page.evaluate(() => hasCustomItemImage('bread')));
    const unsafeImportState = await page.evaluate(() => {
      const editsBefore = localStorage.getItem('hd_edits');
      let message = '';
      try{
        validateImportedBackup({
          items: {},
          edits: {
            mod: {},
            add: [{id:"custom_bad');alert(1)//",nameCN:'恶意物品',bld:'bakery',ing:[{i:'wheat',q:1}],t:1,tg:1,st:'barn'}],
            del: [],
          },
        });
      }catch(error){message=error.message;}
      return {rejected:message.includes('编号无效'),untouched:localStorage.getItem('hd_edits')===editsBefore};
    });
    check("导入会拒绝可注入页面的自定义物品编号", unsafeImportState.rejected && unsafeImportState.untouched, JSON.stringify(unsafeImportState));
    const legacyBackupValidation = await page.evaluate(() => {
      const checked = validateImportedBackup({
        items: {_v:1,_bc:450,wheat:{n:3,tg:5}},
        edits: {
          mod: {rose_oil:{nameCN:'历史重复精油',bld:'essential_oils_lab',ing:[{i:'ginger',q:5}],t:600,tg:3}},
          add: [],
          del: [],
        },
      });
      return {wheat:checked.items.wheat.n,metadata:checked.items._v,preservedRose:Object.prototype.hasOwnProperty.call(checked.edits.mod,'rose_oil')};
    });
    check("历史备份元数据和已失效精油记录可无损往返", legacyBackupValidation.wheat === 3 && legacyBackupValidation.metadata === 1 && legacyBackupValidation.preservedRose, JSON.stringify(legacyBackupValidation));
    const customItemEditState = await page.evaluate(() => {
      const edits = loadEdits();
      edits.mod.custom_review_item = {nameCN:'测试自定义物品（已修改）'};
      saveEdits(edits);
      applyEdits();
      return {name:im.custom_review_item?.nameCN,stock:gs('custom_review_item')};
    });
    check("导入的自定义物品后续编辑能够生效且保留库存", customItemEditState.name === '测试自定义物品（已修改）' && customItemEditState.stock === 7, JSON.stringify(customItemEditState));
    const deleteRecoveryBefore = await page.evaluate(() => ({
      historyCount: loadEditHistory().length,
      stock: gs('custom_review_item'),
      inventory: localStorage.getItem('hd_inv'),
    }));
    await page.evaluate(() => openEditModal('custom_review_item'));
    page.once('dialog', (dialog) => dialog.accept());
    await page.click('#emDelete');
    await page.waitForTimeout(100);
    const deleteRecoverySaved = await page.evaluate(() => ({
      exists: Boolean(im.custom_review_item),
      historyCount: loadEditHistory().length,
      latestId: loadEditHistory()[0]?.id || '',
      latestLabel: loadEditHistory()[0]?.label || '',
      stock: gs('custom_review_item'),
      inventory: localStorage.getItem('hd_inv'),
    }));
    check("删除物品前自动创建恢复点", !deleteRecoverySaved.exists && deleteRecoverySaved.historyCount === deleteRecoveryBefore.historyCount + 1 && deleteRecoverySaved.latestLabel.includes('删除') && deleteRecoverySaved.stock === deleteRecoveryBefore.stock && deleteRecoverySaved.inventory === deleteRecoveryBefore.inventory, JSON.stringify(deleteRecoverySaved));
    page.once('dialog', (dialog) => dialog.accept());
    await page.evaluate((id) => restoreEditHistory(id), deleteRecoverySaved.latestId);
    await page.waitForTimeout(100);
    const deleteRecoveryRestored = await page.evaluate(() => ({
      exists: Boolean(im.custom_review_item),
      stock: gs('custom_review_item'),
      inventory: localStorage.getItem('hd_inv'),
    }));
    check("恢复已删除物品时保留原库存", deleteRecoveryRestored.exists && deleteRecoveryRestored.stock === deleteRecoveryBefore.stock && deleteRecoveryRestored.inventory === deleteRecoveryBefore.inventory, JSON.stringify(deleteRecoveryRestored));

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileFilterState = await page.evaluate(() => ({
      visibleChips: Array.from(document.querySelectorAll("#filterRow .chip")).filter((chip) => getComputedStyle(chip).display !== "none").length,
      hasOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      toggleText: document.querySelector(".mobile-filter-toggle")?.textContent,
      statColumns: getComputedStyle(document.querySelector('#statsRow')).gridTemplateColumns.split(' ').length,
      topActions: ['导出数据', '导入数据'].map((label) => {
        const button = document.querySelector(`button[aria-label="${label}"]`);
        const rect = button?.getBoundingClientRect();
        return { label: button?.getAttribute('aria-label'), width: rect?.width || 0, height: rect?.height || 0 };
      }),
    }));
    check("移动端默认收起设备筛选", mobileFilterState.visibleChips === 8 && mobileFilterState.toggleText === "展开", JSON.stringify(mobileFilterState));
    check("移动端没有横向溢出", !mobileFilterState.hasOverflow, JSON.stringify(mobileFilterState));
    check("移动端摘要更紧凑且顶部操作保持可点和可读", mobileFilterState.statColumns === 3 && mobileFilterState.topActions.every((action) => action.label && action.width >= 44 && action.height >= 44), JSON.stringify(mobileFilterState));
    await page.click(".mobile-filter-toggle");
    check("移动端可展开全部设备", (await page.locator("#filterRow .chip:visible").count()) > 30 && (await page.textContent(".mobile-filter-toggle")) === "收起");
    await page.click('.tab[data-tab="items"]');
    await page.click('#itemsList .items-review-entry button');
    const mobileReviewState = await page.evaluate(() => ({
      documentOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      layoutColumns: getComputedStyle(document.querySelector('.data-review-layout')).gridTemplateColumns.split(' ').length,
      searchWidth: document.querySelector('#dataReviewSearch').getBoundingClientRect().width,
      panelWidth: document.querySelector('#dataReviewPanel').getBoundingClientRect().width,
      detailVisible: document.querySelector('#dataReviewDetail').getBoundingClientRect().height > 0,
    }));
    check("移动端数据校对改为单栏且没有横向溢出", !mobileReviewState.documentOverflow && mobileReviewState.layoutColumns === 1 && mobileReviewState.searchWidth <= mobileReviewState.panelWidth && mobileReviewState.detailVisible, JSON.stringify(mobileReviewState));
    await page.click('#dataReviewPanel .data-review-heading .btn');

    await page.click('.app-view-tab[data-app-view="relations"]');
    await page.fill('#relationsSearch', '蜂蜜吐司');
    await page.press('#relationsSearch', 'Enter');
    const mobileRelations = await page.evaluate(() => {
      const viewport = document.querySelector('#relationGraphViewport');
      const svg = document.querySelector('#relationsGraph');
      const selection = document.querySelector('#relationSelection');
      const before = _relationGraphView.scale;
      relationGraphZoom(1.25);
      return {
        documentOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        viewportFits: Boolean(viewport && viewport.getBoundingClientRect().width <= document.documentElement.clientWidth),
        touchPanEnabled: getComputedStyle(viewport).touchAction === 'none',
        zoomChanged: _relationGraphView.scale > before,
        nodeCount: document.querySelectorAll('[data-network-node]').length,
        svgWidth: svg?.getBoundingClientRect().width,
        focusScale: before,
        mode: document.querySelector('#relationZoomMode')?.textContent,
        detail: selection?.textContent || '',
        detailAboveGraph: selection?.getBoundingClientRect().bottom <= viewport?.getBoundingClientRect().top + 1,
        detailInFirstScreen: selection?.getBoundingClientRect().bottom <= innerHeight,
        demandPlannerFits: document.querySelector('#relationDemandPlanner')?.getBoundingClientRect().width <= document.documentElement.clientWidth,
        demandResultVisible: !document.querySelector('#relationDemandResult')?.hidden,
        demandControlsHeight: document.querySelector('#relationDemandRun')?.getBoundingClientRect().height || 0,
      };
    });
    check("移动端全图不撑宽页面，并支持缩放与拖动", !mobileRelations.documentOverflow && mobileRelations.viewportFits && mobileRelations.touchPanEnabled && mobileRelations.zoomChanged && mobileRelations.nodeCount > 400, JSON.stringify(mobileRelations));
    check("移动端搜索进入可读聚焦且首屏可见配方", mobileRelations.focusScale >= .86 && mobileRelations.mode === '聚焦' && mobileRelations.detailAboveGraph && mobileRelations.detailInFirstScreen && mobileRelations.detail.includes('配方：'), JSON.stringify(mobileRelations));
    check("移动端需求模拟不撑宽页面且操作按钮可点击", mobileRelations.demandPlannerFits && mobileRelations.demandResultVisible && mobileRelations.demandControlsHeight >= 40, JSON.stringify(mobileRelations));

    check("页面无 JS 异常", pageErrors.length === 0, pageErrors.join(" | "));
    check("控制台无错误", consoleErrors.length === 0, consoleErrors.join(" | "));

    await testPublicShowcaseDefaults(browser);
    await testSyncRetry(browser);

    if (results.failed > 0) {
      await page.screenshot({ path: SNAPSHOT_PATH, fullPage: false });
      console.log(`\n  失败截图已保存: ${SNAPSHOT_PATH}`);
    }
  } finally {
    await browser.close();
  }
}

async function runAndReport() {
  try {
    await run();
  } catch (error) {
    check("测试运行", false, error.stack || error.message);
  }
  const total = results.passed + results.failed;
  console.log(`\n═══ ${results.failed === 0 ? "全部通过" : "有失败"} ═══`);
  console.log(`通过: ${results.passed}/${total}  失败: ${results.failed}/${total}`);
  return results;
}

if (require.main === module) {
  runAndReport().then(() => process.exit(results.failed > 0 ? 1 : 0));
}

module.exports = { runAndReport, results };
