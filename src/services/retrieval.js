const pool = require('../config/db');
const { embedOne } = require('./embeddings');

function buildFilterClause(department, verified, startParamIndex) {

  const clauses = [];
  const params = [];
  let index = startParamIndex;

  if (department !== undefined) {
    clauses.push(`department = $${index++}`); 
    params.push(department);
  }
  if (verified !== undefined) {
    clauses.push(`verified = $${index++}`);
    params.push(verified);
  }

  return {
    sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

function buildPermissionClause(user, startParamIndex) {
  return {
    sql: `(
      (d.organization_id = $${startParamIndex} AND d.access_type = 'organization')
      OR (d.organization_id = $${startParamIndex} AND d.access_type = 'project' AND d.project_id = ANY($${startParamIndex + 2}::text[]))
      OR (d.organization_id = $${startParamIndex} AND d.access_type = 'private' AND d.owner_id = $${startParamIndex + 1})
      OR (d.organization_id = $${startParamIndex} AND d.access_type = 'restricted' AND $${startParamIndex + 1} = ANY(d.allowed_user_ids))
    )`,
    params: [user.organizationId, user.userId, user.projectIds],
  };
}

async function retrieveChunks({ query, k = 5, department, verified, user }) {
  if (!user) throw new Error('Authenticated user is required for retrieval');

  const queryVector = await embedOne(query); 
  //gives a vector representation of the search query, eg: "tell me about leaves" gets converted into queryVector = [0.10, 0.50, -0.20]

  const baseParams = [JSON.stringify(queryVector), k];
  //baseParams = ["[0.10,0.50,-0.20]", 3], assuming k = 3

  const permission = buildPermissionClause(user, baseParams.length + 1);
  const filter = buildFilterClause(department, verified, baseParams.length + 1 + permission.params.length);
//buildFilterClause(department, verified, 3), since baseParams array has 2 elements, so baseParams.length + 1 = 3

  const sql = `
        SELECT c.id, c.source_doc_id, c.title, c.department, c.doc_date, c.verified, c.content,
           embedding <=> $1 AS distance
        FROM chunks c
        JOIN documents d ON d.id = c.source_doc_id
        WHERE ${permission.sql}
        ${filter.sql ? `AND ${filter.sql.slice(7)}` : ''}
    ORDER BY distance ASC LIMIT $2
  `;

  //limit $2 means we cap how many results come back, here it is = k

  const { rows } = await pool.query(sql, [...baseParams, ...permission.params, ...filter.params]);
  return rows;
}

module.exports = { retrieveChunks };


/*

/*assume department is "HR", verified is undefined(means not provided), and startParamIndex = 3

index = 3
department !== undefined → true ("HR" is not undefined)
   clauses = ["department = $3"]
   params  = ["HR"]
   index becomes 4
verified !== undefined → false (it IS undefined) → skipped

Returns:
{ sql: " WHERE department = $3", params: ["HR"] }


if department is "IT" and verified = true 
then 
index = 3
department !== undefined → true ("IT" is not undefined)
   clauses = ["department = $3"]
   params  = ["IT"]
   index becomes 4
verified !== undefined → true (true IS undefined) 
    clauses = ["department=$3", "verified = $4"]
    params = ["IT", true]

Returns:
{ 
    sql: " WHERE department = $3 AND verified = true", 
    params: ["IT", true] 
}


Back in retrieveChunks(), this is stored as filter variable.
Next we will build the final SQL query

const sql = `
    SELECT id, source_doc_id, title, department, doc_date, verified, content,
           embedding <=> $1 AS distance
    FROM chunks
    ${filter.sql}
    ORDER BY distance ASC LIMIT $2
`;

Plugging in filter.sql, the real SQL text sent to Postgres is:

SELECT id, source_doc_id, title, department, doc_date, verified, content,
       embedding <=> $1 AS distance
FROM chunks
 WHERE department = $3 AND verified = $4
ORDER BY distance ASC LIMIT $2

Next 
const { rows } = await pool.query(sql, [...baseParams, ...filter.params]);

The params array passed alongside the SQL:

[...baseParams, ...filter.params]
= ["[0.10,0.50,-0.20]", 3, "IT", true]

Postgres matches these positionally to the placeholders:

$1 = "[0.10,0.50,-0.20]" (the query vector)
$2 = 3 (the LIMIT)
$3 = "IT" (the department filter)
$4 = true (the verified filter)

This is why the index tracking matters — $1/$2 are already claimed by the vector and k, so filters must start at $3.

what Postgres actually does
Say the chunks table has these rows (showing only what matters):

id	department	content	                distance to query vector
1	IT	        "Employees get 12 sick leave days per year"	0.05
2	IT	        "Sick leave must be applied via the HR portal"	0.12
3	Engineering	"Backend deploy process"	0.02
4	IT	        "Annual leave policy is 20 days"	0.30

Postgres computes embedding <=> $1 (cosine distance) for every row — smaller number = closer meaning to the query. Row 3 happens to have the smallest distance, but:

WHERE department = $3 AND verified = $4  
 -- i.e. department = 'IT' and verified = true

excludes row 3 entirely, before sorting/limiting even applies. Remaining rows: 1, 2, 4.

ORDER BY distance ASC LIMIT $2   -- LIMIT k=3
Sorts remaining rows by distance ascending, takes top 3 (which is all of them here):

row 1 (0.05), row 2 (0.12), row 4 (0.30)

These become rows in retrieveChunks(), which gets returned.

And then back in search.js
const results = await retrieveChunks({...});   // = [row1, row2, row4]
res.json({ results });

Final JSON sent back to whoever called /search:

json
{
  "results": [
    { "id": 1, "content": "Employees get 12 sick leave days per year", "department": "IT", "verified"=true, "distance": 0.05, ... },
    { "id": 2, "content": "Sick leave must be applied via the HR portal", "department": "it", "verified"=true, "distance": 0.12, ... },
    { "id": 4, "content": "Annual leave policy is 20 days", "department": "IT", "verified"=true, "distance": 0.30, ... }
  ]
}
*/
