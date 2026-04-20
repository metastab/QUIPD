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

// --- Auth Middleware ---

/**
 * Extracts and verifies the Supabase JWT from the Authorization header.
 * Attaches the verified user to req.user on success.
 * Responds with 401 if the token is missing, invalid, or expired.
 */
async function authenticate(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'Missing authorization token.' });
  }

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }

  req.user = user;
  next();
}

// --- API Routes ---

/**
 * GET /entries
 * Returns all diary entries for the authenticated user, sorted newest first.
 * The user identity is taken from the verified JWT — not from query params.
 */
app.get('/entries', authenticate, async (req, res) => {
  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Supabase GET error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch entries.' });
  }

  res.json(data);
});

/**
 * POST /entries
 * Creates a new diary entry for the authenticated user.
 * The user_id is set server-side from the verified JWT — not from the request body.
 * Body: { content: string, tags: string[] }
 */
app.post('/entries', authenticate, async (req, res) => {
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
    user_id: req.user.id,
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
 * Deletes a diary entry by ID, but only if it belongs to the authenticated user.
 * Ownership is enforced server-side via the verified JWT — not client-supplied data.
 */
app.delete('/entries/:id', authenticate, async (req, res) => {
  const { id } = req.params;

  // Check that the entry exists and belongs to the authenticated user
  const { data: existing, error: fetchErr } = await supabase
    .from('entries')
    .select('id')
    .eq('id', id)
    .eq('user_id', req.user.id)
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
