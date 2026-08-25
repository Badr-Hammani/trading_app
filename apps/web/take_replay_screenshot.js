const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: { width: 1440, height: 900 },
  });

  const page = await browser.newPage();

  // Login first
  await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle0' });
  await page.type('input[type="email"]', 'badrhammani2017@gmail.com');
  await page.type('input[type="password"]', 'Password123!');
  await page.click('button[type="submit"]');
  await page.waitForNavigation({ waitUntil: 'networkidle0' });

  // Navigate to Replay page
  await page.goto('http://localhost:3000/replay', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 2000));

  // Jump to historical date 2024-06-15
  const dateInput = await page.$('input[type="date"]');
  if (dateInput) {
    await dateInput.type('2024-06-15');
    await dateInput.evaluate((el) => el.dispatchEvent(new Event('change', { bubbles: true })));
    await new Promise((r) => setTimeout(r, 3000));
  }

  const screenshotPath = 'C:\\Users\\zoro\\.gemini\\antigravity\\brain\\c76c2b59-7167-4e9c-af9c-02ffad879080\\replay_proof_authenticated.png';
  await page.screenshot({ path: screenshotPath, fullPage: true });

  console.log('SUCCESS_SAVED_SCREENSHOT:', screenshotPath);
  await browser.close();
})();
