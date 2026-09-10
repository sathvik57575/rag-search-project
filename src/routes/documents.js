const express = require('express');
const pool = require('../config/db');
const { chunkText } = require('../services/chunking');
const { embedTexts } = require('../services/embeddings');

const router = express.Router();

// Deletes existing chunks for a doc and also re-chunks and re-embeds and inserts fresh rows.
// This is used by both POST(new doc) and PUT(update existing doc) methods
async function upsertDocument(id, meta, text) {
  const { title = null, department = null, date = null, verified = false } = meta;
  const chunks = chunkText(text);
  if (chunks.length === 0) throw new Error('Document produced no chunks(this isempty content)');

  const vectors = await embedTexts(chunks);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM chunks WHERE source_doc_id = $1', [id]);

    for (let i = 0; i < chunks.length; i++) {
      await client.query(
        `INSERT INTO chunks (source_doc_id, title, department, doc_date, verified, chunk_index, content, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, title, department, date, verified, i, chunks[i], JSON.stringify(vectors[i])]
      );

      /*
        I am using performance parameters here as it is safe, but we can do without it too like this
        await client.query(`INSERT INTO CHUNKS (source_doc_id, title, department, doc_date, verified, chunk_index, content, embedding)VALUES (${id}, ${title}, ${date}, ${verified}, ${i}, ${chunks[i]}, ${JSON.stringify(vectors[i])})`)
      */

    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { id, chunkCount: chunks.length };
}

// POST /documents { id, title,text,department,date,verified}
router.post('/', async (req, res) => {
  const { id, title, text, department, date, verified } = req.body;
  if (!id || !text) {
    return res.status(400).json({ error: 'id and text are required' });
  }
  try {
    const result = await upsertDocument(id, { title, department, date, verified }, text);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT method /documents/:id  {title,text, department, date,verified }
router.put('/:id', async (req, res) => {
  const { title, text, department, date, verified } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required' });
  try {
    const result = await upsertDocument(req.params.id, { title, department, date, verified }, text);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETe /documents/:id
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM chunks WHERE source_doc_id = $1', [req.params.id,]);
    
    res.json({ id: req.params.id, deletedChunks: result.rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
