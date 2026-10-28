import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Windows packaging keeps Node runtime and local-only socket', () => {
  const script = fs.readFileSync('scripts/build-windows-installer.ps1', 'utf8');
  const tray = fs.readFileSync('desktop/agent-tray.ps1', 'utf8');
  const setup = fs.readFileSync('installer/windows/CanonStudioAgent.iss', 'utf8');
  assert.match(script, /runtime\\node\.exe/);
  assert.match(script, /npm\.cmd ci --omit=dev/);
  assert.match(tray, /CANON_STUDIO_ALLOWED_ORIGIN/);
  assert.match(tray, /Local\\CanonStudioAgentTray/);
  assert.match(tray, /Stop-Process -Id \$agentProcess\.Id/);
  assert.match(setup, /PrivilegesRequired=lowest/);
  assert.match(setup, /CanonStudioAgent-Setup/);
  assert.doesNotMatch(setup, /taskkill\.exe/i);
  assert.match(fs.readFileSync('src/config.js','utf8'), /HOST = '127\.0\.0\.1'/);
});

test('installer build outputs and user configuration are not committed', () => {
  const ignore = fs.readFileSync('.gitignore', 'utf8');
  assert.match(ignore, /^dist\/$/m);
  assert.match(ignore, /^\/Start-Canon-Studio\.cmd$/m);
  assert.match(ignore, /^\/Start-Canon-Studio\.ps1$/m);
});
