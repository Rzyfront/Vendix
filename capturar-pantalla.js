/**
 * capturar-pantalla.js
 *
 * Captura screenshots de una URL emulando un iPhone (viewport móvil)
 * para comparar el diseño actual con un objetivo de paridad visual.
 *
 * Uso:
 *   node capturar-pantalla.js <url> <output.png>
 *
 * Ejemplos:
 *   node capturar-pantalla.js https://vendix.online referencia-real.png
 *   node capturar-pantalla.js http://localhost:3000 resultado-local.png
 */
const { chromium, devices } = require('playwright');

async function capture(url, outputPath) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...devices['iPhone 14 Pro'],
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await context.newPage();

  try {
    console.log(`Navegando a: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  } catch (e) {
    console.log(`Warning: networkidle timeout, continuando: ${e.message}`);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    } catch (e2) {
      console.log(`Warning: domcontentloaded timeout, continuando: ${e2.message}`);
      await page.goto(url, { waitUntil: 'load', timeout: 10000 }).catch(() => {});
    }
  }

  // Esperar un poco para que las animaciones terminen
  await page.waitForTimeout(2000);

  // Captura completa
  await page.screenshot({ path: outputPath, fullPage: true });
  console.log(`Screenshot guardado en: ${outputPath}`);

  // Info adicional
  const title = await page.title().catch(() => 'unknown');
  const url_final = page.url();
  console.log(`Title: ${title}`);
  console.log(`Final URL: ${url_final}`);

  await browser.close();
}

const url = process.argv[2];
const output = process.argv[3];

if (!url || !output) {
  console.error('Uso: node capturar-pantalla.js <url> <output.png>');
  process.exit(1);
}

capture(url, output).catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
