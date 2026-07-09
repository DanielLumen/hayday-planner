// 卡通农场 UI 自动化测试
// 运行方式: node tests/ui_tests.js
const { chromium } = require("playwright");
const path = require("path");
const { pathToFileURL } = require("url");

const FILE_URL = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

const results = { passed: 0, failed: 0, tests: [] };

function check(name, ok, detail = "") {
    if (ok) { results.passed++; console.log(`  ✓ ${name}`); }
    else { results.failed++; console.log(`  ✗ ${name} — ${detail}`); }
    results.tests.push({ name, ok, detail });
}

(async () => {
    console.log("=== 卡通农场 UI 测试 ===\n");
    
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    
    // 清除存储，从头开始
    await page.goto(FILE_URL, { waitUntil: "networkidle", timeout: 30000 });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    
    // ═══ 基础加载 ═══
    const title = await page.title();
    check("页面标题", title.includes("卡通农场"));
    check("至少30个分组", (await page.$$(".section-header")).length >= 30);
    check("至少200个物品tile", (await page.$$(".item-tile")).length >= 200);
    
    // ═══ 库存输入 ═══
    const firstInp = await page.$(".tile-input");
    check("存在库存输入框", firstInp !== null);
    
    // 取第一个物品 ID
    const firstId = await page.$eval(".item-tile", el => el.dataset.id);
    
    // 点击输入框后应保持聚焦；number 输入在不同 Chromium 版本里 selection 行为不完全一致。
    await firstInp.click();
    const focusedInput = await page.evaluate(() => document.activeElement?.classList.contains("tile-input"));
    check("点击输入框后聚焦", focusedInput);
    
    // 输入数字并回车
    await firstInp.fill("5");
    await firstInp.press("Enter");
    await page.waitForTimeout(600);
    
    // 验证值保存
    const saved = await page.$eval(`[data-id="${firstId}"] .tile-input`, el => el.value);
    check("回车后库存值保存", saved === "5");
    
    // ═══ 回车导航 ═══
    const focusedAfterEnter = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || !el.classList.contains("tile-input")) return null;
        return el.closest(".item-tile")?.dataset.id;
    });
    check("回车后焦点移到下一个输入框", focusedAfterEnter !== null && focusedAfterEnter !== firstId);
    
    // ═══ 无 spinner ═══
    const spinnerCss = await page.evaluate(() => {
        const css = Array.from(document.querySelectorAll("style"))
            .map(style => style.textContent || "")
            .join("\n");
        return css.includes("::-webkit-inner-spin-button") && css.includes("-moz-appearance:textfield");
    });
    check("输入框隐藏浏览器数字箭头 CSS 存在", spinnerCss);
    
    // ═══ 优先级面板 ═══
    const prioCount = await page.$$("#priorityList .prio-item");
    check("优先级面板有缺货物品", prioCount.length > 0);
    
    // 颜色条存在
    const hasBar = await page.$("#priorityList .prio-item .prio-bar");
    check("优先级物品前有颜色条", hasBar !== null);
    
    // 显示"缺N个"
    const prioText = await page.$eval("#priorityList .prio-name", el => el.textContent || "");
    check("优先级面板显示'缺N个'", prioText.includes("缺") && /\d+个/.test(prioText), prioText.substring(0, 60));
    
    // 不显示优先级内部评分值
    const prioBodyHtml = await page.$eval("#priorityList", el => el.innerHTML);
    check("不显示优先级评分数值", !/score|评分|分数/i.test(prioBodyHtml));
    
    // ═══ tile-meta 也显示原材料需求 ═══
    // 找一个有缺货的 tile（库存0，目标>0）
    const tileMetaTexts = await page.$$eval(".tile-meta", els => els.map(e => e.textContent));
    const hasNeed = tileMetaTexts.some(t => /需产?\d+个/.test(t));
    check("物品 tile 显示需求数量", hasNeed);
    
    // ═══ 拖拽 ═══
    const dragHeaders = await page.$$(".section-header[draggable='true']");
    check("分组标题可拖拽", dragHeaders.length >= 30);
    
    // ═══ onfocus select ═══
    const onfocusAttr = await page.$eval(".tile-input", el => el.getAttribute("onfocus"));
    check("输入框 onfocus 包含 select()", onfocusAttr && onfocusAttr.includes("select"));
    
    // ═══ 截图 ═══
    const screenshot = await page.screenshot({ path: path.join(__dirname, "ui_snapshot.png"), fullPage: false });
    console.log("\n  截图已保存: tests/ui_snapshot.png");
    
    await browser.close();
    
    // 汇总
    const total = results.passed + results.failed;
    console.log(`\n═══ ${results.failed === 0 ? "全部通过" : "有失败"} ═══`);
    console.log(`通过: ${results.passed}/${total}  失败: ${results.failed}/${total}`);
    
    process.exit(results.failed > 0 ? 1 : 0);
})();
