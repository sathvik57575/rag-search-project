const axios = require('axios');
const crypto = require('crypto');
const rag = require('./rag');
const store = require('./documentStore');

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-001';
const MAX_CHUNK_CHARACTERS = 2200;
const CHUNK_OVERLAP_CHARACTERS = 200;
const EMBEDDING_BATCH_SIZE = 50;
const KNOWLEDGE_CONTENT_TYPE = 'text/markdown; charset=utf-8';
const MINIMUM_SIMILARITY = 0.45;

let initializationPromise;

function chunkText(text, maxCharacters = MAX_CHUNK_CHARACTERS, overlap = CHUNK_OVERLAP_CHARACTERS) {
  const normalized = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];

  const chunks = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + maxCharacters, normalized.length);
    if (end < normalized.length) {
      const lowerBoundary = start + Math.floor(maxCharacters * 0.65);
      const newline = normalized.lastIndexOf('\n', end);
      const space = normalized.lastIndexOf(' ', end);
      const boundary = Math.max(newline, space);
      if (boundary > lowerBoundary) end = boundary;
    }

    const content = normalized.slice(start, end).trim();
    if (content) chunks.push(content);
    if (end >= normalized.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

function createChunks(filename, text) {
  const document = {
    filename,
    content: text,
    isKnowledgeDir: true,
  };
  return rag.chunkDocument(document).flatMap((section) =>
    chunkText(section.content).map((content) => ({
      section: section.section || filename,
      content,
    }))
  );
}

function checksum(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function getEmbeddingModel() {
  return (process.env.GEMINI_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL).replace(/^models\//, '');
}

async function embedTexts(texts, taskType) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is required for document embeddings.');

  const model = getEmbeddingModel();
  const embeddings = [];
  for (let offset = 0; offset < texts.length; offset += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(offset, offset + EMBEDDING_BATCH_SIZE);
    let response;
    try {
      response = await axios.post(
        `${GEMINI_URL}/${encodeURIComponent(model)}:batchEmbedContents`,
        {
          requests: batch.map((text) => ({
            model: `models/${model}`,
            content: { parts: [{ text }] },
            taskType,
            outputDimensionality: store.EMBEDDING_DIMENSIONS,
          })),
        },
        {
          headers: { 'x-goog-api-key': apiKey },
          timeout: 60000,
        },
      );
    } catch (error) {
      const message = error.response?.data?.error?.message || error.message;
      throw new Error(`Gemini document embedding failed: ${message}`);
    }

    const batchEmbeddings = response.data && response.data.embeddings;
    if (!Array.isArray(batchEmbeddings) || batchEmbeddings.length !== batch.length) {
      throw new Error('Gemini returned an unexpected number of document embeddings.');
    }
    for (const item of batchEmbeddings) {
      if (!item.values || item.values.length !== store.EMBEDDING_DIMENSIONS) {
        throw new Error(`Gemini must return ${store.EMBEDDING_DIMENSIONS}-dimension embeddings.`);
      }
      embeddings.push(item.values);
    }
  }
  return embeddings;
}

async function indexDocument({ sourceKey, sourceType, filename, contentType, originalBytes, text }) {
  const documentChecksum = checksum(originalBytes);
  const existing = await store.findDocument(sourceKey);
  if (existing && existing.checksum === documentChecksum) {
    return { unchanged: true, id: existing.id };
  }

  const chunks = createChunks(filename, text);
  if (!chunks.length) throw new Error('No searchable text was found in this document.');
  const embeddings = await embedTexts(chunks.map((chunk) => chunk.content), 'RETRIEVAL_DOCUMENT');
  return store.saveDocument({
    sourceKey,
    sourceType,
    filename,
    contentType,
    checksum: documentChecksum,
    originalBytes,
    chunks: chunks.map((chunk, index) => ({ ...chunk, embedding: embeddings[index] })),
  });
}

async function initializeDocumentRag() {
  await store.ensureSchema();
  const documents = rag.loadDocuments();
  for (const document of documents) {
    await indexDocument({
      sourceKey: `knowledge:${document.filename}`,
      sourceType: 'knowledge',
      filename: document.filename,
      contentType: KNOWLEDGE_CONTENT_TYPE,
      originalBytes: Buffer.from(document.content, 'utf8'),
      text: document.content,
    });
  }
}

async function ensureInitialized() {
  if (!initializationPromise) {
    initializationPromise = initializeDocumentRag().catch((error) => {
      initializationPromise = null;
      throw error;
    });
  }
  await initializationPromise;
}

async function indexUploadedDocument({ filename, contentType, bytes, text }) {
  await ensureInitialized();
  const documentChecksum = checksum(bytes);
  return indexDocument({
    sourceKey: `upload:${documentChecksum}`,
    sourceType: 'upload',
    filename,
    contentType,
    originalBytes: bytes,
    text,
  });
}

async function searchDocuments(query, limit = 5) {
  if (!query || typeof query !== 'string' || !query.trim()) {
    return { count: 0, results: [] };
  }
  await ensureInitialized();
  const [queryEmbedding] = await embedTexts([query], 'RETRIEVAL_QUERY');
  const candidates = await store.searchNearest(queryEmbedding, limit);
  const threshold = Number(process.env.DOCUMENT_RELEVANCE_THRESHOLD || MINIMUM_SIMILARITY);
  const results = candidates
    .map((candidate) => ({
      source: candidate.filename,
      section: candidate.section,
      content: candidate.content,
      sourceType: candidate.source_type,
      relevanceScore: Number(candidate.similarity),
    }))
    .filter((result) => result.relevanceScore >= threshold);

  return { count: results.length, query, results };
}

module.exports = {
  chunkText,
  createChunks,
  embedTexts,
  indexUploadedDocument,
  searchDocuments,
};