const express = require('express');
const { retrieveChunks } = require('../services/retrieval');
const { generateGroundedAnswer } = require('../services/gemini');

const router = express.Router();

// POST /ask { question, k?, department?, verified? }
router.post('/', async (req, res) => {
  const { question, k = 5, department, verified } = req.body;
  if (!question) return res.status(400).json({ error: 'question is required' });


  //this advice is given by chatgpt because someone can give too large or too small or non-number K values, but this never happens
  const limit = Math.min(Math.max(Number(k) || 5, 1), 10);

  try {
    const chunks = await retrieveChunks({
      query: question,
      k: limit,
      department,
      verified,
      user: req.user,
    });
    const generated = await generateGroundedAnswer(question, chunks);

    res.json({
      question,
      answer: generated.answer,
      sources: chunks.map(({ id, source_doc_id, title, department: sourceDepartment, doc_date, verified: sourceVerified, content, distance }) => ({
        chunkId: id,
        documentId: source_doc_id,
        title,
        department: sourceDepartment,
        date: doc_date,
        verified: sourceVerified,
        content,
        distance,
      })),
      model: generated.model,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

/*
const limit = Math.min(Math.max(Number(k) || 5, 1), 10);

This clamps k into a safe range, step by step:

Number(k) || 5 — convert k to a number; if that fails (e.g. k was "abc", which becomes NaN, and NaN is falsy) fall back to 5.
Math.max(..., 1) — never let it go below 1 (no negative or zero chunk counts).
Math.min(..., 10) — never let it go above 10 (stop someone from requesting k: 999999 and pulling the whole database into an LLM prompt).
*/