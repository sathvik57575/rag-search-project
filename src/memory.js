const fs = require('fs');
const path = require('path');

const defaultMemoryPath = path.join(__dirname, '..', 'data', 'memory.json');
const conversations = new Map();

function getMemoryPath(memoryPath) {
  return memoryPath || process.env.MEMORY_PATH || defaultMemoryPath;
}

function emptyStore() {
  return { users: {} };
}

function readStore(memoryPath) {
  const filePath = getMemoryPath(memoryPath);
  if (!fs.existsSync(filePath)) return emptyStore();
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return parsed && parsed.users ? parsed : emptyStore();
}

function writeStore(store, memoryPath) {
  const filePath = getMemoryPath(memoryPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  try {
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    fs.writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
    if (fs.existsSync(temporaryPath)) {
      try { fs.unlinkSync(temporaryPath); } catch (_) {}
    }
  }
}

function normalizeUserId(userId) {
  return String(userId || 'anonymous').trim().toLowerCase() || 'anonymous';
}

function tokens(value) {
  return new Set(
    String(value || '')
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter((token) => token.length > 2),
  );
}

function stem(word) {
  let s = String(word || '').toLowerCase();
  if (s.length <= 2) return s;
  if (s.endsWith('ies') && s.length > 4) return s.slice(0, -3) + 'y';
  if (s.endsWith('ed') && s.length > 4) return s.slice(0, -2);
  if (s.endsWith('ing') && s.length > 5) return s.slice(0, -3);
  if (s.endsWith('es') && s.length > 4) return s.slice(0, -2);
  if (s.endsWith('s') && s.length > 3 && !s.endsWith('ss')) return s.slice(0, -1);
  return s;
}

const GENERAL_MEMORY_WORDS = new Set([
  'remember', 'rememeber', 'remembering', 'memory', 'memories',
  'stored', 'saved', 'recall', 'history', 'context', 'wanted',
  'asked', 'told', 'tell', 'know', 'preference', 'preferences',
  'info', 'information', 'detail', 'details'
]);

function isGeneralMemoryQuery(query) {
  const queryTokens = tokens(query);
  for (const token of queryTokens) {
    if (GENERAL_MEMORY_WORDS.has(token) || GENERAL_MEMORY_WORDS.has(stem(token))) {
      return true;
    }
  }
  return false;
}

function userMemories(store, userId) {
  const normalizedUserId = normalizeUserId(userId);
  store.users[normalizedUserId] ||= { memories: [] };
  return store.users[normalizedUserId].memories;
}

function remember({ userId, key, content, type = 'preference', tags = [] } = {}, options = {}) {
  if (!key || !content) return { error: 'Memory key and content are required.' };
  const store = readStore(options.memoryPath);
  const memories = userMemories(store, userId);
  const normalizedKey = String(key).trim().toLowerCase();
  const existing = memories.find((memory) => memory.key === normalizedKey);
  const memory = {
    id: existing ? existing.id : `MEM_${Date.now()}_${memories.length + 1}`,
    key: normalizedKey,
    content: String(content).trim(),
    type,
    tags: Array.isArray(tags) ? tags.map(String) : [],
    updatedAt: new Date().toISOString(),
  };
  if (existing) Object.assign(existing, memory);
  else memories.push(memory);
  writeStore(store, options.memoryPath);
  return { saved: true, updated: Boolean(existing), memory };
}

function forget({ userId, key } = {}, options = {}) {
  if (!key) return { error: 'Memory key is required.' };
  const store = readStore(options.memoryPath);
  const memories = userMemories(store, userId);
  const index = memories.findIndex((memory) => memory.key === String(key).trim().toLowerCase());
  if (index === -1) return { removed: false, message: 'No matching memory found.' };
  const [memory] = memories.splice(index, 1);
  writeStore(store, options.memoryPath);
  return { removed: true, memory };
}

function search({ userId, query, limit = 5 } = {}, options = {}) {
  const store = readStore(options.memoryPath);
  const memories = userMemories(store, userId);
  if (!memories.length) {
    return { count: 0, memories: [] };
  }
  if (!query || !query.trim()) {
    return list({ userId, limit }, options);
  }

  const queryTokens = tokens(query);
  const matches = memories
    .map((memory) => {
      const memoryTokens = tokens(`${memory.key} ${memory.content} ${memory.tags.join(' ')}`);
      let score = 0;
      for (const qToken of queryTokens) {
        const qStem = stem(qToken);
        for (const mToken of memoryTokens) {
          const mStem = stem(mToken);
          if (
            qToken === mToken ||
            qStem === mStem ||
            (qStem.length >= 3 && mToken.startsWith(qStem)) ||
            (mStem.length >= 3 && qToken.startsWith(mStem))
          ) {
            score += 1;
            break;
          }
        }
      }
      return { ...memory, relevance: score };
    });

  let relevantMatches = matches
    .filter((memory) => memory.relevance > 0)
    .sort((left, right) => right.relevance - left.relevance || right.updatedAt.localeCompare(left.updatedAt));

  if (relevantMatches.length === 0 || isGeneralMemoryQuery(query)) {
    if (relevantMatches.length === 0) {
      relevantMatches = memories
        .slice()
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    }
  }

  const results = relevantMatches.slice(0, Math.max(1, Number(limit) || 5));
  return { count: results.length, memories: results };
}

function list({ userId, limit = 20 } = {}, options = {}) {
  const store = readStore(options.memoryPath);
  const memories = userMemories(store, userId)
    .slice()
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, Math.max(1, Number(limit) || 20));
  return { count: memories.length, memories };
}

function conversationKey(userId, conversationId) {
  return `${normalizeUserId(userId)}::${conversationId || 'default'}`;
}

function recordTurn({ userId, conversationId, userMessage, assistantMessage } = {}) {
  const key = conversationKey(userId, conversationId);
  const turns = conversations.get(key) || [];
  turns.push({ userMessage, assistantMessage, recordedAt: new Date().toISOString() });
  conversations.set(key, turns.slice(-8));
}

function getRecentTurns({ userId, conversationId, limit = 6 } = {}) {
  const turns = conversations.get(conversationKey(userId, conversationId)) || [];
  return turns.slice(-Math.max(1, Number(limit) || 6));
}

function createSession({ userId, conversationId, memoryPath } = {}) {
  const normalizedUserId = normalizeUserId(userId);
  return {
    userId: normalizedUserId,
    hasUserId: userId !== undefined && userId !== null && String(userId).trim() !== '',
    conversationId: conversationId || 'default',
    memoryPath: getMemoryPath(memoryPath),
    relevant: [],
  };
}

function clearMemoryCache() {
  conversations.clear();
}

module.exports = {
  remember,
  forget,
  search,
  list,
  recordTurn,
  getRecentTurns,
  createSession,
  clearMemoryCache,
};
