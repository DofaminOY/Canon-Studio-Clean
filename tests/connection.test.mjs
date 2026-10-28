import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { allowedOrigin, safeLoopbackHost } from '../src/http/origins.js';
import { isLocalPage } from '../public/assets/js/connection.js';

test('cloud mode has no automatic localhost requests', () => {
  const js = fs.readFileSync('public/assets/js/app.js', 'utf8');
  assert.match(js, /if \(state\.mode === 'web'\)/);
  assert.match(js, /return;/);
  assert.equal(isLocalPage('canon-studio-clean.vercel.app'), false);
  assert.equal(isLocalPage('127.0.0.1'), true);
  assert.equal(isLocalPage('localhost'), true);
});

test('allowed CORS origin requires one exact HTTPS domain', () => {
  const good = 'https://canon-studio-clean.vercel.app';
  assert.equal(allowedOrigin(good, good), true);
  assert.equal(allowedOrigin('https://evil.vercel.app', good), false);
  assert.equal(allowedOrigin('https://canon-studio-clean.vercel.app.evil.net', good), false);
  assert.equal(allowedOrigin('http://canon-studio-clean.vercel.app', good), false);
  assert.equal(allowedOrigin('https://evil.vercel.app', '*.vercel.app'), false);
});

test('reject remote Host header (DNS rebinding protection)', () => {
  assert.equal(safeLoopbackHost('127.0.0.1:3177'), true);
  assert.equal(safeLoopbackHost('localhost:3177'), true);
  assert.equal(safeLoopbackHost('some-evil-domain.tld:3177'), false);
});

test('Vercel builds only static assets with PDF.js browser module', () => {
  const v = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
  const scripts = JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts;
  assert.equal(v.outputDirectory, 'public');
  assert.equal(scripts['build:web'], 'node scripts/build-web.mjs');
  assert.match(fs.readFileSync('scripts/build-web.mjs', 'utf8'), /pdf\.worker\.mjs/);
});
