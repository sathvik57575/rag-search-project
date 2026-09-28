const express = require('express');
const { runCoordinator } = require('../multiAgent');

const router = express.Router();

router.post('/', async (req, res) => {
  const { query, model, employeeId, confirmed } = req.body;
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return res.status(400).json({ error: 'query is required' });
  }
  if (!employeeId || typeof employeeId !== 'string' || employeeId.trim().length === 0) {
    return res.status(400).json({ error: 'employeeId is required for coordinator access' });
  }

  try {
    const result = await runCoordinator(query, {
      model,
      employeeId: employeeId.trim(),
      confirmed: confirmed === true,
      persist: true,
    });
    return res.status(result.status === 'denied' ? 403 : 200).json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

module.exports = router;
