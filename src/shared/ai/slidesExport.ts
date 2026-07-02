/**
 * Export a slide deck (the same Slide[] the sandbox renders) as a STANDALONE HTML file —
 * double-click to open in any browser. Self-contained except chart pages, which pull ECharts
 * from a CDN (needs network for charts only).
 *
 * The deck renders into a fixed **1920×1080 design canvas** that is `transform:scale()`-ed to
 * fit the viewport (the open-slide model — design in absolute px, framework scales). All visual
 * tokens (palette / type scale / padding / fonts) come from a `SlideTheme`, serialized to CSS
 * custom properties that `SLIDES_CSS` consumes. One layout stylesheet, N theme skins.
 *
 * `slideInnerHtml` + `SLIDES_CSS` are ALSO reused by the bundled deck-viewer page
 * (`src/viewer/deckViewer.ts`) so "view in tab" and "export to file" render identically.
 */
import type { Slide } from './slides'
import type { SlideTheme } from './slidesThemes'
import { themeVars, DEFAULT_THEME_ID, getTheme } from './slidesThemes'
import { slideInnerHtml, type SlideCtx } from './slideLayouts'
import type { SlideImage } from './slidesImages'

// re-export so existing deckViewer import keeps working
export { slideInnerHtml }

const slideHtml = (s: Slide, ctx: SlideCtx): string =>
  `<div class="slide slide--${s.layout || 'bullets'}">${slideInnerHtml(s, ctx)}</div>`

