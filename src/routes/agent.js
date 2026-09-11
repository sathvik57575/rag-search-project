const express = require('express');
const { runAgent } = require('../agent');

const router = express.Router();

router.post('/', async (req, res) => {
  const { message, model } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }

  try {
    return res.json({ message, ...(await runAgent(message, { model })) });
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
});

module.exports = router;
