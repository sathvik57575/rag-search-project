const axios = require('axios');

function getGeminiConfig() {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = 'gemini-3.5-flash-lite';
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');
  return { apiKey, model };
}

function getOllamaConfig() {
  const baseURL = 'http://127.0.0.1:11434';
  const model = 'llama3.2';
  return { baseURL, model };
}

/*
function buildGroundedPrompt(question, chunks) {
  const context = chunks
    .map(
      (chunk, index) =>
        `[SOURCE ${index + 1}]\nDocument ID: ${chunk.source_doc_id}\nTitle: ${chunk.title || 'Untitled'}\nDate: ${chunk.doc_date || 'Unknown'}\nContent: ${chunk.content}`
    )
    .join('\n\n');

  return `You answer questions using only the supplied document sources.

Rules:
- Use only facts supported by the sources.
- If the sources do not contain enough information, say exactly: "I don't know based on the available documents."
- Do not use general knowledge, guesses, or invented details.
- If sources conflict, explain the conflict and prefer the document with the newest date only when the question asks for the current policy. Otherwise, mention both versions and their dates.
- Keep the answer concise and cite supporting source IDs in square brackets, for example [HR002].
- Do not cite a source that does not support the statement.

Question:
${question}

Retrieved sources:
${context || '(No sources were retrieved.)'}`;
}
*/


function buildGroundedPrompt(question, chunks) {
  const context = chunks
    .map(
      (chunk, index) =>
        `[SOURCE ${index + 1}] (ID: ${chunk.source_doc_id})\n${chunk.content}`
    )
    .join('\n\n');

  return `You are answering a question using ONLY the sources below.

Instructions:
1. Read each source carefully.
2. If a source answers the question, use it to write a short, direct answer. Cite the source ID in brackets, like [ABC0001].

Sources:
${context || '(No sources were retrieved.)'}

Question: ${question}

Answer:`;
}

/*
async function generateGroundedAnswer(question, chunks) {
  const { apiKey, model } = getGeminiConfig();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const response = await axios.post(
      url,
      {
        contents: [{ role: 'user', parts: [{ text: buildGroundedPrompt(question, chunks) }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 500 },
      },
      { headers: { 'Content-Type': 'application/json' } }
    );

    // this response object is so big 
    // console.log(response.data);
    // console.log(response.data.candidates);
    // console.log(response.data.candidates.content);
    // console.log(response.data.candidates.content.parts);

    const answer = response.data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || '')
      .join('')
      .trim();
    if (!answer) throw new Error('Gemini returned an empty answer');
    return { answer, model };
  } catch (error) {
    // console.log(error.response?.data?.error?.message);
    const message = error.response?.data?.error?.message || error.message;
    throw new Error(`Gemini request failed: ${message}`);
  }
}
*/

async function generateGroundedAnswer(question, chunks) {
  const { baseURL, model } = getOllamaConfig();
  const url = `${baseURL}/api/generate`;

  try {
    const response = await axios.post(url, {
      model,
      prompt: buildGroundedPrompt(question, chunks),
      stream: false,
      options: { temperature: 0.1, num_predict: 500 },
    });

    const answer = response.data?.response?.trim();
    if (!answer) throw new Error('Ollama returned an empty answer');
    return { answer, model };
  } catch (error) {
    const message = error.response?.data?.error || error.message;
    throw new Error(`Ollama request failed: ${message}`);
  }
}

module.exports = { buildGroundedPrompt, generateGroundedAnswer };