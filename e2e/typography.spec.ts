import { test, expect } from '@playwright/test';

// Catch a heading, platform fallback, or control escaping the shared font system.
test('all four destinations and title controls use the loaded interface family', async ({ page }) => {
  for (const path of ['/', '/discover/', '/library/', '/profile/']) {
    await page.goto(path);
    await page.locator('.content-layout').waitFor();
    const result = await page.evaluate(async () => {
      await document.fonts.ready;
      const family = getComputedStyle(document.body).fontFamily;
      const different = Array.from(document.querySelectorAll('h1,h2,h3,button,input,select,textarea,strong,p')).filter(el => {
        return el.getClientRects().length && getComputedStyle(el).fontFamily !== family;
      }).map(el => `${el.tagName}: ${el.textContent?.slice(0,40)}`);
      return { family, different, loaded: document.fonts.check(`500 16px ${family.split(',')[0]}`) };
    });
    expect(result.different, path).toEqual([]);
    expect(result.loaded).toBe(true);
    expect(result.family.toLowerCase()).toContain('sora');
  }
  await page.goto('/discover/');
  await page.getByRole('button', {name:'Dune: Part Two', exact:true}).first().click();
  await expect(page.getByRole('button',{name:'Log film',exact:true})).toBeVisible();
  const font = await page.locator('.modal').evaluate(el => ({
    heading: getComputedStyle(el.querySelector('h2')!).fontFamily,
    button: getComputedStyle(el.querySelector('button')!).fontFamily,
    body: getComputedStyle(document.body).fontFamily,
  }));
  expect(font.heading).toBe(font.body);
  expect(font.button).toBe(font.body);
});

test('type and aligned controls reflow on a narrow screen and at browser zoom', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  for (const path of ['/', '/discover/', '/library/', '/profile/']) {
    await page.goto(path);
    await page.locator('.content-layout').waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path).toBe(true);
  }
  await page.setViewportSize({width:1280,height:900});
  await page.goto('/discover/');
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  await expect(page.getByRole('textbox',{name:'Search catalog'})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
