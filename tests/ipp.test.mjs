import test from 'node:test';
import assert from 'node:assert/strict';
import { ippAttr, ippInt, ippBody } from '../src/printers/ipp.js';
import { parseIPPResponse } from '../src/protocol/ipp-parser.js';

// Synthetic local IPP buffer: never use actual printer response containing metadata.
test('IPP integer attribute contains expected big-endian number', () => {
  const value=ippInt(0x21,'copies',3);
  assert.equal(value[0],0x21);
  assert.equal(value.readUInt32BE(value.length-4),3);
});

test('IPP request header and document payload are intact', () => {
  const data=Buffer.from([0xff,0xd8,0xff,0xd9]);
  const request=ippBody(2,[ippAttr(0x49,'document-format','image/jpeg')],data);
  assert.equal(request[3],2);
  assert.equal(request.subarray(-4).compare(data),0);
  assert.equal(request.includes(Buffer.from('image/jpeg')),true);
});

test('parse successful minimal IPP answer', () => {
  const parsed=parseIPPResponse(Buffer.from([1,1,0,0,0,0,0,1,3]));
  assert.equal(parsed.status,0);
});
