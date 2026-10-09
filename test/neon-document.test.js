require('dotenv').config();

const assert = require('assert');
const crypto = require('crypto');
const { Pool } = require('pg');
const documentRag = require('../src/documentRag');
const documentStore = require('../src/documentStore');

async function run() {
  if (!process.env.DATABASE_URL || !process.env.GEMINI_API_KEY) {
    console.log('Neon integration skipped; configure DATABASE_URL and GEMINI_API_KEY to run it.');
    return;
  }

  const marker = `neon-smoke-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const filename = 'temporary-neon-document-test.txt';
  const bytes = Buffer.from(`Temporary retrieval test. Unique marker ${marker} states the release is cobalt.`, 'utf8');
  const sourceKey = `upload:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
  const cleanupPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let stage = 'index upload';

  try {
    await documentRag.indexUploadedDocument({
      filename,
      contentType: 'text/plain; charset=utf-8',
      bytes,
      text: bytes.toString('utf8'),
    });

    stage = 'search uploaded document';
    const uploadedResults = await documentRag.searchDocuments(`What color does ${marker} say the release is?`);
    assert(uploadedResults.results.some((item) => item.source === filename && item.content.includes('cobalt')));

    stage = 'search existing knowledge';
    const knowledgeResults = await documentRag.searchDocuments('What is the SLA for a critical priority one issue?');
    assert(knowledgeResults.results.some((item) => item.source === 'sla_and_compliance.md'));

    console.log('Neon semantic upload and existing knowledge retrieval passed.');
  } catch (error) {
    error.stage = stage;
    throw error;
  } finally {
    await cleanupPool.query('DELETE FROM rag_documents WHERE source_key = $1', [sourceKey]).catch(() => {});
    await Promise.all([cleanupPool.end(), documentStore.closePool()]);
  }
}

run().catch((error) => {
  let detail = String(error.message || error);
  for (const secret of [process.env.DATABASE_URL, process.env.GEMINI_API_KEY]) {
    if (secret) detail = detail.replaceAll(secret, '[redacted]');
  }
  console.error(`Neon document integration failed during ${error.stage || 'test'}: ${detail}`);
  process.exitCode = 1;
});