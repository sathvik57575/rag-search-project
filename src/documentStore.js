const { Pool } = require('pg');

const EMBEDDING_DIMENSIONS = 768;
let pool;
let schemaPromise;

function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must point to your Neon database.');
  }
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const database = getPool();
      await database.query('CREATE EXTENSION IF NOT EXISTS vector');
      await database.query(`
        CREATE TABLE IF NOT EXISTS rag_documents (
          id BIGSERIAL PRIMARY KEY,
          source_key TEXT NOT NULL UNIQUE,
          source_type TEXT NOT NULL CHECK (source_type IN ('upload', 'knowledge')),
          filename TEXT NOT NULL,
          content_type TEXT NOT NULL,
          checksum TEXT NOT NULL,
          original_bytes BYTEA NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await database.query(`
        CREATE TABLE IF NOT EXISTS rag_document_chunks (
          id BIGSERIAL PRIMARY KEY,
          document_id BIGINT NOT NULL REFERENCES rag_documents(id) ON DELETE CASCADE,
          chunk_index INTEGER NOT NULL,
          section TEXT NOT NULL DEFAULT '',
          content TEXT NOT NULL,
          embedding VECTOR(${EMBEDDING_DIMENSIONS}) NOT NULL,
          UNIQUE (document_id, chunk_index)
        )
      `);
      await database.query(`
        CREATE INDEX IF NOT EXISTS rag_document_chunks_embedding_hnsw
        ON rag_document_chunks USING hnsw (embedding vector_cosine_ops)
      `);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

function formatVector(values) {
  const vector = Array.from(values || [], Number);
  if (vector.length !== EMBEDDING_DIMENSIONS || vector.some((value) => !Number.isFinite(value))) {
    throw new Error(`Embedding must contain ${EMBEDDING_DIMENSIONS} finite numbers.`);
  }
  return `[${vector.join(',')}]`;
}

async function findDocument(sourceKey) {
  const result = await getPool().query(
    'SELECT id, checksum FROM rag_documents WHERE source_key = $1',
    [sourceKey],
  );
  return result.rows[0] || null;
}

async function saveDocument(document) {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [document.sourceKey]);

    const existingResult = await client.query(
      'SELECT id, checksum FROM rag_documents WHERE source_key = $1 FOR UPDATE',
      [document.sourceKey],
    );
    const existing = existingResult.rows[0];
    if (existing && existing.checksum === document.checksum) {
      await client.query('COMMIT');
      return { id: existing.id, unchanged: true };
    }

    let documentId;
    if (existing) {
      const updated = await client.query(`
        UPDATE rag_documents
        SET source_type = $2, filename = $3, content_type = $4,
            checksum = $5, original_bytes = $6, updated_at = NOW()
        WHERE id = $1
        RETURNING id
      `, [
        existing.id,
        document.sourceType,
        document.filename,
        document.contentType,
        document.checksum,
        document.originalBytes,
      ]);
      documentId = updated.rows[0].id;
      await client.query('DELETE FROM rag_document_chunks WHERE document_id = $1', [documentId]);
    } else {
      const inserted = await client.query(`
        INSERT INTO rag_documents
          (source_key, source_type, filename, content_type, checksum, original_bytes)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `, [
        document.sourceKey,
        document.sourceType,
        document.filename,
        document.contentType,
        document.checksum,
        document.originalBytes,
      ]);
      documentId = inserted.rows[0].id;
    }

    const chunks = document.chunks || [];
    for (let offset = 0; offset < chunks.length; offset += 100) {
      const batch = chunks.slice(offset, offset + 100);
      const values = [];
      const rows = batch.map((chunk, batchIndex) => {
        const start = values.length + 1;
        values.push(
          documentId,
          offset + batchIndex,
          chunk.section || '',
          chunk.content,
          formatVector(chunk.embedding),
        );
        return `($${start}, $${start + 1}, $${start + 2}, $${start + 3}, $${start + 4}::vector)`;
      });
      await client.query(`
        INSERT INTO rag_document_chunks (document_id, chunk_index, section, content, embedding)
        VALUES ${rows.join(', ')}
      `, values);
    }

    await client.query('COMMIT');
    return { id: documentId, unchanged: false, chunkCount: chunks.length };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function searchNearest(embedding, limit = 5) {
  const vector = formatVector(embedding);
  const boundedLimit = Math.min(10, Math.max(1, Number(limit) || 5));
  const result = await getPool().query(`
    SELECT d.filename, d.source_type, c.section, c.content,
           1 - (c.embedding <=> $1::vector) AS similarity
    FROM rag_document_chunks AS c
    JOIN rag_documents AS d ON d.id = c.document_id
    ORDER BY c.embedding <=> $1::vector
    LIMIT $2
  `, [vector, boundedLimit]);
  return result.rows;
}

async function closePool() {
  if (!pool) return;
  const activePool = pool;
  pool = null;
  schemaPromise = null;
  await activePool.end();
}

module.exports = {
  EMBEDDING_DIMENSIONS,
  ensureSchema,
  findDocument,
  formatVector,
  saveDocument,
  searchNearest,
  closePool,
};