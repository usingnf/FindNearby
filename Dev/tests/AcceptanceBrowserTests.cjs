const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require(process.env.FIND_NEARBY_PLAYWRIGHT_PATH || 'playwright');

const appUrl = 'http://127.0.0.1:5173';
const fixture = JSON.parse(readFileSync(join(__dirname, '자료_FindNearby_재개7인수시험.json'), 'utf8'));
const modes = { walk: ['W', '도보'], transit: ['T', '대중교통'], car: ['C', '자동차'] };
const kinds = { convenience: '편의점', subway: '지하철역', restroom: '공중화장실' };
const cases = fixture.origins.flatMap(origin => Object.entries(origin.facilities_by_mode).map(([mode, kind]) => ({
  id: `${origin.id}-${modes[mode][0]}`, originId: origin.id, coordinates: origin.coordinates, mode, kind,
})));
const activeCases = cases.filter(sample => fixture.active_origin_ids.includes(sample.originId));
for (const { id, origin_id, mode, kind } of fixture.supplemental_cases) {
  cases.push({ id, coordinates: fixture.origins.find(origin => origin.id === origin_id).coordinates, mode, kind });
}

class AcceptanceBrowserTests {
  constructor(browser, live, touch) {
    this.browser = browser;
    this.live = live;
    this.touch = touch;
  }

  async run(cases) {
    const context = await this.browser.newContext({
      viewport: this.touch ? { width: 390, height: 844 } : { width: 1366, height: 900 },
      hasTouch: this.touch,
    });
    if (!this.live) {
      // Keep browser verification local even when a real key is configured.
      await context.route(url => url.origin !== appUrl, route => route.abort());
      await context.route('**/api/status', route => route.fulfill({
        json: { live_ready: false, facilities: 0, access_points: 0 },
      }));
    }
    try {
      for (const sample of cases) console.log(JSON.stringify(await this.runCase(context, sample)));
    } finally {
      await context.close();
    }
  }

