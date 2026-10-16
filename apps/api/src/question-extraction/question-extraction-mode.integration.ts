// B2 regression: extraction mode wiring is explicit, not implicit.
//
// Two source-extraction surfaces share one extractor:
//   - the Question Bank endpoints run in BANK mode (candidates → REVIEW tray,
//     NO paper created);
//   - the question-papers endpoints run in PAPER mode (a paper is created).
// Historically the paper controllers never passed the mode flag, so "Extract
// from Source" silently ran bank mode and never created the paper the UI then
// navigated to. This locks the flag at the controller boundary.
//
// Pure unit test — stubs the extraction service, touches no database.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { QuestionExtractionController } from './question-extraction.controller.ts';
import { QuestionPapersController } from '../question-papers/question-papers.controller.ts';

interface Call {
  method: string;
  args: unknown[];
}

function stubExtraction() {
  const calls: Call[] = [];
  const record = (method: string) => (...args: unknown[]) => {
    calls.push({ method, args });
    return Promise.resolve({ jobId: 'job', status: 'QUEUED', reused: false, paperId: null });
  };
  return {
    calls,
    requestTextExtraction: record('requestTextExtraction'),
    requestFileExtraction: record('requestFileExtraction'),
  };
}

const chunks = { parse: () => undefined, acceptOrAssemble: () => undefined } as never;
const tenant = { instituteId: 'inst', membershipId: 'mem' } as never;
const user = { userId: 'u' } as never;
const file = {
  originalname: 'paper.pdf',
  mimetype: 'application/pdf',
  buffer: Buffer.from('source'),
} as never;

describe('extraction mode wiring (B2)', () => {
  it('retired the material-driven /questions/extract-from-material handler', () => {
    assert.equal(
      (QuestionExtractionController.prototype as unknown as Record<string, unknown>)['extract'],
      undefined,
    );
  });

  it('bank text extraction runs in bank mode (no paper)', async () => {
    const extraction = stubExtraction();
    const controller = new QuestionExtractionController({} as never, extraction as never, chunks);
    await controller.extractSourceText(tenant, user, { text: 'Q1 ...' } as never);
    assert.equal(extraction.calls[0]?.method, 'requestTextExtraction');
    assert.notEqual(extraction.calls[0]?.args[3], true);
  });

  it('bank file extraction runs in bank mode (no paper)', async () => {
    const extraction = stubExtraction();
    const controller = new QuestionExtractionController({} as never, extraction as never, chunks);
    await controller.extractSourceFile(tenant, user, file, undefined, undefined, undefined);
    assert.equal(extraction.calls[0].method, 'requestFileExtraction');
    assert.notEqual(extraction.calls[0].args[3], true);
  });

  it('question-papers text extraction runs in paper mode (creates a paper)', async () => {
    const extraction = stubExtraction();
    const controller = new QuestionPapersController({} as never, extraction as never, chunks);
    await controller.extractText(tenant, user, { text: 'Q1 ...' } as never);
    assert.equal(extraction.calls[0].method, 'requestTextExtraction');
    assert.equal(extraction.calls[0].args[3], true);
  });

  it('question-papers file extraction runs in paper mode (creates a paper)', async () => {
    const extraction = stubExtraction();
    const controller = new QuestionPapersController({} as never, extraction as never, chunks);
    await controller.extractFile(tenant, user, file, undefined, undefined, undefined);
    assert.equal(extraction.calls[0].method, 'requestFileExtraction');
    assert.equal(extraction.calls[0].args[3], true);
  });
});
