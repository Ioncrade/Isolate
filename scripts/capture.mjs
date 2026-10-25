import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const browser = await chromium.launch({
  executablePath:
    '/home/dev/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--no-zygote',
    '--single-process',
    '--disable-dev-shm-usage',
    '--disable-crash-reporter',
  ],
})

const reviewDir = '../.impeccable/review'
await mkdir(reviewDir, { recursive: true })

const errors = []
const baseUrl = process.env.ISOLATE_CAPTURE_URL ?? 'http://127.0.0.1:4175'

async function preparePage(viewport, path = '/') {
  const page = await browser.newPage({ viewport, reducedMotion: 'reduce' })
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`page: ${error.message}`))
  await page.goto(`${baseUrl}${path}`, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  return page
}

const desktop = await preparePage({ width: 1440, height: 900 })
await desktop.screenshot({ path: `${reviewDir}/desktop.png`, fullPage: true })
await desktop.setViewportSize({ width: 390, height: 844 })
await desktop.goto(`${baseUrl}/`, { waitUntil: 'networkidle' })
await desktop.screenshot({ path: `${reviewDir}/mobile.png`, fullPage: true })
await desktop.setViewportSize({ width: 1440, height: 900 })
await desktop.goto(`${baseUrl}/`, { waitUntil: 'networkidle' })
await desktop.getByRole('link', { name: 'Try now' }).first().click()
await desktop.locator('.studio-shell').waitFor({ state: 'visible' })
await desktop.screenshot({ path: `${reviewDir}/studio-desktop.png`, fullPage: true })

await browser.close()

if (errors.length) {
  throw new Error(errors.join('\n'))
}

