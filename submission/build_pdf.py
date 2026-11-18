"""把 作品介绍文档.html 导出成 A4 PDF。
用法：python -I submission/build_pdf.py
"""
import os
import pathlib

from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE / "作品介绍文档.html"
OUT = HERE / "话里有事-作品介绍文档.pdf"
TMP = HERE / "话里有事-作品介绍文档.tmp.pdf"

FOOTER = """
<div style="width:100%;font-size:7.5pt;color:#6b6b6b;padding:0 16mm;
            font-family:'Microsoft YaHei',sans-serif;display:flex;
            justify-content:space-between;align-items:center;">
  <span>话里有事 · 群聊待办提取器 &nbsp;|&nbsp; 第九届传智杯 AI 创新应用挑战赛</span>
  <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
</div>
"""

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 794, "height": 1123})
    pg.goto(SRC.as_uri())
    pg.wait_for_load_state("networkidle")
    pg.emulate_media(media="print")
    pg.pdf(
        path=str(TMP),
        format="A4",
        print_background=True,
        display_header_footer=True,
        header_template="<div></div>",
        footer_template=FOOTER,
        margin={"top": "14mm", "bottom": "15mm", "left": "16mm", "right": "16mm"},
        prefer_css_page_size=False,
    )
    b.close()

try:
    os.replace(TMP, OUT)
except PermissionError:
    print("目标 PDF 被占用（可能在阅读器里打开着），已写入:", TMP)
    raise SystemExit(2)

print("written:", OUT, OUT.stat().st_size // 1024, "KB")