const fs = require('fs');
const path = require('path');

const KNOWLEDGE_DIRS = [
  path.join(__dirname, '..', 'knowledge'),
];

function loadDocuments() {
  const documents = [];

  for (const dir of KNOWLEDGE_DIRS) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (file.startsWith('.')) continue;
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isFile() && (file.endsWith('.md') || file.endsWith('.txt') || file.endsWith('.json'))) {
        const content = fs.readFileSync(fullPath, 'utf8');
        documents.push({
          filename: file,
          filepath: fullPath,
          content,
          isKnowledgeDir: true,
        });
      }
    }
  }
  return documents;
}

function chunkDocument(doc) {
  const chunks = [];
  const rawSections = doc.content.split(/(?=\n#{1,4}\s+|\n\n)/);
  let currentSection = doc.filename;

  for (const block of rawSections) {
    const text = block.trim();
    if (!text || text.length < 15) continue;

    const headerMatch = text.match(/^#{1,4}\s+(.+)$/m);
    if (headerMatch) {
      currentSection = headerMatch[1].trim();
    }

    if (text.length > 1200) {
      const paragraphs = text.split(/\n\n+/);
      for (const p of paragraphs) {
        if (p.trim().length > 15) {
          chunks.push({
            source: doc.filename,
            section: currentSection,
            content: p.trim(),
            isKnowledgeDir: doc.isKnowledgeDir,
          });
        }
      }
    } else {
      chunks.push({
        source: doc.filename,
        section: currentSection,
        content: text,
        isKnowledgeDir: doc.isKnowledgeDir,
      });
    }
  }

  return chunks;
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

function stem(word) {
  return String(word || '')
    .toLowerCase()
    .replace(/(ing|ed|es|s)$/, '');
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'are', 'was', 'were',
  'will', 'been', 'about', 'what', 'which', 'who', 'how', 'when', 'where', 'our',
  'any', 'all', 'has', 'can', 'should', 'could', 'would', 'is', 'it', 'in', 'on', 'at', 'to', 'company'
]);

function searchKnowledgeBase(query, limit = 3) {
  if (!query || typeof query !== 'string') return { count: 0, results: [] };

  const queryTokens = tokenize(query).filter((w) => !STOP_WORDS.has(w));
  if (queryTokens.length === 0) return { count: 0, results: [] };

  const docs = loadDocuments();
  const allChunks = [];
  for (const doc of docs) {
    allChunks.push(...chunkDocument(doc));
  }

  const scoredChunks = allChunks.map((chunk) => {
    const contentTokens = tokenize(chunk.content);
    const sectionTokens = tokenize(chunk.section);

    let score = 0;
    for (const qToken of queryTokens) {
      const qStem = stem(qToken);

      // Match exact or stemmed tokens
      const exactContentMatches = contentTokens.filter((t) => t === qToken || stem(t) === qStem).length;
      score += exactContentMatches * 5;

      // Partial matches
      const partialMatches = contentTokens.filter((t) => t !== qToken && stem(t) !== qStem && (t.includes(qToken) || qToken.includes(t) || stem(t).includes(qStem))).length;
      score += partialMatches * 1;

      // Header matches
      const exactHeaderMatches = sectionTokens.filter((t) => t === qToken || stem(t) === qStem).length;
      score += exactHeaderMatches * 15;
    }

    if (contentTokens.length > 0) {
      score = score / Math.sqrt(Math.max(contentTokens.length, 20));
    }

    return { ...chunk, score: Math.round(score * 100) / 100 };
  });

  const results = scoredChunks
    .filter((c) => c.score >= 0.5)
    .sort((a, b) => b.score - a.score || a.source.localeCompare(b.source) || a.section.localeCompare(b.section))
    .slice(0, limit);

  return {
    count: results.length,
    query,
    results: results.map((r) => ({
      source: r.source,
      section: r.section,
      content: r.content,
      relevanceScore: r.score,
    })),
  };
}

module.exports = {
  searchKnowledgeBase,
  loadDocuments,
  chunkDocument,
};
