import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

test('Super Admin Fiscal Invoicing Visual & Functional Audit', async ({ page }) => {
  const screenshotDir = path.join(process.cwd(), 'docs/playwright-screenshots/super-admin-fiscal');
  fs.mkdirSync(screenshotDir, { recursive: true });

  const baseUrl = process.env.BASE_URL || 'https://vendix.com';

  console.log('1. Navigating to login...');
  await page.goto(`${baseUrl}/admin/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="email"], input[name="email"], input[formcontrolname="email"]', { timeout: 15000 });
  await page.screenshot({ path: path.join(screenshotDir, '01-login-page.png') });

  console.log('2. Filling credentials...');
  await page.fill('input[type="email"], input[name="email"], input[formcontrolname="email"]', 'admin@vendix.online');
  await page.fill('input[type="password"], input[name="password"], input[formcontrolname="password"]', '1125634q');
  await page.screenshot({ path: path.join(screenshotDir, '02-login-filled.png') });

  console.log('3. Submitting login...');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(4000);

  console.log('4. Navigating to super-admin fiscal invoicing...');
  await page.goto(`${baseUrl}/super-admin/fiscal/invoicing`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(screenshotDir, '03-super-admin-invoicing-list.png'), fullPage: true });

  console.log('5. Navigating to super-admin fiscal invoicing new...');
  await page.goto(`${baseUrl}/super-admin/fiscal/invoicing/invoices/new`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(screenshotDir, '04-super-admin-invoice-new.png'), fullPage: true });

  console.log('6. Navigating to super-admin fiscal resolutions...');
  await page.goto(`${baseUrl}/super-admin/fiscal/invoicing/resolutions`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(screenshotDir, '05-super-admin-resolutions.png'), fullPage: true });

  console.log('7. Navigating to super-admin fiscal support document...');
  await page.goto(`${baseUrl}/super-admin/fiscal/invoicing/support-document`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(screenshotDir, '06-super-admin-support-document.png'), fullPage: true });

  console.log('8. Navigating to super-admin fiscal profiles...');
  await page.goto(`${baseUrl}/super-admin/fiscal/invoicing/profiles`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(screenshotDir, '07-super-admin-profiles.png'), fullPage: true });
});
