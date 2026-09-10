// Loads a corpus JSON file (array of {id, title, text, department, date, verified}) into the running API via POST /documents.
// we need to run node scripts/seed.js data.json

require('dotenv').config();
const fs = require('fs');
const axios = require('axios');

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;

//this is optional case recommended by chatgpt when user doesn't send the title, in this case we just take first 8 words as title, but we always do send titles
function deriveTitle(text) {
  const words = text.split(/\s+/).slice(0, 8).join(' '); //just splitting at spaces

  return words.length < text.length ? `${words}...` : words; //dont forget to add this
}

async function seed(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const docs = JSON.parse(raw);

  console.log(`Loading ${docs.length} documents...`);
  let ok = 0;
  let failed = 0;

  for (const doc of docs) {
    try {
      await axios.post(`${BASE_URL}/documents`, {
        id: doc.id,
        title: doc.title || deriveTitle(doc.text),
        text: doc.text,
        department: doc.department,
        date: doc.date,
        verified: doc.verified,
      });
      ok++;
    } catch (err) {
      failed++;
      console.error(`Failed on ${doc.id}:`, err.response?.data?.error || err.message);
    }
  }

  console.log(`Done. Loaded: ${ok}, Failed: ${failed}`);
}

const filePath = process.argv[2];
if (!filePath) {
  process.exit(1);
}
//we are running this from terminal instead of directly doing it here, but we can directly do it here too by just importing the data.json array of objects here

seed(filePath).catch((err) => {
  console.error('failed', err.message);
  process.exit(1);
});
