async function main() {
  const loginRes = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'badrhammani2017@gmail.com', password: 'password123' }),
  });
  const setCookie = loginRes.headers.get('set-cookie');
  const match = setCookie ? setCookie.match(/xau_session=([^;]+)/) : null;
  const token = match ? match[1] : '';

  const res = await fetch('http://localhost:3000/api/analysis?timeframe=5M&limit=600', {
    headers: { Cookie: `xau_session=${token}` },
  });
  const json = await res.json();
  console.log('ALL ZONES:');
  for (const z of json.fvgZones) {
    console.log(`ID: ${z.id} | Status: ${z.status} | High: ${z.high} | Low: ${z.low} | CreatedTime: ${z.createdTime}`);
  }
}

main().catch(console.error);
