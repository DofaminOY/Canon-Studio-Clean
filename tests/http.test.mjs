import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from '../src/http/router.js';

let server, base;
test.before(async () => {
  server=createServer();
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  base=`http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { if (server) await new Promise(resolve=>server.close(resolve)); });

test('GET root serves thin HTML with modular assets', async () => {
  const response=await fetch(base);
  const html=await response.text();
  assert.equal(response.status,200);
  assert.match(html,/\/assets\/js\/app\.js/);
  assert.match(html,/\/assets\/css\/main\.css/);
  assert.doesNotMatch(html,/<script[^>]*>\s*const\s/);
});

test('static frontend JS and CSS respond with correct media types', async () => {
  for (const [url,type] of [['/assets/js/app.js','text/javascript'],['/assets/css/main.css','text/css']]) {
    const result=await fetch(base+url);
    assert.equal(result.status,200);
    assert.match(result.headers.get('content-type'),new RegExp(type));
  }
});

test('no arbitrary file access and no open arbitrary HTTP routes', async () => {
  assert.equal((await fetch(base+'/src/config.js')).status,404);
  assert.equal((await fetch(base+'/assets/js/../../src/config.js')).status,404);
});

test('local API config and tasks are JSON', async () => {
  const c=await (await fetch(base+'/api/config')).json();
  assert.ok(c.token);
  assert.ok(c.limit>0);
  const t=await (await fetch(base+'/api/tasks')).json();
  assert.deepEqual(t.tasks,[]);
});

test('POST rejects requests without session token', async () => {
  const response=await fetch(base+'/api/print',{method:'POST',body:'x'});
  assert.equal(response.status,403);
});
