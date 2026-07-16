// 卡通农场 UI 自动化测试
// 运行方式: node tests/ui_tests.js
const { chromium } = require("playwright");
const path = require("path");
const { pathToFileURL } = require("url");
const { createServer } = require("../server");

const FILE_URL = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
const SNAPSHOT_PATH = path.join(__dirname, "ui_snapshot.png");
const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
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
  } finally {
    await syncPage.close();
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

    await page.evaluate(() => selectRelationNode('cheese_sandwich', true));
    const editActionBeforeFullscreen = await page.evaluate(() => {
      const button = document.querySelector('#relationSelection [data-edit-id="cheese_sandwich"]');
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
        editActionDisplay: getComputedStyle(document.querySelector('#relationSelection [data-edit-id="cheese_sandwich"]')).display,
        editModalHidden: document.querySelector('#editModal')?.classList.contains('hidden'),
    }));
    check("全屏按钮让关系网占满屏幕并切换为退出状态", fullscreenState.active && fullscreenState.pressed === 'true' && fullscreenState.label === '退出全屏' && fullscreenState.viewWidth >= fullscreenState.viewportWidth - 2 && fullscreenState.viewHeight >= fullscreenState.viewportHeight - 2, JSON.stringify(fullscreenState));
    check("全屏专注查看时隐藏编辑物品入口", editActionBeforeFullscreen && fullscreenState.editActionDisplay === 'none' && fullscreenState.editModalHidden, JSON.stringify({ editActionBeforeFullscreen, fullscreenState }));
    await page.evaluate(() => openEditModal('cheese_sandwich'));
    const fullscreenEditGuard = await page.evaluate(() => ({
      modalHidden: document.querySelector('#editModal')?.classList.contains('hidden'),
      message: document.querySelector('#toast')?.textContent || '',
    }));
    check("全屏期间不会在关系网后方打开编辑对话框", fullscreenEditGuard.modalHidden && fullscreenEditGuard.message.includes('退出关系网全屏'), JSON.stringify(fullscreenEditGuard));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(220);
    const restoredFullscreenState = await page.evaluate(() => ({
        active: Boolean(document.fullscreenElement || document.querySelector('#relationsView')?.classList.contains('is-pseudo-fullscreen')),
        pressed: document.querySelector('#relationFullscreenButton')?.getAttribute('aria-pressed'),
        label: document.querySelector('#relationFullscreenButton')?.textContent?.trim(),
        editActionDisplay: getComputedStyle(document.querySelector('#relationSelection [data-edit-id="cheese_sandwich"]')).display,
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

    await page.fill('#relationsSearch', '奶酪三明治');
    await page.press('#relationsSearch', 'Enter');
    const cheeseNetwork = await page.evaluate(() => {
      const root = document.querySelector('[data-network-node="cheese_sandwich"]');
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
    check("搜索只高亮并聚焦关系，不会把其他物品从全图移除", cheeseNetwork.allNodesRemain > 400 && cheeseNetwork.selected && cheeseNetwork.detail.includes('奶酪三明治'), JSON.stringify(cheeseNetwork));
    check("聚焦后显示完整动物饲料来源、数量与左右层级", ['milk','cow_feed','corn','soybean'].every((id) => cheeseNetwork.activeIds.includes(id)) && cheeseNetwork.hasSemanticQty && cheeseNetwork.leftToRight, JSON.stringify(cheeseNetwork));
    check("聚焦详情在图上方并直接显示配方", cheeseNetwork.mode === '聚焦' && cheeseNetwork.detailAboveGraph && cheeseNetwork.detail.includes('配方：') && cheeseNetwork.scale >= .9, JSON.stringify(cheeseNetwork));
    await page.locator('[data-network-node="cheese_sandwich"]').press('ArrowRight');
    const keyboardRelation = await page.evaluate(() => ({
      activeId: document.activeElement?.getAttribute('data-network-node'),
      selectedId: document.querySelector('.network-node.is-selected')?.getAttribute('data-network-node'),
      tabbableNodes: document.querySelectorAll('.network-node[tabindex="0"]').length,
    }));
    check("方向键可沿关系移动且始终只有一个键盘入口", keyboardRelation.activeId && keyboardRelation.activeId !== 'cheese_sandwich' && keyboardRelation.selectedId === keyboardRelation.activeId && keyboardRelation.tabbableNodes === 1, JSON.stringify(keyboardRelation));
    await page.press('#relationsSearch', 'Enter');

    const previousEdits = await page.evaluate(() => localStorage.getItem('hd_edits'));
    await page.click('#relationSelection [data-edit-id="cheese_sandwich"]');
    await page.evaluate(() => {
      const index = _ingRows.findIndex((row) => row.i === 'cheese');
      _ingRows[index].q = 7;
      refreshIngUI();
      updateEditSaveState();
    });
    await page.click('#emSave');
    await page.waitForTimeout(150);
    const liveEditState = await page.evaluate(() => ({
      quantity: _relationsNetwork.ingredientsById.cheese_sandwich.find((edge) => edge.to === 'cheese')?.q,
      label: Array.from(document.querySelectorAll('.network-edge-wrap.show-label .network-edge-label')).map((node) => node.textContent || '').find((text) => text.includes('7')),
      selected: document.querySelector('[data-network-node="cheese_sandwich"]')?.classList.contains('is-selected'),
    }));
    check("物品编辑保存后立即重算关系网和连线数量", liveEditState.quantity === 7 && Boolean(liveEditState.label) && liveEditState.selected, JSON.stringify(liveEditState));
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
    await page.click('.app-view-tab[data-app-view="inventory"]');
    check("至少30个分组", (await page.$$(".section-header")).length >= 30);
    check("至少200个物品tile", (await page.$$(".item-tile")).length >= 200);

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
    const chainToggle = page.locator('#planResults .chain-depth-badge').filter({ hasText: /层级 [2-9]/ }).first();
    if (await chainToggle.count()) {
      await chainToggle.click();
      const chainState = await chainToggle.evaluate((toggle) => {
        const tree = toggle.parentElement.querySelector('.chain-expanded');
        const rows = Array.from(tree.querySelectorAll('.chain-tree-row'));
        return {
          hasUndefined: tree.textContent.includes('undefined'),
          depths: rows.map((row) => Number(row.dataset.depth)),
          lefts: rows.map((row) => row.getBoundingClientRect().left),
        };
      });
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
      honeyToast: getDataReviewState(im.cheese_sandwich, loadEdits(), loadChecked()),
    }));
    check("数据校对从物品清单进入且不增加主导航", reviewWorkspace.visible && reviewWorkspace.inventoryHidden && reviewWorkspace.filters === 5 && reviewWorkspace.summary.includes('图片覆盖率'), JSON.stringify(reviewWorkspace));
    check("内置占位图不会被误算为真实图片", reviewWorkspace.missing > 0 && reviewWorkspace.honeyToast.placeholderImage && reviewWorkspace.honeyToast.missingImage, JSON.stringify(reviewWorkspace));
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
    check("新备份使用 v3 并包含用户图片", uploadedImageState.version === 3 && uploadedImageState.backupHasImage, JSON.stringify(uploadedImageState));
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
        deletions: savedEdits.del,
      };
    });
    check("自定义物品备份完整恢复", importState.restored === 1 && importState.stock === 7 && importState.target === 9, JSON.stringify(importState));
    check("导入时规范重复原料和依赖删除", importState.ingredients.length === 1 && importState.ingredients[0].q === 3 && !importState.deletions.includes("lavender"), JSON.stringify(importState));
    check("导入旧版备份不会清空已有用户图片", await page.evaluate(() => hasCustomItemImage('bread')));

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
    check("移动端默认收起设备筛选", mobileFilterState.visibleChips === 8 && mobileFilterState.toggleText === "更多设备", JSON.stringify(mobileFilterState));
    check("移动端没有横向溢出", !mobileFilterState.hasOverflow, JSON.stringify(mobileFilterState));
    check("移动端摘要更紧凑且顶部操作保持可点和可读", mobileFilterState.statColumns === 3 && mobileFilterState.topActions.every((action) => action.label && action.width >= 44 && action.height >= 44), JSON.stringify(mobileFilterState));
    await page.click(".mobile-filter-toggle");
    check("移动端可展开全部设备", (await page.locator("#filterRow .chip:visible").count()) > 30 && (await page.textContent(".mobile-filter-toggle")) === "收起设备");
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
    await page.fill('#relationsSearch', '奶酪三明治');
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
      };
    });
    check("移动端全图不撑宽页面，并支持缩放与拖动", !mobileRelations.documentOverflow && mobileRelations.viewportFits && mobileRelations.touchPanEnabled && mobileRelations.zoomChanged && mobileRelations.nodeCount > 400, JSON.stringify(mobileRelations));
    check("移动端搜索进入可读聚焦且首屏可见配方", mobileRelations.focusScale >= .86 && mobileRelations.mode === '聚焦' && mobileRelations.detailAboveGraph && mobileRelations.detailInFirstScreen && mobileRelations.detail.includes('配方：'), JSON.stringify(mobileRelations));

    check("页面无 JS 异常", pageErrors.length === 0, pageErrors.join(" | "));
    check("控制台无错误", consoleErrors.length === 0, consoleErrors.join(" | "));

    await testSyncRetry(browser);

    if (results.failed > 0) {
      await page.screenshot({ path: SNAPSHOT_PATH, fullPage: false });
      console.log(`\n  失败截图已保存: ${SNAPSHOT_PATH}`);
    }
  } finally {
    await browser.close();
  }
}

run()
  .catch((error) => {
    check("测试运行", false, error.stack || error.message);
  })
  .finally(() => {
    const total = results.passed + results.failed;
    console.log(`\n═══ ${results.failed === 0 ? "全部通过" : "有失败"} ═══`);
    console.log(`通过: ${results.passed}/${total}  失败: ${results.failed}/${total}`);
    process.exit(results.failed > 0 ? 1 : 0);
  });
