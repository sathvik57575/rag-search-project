const express = require('express');
require('dotenv').config();

const documentsRouter = require('./routes/documents');
const searchRouter = require('./routes/search');
const askRouter = require('./routes/ask');

const app = express();
app.use(express.json())
const PORT = process.env.PORT || 3000;

app.use('/documents', documentsRouter); 
app.use('/search', searchRouter);

app.use('/ask', askRouter); //for llm

app.get('/', (req,res)=>{
  res.send("hi, I'm sathvik, server started")
})
app.listen(PORT, () => {
  console.log(`RAG search API listening on port ${PORT}`);
});

