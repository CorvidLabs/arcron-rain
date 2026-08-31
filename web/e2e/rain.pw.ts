/**
 * Rain as a holder clicks through it: list, open, detail, empty, missing.
 *
 * `page.pw.ts` audits what the CSS resolves to. This file is the behaviour: a
 * hash-only "Open a rain" resolved against the base href as the list itself,
 * so the button appeared to do nothing, and pinning the form under the table
 * left opening a rain ending on an empty form. `/new` is a page.
 *
 * It also pins D3a at the level a unit test cannot reach — the rendered page.
 * Rain is the holder's surface: no upkeep id, no selector, no escrow, and not
 * the word Arcron, anywhere a reader can see. The keeper is still *read*, and
 * `the schedule decides whether a rain may say Due` is the test that keeps
 * that read honest.
 */

import { expect, test, type Page } from '@playwright/test';

import { RAIN_APP_ID, stubAlgod, stubWebFonts } from './chain';

async function settled(page: Page): Promise<void> {
  await expect(page.locator('.status .mono')).not.toHaveText(/connecting/, { timeout: 15_000 });
  await expect(page.locator('.status .mono')).toContainText('testnet-v1.0');
}

/**
 * The list's own "Open a rain" button, not the one in the header.
 *
 * Both are the same destination and both must work, so neither is going away —
 * but a bare role lookup matches two elements and Playwright refuses. The
 * header's copy is exercised by `the nav is two rain destinations`.
 */
function primaryCta(page: Page) {
  return page.locator('#main').getByRole('link', { name: 'Open a rain' });
}

async function openHub(page: Page): Promise<void> {
  await stubWebFonts(page);
  await stubAlgod(page);
  await page.goto('/');
  await settled(page);
  await expect(page.getByRole('heading', { name: 'Rains' })).toBeVisible();
  await expect(page.getByText('Corvid daily')).toBeVisible();
}

/**
 * D3a, checked against the rendered text rather than the source.
 *
 * A unit test greps a template literal; this reads what a person would. Both
 * are worth having — the template check catches it before a build, this
 * catches it arriving from a component the page composes rather than owns.
 */
async function noKeeperSurface(page: Page): Promise<void> {
  const body = (await page.locator('body').innerText()).toLowerCase();
  for (const word of ['arcron', 'upkeep', 'escrow', 'catch-up', 'registry', 'keeper']) {
    expect(body, `"${word}" is visible to a Rain reader`).not.toContain(word);
  }
  await expect(page.locator('a[href*="/u/"]')).toHaveCount(0);
}

