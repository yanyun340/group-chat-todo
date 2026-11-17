"""核心验收自动复测：在真实 Chromium 里跑通 README「时间表」的前 8 条。
输出为 JSON，供作品介绍文档引用（不修改仓库代码）。
"""
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
URL = (ROOT / "index.html").as_uri() + "?intro=0"
SAMPLE = (ROOT / "sample-chat.txt").read_text(encoding="utf-8")
R = {}


def txt(page, sel):
    el = page.query_selector(sel)
    return el.inner_text().strip() if el else None


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 1100})
    pg.goto(URL)
    pg.evaluate("localStorage.clear()")
    pg.reload()
    pg.wait_for_timeout(800)

    # 1 正常提取
    pg.fill("#chat", SAMPLE)
    pg.click("#extract")
    pg.wait_for_timeout(900)
    R["items_after_first"] = len(pg.query_selector_all("#list .item"))
    R["stat_open"] = txt(pg, "#stat-open")
    R["stat_confirm"] = txt(pg, "#stat-confirm")
    R["summary"] = txt(pg, "#summary")
    R["list_status"] = txt(pg, "#list-status")

    # 2 单条依据
    pg.click("#list .item")
    pg.wait_for_timeout(500)
    R["detail_text"] = txt(pg, "#detail-text")
    R["detail_source"] = txt(pg, "#detail-source")
    R["detail_reasons"] = txt(pg, "#detail-reasons")
    R["detail_raw_btn"] = txt(pg, "#detail-raw-btn")
    R["detail_date"] = txt(pg, "#detail-date")
    if pg.query_selector("#detail-raw-btn"):
        pg.click("#detail-raw-btn")
        pg.wait_for_timeout(300)
        R["detail_raw_text"] = txt(pg, "#detail-raw-text")
    else:
        R["detail_raw_text"] = None
    if pg.query_selector("#detail-close"):
        pg.click("#detail-close")
    pg.wait_for_timeout(300)

    # 3 空输入
    pg.fill("#chat", "")
    pg.click("#extract")
    pg.wait_for_timeout(600)
    R["empty_hint"] = txt(pg, "#hint")
    R["items_after_empty"] = len(pg.query_selector_all("#list .item"))

    # 4 纯闲聊
    pg.fill("#chat", "小明 09:33 中午一起吃饭吗\n同学甲 09:34 好的")
    pg.click("#extract")
    pg.wait_for_timeout(600)
    R["chat_hint"] = txt(pg, "#hint")
    R["items_after_chat"] = len(pg.query_selector_all("#list .item"))

    # 5 再次提取是追加
    pg.fill("#chat", SAMPLE + "\n团支书 10:20 周三前把青年大学习的截图发给我\n")
    pg.click("#extract")
    pg.wait_for_timeout(900)
    R["items_after_append"] = len(pg.query_selector_all("#list .item"))

    # 6 标记完成 + 刷新保持
    pg.click("#list .item input[type=checkbox]")
    pg.wait_for_timeout(500)
    R["stat_done"] = txt(pg, "#stat-done")
    pg.reload()
    pg.wait_for_timeout(900)
    R["items_after_reload"] = len(pg.query_selector_all("#list .item"))
    R["stat_done_after_reload"] = txt(pg, "#stat-done")

    # 7 日历
    pg.click("#view-toggle")
    pg.wait_for_timeout(700)
    R["calendar_visible"] = pg.is_visible("#calendar")
    R["cal_scheduled_days"] = len(pg.query_selector_all("#cal-grid .cal__count"))
    R["cal_scheduled_items"] = pg.evaluate(
        "Array.from(document.querySelectorAll('#cal-grid .cal__day'))"
        ".reduce((s,e)=>s+Number(e.dataset.load||0),0)")
    R["cal_unscheduled"] = txt(pg, "#cal-unscheduled-count")
    R["cal_meta"] = txt(pg, "#cal-meta")
    R["totals"] = pg.evaluate(
        "['stat-open','stat-confirm','stat-done'].map(i=>document.getElementById(i).innerText.trim()).join('/')")

    # 8 主题切换 + 刷新保持
    pg.click("#view-toggle")
    pg.wait_for_timeout(400)
    theme_before = pg.get_attribute("html", "data-theme")
    pg.click("#theme-toggle")
    pg.wait_for_timeout(700)
    theme_after = pg.get_attribute("html", "data-theme")
    pg.reload()
    pg.wait_for_timeout(700)
    R["theme"] = {"before": theme_before, "after": theme_after,
                  "after_reload": pg.get_attribute("html", "data-theme")}

    pg.screenshot(path=str(ROOT / "submission" / "_preview" / "smoke.png"), full_page=False)
    b.close()

out = ROOT / "submission" / "_preview" / "smoke.json"
out.write_text(json.dumps(R, ensure_ascii=False, indent=2), encoding="utf-8")
print("written:", out)