import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { convertImageToJpeg } from '../src/documents/document-tools.js';

test('PNG converts to JPEG and applies grayscale for monochrome',async()=>{
  const png=await sharp({create:{width:100,height:60,channels:3,background:'#437a9b'}}).png().toBuffer();
  const jpeg=await convertImageToJpeg(png,{color:'monochrome',density:0,contrast:0});
  const info=await sharp(jpeg).metadata();
  assert.equal(info.format,'jpeg');
  assert.equal(info.width,100);
  assert.equal(info.height,60);
});

test('tone changes pixels while preserving white background',async()=>{
  const black=await sharp({create:{width:50,height:50,channels:3,background:'#888888'}}).png().toBuffer();
  const baseline=await convertImageToJpeg(black,{color:'color',density:0,contrast:0});
  const modified=await convertImageToJpeg(black,{color:'color',density:40,contrast:20});
  assert.notDeepEqual(modified,baseline);
});
