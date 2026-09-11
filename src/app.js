const express = require('express');
require('dotenv').config();

const agentRouter = require('./routes/agent');

const app = express();
app.use(express.json())
const PORT = process.env.PORT || 3000;

app.use('/agent', agentRouter);

app.get('/', (req,res)=>{
  res.json({ name: 'Project Management Agent', status: 'ok' });
})
app.listen(PORT, () => {
  console.log(`Project management agent listening on port ${PORT}`);
});

