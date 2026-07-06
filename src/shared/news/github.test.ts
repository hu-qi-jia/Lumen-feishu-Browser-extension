import { describe, it, expect } from 'vitest'
import { parseGitHubTrending } from './github'

// A minified-but-faithful slice of github.com/trending structure. Real pages have more
// whitespace and indirection; this captures the anchors the parser depends on.
const SAMPLE = `
<article class="Box-row">
  <h2 class="h3 lh-condensed">
    <a href="/octocat/Hello-World">
      octocat / <wbr>Hello-World
    </a>
  </h2>
  <p class="col-9 color-fg-muted my-1 mt-0">
    An &amp; awesome &quot;demo&quot; repo with &lt;tags&gt;
  </p>
  <div class="f6 color-fg-muted mt-2">
    <span class="d-inline-block ml-0 mr-3">
      <span class="repo-language-color" style="background-color: #dea584;"></span>
      <span itemprop="programmingLanguage">Ruby</span>
    </span>
    <a href="/octocat/Hello-World/stargazers" class="Link Link--muted">
      <svg class="octicon"></svg> 1,234
    </a>
    <a href="/octocat/Hello-World/forks" class="Link Link--muted">
      <svg class="octicon"></svg> 56
    </a>
  </div>
  <div class="d-flex flex-justify-between mt-2">
    <span>1,409 stars today</span>
  </div>
</article>

<article class="Box-row">
  <h2 class="h3 lh-condensed">
    <a href="/torvalds/linux">
      torvalds / <wbr>linux
    </a>
  </h2>
  <p class="col-9 color-fg-muted my-1 mt-0">
    Linux kernel source tree
  </p>
  <div class="f6 color-fg-muted mt-2">
    <span class="d-inline-block ml-0 mr-3">
      <span class="repo-language-color" style="background-color: #555555;"></span>
      <span itemprop="programmingLanguage">C</span>
    </span>
    <a href="/torvalds/linux/stargazers">
      <svg class="octicon"></svg> 100,000
    </a>
    <a href="/torvalds/linux/forks">
      <svg class="octicon"></svg> 30,000
    </a>
  </div>
  <div class="d-flex flex-justify-between mt-2">
    <span>500 stars this week</span>
  </div>
</article>
`

describe('parseGitHubTrending', () => {
  it('extracts repo path, desc, lang, stars, forks, starsSince', () => {
    const repos = parseGitHubTrending(SAMPLE, 'daily')
    expect(repos).toHaveLength(2)

    const r0 = repos[0]
    expect(r0.rank).toBe(1)
    expect(r0.fullName).toBe('octocat/Hello-World')
    expect(r0.url).toBe('https://github.com/octocat/Hello-World')
    expect(r0.description).toBe('An & awesome "demo" repo with <tags>')
    expect(r0.language).toBe('Ruby')
    expect(r0.languageColor).toBe('#dea584')
    expect(r0.stars).toBe(1234)
    expect(r0.forks).toBe(56)
    expect(r0.starsSince).toBe(1409)
    expect(r0.sinceLabel).toBe('today')
  })

  it('respects the since label (weekly)', () => {
    const repos = parseGitHubTrending(SAMPLE, 'weekly')
    expect(repos[0].sinceLabel).toBe('today') // first repo's HTML literally says today
    expect(repos[1].sinceLabel).toBe('this week')
  })

  it('returns empty array when structure is missing', () => {
    expect(parseGitHubTrending('<html><body>nope</body></html>', 'daily')).toEqual([])
  })

  it('skips entries with non-repo hrefs', () => {
    const html = `
      <article class="Box-row">
        <h2><a href="/about">Not a repo</a></h2>
      </article>
      <article class="Box-row">
        <h2><a href="/foo/bar">Real repo</a></h2>
        <p class="col-9 my-1">desc</p>
      </article>
    `
    const repos = parseGitHubTrending(html, 'daily')
    expect(repos).toHaveLength(1)
    expect(repos[0].fullName).toBe('foo/bar')
  })

  it('decodes entities and strips tags in description', () => {
    const html = `
      <article class="Box-row">
        <h2><a href="/a/b">a/b</a></h2>
        <p class="col-9 color-fg-muted">Hello <strong>world</strong> &amp; &quot;all&quot;</p>
      </article>
    `
    const repos = parseGitHubTrending(html, 'daily')
    expect(repos[0].description).toBe('Hello world & "all"')
  })
})
