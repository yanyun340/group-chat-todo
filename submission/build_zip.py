"""把提交材料打成网盘用的 zip。
用法：python -I submission/build_zip.py
包含：可运行源码 + 三份核心文档 + 样本 + prompt-log + 原始对话记录 + 作品介绍文档 PDF。
不含：视频（435MB，单独的 mp4 文件），不含面试答辩等内部草稿。
"""
import pathlib
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "submission" / "话里有事-源码包.zip"

SRC = [
    "index.html",
    "styles.css",
    "app.js",
    "bg-shader.js",
    "README.md",
    "PRD.md",
    "AGENTS.md",
    "CLAUDE.md",
    "sample-chat.txt",
    "使用说明.txt",
    "config.example.json",
    "Claude对话记录-2026-10-23.md",   # 93 轮 AI 对话原始记录（已脱敏）
]
PDF = ROOT / "submission" / "话里有事-作品介绍文档.pdf"

files = [(ROOT / f, f) for f in SRC]
files += [(p, str(p.relative_to(ROOT)).replace("\\", "/"))
          for p in sorted((ROOT / "docs").rglob("*")) if p.is_file()]
files.append((PDF, PDF.name))

missing = [str(p) for p, _ in files if not p.exists()]
if missing:
    raise SystemExit("缺少文件：" + ", ".join(missing))

with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    for path, arc in files:
        z.write(path, arc)

print("written:", OUT)
print("files:", len(files), "| size:", OUT.stat().st_size // 1024, "KB")