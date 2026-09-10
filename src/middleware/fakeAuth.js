const pool = require('../config/db');

async function fakeAuth(req, res, next) {
  const userId = req.get('x-user-id');
  if (!userId) return res.status(401).json({ error: 'x-user-id header is required' });

  try {
    const userResult = await pool.query(
      'SELECT id, organization_id FROM users WHERE id = $1',
      [userId]
    );
    if (userResult.rowCount === 0) {
      return res.status(401).json({ error: 'unknown user' });
    }

    const projectResult = await pool.query(
      'SELECT project_id FROM user_projects WHERE user_id = $1 ORDER BY project_id',
      [userId]
    );

    req.user = {
      userId: userResult.rows[0].id,
      organizationId: userResult.rows[0].organization_id,
      projectIds: projectResult.rows.map(({ project_id }) => project_id),
    };
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = fakeAuth;