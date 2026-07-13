"""测试浏览器中 PptxGenJS 生成的 PPTX 是否有效"""
from playwright.sync_api import sync_playwright
import os

DIST = os.path.abspath("dist")
HTML = f"file:///{DIST.replace(os.sep, '/')}/test-pptx.html"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()

    # 捕获 console
    logs = []
    page.on("console", lambda msg: logs.append(f"[{msg.type}] {msg.text}"))

    # 捕获下载
    downloads = []
    page.on("download", lambda d: downloads.append(d))

    page.goto(HTML)
    page.wait_for_load_state("networkidle")

    # 点击按钮
    page.click("#btn")

    # 等待 "Done!" 出现
    try:
        page.wait_for_function("document.getElementById('log').textContent.includes('Done!')", timeout=15000)
    except:
        pass

    # 获取 log
    log_text = page.evaluate("document.getElementById('log').textContent")
    print("=== Browser Log ===")
    print(log_text)
    print("\n=== Console Messages ===")
    for l in logs:
        print(l)

    # 保存下载的文件
    if downloads:
        d = downloads[0]
        path = os.path.join(DIST, "test-browser-result.pptx")
        d.save_as(path)
        size = os.path.getsize(path)
        print(f"\n=== Downloaded File ===")
        print(f"Path: {path}")
        print(f"Size: {size} bytes")
    else:
        print("\n=== No download captured ===")

    browser.close()
