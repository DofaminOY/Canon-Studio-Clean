import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateSettings, pdfPrintSettings, jpegIPPSettings } from '../src/documents/print-utils.js';
import { ippBody, ippInt } from '../src/printers/ipp.js';
import { publicTask } from '../src/jobs/store.js';

const base = {
  type: 'pdf', name: 'demo.pdf', color: 'monochrome', quality: 'high',
  printer: 'Canon TS5350i series', duplex: 'simplex', paper: 'A4',
  scale: 'fit', pages: 'all', filter: 'all', copies: '1', density: '0', contrast: '0',
};

test('Validates portrait and landscape, rejecting unexpected values', () => {
  assert.equal(validateSettings({ ...base, orientation: 'landscape' }).orientation, 'landscape');
  assert.equal(validateSettings({ ...base, orientation: 'portrait' }).orientation, 'portrait');
  assert.throws(() => validateSettings({ ...base, orientation: 'sideways' }), /ориентац/i);
});

test('Landscape reaches SumatraPDF settings and IPP enum 4', () => {
  const options = validateSettings({ ...base, orientation: 'landscape' });
  assert.match(pdfPrintSettings(options), /landscape/);
  assert.equal(jpegIPPSettings(options).orientation, 4);
  assert.equal(jpegIPPSettings({ ...options, orientation: 'portrait' }).orientation, 3);
});

test('Get-Job-Attributes operation uses 0x09 with the requested IPP job ID', () => {
  const packet = ippBody(0x09, [ippInt(0x21, 'job-id', 123)]);
  assert.equal(packet[3], 0x09);
  assert.ok(packet.includes(Buffer.from('job-id')));
});

test('Only active or addressable submitted tasks expose cancellation', () => {
  const task = {
    id: 'id', status: 'submitted', ippJobIds: [], ippJobId: null, windowsJobId: null,
    fileName: 'demo.pdf', type: 'pdf', printer: 'Canon TS5350i series',
    message: '',
  };
  assert.equal(publicTask(task).canCancel, false);
  assert.equal(publicTask({ ...task, ippJobIds: [123, 124] }).canCancel, true);
  assert.equal(publicTask({ ...task, ippJobIds: [123], status: 'cancel-requested' }).canCancel, false);
  assert.equal(publicTask({ ...task, status: 'sending' }).canCancel, true);
});

test('UI renders explicit orientation selector and IPP cancellation action', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const ui = fs.readFileSync(new URL('../public/assets/js/printers.js', import.meta.url), 'utf8');
  assert.match(html, /id="orientations"/);
  assert.match(ui, /Отменить IPP/);
});
