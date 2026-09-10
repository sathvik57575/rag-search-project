const express = require('express');
const { rerank } = require('../services/reranker');
const { retrieveChunks } = require('../services/retrieval');

const router = express.Router();

// POST /search  {query, k, department?, verified?}
// Basic vector search: cosine distance via pgvector's <=> operator,
// we can also optionally filter by department and/or verified status.
router.post('/', async (req, res) => {
  const { query, k = 5, department, verified } = req.body;
  if (!query) return res.status(400).json({ error: 'query is required' });

  try {
    const results = await retrieveChunks({ query, k, department, verified, user: req.user });
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /search/rerank  {query, k, candidatePoolSize?, department?, verified? }
// Improved pipeline means: pull a larger candidate set via vector search (with the same metadata filters), then rerank with a cross-encoder before cutting to top-k.
router.post('/rerank', async (req, res) => {
  const { query, k = 5, candidatePoolSize = 20, department, verified } = req.body;
  if (!query) return res.status(400).json({ error: 'query is required' });

  try {
    const candidates = await retrieveChunks({
      query,
      k: candidatePoolSize,
      department,
      verified,
      user: req.user,
    });
    const rerankedAll = await rerank(query, candidates);
    res.json({ results: rerankedAll.slice(0, k) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

/*
explaining how reranking happens

POST /search/rerank.

POST /search/rerank
{ "query": "sick leave policy", "k": 2, "candidatePoolSize": 4, "department": "HR" }

const { query, k = 5, candidatePoolSize = 20, department, verified } = req.body;
query = "sick leave policy"
k = 2  final number of results wanted
candidatePoolSize = 4  size of the rough draft list before refining
department = "HR", verified = undefined

This is the key idea of reranking: first grab more candidates than you need (4), then narrow down to what you actually want (2), using a better but slower scoring method in between.

get the vector-search candidates (same mechanism as before)
const queryVector = await embedOne(query);   // → [0.10, 0.50, -0.20] (assume this is the value)
const baseParams = [JSON.stringify(queryVector), candidatePoolSize];  // = [vector, 4]
const filter = buildFilterClause("HR", undefined, 3);  
//filter  = { sql: " WHERE department = $3", params: ["HR"] }

Final SQL: sql = 
  SELECT id, source_doc_id, title, department, doc_date, verified, content,
    embedding <=> $1 AS distance
  FROM chunks
  ${filter.sql}
  ORDER BY distance ASC LIMIT $2

const { rows: candidates } = await pool.query(sql, [...baseParams, ...filter.params]);
const { rows: candidates } = await pool.query(sql, [[0.10, 0.50, -0.20], 4, "HR"]);

Assume this returns 4 HR chunks, sorted by vector-distance (smaller = closer):
id	        content	                                            distance
1	          "Employees get 12 sick leave days per year"	        0.05
2	          "Sick leave must be applied via the HR portal"	    0.12
3	          "Annual leave policy is 20 days"	                  0.15
4	          "Office hours are 9 to 5"	                          0.20

This is candidates which is the rough draft. Notice row 4 (about office hours) snuck in. Vector search is approximate, so irrelevant stuff sometimes gets through with a near okay distance score.

Next
const rerankedAll = await rerank(query, candidates);


*/