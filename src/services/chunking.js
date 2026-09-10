/*
  THis func splits text into overlapping chunks by approximate word count.
  Word count is a simple, dependency-free stand-in for token count
  (roughly 0.75 words per token for English).

 */
function chunkText(text, chunkSize = 60, overlapRatio = 0.2) {
  //overlap ratio means each chunk should share 20% of their words with the previous chunk
  //12

  const words = text.split(/\s+/).filter(Boolean); //we are splitting at spaces, tabs, new lines etc, and .filter(Boolean) removes any empty entries(in case there are double spaces or no words).
  //This is much better than manually removing them 

  if (words.length === 0) return [];

  const overlap = Math.floor(chunkSize * overlapRatio);//default will be 12, unless we change the values when we are calling the function, but I am not

  const step = chunkSize - overlap;

  if (step <= 0) throw new Error('overlapRatio must be < 1'); 

  const chunks = [];
  for (let start = 0; start < words.length; start += step) {
    const end = Math.min(start + chunkSize, words.length);
    chunks.push(words.slice(start, end).join(' '));
    if (end === words.length) break;
  }
  /*
  I dry ran this for small inputs with chunkSize = 10, and overlapRatio = 0.2 with total words = 26, 28
  */
  return chunks;
}

module.exports = { chunkText };
