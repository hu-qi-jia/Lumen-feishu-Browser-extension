// Stub for Node-only modules that some deps (e.g. pptxgenjs) declare but never use in browser.
// Vite's default `__vite-browser-external.js` stub uses a filename starting with "_" which
// Chrome extensions reject. Aliased here as a normal module so the build emits no "_" file.
export default {}
