import assert from 'node:assert/strict';
import test from 'node:test';

import { extractTradingCardFields } from '../src/ocr-service/cardFieldParser.js';
import { LightOcrService, OcrServiceError } from '../src/ocr-service/lightOcrService.js';

test('card OCR parser extracts slab grade, cert, year, card number, and serial evidence', () => {
  const result = extractTradingCardFields([
    { text: '2023 TOPPS CHROME', confidence: 0.99, box: [] },
    { text: 'CARD NO #120', confidence: 0.96, box: [] },
    { text: 'PSA 10', confidence: 0.98, box: [] },
    { text: 'CERT 12345678', confidence: 0.97, box: [] },
    { text: '07/25 RC AUTO', confidence: 0.91, box: [] },
  ]);
  assert.equal(result.fields.year, 2023);
  assert.equal(result.fields.cardNumber, '120');
  assert.equal(result.fields.grader, 'PSA');
  assert.equal(result.fields.grade, '10');
  assert.equal(result.fields.certNumber, '12345678');
  assert.equal(result.fields.serialNumber, '07/25');
  assert.equal(result.fields.rookie, true);
  assert.equal(result.fields.autograph, true);
});

test('local OCR service normalizes the native result and closes the engine', async () => {
  let closed = false;
  const service = new LightOcrService({
    moduleLoader: async () => ({
      createEngine: async () => ({
        info: { execution: { sessions: { recognition: { actualProviderChain: ['webgpu', 'cpu'] } } } },
        recognizeEncoded: async () => ({
          schemaVersion: 1,
          pages: [{ index: 0, width: 600, height: 900, lines: [{ id: 'L0', text: 'PSA 9', confidence: 0.99, box: [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}] }] }],
        }),
        close: async () => { closed = true; },
      }),
    }),
  });
  const result = await service.recognizeBuffer(Buffer.from('image'));
  assert.equal(result.fields.grader, 'PSA');
  assert.equal(result.fields.grade, '9');
  assert.deepEqual(result.executionProvider, ['webgpu', 'cpu']);
  await service.close();
  assert.equal(closed, true);
});

test('local OCR fails closed on unsupported data URL media types', async () => {
  const service = new LightOcrService({ moduleLoader: async () => ({}) });
  await assert.rejects(
    () => service.recognizeDataUrl('data:image/webp;base64,AAAA'),
    (error) => error instanceof OcrServiceError && error.code === 'OCR_UNSUPPORTED_MEDIA_TYPE',
  );
});