test.describe('rain hub', () => {
  test('Open a rain is a page, and never the list it was clicked from', async ({ page }) => {
    await openHub(page);

    await primaryCta(page).click();

    await expect(page).toHaveURL(/\/new(?:\?|$)/);
    const url = new URL(page.url());
    expect(url.pathname, 'Open a rain landed back on the list').toBe('/new');
    expect(url.hash).not.toBe('#create');

    await expect(page.getByRole('heading', { name: 'Open a rain' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Rains' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Back to rains' })).toBeVisible();
    await expect(page.getByText('Who it falls on')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open this rain' })).toBeDisabled();
    await noKeeperSurface(page);
  });

  test('the same bug does not come back at phone width', async ({ page }) => {
    await stubWebFonts(page);
    await stubAlgod(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await settled(page);

    await primaryCta(page).click();

    await expect(page).toHaveURL(/\/new(?:\?|$)/);
    await expect(page.getByRole('heading', { name: 'Open a rain' })).toBeVisible();
  });

  test('empty-hub Open one goes to the same page', async ({ page }) => {
    await stubWebFonts(page);
    await stubAlgod(page, { emptyRains: true });
    await page.goto('/');
    await settled(page);

    await expect(page.getByText('No rains on this hub yet.')).toBeVisible();
    await page.getByRole('link', { name: 'Open one' }).click();

    await expect(page).toHaveURL(/\/new(?:\?|$)/);
    await expect(page.getByRole('heading', { name: 'Open a rain' })).toBeVisible();
  });

  test('the table lists every stub rain and a row opens its detail', async ({ page }) => {
    await openHub(page);

    const daily = page.getByRole('row', { name: /Corvid daily/ });
    const gm = page.getByRole('row', { name: /Corvid GM/ });
    const lottery = page.getByRole('row', { name: /Corvid lottery/ });
    const asa = page.getByRole('row', { name: /live ASA split/ });
    await expect(daily).toBeVisible();
    await expect(gm).toBeVisible();
    await expect(lottery).toBeVisible();
    await expect(asa).toBeVisible();
    await expect(daily).toContainText('Everyone');
    await expect(gm).toContainText('Who shows up');
    await expect(lottery).toContainText('One person');
    await expect(daily).toContainText('Corvid NFT');
    await expect(daily).toContainText('connect to check');
    await expect(daily).toContainText('746557513');
    await expect(asa).toContainText('770131837');
    await expect(asa).toContainText('Rain Drops');

    await daily.getByRole('link', { name: 'Corvid daily' }).click();

    await expect(page).toHaveURL(/\/r\/1(?:\?|$)/);
    await expect(page.getByRole('heading', { name: 'Corvid daily' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to rains' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'The pot' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What anyone can do here' })).toBeVisible();
    await expect(page.getByText('Split across everyone who entered')).toBeVisible();
    await expect(page.getByText('Connect an account above to enter, check in, or claim.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enter this rain' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'I am here' })).toHaveCount(0);
    await noKeeperSurface(page);

    await page.getByRole('link', { name: 'Back to rains' }).click();
    await expect(page.getByRole('heading', { name: 'Rains' })).toBeVisible();
  });

  test('the GM rain has WAVE facts', async ({ page }) => {
    await openHub(page);
    await page.getByRole('row', { name: /Corvid GM/ }).getByRole('link', { name: 'Corvid GM' }).click();
    await expect(page).toHaveURL(/\/r\/2(?:\?|$)/);
    await expect(page.getByRole('heading', { name: 'Corvid GM' })).toBeVisible();
    await expect(page.getByText('Who shows up', { exact: true })).toBeVisible();
    await expect(page.getByText('The first 10 to check in this drop')).toBeVisible();
    await expect(page.getByText('This drop', { exact: true })).toBeVisible();
    await expect(page.getByText('0 / 10')).toBeVisible();
    await expect(page.getByRole('button', { name: 'I am here' })).toHaveCount(0);
    await noKeeperSurface(page);
  });

  test('the lottery rain is one person, and missing ids say so', async ({ page }) => {
    await openHub(page);
    await page.getByRole('row', { name: /Corvid lottery/ }).getByRole('link', { name: 'Corvid lottery' }).click();
    await expect(page).toHaveURL(/\/r\/3(?:\?|$)/);
    await expect(page.getByRole('heading', { name: 'Corvid lottery' })).toBeVisible();
    await expect(page.getByText('One person', { exact: true })).toBeVisible();
    await expect(page.getByText('One random ticket each drop')).toBeVisible();
    await expect(page.getByText('This drop', { exact: true })).toHaveCount(0);

    await page.goto('/r/99');
    await settled(page);
    await expect(page.getByRole('heading', { name: 'No rain 99 on this hub.' })).toBeVisible();
    await page.getByRole('link', { name: 'See what is open' }).click();
    await expect(page.getByRole('heading', { name: 'Rains' })).toBeVisible();
  });

  test('the chrome is the hub, and nothing on it is a keeper fact', async ({ page }) => {
    await openHub(page);

    await expect(page.getByText('4 boxes on this hub')).toBeVisible();
    await expect(page.getByText('across every rain', { exact: true })).toBeVisible();
    await expect(page.getByText('ALGO, plus 1 ASA rain', { exact: true })).toBeVisible();
    // The hub id is a link on every page: the one check a reader can make that
    // this page cannot fake.
    await expect(page.getByRole('link', { name: new RegExp(String(RAIN_APP_ID)) }).first()).toBeVisible();
    // The activity log is on every page now, not hidden on the rain surface.
    await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();
    await noKeeperSurface(page);
  });

  test('the schedule decides whether a rain may say Due', async ({ page }) => {
    // Rain 1 is past its cadence, so its own standing is `due`. That alone is
    // not enough: `_fire_split` leaves `last_rain_round` untouched when a rain
    // cannot pay, so a rain nothing is servicing satisfies it for ever. With
    // the schedule readable, the page may promise a drop.
    await openHub(page);
    await page.getByRole('row', { name: /Corvid daily/ }).click();
    await expect(page).toHaveURL(/\/r\/1(?:\?|$)/);
    await expect(page.getByText('Due', { exact: true }).first()).toBeVisible();

    // With it unreadable it may not — and must not invent a round number
    // either. The box name is `"u"` then the id as a big-endian uint64, which
    // base64-encodes with a `dQ` prefix for every id this hub will ever use.
    await page.route(/\/v2\/applications\/\d+\/box\?name=b64(?:%3A|:)dQ/, (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"nope"}' }),
    );
    await page.reload();
    await settled(page);
    await expect(page.getByText('the schedule cannot be read right now')).toBeVisible();
    await expect(page.getByText('Due', { exact: true })).toHaveCount(0);
    await noKeeperSurface(page);
  });

  test('a rain waiting on a person never says Due', async ({ page }) => {
    // The other half of the same rule. Rain 3 is a ONE draw whose prize is
    // still locked: `_fire_one` returns before it writes `last_rain_round`, so
    // it is past its cadence for ever and no keeper will fire it however
    // healthy the schedule is. This page carries the Resolve/Abandon row and
    // the schedule line together, and used to publish "Due" directly above the
    // row that says why it cannot be.
    await stubWebFonts(page);
    await stubAlgod(page, { lockedOne: true });
    await page.goto('/r/3');
    await settled(page);

    await expect(page.getByRole('heading', { name: 'Corvid lottery' })).toBeVisible();
    // This rain's own standing, not the hub tile above it: the tile rolls up
    // every rain, and Corvid daily really is due, so a page-wide assertion
    // here would be asserting the wrong rain.
    await expect(page.locator('p.standing')).toHaveText('waiting');
    const schedule = page
      .locator('.panel')
      .filter({ has: page.getByRole('heading', { name: 'Schedule' }) });
    await expect(schedule.getByText('Waiting', { exact: true })).toBeVisible();
    await expect(schedule.getByText('the last drop is still being resolved')).toBeVisible();
    await expect(schedule.getByText('Due', { exact: true })).toHaveCount(0);
    // And no round is named anywhere: nothing is coming until a person acts.
    await expect(page.getByText(/next drop expected around round/)).toHaveCount(0);
    // The way out is on the same page, in the reader's own words.
    await expect(page.getByRole('button', { name: 'Return the prize to the pot' })).toBeVisible();
    await noKeeperSurface(page);
  });

  test('the nav is two rain destinations and nothing else', async ({ page }) => {
    await openHub(page);

    const nav = page.getByRole('navigation', { name: 'Rain' }).first();
    await expect(nav.getByRole('link')).toHaveCount(2);
    await nav.getByRole('link', { name: 'Open a rain' }).click();
    await expect(page).toHaveURL(/\/new(?:\?|$)/);
    await expect(page.getByRole('heading', { name: 'Open a rain' })).toBeVisible();

    await nav.getByRole('link', { name: 'Rains', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Rains' })).toBeVisible();
  });

  test('the phone drawer offers the same two destinations', async ({ page }) => {
    await stubWebFonts(page);
    await stubAlgod(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await settled(page);

    await page.getByRole('button', { name: 'Open menu' }).click();
    const drawer = page.getByRole('navigation', { name: 'Rain' }).last();
    await expect(drawer.getByRole('link', { name: 'Rains', exact: true })).toBeVisible();
    await drawer.getByRole('link', { name: 'Open a rain' }).click();
    await expect(page).toHaveURL(/\/new(?:\?|$)/);
    await expect(page.getByRole('heading', { name: 'Open a rain' })).toBeVisible();
  });

  test('a rain at phone width still opens its own detail', async ({ page }) => {
    await stubWebFonts(page);
    await stubAlgod(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await settled(page);
    await expect(page.getByText('Corvid daily')).toBeVisible();

    await page.getByRole('link', { name: 'Corvid daily' }).click();
    await expect(page).toHaveURL(/\/r\/1(?:\?|$)/);
    await expect(page.getByRole('heading', { name: 'Corvid daily' })).toBeVisible();

    await page.getByRole('link', { name: 'Back to rains' }).click();
    await expect(page.getByRole('heading', { name: 'Rains' })).toBeVisible();
  });

  test('clicking a middle cell opens that rain, not the last row', async ({ page }) => {
    await openHub(page);

    await page.getByRole('row', { name: /Corvid daily/ }).click();
    await expect(page).toHaveURL(/\/r\/1(?:\?|$)/);
    await page.getByRole('link', { name: 'Back to rains' }).click();

    await page.getByRole('row', { name: /Corvid GM/ }).click();
    await expect(page).toHaveURL(/\/r\/2(?:\?|$)/);
    await page.getByRole('link', { name: 'Back to rains' }).click();

    await page.getByRole('row', { name: /Corvid lottery/ }).click();
    await expect(page).toHaveURL(/\/r\/3(?:\?|$)/);
  });

  test('a rain row is one link covering the row, not the id and the name separately', async ({ page }) => {
    await openHub(page);
    const daily = page.getByRole('row', { name: /Corvid daily/ });
    await expect(daily.getByRole('link')).toHaveCount(1);
    await expect(daily.locator('img.thumb')).toHaveAttribute('src', /corvid-0001\.png/);
    await expect(page.locator('img[src*="mascot"]')).toHaveCount(0);
    await daily.click();
    await expect(page).toHaveURL(/\/r\/1(?:\?|$)/);
    await expect(page.getByRole('heading', { name: 'Corvid daily' })).toBeVisible();
  });

  test('an ASA rain shows the asset id and the opt-in on its page', async ({ page }) => {
    await openHub(page);
    const asa = page.getByRole('row', { name: /live ASA split/ });
    await expect(asa).toContainText('770131837');
    await expect(asa.getByText('waiting', { exact: true })).toBeVisible();
    await asa.click();
    await expect(page).toHaveURL(/\/r\/4(?:\?|$)/);
    await expect(page.getByRole('heading', { name: 'live ASA split' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Prize' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Asset 770131837/ }).first()).toBeVisible();
    await expect(page.getByText(/Connect to opt in to ASA 770131837/)).toBeVisible();
    await expect(page.getByText(/Entering still costs/)).toBeVisible();
    await noKeeperSurface(page);
  });

  test('every destination lands at the top, not a jump down', async ({ page }) => {
    await openHub(page);

    const nav = page.getByRole('navigation', { name: 'Rain' }).first();
    await nav.getByRole('link', { name: 'Open a rain' }).click();
    await expect(page.getByRole('heading', { name: 'Open a rain' })).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBeLessThan(8);

    await nav.getByRole('link', { name: 'Rains', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Rains' })).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBeLessThan(8);
  });

  test('Back to rains from the create page returns to the list', async ({ page }) => {
    await openHub(page);
    await primaryCta(page).click();
    await expect(page).toHaveURL(/\/new(?:\?|$)/);
    await page.getByRole('link', { name: 'Back to rains' }).click();
    await expect(page.getByRole('heading', { name: 'Rains' })).toBeVisible();
  });
});