/** Build a self-contained HTML document string for the given deck + theme. */
export function buildSlidesHtml(slides: Slide[], name: string, theme: SlideTheme = getTheme(DEFAULT_THEME_ID), images: SlideImage[] = []): string {
  const data = (Array.isArray(slides) ? slides : []).filter(Boolean)
  const total = data.length
  const ctx = (i: number): SlideCtx => ({ deckName: name || '演示文稿', index: i, total, images })
  // IMPORTANT: keep this an ARRAY, not a joined string. The embedded JS indexes it per page
  // (pages[i]); a joined string would make pages[i] return a single character → blank export.
  const pages = data.map((s, i) => slideHtml(s, ctx(i)))
  const title = (name || '演示文稿').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const hasChart = data.some((s) => s.layout === 'chart')
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${SLIDES_CSS}
:root{${themeVars(theme)}}
${theme.decorations ?? ''}</style>
${hasChart ? '<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>' : ''}
</head>
<body>
<div class="slides-stage" tabindex="0">
  <div class="slide-frame-wrap"><div class="slide-frame-outer"><div class="slide-frame"></div></div></div>
  <div class="slides-bar-zone">
    <div class="slides-bar">
      <div class="slides-nav">
        <button class="page slides-prev" type="button">&#8249;</button>
        <span class="slides-count"></span>
      </div>
      <div class="slides-dots"></div>
      <div class="slides-nav">
        <button class="page slides-play" type="button" title="全屏播放"></button>
        <button class="page slides-next" type="button">&#8250;</button>
      </div>
    </div>
  </div>
</div>
<div class="slides-print"></div>
<script>window.__SLIDES__ = ${JSON.stringify(pages)}; window.__COUNT__ = ${total};</script>
<script>${SLIDES_JS}</script>
</body>
</html>`
}

/** Trigger a browser download of the HTML string (no new window/tab). */
export function downloadSlidesHtml(slides: Slide[], name: string, theme: SlideTheme = getTheme(DEFAULT_THEME_ID), images: SlideImage[] = []): void {
  const html = buildSlidesHtml(slides, name, theme, images)
  // Prepend a UTF-8 BOM so every browser opens the file as UTF-8 regardless of the system locale
  // (Chinese Windows otherwise tends to guess GBK → mojibake), even with <meta charset> present.
  const blob = new Blob(['﻿' + html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${(name || '演示文稿').replace(/[\\/:*?"<>|]/g, '_')}.html`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ── Shared slide styles (used by both the exported file and the viewer page) ─
//    Token-driven: palette / type scale / padding / fonts come from the injected SlideTheme vars.
//    The `:root` block here is only a defensive fallback; the runtime always overrides it.
export const SLIDES_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#fff;--fg:#1f2329;--accent:#3370ff;--muted:#646a73;--card:#f5f6f8;--border:#dee0e3;--pad:120px;--hero-size:104px;--heading-size:58px;--body-size:34px;--caption-size:24px;--font-display:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;--font-body:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
html,body{height:100%;background:var(--bg);color:var(--fg);font-family:var(--font-body)}
.slides-stage{position:fixed;inset:0;display:flex;flex-direction:column;outline:none;background:var(--bg)}
.slides-stage::backdrop{background:var(--bg)}
/* 1920×1080 fixed design canvas, transform-scaled to fit the wrap. Design in absolute px. */
.slide-frame-wrap{flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative}
.slide-frame-outer{position:relative;overflow:hidden}
.slide-frame{width:1920px;height:1080px;transform-origin:top left;overflow:hidden}
.slide{display:flex;flex-direction:column;justify-content:center;width:100%;height:100%;padding:var(--pad);background:var(--bg);color:var(--fg);font-family:var(--font-body);overflow:hidden}
.slide--title,.slide--section,.slide--quote{align-items:center;text-align:center}
.s-title{font-family:var(--font-display);font-size:var(--hero-size);font-weight:800;line-height:1.1;color:var(--fg)}
.s-head{font-family:var(--font-display);font-size:var(--heading-size);font-weight:800;line-height:1.15;margin-bottom:40px;color:var(--fg)}
.s-sub{font-size:var(--body-size);color:var(--muted);margin-top:32px}
.s-section-num{font-size:var(--caption-size);letter-spacing:.3em;color:var(--accent);font-weight:700;margin-bottom:28px}
.s-bullets{list-style:none;padding:0;margin:0}
.s-bullets li{font-size:var(--body-size);line-height:1.6;color:var(--fg);padding:14px 0 14px 40px;position:relative}
.s-bullets li::before{content:"";position:absolute;left:0;top:26px;width:14px;height:14px;border-radius:50%;background:var(--accent)}
.s-two{display:grid;grid-template-columns:1fr 1fr;gap:64px}
.s-stats{display:flex;flex-wrap:wrap;gap:48px}
.s-stat{flex:1;min-width:260px;text-align:center}
.s-num{font-family:var(--font-display);font-size:var(--hero-size);font-weight:800;color:var(--accent);line-height:1}
.s-label{font-size:var(--caption-size);color:var(--muted);margin-top:16px}
.s-quote{font-size:var(--heading-size);line-height:1.5;font-style:italic;color:var(--fg)}
.s-by{font-size:var(--caption-size);color:var(--muted);margin-top:32px;text-align:right}
.s-chart{width:100%;height:560px;min-height:400px}
.s-embed{padding:80px 0;text-align:center}
.muted.center{color:var(--muted);font-size:var(--body-size)}
.s-eyebrow{font-size:var(--caption-size);letter-spacing:.28em;text-transform:uppercase;color:var(--accent);font-weight:600;margin-bottom:20px}
.s-footer{position:absolute;left:var(--pad);right:var(--pad);bottom:48px;display:flex;align-items:baseline;font-size:18px;letter-spacing:.2em;color:var(--muted);border-top:1px solid var(--border);padding-top:14px}
.slide{position:relative} /* footer 绝对定位锚点 */
/* photo frame（圆角+阴影，open-slide 风）*/
.s-photo,.s-split-img,.s-card-img,.s-cover-bg{border-radius:var(--osd-radius,12px);overflow:hidden}
/* Content images (split/card/photo) use 'contain' so the FULL image is always visible —
   'cover' cropped landscape doc images. The container's --card bg fills the letterbox area so
   the letterboxing reads as a deliberate matte, not a gap. The cover background stays 'cover'
   (decorative, with title text overlaid at low opacity). */
.s-photo img,.s-split-img img,.s-card-img img{width:100%;height:100%;object-fit:contain;display:block}
.s-cover-bg img{width:100%;height:100%;object-fit:cover;display:block}
.s-photo,.s-split-img,.s-card-img{box-shadow:0 2px 12px rgba(0,0,0,.06)}
/* image-split */
.s-split{display:flex;gap:64px;align-items:center;flex:1}
.s-split--left{flex-direction:row-reverse}
.s-split-text{flex:1.2;display:flex;flex-direction:column;justify-content:center}
.s-split-img{flex:0.8;align-self:stretch;min-height:360px}
/* cards grid */
.s-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:40px;flex:1;align-content:center}
.s-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:32px 28px}
.s-card-img{margin:-32px -28px 24px;height:180px;border-radius:12px 12px 0 0}
.s-card-num{font-family:var(--font-display);font-size:32px;color:var(--accent);margin-bottom:12px}
.s-card-title{font-family:var(--font-display);font-size:30px;font-weight:700;color:var(--fg);margin-bottom:12px}
.s-card-body{font-size:18px;color:var(--muted);line-height:1.6}
/* cover */
.s-cover{align-items:center;justify-content:center;position:relative}
.s-cover--hasimg .s-cover-bg{position:absolute;inset:0;border-radius:0;box-shadow:none}
.s-cover--hasimg .s-cover-bg img{opacity:.45}
.s-cover-inner{position:relative;z-index:1;text-align:center;max-width:1500px}
.s-cover--hasimg~.s-footer,.s-cover .s-footer{color:var(--fg)}
@media (max-width:900px){.s-cards{grid-template-columns:repeat(2,1fr)}}
@media print{
  .s-cards{grid-template-columns:repeat(3,1fr)}
  .s-split-img,.s-photo,.s-card-img{height:auto}
}
.slides-bar{flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;border-top:1px solid var(--border);background:var(--card)}
.slides-nav{display:flex;align-items:center;gap:6px}
.slides-count{font-size:13px;color:var(--muted);min-width:56px;text-align:center;font-family:var(--font-body)}
.slides-dots{display:flex;gap:6px}
.slides-dot{width:8px;height:8px;border-radius:50%;border:none;background:var(--border);cursor:pointer;padding:0}
.slides-dot.active{background:var(--accent)}
button.page{height:30px;min-width:30px;padding:0 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);font-size:14px;cursor:pointer;font-family:var(--font-body)}
button.page:hover{border-color:var(--accent);color:var(--accent)}
.slides-play svg{width:15px;height:15px;display:block}
.slides-bar-zone{flex-shrink:0}
/* Fullscreen presentation: the control bar is hidden off-screen and slides up when the mouse
   enters the bottom strip (a hover catcher). The stage keeps its themed bg so fullscreen isn't
   forced dark. */
