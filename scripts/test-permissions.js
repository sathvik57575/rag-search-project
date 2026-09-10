require('dotenv').config();
const axios = require('axios');

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;
const cases = [
  {
    userId: 'USER_001',
    allowed: ['HR001', 'HR002', 'HR014'],
    forbidden: ['HR015', 'EN014', 'EN015', 'EN016', 'EN017'],
  },
  {
    userId: 'USER_002',
    allowed: ['HR001', 'HR015'],
    forbidden: ['HR002', 'HR014', 'EN014', 'EN015', 'EN016', 'EN017'],
  },
  {
    userId: 'USER_003',
    allowed: ['EN014', 'EN015', 'EN016', 'EN017'],
    forbidden: ['HR001', 'HR002', 'HR014', 'HR015'],
  },
];

async function checkEndpoint(path, userId) {
  const response = await axios.post(
    `${BASE_URL}${path}`,
    { query: 'policy project organization review', k: 50, candidatePoolSize: 50 },
    { headers: { 'x-user-id': userId } }
  );
  return response.data.results.map((result) => result.source_doc_id);
}

async function main() {
  for (const testCase of cases) {
    for (const path of ['/search', '/search/rerank']) {
      const documentIds = await checkEndpoint(path, testCase.userId);
      const unexpected = documentIds.filter((id) => !testCase.allowed.includes(id));
      const missingForbidden = testCase.forbidden.filter((id) => documentIds.includes(id));
      if (unexpected.length || missingForbidden.length) {
        throw new Error(`${path} leaked documents for ${testCase.userId}: ${[...unexpected, ...missingForbidden].join(', ')}`);
      }
      if (documentIds.length === 0) throw new Error(`${path} returned no authorized documents for ${testCase.userId}`);
      console.log(`${path} ${testCase.userId}: ${documentIds.join(', ')}`);
    }
  }
  console.log('Permission tests passed: no unauthorized document was returned.');
}

main().catch((error) => {
  console.error('Permission tests failed:', error.response?.data || error.message);
  process.exit(1);
});