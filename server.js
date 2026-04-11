const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'entries.json');

// --- Middleware ---
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Helper Functions ---

/**
 * Reads entries from the JSON data file.
 * Returns an empty array if the file is missing or malformed.
 */
function readEntries() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading entries file:', err.message);
    return [];
  }
}

/**
 * Writes entries array to the JSON data file.
 * Creates the data directory if it doesn't exist.
 */
function writeEntries(entries) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(entries, null, 2), 'utf-8');
}

/**
 * Generates a unique ID for a new entry.
 */
function generateId() {
  return crypto.randomUUID();
}

// --- API Routes ---

/**
 * GET /entries
 * Returns all diary entries, sorted newest first.
 */
app.get('/entries', (req, res) => {
  const entries = readEntries();
  entries.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(entries);
});

/**
 * POST /entries
 * Creates a new diary entry.
 * Body: { content: string, tags: string[] }
 */
app.post('/entries', (req, res) => {
  const { content, tags } = req.body;

  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return res.status(400).json({ error: 'Content is required and must be a non-empty string.' });
  }

  const sanitizedTags = Array.isArray(tags)
    ? tags.map(t => String(t).trim()).filter(t => t.length > 0)
    : [];

  const entry = {
    id: generateId(),
    content: content.trim(),
    created_at: new Date().toISOString(),
    tags: sanitizedTags,
  };

  const entries = readEntries();
  entries.push(entry);
  writeEntries(entries);

  res.status(201).json(entry);
});

/**
 * DELETE /entries/:id
 * Deletes a diary entry by its ID.
 */
app.delete('/entries/:id', (req, res) => {
  const { id } = req.params;
  let entries = readEntries();
  const index = entries.findIndex(e => e.id === id);

  if (index === -1) {
    return res.status(404).json({ error: 'Entry not found.' });
  }

  entries.splice(index, 1);
  writeEntries(entries);

  res.json({ message: 'Entry deleted successfully.' });
});

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`Diary app running at http://localhost:${PORT}`);
});
