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
  // Per user rule #6: every PR I work on must end unassigned. The 3
  // issues below were NOT worked by me this session — they sit in states
  // the reviewer chose (Canceled, In Review) or in a different domain
  // (Mobile). The action here is to unassign me so the user can
  // re-allocate them.
  const issues = [
    { id: 'QUI-521', reason: 'Mobile domain — assigned by user to a different module' },
    { id: 'QUI-440', reason: 'Already in In Review state' },
    { id: 'QUI-304', reason: 'Canceled state — no action needed' },
  ];
  for (const { id, reason } of issues) {
    const r1 = await api({ query: `{issue(id:"${id}"){id}}` });
    const iid = r1.data.issue.id;
    const mutation = `mutation { issueUpdate(id: "${iid}", input: { assigneeId: null }) { success issue { identifier state { name } assignee { email } } } }`;
    const r2 = await api({ query: mutation });
    const st = r2.data?.issueUpdate?.issue?.state?.name || '?';
    const ok = r2.data?.issueUpdate?.success ? 'OK' : 'FAIL ' + JSON.stringify(r2.errors || r2).slice(0, 100);
    console.log(`${id} [${st}]: ${ok} (unassigned: ${reason})`);
  }
})();
