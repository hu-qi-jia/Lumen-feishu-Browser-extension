"""Capture console errors from the sidepanel page by serving dist/ over HTTP
and mocking the chrome.* APIs the panel needs at init time."""
import http.server, socketserver, threading, sys, json
from playwright.sync_api import sync_playwright

PORT = 8765
DIST = r"e:\个人项目\feishu\feishu-doc-ai-assistant\dist"

# Serve dist/ so the absolute paths (/src/sidepanel/index.js) resolve.
class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=DIST, **kw)
    def log_message(self, *a): pass

with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()

    CHROME_MOCK = """
    window.chrome = {
      runtime: {
        id: 'test-extension-id',
        getURL: (p) => '/' + p.replace(/^\\//, ''),
        sendMessage: () => {},
        connect: () => ({ onMessage: { addListener: () => {} }, postMessage: () => {}, disconnect: () => {} }),
        onMessage: { addListener: () => {} },
      },
      storage: {
        local: {
          get: () => Promise.resolve({}),
          set: () => Promise.resolve(),
          remove: () => Promise.resolve(),
        },
        session: {
          get: () => Promise.resolve({}),
          set: () => Promise.resolve(),
        },
        onChanged: { addListener: () => {} },
      },
      tabs: { query: () => Promise.resolve([]), sendMessage: () => Promise.resolve() },
      sidePanel: { open: () => {}, setOptions: () => {} },
      action: { onClicked: { addListener: () => {} } },
    };
    """

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        errors = []
        page.on("console", lambda msg: errors.append(f"[console.{msg.type}] {msg.text}") if msg.type in ("error", "warning") else None)
        page.on("pageerror", lambda exc: errors.append(f"[pageerror] {exc}"))

        # Inject chrome mock before any page script runs.
        page.add_init_script(CHROME_MOCK)
        page.goto(f"http://127.0.0.1:{PORT}/src/sidepanel/index.html", wait_until="domcontentloaded")
        page.wait_for_timeout(3000)

        print("=== CAPTURED ERRORS ===")
        for e in errors:
            print(e)
        if not errors:
            print("(none)")
        print(f"=== TOTAL: {len(errors)} ===")

        page.screenshot(path=r"e:\个人项目\feishu\feishu-doc-ai-assistant\sidepanel-debug.png")
        browser.close()

    httpd.shutdown()
