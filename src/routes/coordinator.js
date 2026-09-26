const express = require('express');
const { runCoordinator } = require('../multiAgent');

const router = express.Router();

router.post('/', async (req, res) => {
  const { query, model } = req.body;
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'query is required' });
  }

  try {
    return res.json(await runCoordinator(query, { model }));
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
