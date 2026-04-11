const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Supabase Client ---
const SUPABASE_URL = 'https://bcigoossgislfoebayuf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJjaWdvb3NzZ2lzbGZvZWJheXVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5MTc1NjcsImV4cCI6MjA5MTQ5MzU2N30.GaygdgSEYn4R4BOjDt1MqIftYecpRMpw7l1zgBC_eFQ';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- Middleware ---
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- API Routes ---

/**
 * GET /entries
 * Returns all diary entries, sorted newest first.
 */
app.get('/entries', async (req, res) => {
  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Supabase GET error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch entries.' });
  }

  res.json(data);
});

/**
 * POST /entries
 * Creates a new diary entry.
 * Body: { content: string, tags: string[] }
 */
app.post('/entries', async (req, res) => {
  const { content, tags } = req.body;

  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return res.status(400).json({ error: 'Content is required and must be a non-empty string.' });
  }

  const sanitizedTags = Array.isArray(tags)
    ? tags.map(t => String(t).trim()).filter(t => t.length > 0)
    : [];

  const entry = {
    id: crypto.randomUUID(),
    content: content.trim(),
    created_at: new Date().toISOString(),
    tags: sanitizedTags,
  };

  const { data, error } = await supabase
    .from('entries')
    .insert(entry)
    .select()
    .single();

  if (error) {
    console.error('Supabase POST error:', error.message);
    return res.status(500).json({ error: 'Failed to create entry.' });
  }

  res.status(201).json(data);
});

/**
 * DELETE /entries/:id
 * Deletes a diary entry by its ID.
 */
app.delete('/entries/:id', async (req, res) => {
  const { id } = req.params;

  // Check if entry exists
  const { data: existing, error: fetchErr } = await supabase
    .from('entries')
    .select('id')
    .eq('id', id)
    .single();

  if (fetchErr || !existing) {
    return res.status(404).json({ error: 'Entry not found.' });
  }

  const { error } = await supabase
    .from('entries')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Supabase DELETE error:', error.message);
    return res.status(500).json({ error: 'Failed to delete entry.' });
  }

  res.json({ message: 'Entry deleted successfully.' });
});

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`Quipd running at http://localhost:${PORT}`);
});
