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

    const tileMetaTexts = await page.$$eval(".tile-meta", (els) => els.map((el) => el.textContent));
    check("物品 tile 显示需求数量", tileMetaTexts.some((text) => /需产?\d+个/.test(text)));

    const dragHeaders = await page.$$(".section-header[draggable='true']");
    check("分组标题可拖拽", dragHeaders.length >= 30);

    const onfocusAttr = await page.$eval(".tile-input", (el) => el.getAttribute("onfocus"));
    check("输入框 onfocus 包含 select()", onfocusAttr && onfocusAttr.includes("select"));

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
