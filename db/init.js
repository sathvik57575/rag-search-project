require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL }); //we are establishing connection to postgres
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'); //reading sql file
  await pool.query(sql); //executing entire schema
  console.log('Schrma applied successfully.');
  await pool.end();
}

main().catch((err) => {
  console.error('Failed to initialize DB:', err);
  process.exit(1);
});

// node db/init.js