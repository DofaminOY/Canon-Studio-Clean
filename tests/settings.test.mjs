import test from 'node:test';
import assert from 'node:assert/strict';
import { fileKind, validateSettings, validatePages, pdfPrintSettings, jpegIPPSettings } from '../src/documents/print-utils.js';
import { selectedPdfPages, toneLookup, rasterDpi } from '../src/documents/print-effects.js';

const base = {
  type: 'pdf', name: 'document.pdf', printer: 'Canon TS5350i series',
  color: 'monochrome', quality: 'standard', copies: 1, duplex: 'simplex',
  paper: 'A4', scale: 'fit', pages: 'all', filter: 'all', density: 0, contrast: 0,
};

test('all supported file extensions, reject exe', () => {
  for (const ext of ['pdf']) assert.equal(fileKind(`a.${ext}`), 'pdf');
  for (const ext of ['docx','doc','txt','rtf','odt','xlsx','xls','csv','ods','pptx','ppt','odp']) assert.equal(fileKind(`a.${ext}`), 'office');
  for (const ext of ['jpg','jpeg','png','gif','webp','bmp','tif','tiff']) assert.equal(fileKind(`a.${ext}`), 'image');
  assert.equal(fileKind('malware.exe'), null);
});

test('range 2–13 valid only with sufficient real pages', () => {
  const settings = validateSettings({ ...base, pages: 'range', from: '2', to: '13' });
  assert.deepEqual(validatePages(settings, 20), { from:2, to:13, selected:12 });
  assert.throws(() => validatePages(settings, 5), /5 стр/);
  assert.match(pdfPrintSettings(settings), /2-13/);
});

test('all pages allowed when page count unknown, range/filter rejected', () => {
  assert.deepEqual(validatePages(validateSettings(base), null), { from:null, to:null, selected:null });
  for (const variant of [{ pages:'range', from:1,to:2 },{filter:'odd'}]) {
    assert.throws(() => validatePages(validateSettings({...base,...variant}),null),/только печать всего/);
  }
});

test('odd/even page selection and no empty print range', () => {
  const opts = validateSettings({ ...base, pages:'range', from:'2',to:'7',filter:'odd' });
  assert.deepEqual(selectedPdfPages(opts, 10),[3,5,7]);
  assert.deepEqual(validatePages(opts,10), { from:2,to:7,selected:3 });
  const empty=validateSettings({...base,pages:'range',from:'1',to:'1',filter:'even'});
  assert.throws(()=>validatePages(empty,1),/нет страниц/);
});

test('reject reverse, fractional and out-of-bounds ranges', () => {
  for (const [from,to] of [['3','2'],['0','2'],['1.5','3'],['1','10001']]) {
    assert.throws(() => validateSettings({...base,pages:'range',from,to}));
  }
});

test('photo print options carry IPP quality and paper', () => {
  const opts=validateSettings({...base,type:'image',name:'photo.jpg',quality:'high'});
  assert.equal(jpegIPPSettings(opts).quality,5);
  assert.equal(jpegIPPSettings(opts).media,'iso_a4_210x297mm');
  assert.throws(()=>validateSettings({...opts,pages:'range',from:'1',to:'2'}));
});

test('reject bad printer, copies, toner, file format', () => {
  for (const patch of [
    {printer:'Microsoft Print to PDF'},{copies:99},{density:51},
    {contrast:-51},{name:'something.exe'},{type:'image'},
  ]) assert.throws(()=>validateSettings({...base,...patch}));
});

test('neutral tone maps no pixels, white always stays white', () => {
  assert.equal(toneLookup({density:0,contrast:0}),null);
  for (const density of [-50,-20,0,20,50]) {
    for (const contrast of [-50,0,15,50]) {
      const lut=toneLookup({density,contrast});
      if (density === 0 && contrast === 0) continue;
      assert.equal(lut[255],255);
      assert.equal(lut.length,256);
    }
  }
});

test('document DPI mapping matches controls', () => {
  assert.deepEqual(['draft','standard','high'].map(rasterDpi),[140,220,300]);
});
