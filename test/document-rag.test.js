const assert = require('assert');
const axios = require('axios');
const ejs = require('ejs');
const path = require('path');
const documentRag = require('../src/documentRag');
const documentStore = require('../src/documentStore');
const uploadRoute = require('../src/routes/upload');
const toolImpl = require('../src/toolImpl');
const { toolDefinitions } = require('../src/tools');

async function testChunkingPreservesDocumentText() {
  const source = `${'A project document paragraph. '.repeat(150)}\n\n${'A second policy paragraph. '.repeat(150)}`;
  const chunks = documentRag.chunkText(source, 900, 80);

  assert(chunks.length > 2);
  assert(chunks.every((chunk) => chunk.length <= 900));
  assert(chunks.join(' ').includes('A project document paragraph.'));
  assert(chunks.join(' ').includes('A second policy paragraph.'));
}

async function testGeminiEmbeddingRequest() {
  const originalPost = axios.post;
  const originalApiKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-key';
  let request;
  axios.post = async (url, body) => {
    request = { url, body };
    return {
      data: {
        embeddings: body.requests.map(() => ({ values: Array(768).fill(0.125) })),
      },
    };
  };

  try {
    const embeddings = await documentRag.embedTexts(['test document passage'], 'RETRIEVAL_DOCUMENT');
    assert(request.url.includes('gemini-embedding-001:batchEmbedContents'));
    assert.strictEqual(request.body.requests[0].taskType, 'RETRIEVAL_DOCUMENT');
    assert.strictEqual(request.body.requests[0].outputDimensionality, 768);
    assert.strictEqual(embeddings[0].length, 768);
  } finally {
    axios.post = originalPost;
    if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalApiKey;
  }
}

function testVectorSerialization() {
  const value = documentStore.formatVector(Array(768).fill(0.25));
  assert(value.startsWith('['));
  assert(value.endsWith(']'));
  assert.throws(() => documentStore.formatVector([0.1]), /768 finite numbers/);
}

async function testTextUploadAndAgentToolIsolation() {
  const files = [
    { originalname: 'meeting-notes.txt', buffer: Buffer.from('The delivery review is scheduled for Friday.', 'utf8') },
    { originalname: 'release-notes.txt', buffer: Buffer.from('The next release is planned for June.', 'utf8') },
  ];
  const parsedFiles = await uploadRoute.extractFiles(files);
  assert.strictEqual(parsedFiles.length, 2);
  assert.strictEqual(parsedFiles[0].extracted.filename, 'meeting-notes.txt');
  assert.strictEqual(parsedFiles[0].extracted.contentType, 'text/plain; charset=utf-8');
  assert(parsedFiles[0].extracted.text.includes('delivery review'));
  assert(parsedFiles[1].extracted.text.includes('next release'));
  await assert.rejects(
    () => uploadRoute.extractFiles([
      ...files,
      { originalname: 'notes.docx', buffer: Buffer.from('text') },
    ]),
    /Only PDF and TXT/,
  );
  await assert.rejects(
    () => uploadRoute.extractText({ originalname: 'broken.pdf', buffer: Buffer.from('not-a-pdf') }),
    /not a valid PDF/,
  );
  await assert.rejects(
    () => uploadRoute.extractText({ originalname: 'invalid.txt', buffer: Buffer.from([0xff, 0xfe]) }),
    /UTF-8/,
  );

  assert(toolDefinitions.some((tool) => tool.function.name === 'search_documents'));
  assert(!toolDefinitions.some((tool) => tool.function.name === 'search_knowledge_base'));
  assert.strictEqual(typeof toolImpl.search_documents, 'function');
  assert.strictEqual(typeof toolImpl.search_knowledge_base, 'function');
}

async function testUploadSuccessAlertCounts() {
  const templatePath = path.join(__dirname, '..', 'src', 'views', 'upload.ejs');
  const render = (successCount) => new Promise((resolve, reject) => {
    ejs.renderFile(templatePath, { page: 'upload', message: null, isError: false, successCount }, (error, html) => {
      if (error) reject(error);
      else resolve(html);
    });
  });
  const oneFileHtml = await render(1);
  const threeFileHtml = await render(3);
  const failureHtml = await render(0);

  assert(oneFileHtml.includes("alert('1 file successfully uploaded.')"));
  assert(threeFileHtml.includes("alert('3 files successfully uploaded.')"));
  assert(!failureHtml.includes('alert('));
}

(async () => {
  await testChunkingPreservesDocumentText();
  await testGeminiEmbeddingRequest();
  testVectorSerialization();
  await testTextUploadAndAgentToolIsolation();
  await testUploadSuccessAlertCounts();
  console.log('document RAG checks passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});