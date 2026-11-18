'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prose, lineCol, main } = require('../bin/dropslop.js');

const DOC = '---\ntitle: x\n---\n\nIntro line here.\n\n```js\nconst furthermore = 1;\n```\n\nFurthermore, `code` is robust.\n';

test('prose blanks front matter and code but keeps positions', () => {
  const p = prose(DOC);
  assert.strictEqual(p.length, DOC.length);
  assert.ok(!p.includes('title') && !p.includes('const') && !p.includes('code'));
  assert.deepStrictEqual(lineCol(p, p.indexOf('Furthermore')), [11, 1]);
});

function server(answer, status) {
  const seen = [];
  const s = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => { b += d; });
    req.on('end', () => {
      seen.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(b) });
      res.writeHead(status || 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(typeof answer === 'function' ? answer(seen[seen.length - 1].body) : answer));
    });
  });
  return new Promise((ok) => s.listen(0, '127.0.0.1', () => ok({ s, seen, url: `http://127.0.0.1:${s.address().port}` })));
}

async function run(args) {
  const out = [], err = [];
  const code = await main(args, { out: (x) => out.push(x), err: (x) => err.push(x), color: false });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('prints line numbers, and the threshold sets the exit code', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dropslop-cli-'));
  const file = path.join(dir, 'post.md');
  fs.writeFileSync(file, DOC);
  const srv = await server((body) => {
    const i = body.text.indexOf('Furthermore');
    return { humanScore: 42.5, aiProbability: 0.575, words: 6, flaggedSpans: [{ start: i, end: i + 12, text: 'Furthermore,', reason: 'Robotic transition opener', suggestedCut: '' }], uniformCadenceBrackets: [] };
  });
  try {
    let r = await run(['check', file, '--api-url', srv.url, '--cuts']);
    assert.strictEqual(r.code, 0);
    assert.match(r.out, /42\.5% human/);
    assert.match(r.out, /11:1\s+"Furthermore,"\s+Robotic transition opener\s+-> cut it/);
    assert.strictEqual(srv.seen[0].url, '/v1/lint');
    assert.strictEqual(srv.seen[0].body.mode, 'cuts');
    assert.strictEqual(srv.seen[0].auth, undefined);
    r = await run(['check', file, '--api-url', srv.url, '--threshold', '85']);
    assert.strictEqual(r.code, 1);
    r = await run(['check', file, '--api-url', srv.url, '--threshold', '40']);
    assert.strictEqual(r.code, 0);
    r = await run(['check', path.join(dir, 'missing.md'), '--api-url', srv.url]);
    assert.strictEqual(r.code, 2);
  } finally { srv.s.close(); }
});

test('a refusal from the server is exit 2 with its message', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dropslop-cli-'));
  const file = path.join(dir, 'a.txt');
  fs.writeFileSync(file, 'Some plain words to check here.');
  const srv = await server({ detail: { message: "You've used today's free checks." } }, 402);
  try {
    const r = await run([file, '--api-url', srv.url]);
    assert.strictEqual(r.code, 2);
    assert.match(r.err, /used today's free checks\. Or set DROPSLOP_API_KEY/);
  } finally { srv.s.close(); }
});