  async runCase(context, sample) {
    const page = await context.newPage();
    try {
      const button = name => page.getByRole('button', { name, exact: true });
      const activate = locator => this.touch ? locator.tap() : locator.click();
      const { id, coordinates, mode, kind } = sample;
      const endpoint = path => response => new URL(response.url()).pathname === path
        && response.request().method() === 'POST';
      const detailResponses = [];
      page.on('response', response => { if (endpoint('/api/route')(response)) detailResponses.push(response); });
      await page.goto(appUrl);
      await page.getByText(this.live ? '실제 데이터' : '개발용 데모', { exact: true }).waitFor();
      if (!this.live && !this.touch) {
        const map = page.locator('.map-host');
        await map.click({ button: 'right', position: { x: 120, y: 100 } });
        await page.getByText('지도에서 선택한 위치', { exact: true }).waitFor();
        assert.notEqual(await page.locator('.origin small').innerText(), '37.56630, 126.97790');
      }
      await activate(page.getByText('좌표 직접 입력', { exact: true }));
      await page.getByLabel('위도', { exact: true }).fill(String(coordinates.lat));
      await page.getByLabel('경도', { exact: true }).fill(String(coordinates.lng));
      await activate(button('적용'));
      await page.getByText('직접 입력한 위치', { exact: true }).waitFor();
      await activate(button(kinds[kind]));
      await activate(button(modes[mode][1]));

      await page.locator('#results').evaluate(results => {
        document.querySelector('.search-primary').addEventListener('click', () => {
          const started = performance.now();
          const observer = new MutationObserver(() => {
            if (!results.querySelector('.result-meta, div[role="status"] > .notice')) return;
            observer.disconnect();
            // Wait for the rendered result to have a frame before recording it.
            requestAnimationFrame(() => requestAnimationFrame(() => {
              results.dataset.acceptanceDisplayMs = String(Math.round(performance.now() - started));
            }));
          });
          observer.observe(results, { childList: true, subtree: true });
        }, { capture: true, once: true });
      });
      const pending = page.waitForResponse(endpoint('/api/recommend'));
      await activate(button('주변 시설 추천'));
      const response = await pending;
      assert.deepEqual(response.request().postDataJSON(), { origin: coordinates, mode, kind, demo: !this.live });
      const result = await response.json();
      await page.locator('#results[data-acceptance-display-ms]').waitFor();
      const timing = await page.locator('#results').evaluate(results => ({
        displayMs: Number(results.dataset.acceptanceDisplayMs),
        recommendMs: Math.round(performance.getEntriesByName(location.origin + '/api/recommend', 'resource').at(-1)?.duration ?? 0),
      }));
      if (!response.ok()) {
        await page.locator('#results .notice').waitFor();
        return { id, live: this.live, http: response.status(), reason: result.reason ?? null, ...timing };
      }
      assert.equal(result.demo, !this.live);

      const cards = page.locator('.result-card');
      const count = result.recommendations.length;
      assert.ok(count <= 3);
      if (!this.live) assert.equal(count, 3);
      const record = {
        id, live: this.live, touch: this.touch, http: response.status(), count,
        matched: result.matched, evaluated: result.evaluated, unavailable: result.unavailable,
        failed: result.failed, reason: result.stop_reason, geometry: null, ...timing,
      };
      if (count === 0) {
        await page.locator('#results .empty').waitFor();
        return record;
      }

      await cards.nth(count - 1).waitFor();
      assert.equal(await cards.count(), count);
      const first = result.recommendations[0];
      for (const [index, item] of result.recommendations.entries()) {
        const card = cards.nth(index);
        assert.equal(await card.locator('.card-label strong').innerText(), item.facility.name);
        assert.match(await card.locator('.metrics').innerText(), /(?:초|분)\s+.+m/);
      }
      await page.getByRole('heading', { name: first.facility.name + ' 경로', exact: true }).waitFor();
      let route = first.route;
      if (route.geometry === 'summary') {
        const isFirstDetail = response => {
          if (!endpoint('/api/route')(response)) return false;
          const { destination } = response.request().postDataJSON();
          return destination.lat === first.destination.lat && destination.lng === first.destination.lng;
        };
        const detail = detailResponses.find(isFirstDetail) || await page.waitForResponse(isFirstDetail);
        assert.deepEqual(detail.request().postDataJSON().destination, first.destination);
        record.detailHttp = detail.status();
        await detail.finished();
        record.detailMs = await page.evaluate(() =>
          Math.round(performance.getEntriesByName(location.origin + '/api/route', 'resource').at(-1)?.duration ?? 0));
        if (!detail.ok()) {
          await button('상세 경로 다시 조회').waitFor();
          return record;
        }
        route = await detail.json();
      }
      if (mode === 'transit') {
        assert.match(await page.locator('#route-detail').innerText(), new RegExp(`환승 ${route.transfers}회`));
        if (route.segments.length) await page.getByRole('list', { name: '대중교통 이동 구간' }).waitFor();
      }
      if (this.touch) await activate(button('선택 경로 지도에서 보기'));
      await page.getByRole('heading', { name: this.live ? '카카오 지도' : '개발용 지도', exact: true }).waitFor();
      await page.locator('.map-host .rank-pin[aria-pressed=true]').waitFor();
      record.geometry = route.geometry;
      if (route.geometry === 'polyline') {
        // Kakao sets stroke on the SVG style; Leaflet uses SVG attributes.
        await page.locator('.map-host svg path[d][style*="stroke:"]:visible, '
          + '.map-host svg path[d][fill="none"]:visible, .map-host svg polyline:visible').first().waitFor();
      }
      if (!this.live) {
        const paths = page.locator('.map-host svg path[d][fill="none"]');
        const strokeColors = () => paths.evaluateAll(elements => elements.map(el => el.getAttribute('stroke')));
        const colors = await strokeColors();
        assert.equal(colors.length, 3);
        assert.equal(new Set(colors).size, 3);
        await activate(page.locator('.map-host .rank-pin').nth(1));
        await page.locator('.map-host .rank-pin').nth(1).and(page.locator('[aria-pressed=true]')).waitFor();
        assert.deepEqual(await strokeColors(), colors);
      }
      if (this.touch) {
        await activate(button('경로 상세 보기'));
        assert.equal(await page.locator('#route-heading').evaluate(el => el === document.activeElement), true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      }
      return record;
    } catch (error) {
      throw new Error(`${sample.id}: ${error.message}`, { cause: error });
    } finally {
      await page.close();
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const live = args.includes('--live');
  const touch = args.includes('--touch');
  const ids = args.filter(arg => !arg.startsWith('--'));
  if (live) assert.ok(args.includes('--free-quota-verified') && ids.length === 1,
    '실호출은 무료 쿼터와 유료 설정을 확인한 뒤 한 조합씩 실행하세요.');
  const selected = ids.length ? ids.map(id => {
    const sample = (live ? activeCases : cases).find(item => item.id === id);
    assert.ok(sample, `현재 실행 범위에 없는 시험 ID ${id}`);
    return sample;
  }) : activeCases;
  const browser = await chromium.launch({ executablePath: process.env.FIND_NEARBY_BROWSER_PATH || undefined });
  try {
    await new AcceptanceBrowserTests(browser, live, touch).run(selected);
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
