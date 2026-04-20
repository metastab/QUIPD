const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const BCRYPT_ROUNDS = 12;

// --- Supabase Client ---
const SUPABASE_URL = 'https://bcigoossgislfoebayuf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJjaWdvb3NzZ2lzbGZvZWJheXVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5MTc1NjcsImV4cCI6MjA5MTQ5MzU2N30.GaygdgSEYn4R4BOjDt1MqIftYecpRMpw7l1zgBC_eFQ';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- Middleware ---
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- In-Memory Unlock Registry ---
// Maps userId -> expiry timestamp (ms). Cleared on server restart.
const unlockedSessions = new Map();
const UNLOCK_TTL_MS = 60 * 60 * 1000; // 1 hour

function isUnlocked(userId) {
  const expiresAt = unlockedSessions.get(userId);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    unlockedSessions.delete(userId);
    return false;
  }
  return true;
}

function unlockSession(userId) {
  unlockedSessions.set(userId, Date.now() + UNLOCK_TTL_MS);
}

// --- Auth Middleware ---

/**
 * Extracts and verifies the Supabase JWT from the Authorization header.
 * Attaches the verified user to req.user on success.
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

/**
 * Checks user_security for a password lock.
 * If has_password is true and session is not unlocked, responds 403 { locked: true }.
 * Must be used after authenticate().
 */
async function checkEntryAccess(req, res, next) {
  const { data, error } = await supabase
    .from('user_security')
    .select('has_password')
    .eq('user_id', req.user.id)
    .maybeSingle();

  if (error) {
    console.error('Security check error:', error.message);
    return res.status(500).json({ error: 'Failed to verify security status.' });
  }

  const hasPassword = data?.has_password ?? false;

  if (hasPassword && !isUnlocked(req.user.id)) {
    return res.status(403).json({ locked: true });
  }

  next();
}

// --- Security Routes ---

/**
 * GET /security-status
 * Returns whether the authenticated user has a password lock configured.
 */
app.get('/security-status', authenticate, async (req, res) => {
  const { data, error } = await supabase
    .from('user_security')
    .select('has_password')
    .eq('user_id', req.user.id)
    .maybeSingle();

  if (error) {
    console.error('Security status error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch security status.' });
  }

  res.json({ hasPassword: data?.has_password ?? false });
});

/**
 * POST /setup-password
 * Sets a bcrypt-hashed password for the authenticated user.
 * Only allowed if the user does not already have a password set.
 * Body: { password: string }
 */
app.post('/setup-password', authenticate, async (req, res) => {
  const { password } = req.body;

  if (!password || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  // Block if password already exists
  const { data: existing } = await supabase
    .from('user_security')
    .select('has_password')
    .eq('user_id', req.user.id)
    .maybeSingle();

  if (existing?.has_password) {
    return res.status(409).json({ error: 'A password is already set.' });
  }

  const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const { error } = await supabase
    .from('user_security')
    .upsert({
      user_id: req.user.id,
      password_hash,
      has_password: true,
      created_at: new Date().toISOString(),
    });

  if (error) {
    console.error('Setup password error:', error.message);
    return res.status(500).json({ error: 'Failed to save password.' });
  }

  // Unlock immediately after setup so user doesn't need to re-enter
  unlockSession(req.user.id);

  res.json({ success: true });
});

/**
 * POST /verify-password
 * Verifies the submitted password against the stored bcrypt hash.
 * On success, marks the session as unlocked for 1 hour.
 * Body: { password: string }
 */
app.post('/verify-password', authenticate, async (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ error: 'Password is required.' });
  }

  const { data, error } = await supabase
    .from('user_security')
    .select('password_hash')
    .eq('user_id', req.user.id)
    .single();

  if (error || !data) {
    return res.status(404).json({ error: 'No password configured for this account.' });
  }

  const match = await bcrypt.compare(password, data.password_hash);

  if (!match) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }

  unlockSession(req.user.id);
  res.json({ success: true });
});

// --- Entries Routes ---

/**
 * GET /entries
 * Returns all diary entries for the authenticated user, sorted newest first.
 * Blocked with { locked: true } if user has a password and session is not unlocked.
 */
app.get('/entries', authenticate, checkEntryAccess, async (req, res) => {
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
 * Blocked with { locked: true } if user has a password and session is not unlocked.
 * Body: { content: string, tags: string[] }
 */
app.post('/entries', authenticate, checkEntryAccess, async (req, res) => {
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
 * Deletes a diary entry by ID.
 * Blocked with { locked: true } if user has a password and session is not unlocked.
 * Ownership is enforced server-side via the verified JWT.
 */
app.delete('/entries/:id', authenticate, checkEntryAccess, async (req, res) => {
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
