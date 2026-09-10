-- Enabling pgvector. Remember Without this VECTOR(384) would not work.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_projects (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  PRIMARY KEY (user_id, project_id)
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT,
  organization_id TEXT NOT NULL,
  access_type TEXT NOT NULL CHECK (access_type IN ('organization', 'project', 'private', 'restricted')),
  project_id TEXT,
  owner_id TEXT,
  allowed_user_ids TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- This is one row per CHUNK, not per document. source_doc_id groups chunks belonging to the same original document, so update/delete can
-- operate at the document level while search operates at chunk level.
-- so it stores chunks
CREATE TABLE IF NOT EXISTS chunks (
  id BIGSERIAL PRIMARY KEY,
  source_doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, -- e.g HR001
  title TEXT,                       -- document title
  department TEXT,                  -- metadata filter field, example 'HR', 'Engineering'
  doc_date DATE,                    -- document date (named doc_date, later found out we can't use "date", it's a reserved word)
  verified BOOLEAN DEFAULT false,   -- metadata filter field
  chunk_index INT NOT NULL,         -- position of this chunk within the doc
  content TEXT NOT NULL,
  embedding VECTOR(384),            -- must match the configured embedding model's output
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chunks_source_doc_id_fkey'
      AND conrelid = 'chunks'::regclass
  ) THEN
    ALTER TABLE chunks
      ADD CONSTRAINT chunks_source_doc_id_fkey
      FOREIGN KEY (source_doc_id) REFERENCES documents(id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;

-- HNSW(Hierarchical Navigable Small World) index for approximate nearest-neighbor cosine search.
-- Supports incremental inserts therefore no full rebuild needed when you add/update/delete documents.
CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw_idx
  ON chunks USING hnsw (embedding vector_cosine_ops);


-- Speeds up metadata-filtered queries (WHERE department = ...), recommened by chatgpt to make searching faster in case on large number of chunks
CREATE INDEX IF NOT EXISTS chunks_department_idx ON chunks (department);
CREATE INDEX IF NOT EXISTS chunks_source_doc_idx ON chunks (source_doc_id);
CREATE INDEX IF NOT EXISTS chunks_verified_idx ON chunks (verified);
CREATE INDEX IF NOT EXISTS chunks_doc_date_idx ON chunks (doc_date);
CREATE INDEX IF NOT EXISTS documents_organization_idx ON documents (organization_id);
CREATE INDEX IF NOT EXISTS documents_project_idx ON documents (project_id);
CREATE INDEX IF NOT EXISTS user_projects_project_idx ON user_projects (project_id);


--to clear the db just go to sql editor in neon db below tables and do this 
--TRUNCATE TABLE chunks RESTART IDENTITY;