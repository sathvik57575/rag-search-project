const express = require('express');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const agentRouter = require('./routes/agent');
const coordinatorRouter = require('./routes/coordinator');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, '..', 'public')));
const PORT = process.env.PORT || 3000;

app.use('/agent', agentRouter);
app.use('/coordinator', coordinatorRouter);

app.get('/', (req, res) => {
  res.render('home', { page: 'home' });
});

app.get('/how-to-use', (req, res) => {
  res.render('how-to-use', { page: 'how-to-use' });
});

app.get('/agent', (req, res) => {
  res.render('agent', { page: 'agent' });
});

app.get('/coordinator', (req, res) => {
  res.render('coordinator', { page: 'coordinator' });
});

app.get('/data', (req, res) => {
  const dataPath = path.join(__dirname, '..', 'data', 'pm-data.json');
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  res.render('data', { page: 'data', data: JSON.stringify(data, null, 2) });
});

app.get('/guidelines', (req, res) => {
  const knowledgePath = path.join(__dirname, '..', 'knowledge');
  const documents = [
    { title: 'Company Policies', filename: 'company_policies.md' },
    { title: 'Project Guidelines', filename: 'project_guidelines.md' },
    { title: 'SLA and Compliance', filename: 'sla_and_compliance.md' },
  ].map((document) => ({
    title: document.title,
    content: fs.readFileSync(path.join(knowledgePath, document.filename), 'utf8'),
  }));
  res.render('guidelines', { page: 'guidelines', documents });
});

app.get('/health', (req, res) => {
  res.json({ name: 'Project Management Agent', status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Project management agent listening on port ${PORT}`);
});

