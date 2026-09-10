-- Enabling pgvector. Remember Without this VECTOR(384) would not work.
CREATE EXTENSION IF NOT EXISTS vector;

-- This is one row per CHUNK, not per document. source_doc_id groups chunks belonging to the same original document, so update/delete can
-- operate at the document level while search operates at chunk level.
-- so it stores chunks
CREATE TABLE IF NOT EXISTS chunks (
  id BIGSERIAL PRIMARY KEY,
  source_doc_id TEXT NOT NULL,      -- e.g HR001
  title TEXT,                       -- document title
  department TEXT,                  -- metadata filter field, example 'HR', 'Engineering'
  doc_date DATE,                    -- document date (named doc_date, later found out we can't use "date", it's a reserved word)
  verified BOOLEAN DEFAULT false,   -- metadata filter field
  chunk_index INT NOT NULL,         -- position of this chunk within the doc
  content TEXT NOT NULL,
  embedding VECTOR(384),            -- must match HF_EMBED_MODEL's output 
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- HNSW(Hierarchical Navigable Small World) index for approximate nearest-neighbor cosine search.
-- Supports incremental inserts therefore no full rebuild needed when you add/update/delete documents.
CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw_idx
  ON chunks USING hnsw (embedding vector_cosine_ops);


-- Speeds up metadata-filtered queries (WHERE department = ...), recommened by chatgpt to make searching faster in case on large number of chunks
CREATE INDEX IF NOT EXISTS chunks_department_idx ON chunks (department);
CREATE INDEX IF NOT EXISTS chunks_source_doc_idx ON chunks (source_doc_id);
CREATE INDEX IF NOT EXISTS chunks_verified_idx ON chunks (verified);
CREATE INDEX IF NOT EXISTS chunks_doc_date_idx ON chunks (doc_date);


--to clear the db just go to sql editor in neon db below tables and do this 
--TRUNCATE TABLE chunks RESTART IDENTITY;