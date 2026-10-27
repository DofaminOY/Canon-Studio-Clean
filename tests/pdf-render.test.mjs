import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname,join } from 'node:path';
import { prepareRasterPdf, createPopplerTempPdf, locatePdftoppm } from '../src/documents/print-effects.js';
import { countPdfPages } from '../src/documents/document-tools.js';

const fixture=join(dirname(fileURLToPath(import.meta.url)),'fixtures','two-pages.pdf');
const options={ pages:'range',from:'1',to:'2',filter:'all',quality:'draft',color:'monochrome', density:-20,contrast:15 };

test('PDF fixture has exactly two pages',async()=>{
  const pdf=await fs.readFile(fixture);
  assert.equal(await countPdfPages(pdf),2);
});

test('Poppler path available in this test environment',()=>{
  const p=locatePdftoppm();
  const result=execFileSync(p,['-v'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  assert.equal(typeof result,'string');
});

test('Poppler + Sharp build 2-page corrected PDF without Canvas.fill/clip',async()=>{
  const input=await fs.readFile(fixture);
  const output=await prepareRasterPdf(input,options);
  assert.ok(output.subarray(0,5).equals(Buffer.from('%PDF-')));
  assert.equal(await countPdfPages(output),2);
});

test('temporary PDF files cleaned up by helper',async()=>{
  const temp=await createPopplerTempPdf(await fs.readFile(fixture));
  assert.equal((await fs.readFile(temp.input)).length>0,true);
  await temp.cleanup();
  await assert.rejects(fs.stat(temp.input),/ENOENT/);
});
