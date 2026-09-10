require('dotenv').config();
const { Pool } = require('pg');

const users = [
  { id: 'USER_001', organizationId: 'ORG_001', projectIds: ['PROJ_A'] },
  { id: 'USER_002', organizationId: 'ORG_001', projectIds: ['PROJ_B'] },
  { id: 'USER_003', organizationId: 'ORG_002', projectIds: ['PROJ_C'] },
];

const permissionDocuments = [
  { id: 'HR001', title: 'Organization Leave Policy', organizationId: 'ORG_001', accessType: 'organization' },
  { id: 'HR002', title: 'Project A Requirements', organizationId: 'ORG_001', accessType: 'project', projectId: 'PROJ_A' },
  { id: 'HR014', title: 'User 001 Private Notes', organizationId: 'ORG_001', accessType: 'private', ownerId: 'USER_001' },
  { id: 'HR015', title: 'Restricted HR Review', organizationId: 'ORG_001', accessType: 'restricted', allowedUserIds: ['USER_002'] },
  { id: 'EN014', title: 'Organization Engineering Standard', organizationId: 'ORG_002', accessType: 'organization' },
  { id: 'EN015', title: 'Project C Dependency Plan', organizationId: 'ORG_002', accessType: 'project', projectId: 'PROJ_C' },
  { id: 'EN016', title: 'User 003 Private Notes', organizationId: 'ORG_002', accessType: 'private', ownerId: 'USER_003' },
  { id: 'EN017', title: 'Restricted Engineering Review', organizationId: 'ORG_002', accessType: 'restricted', allowedUserIds: ['USER_003'] },
];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query('SELECT DISTINCT source_doc_id FROM chunks');
    if (rows.length === 0) throw new Error('No chunks found. Run npm run seed first.');

    await pool.query('BEGIN');
    for (const user of users) {
      await pool.query(
        `INSERT INTO users (id, organization_id) VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET organization_id = EXCLUDED.organization_id`,
        [user.id, user.organizationId]
      );
      await pool.query('DELETE FROM user_projects WHERE user_id = $1', [user.id]);
      for (const projectId of user.projectIds) {
        await pool.query(
          'INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)',
          [user.id, projectId]
        );
      }
    }

    for (const row of rows) {
      await pool.query(
        `INSERT INTO documents (id, title, organization_id, access_type, allowed_user_ids)
         SELECT $1, max(title), 'ORG_001', 'restricted', '{}' FROM chunks WHERE source_doc_id = $1
         ON CONFLICT (id) DO UPDATE SET
           organization_id = 'ORG_001',
           access_type = 'restricted',
           project_id = NULL,
           owner_id = NULL,
           allowed_user_ids = '{}'`,
        [row.source_doc_id]
      );
    }

    for (const document of permissionDocuments) {
      await pool.query(
        `INSERT INTO documents (id, title, organization_id, access_type, project_id, owner_id, allowed_user_ids)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title,
           organization_id = EXCLUDED.organization_id,
           access_type = EXCLUDED.access_type,
           project_id = EXCLUDED.project_id,
           owner_id = EXCLUDED.owner_id,
           allowed_user_ids = EXCLUDED.allowed_user_ids,
           updated_at = now()`,
        [document.id, document.title, document.organizationId, document.accessType, document.projectId || null, document.ownerId || null, document.allowedUserIds || []]
      );
    }
    await pool.query('COMMIT');
    console.log(`Seeded ${users.length} users and ${permissionDocuments.length} permission documents.`);
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Permission seed failed:', error.message);
  process.exit(1);
});