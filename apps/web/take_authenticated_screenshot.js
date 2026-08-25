const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

async function getJson(url, retries = 20) {
  for (let i = 0; i < retries; i++) {
    try {
      const data = await new Promise((resolve, reject) => {
        http
          .get(url, (res) => {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => {
              try {
                resolve(JSON.parse(body));
              } catch (e) {
                reject(e);
              }
            });
          })
          .on('error', reject);
      });
      return data;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error('Failed to get JSON from ' + url);
}

async function main() {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const profileDir = 'C:\\Users\\zoro\\.gemini\\antigravity\\chrome_dev_profile_9223';
  if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });

  const chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--remote-debugging-port=9223',
    '--user-data-dir=' + profileDir,
    '--window-size=1920,1080',
    'about:blank',
  ]);

  const targets = await getJson('http://127.0.0.1:9223/json/list');
  const pageTarget = targets.find((t) => t.type === 'page') || targets[0];
  if (!pageTarget) throw new Error('No page target found');

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  let id = 0;

  function send(method, params = {}) {
    return new Promise((resolve) => {
      const currentId = ++id;
      const handler = (event) => {
        const res = JSON.parse(event.data);
        if (res.id === currentId) {
          ws.removeEventListener('message', handler);
          resolve(res.result);
        }
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ id: currentId, method, params }));
    });
  }

  await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));

  await send('Network.enable');

  const loginRes = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'badrhammani2017@gmail.com', password: 'password123' }),
  });
  const setCookie = loginRes.headers.get('set-cookie');
  const match = setCookie ? setCookie.match(/xau_session=([^;]+)/) : null;
  const token = match ? match[1] : '';

  await send('Network.setCookie', {
    name: 'xau_session',
    value: token,
    domain: 'localhost',
    path: '/',
    httpOnly: true,
  });

  // Navigate to Charts view
  await send('Page.navigate', { url: 'http://localhost:3000/charts' });
  await new Promise((r) => setTimeout(r, 4000));

  // Set Pro preset in localStorage and reload
  await send('Runtime.evaluate', {
    expression: `
      localStorage.setItem('xau_chart_layers_config_v2', JSON.stringify({
        preset: 'pro',
        setupOnlyMode: false,
        showStructure: true,
        showFvg: true,
        fvgMaxCount: 15,
        fvgHideMitigated: false,
        fvgMaxDistanceAtr: 10,
        showLiquidity: true,
        showLiquidityBadges: true,
        liquidityIntactOnly: false,
        liquidityMaxCount: 15,
        showSessions: true,
        showTrade: true,
        showVolume: true
      }));
      window.location.reload();
    `,
  });
  await new Promise((r) => setTimeout(r, 8000));

  // Capture full screenshot
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const buffer = Buffer.from(shot.data, 'base64');
  const filename = `live_chart_pro_${Date.now()}.png`;
  const outputPath = path.join('C:\\Users\\zoro\\.gemini\\antigravity\\brain\\c76c2b59-7167-4e9c-af9c-02ffad879080', filename);
  fs.writeFileSync(outputPath, buffer);
  console.log('SUCCESS_SAVED_SCREENSHOT:', outputPath);

  chrome.kill();
  ws.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
