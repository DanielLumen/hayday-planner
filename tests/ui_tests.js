// 卡通农场 UI 自动化测试
// 运行方式: node tests/ui_tests.js
const { chromium } = require("playwright");
const path = require("path");
const { pathToFileURL } = require("url");

const FILE_URL = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
const SNAPSHOT_PATH = path.join(__dirname, "ui_snapshot.png");
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
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    const title = await page.title();
    check("页面标题", title.includes("卡通农场"));
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

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileFilterState = await page.evaluate(() => ({
      visibleChips: Array.from(document.querySelectorAll("#filterRow .chip")).filter((chip) => getComputedStyle(chip).display !== "none").length,
      hasOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      toggleText: document.querySelector(".mobile-filter-toggle")?.textContent,
    }));
    check("移动端默认收起设备筛选", mobileFilterState.visibleChips === 8 && mobileFilterState.toggleText === "更多设备", JSON.stringify(mobileFilterState));
    check("移动端没有横向溢出", !mobileFilterState.hasOverflow, JSON.stringify(mobileFilterState));
    await page.click(".mobile-filter-toggle");
    check("移动端可展开全部设备", (await page.locator("#filterRow .chip:visible").count()) > 30 && (await page.textContent(".mobile-filter-toggle")) === "收起设备");

    check("页面无 JS 异常", pageErrors.length === 0, pageErrors.join(" | "));
    check("控制台无错误", consoleErrors.length === 0, consoleErrors.join(" | "));

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
