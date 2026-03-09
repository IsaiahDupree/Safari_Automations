import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 4001;

app.use(cors());
app.use(express.json());

const LINKEDIN_DIR = path.join(process.env.HOME, '.linkedin-outreach');

// Get prospects
app.get('/api/prospects', (req, res) => {
  try {
    const prospectsPath = path.join(LINKEDIN_DIR, 'prospects.json');
    const data = fs.readFileSync(prospectsPath, 'utf-8');
    res.json(JSON.parse(data));
  } catch (error) {
    console.error('Error reading prospects:', error);
    res.status(500).json({ error: 'Failed to read prospects' });
  }
});

// Get campaigns
app.get('/api/campaigns', (req, res) => {
  try {
    const campaignsPath = path.join(LINKEDIN_DIR, 'campaigns.json');
    const data = fs.readFileSync(campaignsPath, 'utf-8');
    res.json(JSON.parse(data));
  } catch (error) {
    console.error('Error reading campaigns:', error);
    res.status(500).json({ error: 'Failed to read campaigns' });
  }
});

// Get runs
app.get('/api/runs', (req, res) => {
  try {
    const runsPath = path.join(LINKEDIN_DIR, 'runs.json');
    const data = fs.readFileSync(runsPath, 'utf-8');
    res.json(JSON.parse(data));
  } catch (error) {
    console.error('Error reading runs:', error);
    res.status(500).json({ error: 'Failed to read runs' });
  }
});

app.listen(PORT, () => {
  console.log(`LinkedIn Dashboard API server running on http://localhost:${PORT}`);
  console.log(`Reading data from: ${LINKEDIN_DIR}`);
});
