const https = require('https');
const token = process.env.LINEAR_API_KEY;

async function api(query) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(query);
    const req = https.request({
      hostname: 'api.linear.app', path: '/graphql', method: 'POST',
      headers: {
        Authorization: token, 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(JSON.parse(body)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  const stateId = '17d15a4c-92b4-4d6e-92d7-bc7c201fb465';
  const issues = ['QUI-616'];
  for (const tid of issues) {
    const r1 = await api({ query: `{issue(id:"${tid}"){id}}` });
    const iid = r1.data.issue.id;
    const mutation = `mutation { issueUpdate(id: "${iid}", input: { stateId: "${stateId}", assigneeId: null }) { success issue { state { name } } } }`;
    const r2 = await api({ query: mutation });
    const st = r2.data?.issueUpdate?.issue?.state?.name || '?';
    const ok = r2.data?.issueUpdate?.success ? 'OK' : 'FAIL ' + JSON.stringify(r2.errors || r2).slice(0, 100);
    console.log(`${tid}: ${ok} [${st}]`);
  }
})();