.slides-stage:fullscreen .slides-bar-zone,.slides-stage:-webkit-full-screen .slides-bar-zone{position:absolute;left:0;right:0;bottom:0;height:72px;display:flex;align-items:flex-end}
.slides-stage:fullscreen .slides-bar,.slides-stage:-webkit-full-screen .slides-bar{width:100%;transform:translateY(120%);opacity:0;transition:transform .35s cubic-bezier(.4,0,.2,1),opacity .25s ease}
.slides-stage:fullscreen .slides-bar-zone:hover .slides-bar,.slides-stage:-webkit-full-screen .slides-bar-zone:hover .slides-bar{transform:translateY(0);opacity:1}
/* Print / export-PDF: hide the paged stage, lay EVERY slide out one-per-page. The .is-building
   variant renders the sheet off-screen (but sized) so ECharts canvases get a real size before print. */
.slides-print{display:none}
.slides-print.is-building{display:block;position:fixed;inset:0;visibility:hidden;overflow:hidden;z-index:-1}
.slides-print .slide{padding:var(--pad);overflow:hidden}
@media print{
  @page{size:landscape}
  .slides-stage{display:none!important}
  .slides-print{display:block!important}
  .slides-print .slide{height:96vh;page-break-after:always}
  .slides-print .s-chart{height:45vh}
}
`

// ── Embedded JS for the STANDALONE file only (canvas fit + paging + fullscreen + charts).
//    The bundled viewer page (`src/viewer/deckViewer.ts`) reimplements this in TS — it can't
//    use this string because extension-page CSP blocks inline <script>.
const SLIDES_JS = `
(function(){
  var wrap=document.querySelector('.slide-frame-wrap');
  var outer=document.querySelector('.slide-frame-outer');
  var frame=document.querySelector('.slide-frame');
  var countEl=document.querySelector('.slides-count');
  var dotsEl=document.querySelector('.slides-dots');
  var stage=document.querySelector('.slides-stage');
  var n=window.__COUNT__||0, cur=-1;
  var pages=window.__SLIDES__||[];
  var ICON_MAX='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
  var ICON_MIN='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>';
  // Scale the 1920×1080 design canvas to fit the wrap (keeps aspect ratio, no distortion).
  function fit(){
    var w=wrap.clientWidth, h=wrap.clientHeight;
    if(!w||!h)return;
    var s=Math.min(w/1920,h/1080);
    outer.style.width=(1920*s)+'px';
    outer.style.height=(1080*s)+'px';
    frame.style.transform='scale('+s+')';
  }
  if(window.ResizeObserver){new ResizeObserver(fit).observe(wrap);}else{window.addEventListener('resize',fit);}
  dotsEl.innerHTML=Array.from({length:n},function(_,i){return '<button class="slides-dot" data-i="'+i+'" type="button"></button>';}).join('');
  var dots=Array.from(dotsEl.children);
  function hydrate(node){
    var ce=node.querySelector('.s-chart');
    if(ce&&ce.dataset.chart&&window.echarts){
      try{window.echarts.init(ce).setOption(JSON.parse(ce.dataset.chart));}catch(e){}
    }
  }
  function show(i){
    var nx=Math.max(0,Math.min(n-1,i));
    if(nx===cur)return;
    cur=nx;
    frame.innerHTML=pages[nx]||'';
    countEl.textContent=(cur+1)+' / '+n;
    dots.forEach(function(d,j){d.classList.toggle('active',j===cur);});
    hydrate(frame);
  }
  function next(){show(cur+1);}
  function prev(){show(cur-1);}
  document.querySelector('.slides-next').onclick=next;
  document.querySelector('.slides-prev').onclick=prev;
  var playBtn=document.querySelector('.slides-play');
  function inFs(){return !!(document.fullscreenElement||document.webkitFullscreenElement);}
  function syncPlayBtn(){playBtn.innerHTML=inFs()?ICON_MIN:ICON_MAX;playBtn.title=inFs()?'退出全屏':'全屏播放';}
  syncPlayBtn();
  dots.forEach(function(d,i){d.onclick=function(){show(i);};});
  // Play = toggle fullscreen presentation. No autoplay — the user drives navigation
  // (wheel / arrows / click); Esc exits natively and fullscreenchange re-syncs the icon.
  function enterPresent(){var rq=stage.requestFullscreen||stage.webkitRequestFullscreen;if(rq){try{rq.call(stage);}catch(e){}}}
  function exitPresent(){var ex=document.exitFullscreen||document.webkitExitFullscreen;if(inFs()&&ex){try{ex.call(document);}catch(e){}}}
  playBtn.onclick=function(){if(inFs())exitPresent();else enterPresent();};
  document.addEventListener('fullscreenchange',syncPlayBtn);
  document.addEventListener('webkitfullscreenchange',syncPlayBtn);
  stage.addEventListener('keydown',function(e){
    if(e.key==='ArrowRight'||e.key===' '){e.preventDefault();next();}
    else if(e.key==='ArrowLeft'){e.preventDefault();prev();}
    else if(e.key==='Home'){show(0);}
    else if(e.key==='End'){show(n-1);}
  });
  // Mouse wheel = prev/next while presenting (windowed mode lets the design canvas breathe).
  var wheelLock=false;
  stage.addEventListener('wheel',function(e){
    if(!inFs()||wheelLock)return;
    if(Math.abs(e.deltaY)<12)return;
    wheelLock=true;
    if(e.deltaY>0)next();else prev();
    setTimeout(function(){wheelLock=false;},350);
  },{passive:true});
  // Click left/right half of the canvas to navigate (clientX vs the frame's visual midpoint).
  frame.addEventListener('click',function(e){
    var r=frame.getBoundingClientRect();
    if(e.clientX<r.left+r.width/2)prev();else next();
  });
  show(0);
  fit();
  stage.focus();
})();
`
