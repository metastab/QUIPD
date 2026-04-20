/**
 * Quipd — Frontend Logic
 *
 * Handles:
 *  - Dark mode toggle with localStorage persistence
 *  - Rich text editor (bold, italic, underline)
 *  - Fetching and rendering diary entries
 *  - Creating new entries (POST) linked to user
 *  - Deleting entries (DELETE) with confirmation
 *  - Real-time search/filter by content and tags
 *  - Toast notifications for user feedback
 *
 * Auth logic is in auth.js (initAuth, handleAuthClick, handleGithubClick).
 */

// === Configuration ===
const API_BASE = '/entries';
const SUPABASE_URL = 'https://bcigoossgislfoebayuf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJjaWdvb3NzZ2lzbGZvZWJheXVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5MTc1NjcsImV4cCI6MjA5MTQ5MzU2N30.GaygdgSEYn4R4BOjDt1MqIftYecpRMpw7l1zgBC_eFQ';

// === Supabase Client (frontend) ===
const sbClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// === DOM References ===
const entryForm       = document.getElementById('entry-form');
const entryContent    = document.getElementById('entry-content');
const entryTags       = document.getElementById('entry-tags');
const charCount       = document.getElementById('char-count');
const editorToolbar   = document.getElementById('editor-toolbar');
const searchInput     = document.getElementById('search-input');
const searchClear     = document.getElementById('search-clear');
const entriesList     = document.getElementById('entries-list');
const emptyState      = document.getElementById('empty-state');
const noResultsState  = document.getElementById('no-results-state');
const entryCountEl    = document.getElementById('entry-count');
const themeToggle     = document.getElementById('theme-toggle');
const authBtn         = document.getElementById('auth-btn');
const authBtnGithub   = document.getElementById('auth-btn-github');
const lockBtn         = document.getElementById('lock-btn');

// === State ===
let allEntries = [];
let currentUser = null;
let currentToken = null;
let hasPassword = false;
let isAppLocked = false;

// === Initialization ===
document.addEventListener('DOMContentLoaded', init);

async function init() {
  initTheme();
  await initAuth(sbClient, authBtn, authBtnGithub, handleAuthChange);
  attachEventListeners();
  initEditor();
}

function attachEventListeners() {
  entryForm.addEventListener('submit', handleFormSubmit);
  entryContent.addEventListener('input', updateCharCount);
  searchInput.addEventListener('input', handleSearch);
  searchClear.addEventListener('click', clearSearch);

  // Lock overlay — unlock form
  document.getElementById('unlock-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const password = document.getElementById('unlock-password-input').value;
    if (password) verifyUnlock(password);
  });

  // Setup overlay — setup form
  document.getElementById('setup-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const password = document.getElementById('setup-password-input').value;
    const confirm  = document.getElementById('setup-confirm-input').value;
    setupPassword(password, confirm);
  });

  // Setup overlay — close button
  document.getElementById('setup-close').addEventListener('click', hideSetupOverlay);

  // Lock button in header — opens setup overlay
  if (lockBtn) {
    lockBtn.addEventListener('click', showSetupOverlay);
  }
}

// === Auth ===

/**
 * Updates UI and state based on auth session.
 * Called by initAuth() in auth.js whenever the session changes.
 */
function handleAuthChange(session) {
  if (session && session.user) {
    currentUser = session.user;
    currentToken = session.access_token;
    document.body.setAttribute('data-auth', 'true');
    updateAuthUI(currentUser, authBtn);
    checkSecurityStatus();
  } else {
    currentUser = null;
    currentToken = null;
    hasPassword = false;
    isAppLocked = false;
    document.body.removeAttribute('data-auth');
    document.body.removeAttribute('data-has-password');
    updateAuthUI(null, authBtn);
    hideLockOverlay();
    hideSetupOverlay();
    // Clear entries when logged out
    allEntries = [];
    renderEntries([]);
  }
}

// === Security ===

/**
 * Checks whether the user has a password lock configured.
 * Shows the lock overlay or loads entries accordingly.
 */
async function checkSecurityStatus() {
  try {
    const res = await fetch('/security-status', { headers: authHeaders() });
    if (!res.ok) throw new Error('Failed to check security status');
    const data = await res.json();
    hasPassword = data.hasPassword;

    if (hasPassword) {
      document.body.setAttribute('data-has-password', 'true');
      isAppLocked = true;
      showLockOverlay();
    } else {
      document.body.removeAttribute('data-has-password');
      isAppLocked = false;
      fetchEntries();
    }
  } catch (err) {
    console.error('Security status check failed:', err);
    // Fail open — load entries normally if status check fails
    fetchEntries();
  }
}

/**
 * Submits the unlock password to the server.
 * On success, hides the lock overlay and loads entries.
 */
async function verifyUnlock(password) {
  try {
    const res = await fetch('/verify-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Incorrect password');

    isAppLocked = false;
    hideLockOverlay();
    fetchEntries();
    showToast('Diary unlocked', 'success');
  } catch (err) {
    showToast(err.message, 'error');
    // Shake the input
    const input = document.getElementById('unlock-password-input');
    if (input) {
      input.classList.add('input-shake');
      setTimeout(() => input.classList.remove('input-shake'), 500);
    }
  }
}

/**
 * Submits a new password to the server to enable lock protection.
 */
async function setupPassword(password, confirmPassword) {
  if (password !== confirmPassword) {
    showToast('Passwords do not match', 'error');
    return;
  }
  if (password.length < 6) {
    showToast('Password must be at least 6 characters', 'error');
    return;
  }

  try {
    const res = await fetch('/setup-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to set password');

    hasPassword = true;
    isAppLocked = false;
    hideSetupOverlay();
    showToast('Diary lock enabled', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// --- Lock overlay helpers ---

function showLockOverlay() {
  const overlay = document.getElementById('lock-overlay');
  if (overlay) {
    overlay.classList.add('visible');
    // Focus password field after transition
    setTimeout(() => {
      const input = document.getElementById('unlock-password-input');
      if (input) input.focus();
    }, 300);
  }
}

function hideLockOverlay() {
  const overlay = document.getElementById('lock-overlay');
  if (overlay) overlay.classList.remove('visible');
}

function showSetupOverlay() {
  if (hasPassword) {
    showToast('A password is already set', 'error');
    return;
  }
  const overlay = document.getElementById('setup-overlay');
  if (overlay) {
    overlay.classList.add('visible');
    setTimeout(() => {
      const input = document.getElementById('setup-password-input');
      if (input) input.focus();
    }, 300);
  }
}

function hideSetupOverlay() {
  const overlay = document.getElementById('setup-overlay');
  if (overlay) overlay.classList.remove('visible');
  // Reset fields
  const p = document.getElementById('setup-password-input');
  const c = document.getElementById('setup-confirm-input');
  if (p) p.value = '';
  if (c) c.value = '';
}

// === Theme Toggle ===

/**
 * Initializes the theme based on localStorage or system preference.
 */
function initTheme() {
  const saved = localStorage.getItem('quipd-theme');
  if (saved) {
    document.documentElement.setAttribute('data-theme', saved);
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (prefersDark) {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  }
  themeToggle.addEventListener('click', toggleTheme);
}

/**
 * Toggles between light and dark theme.
 */
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  if (next === 'light') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
  localStorage.setItem('quipd-theme', next);
}

// === Rich Text Editor ===

/**
 * Sets up the toolbar buttons for the rich text editor.
 */
function initEditor() {
  const toolbarButtons = editorToolbar.querySelectorAll('.toolbar-btn');

  toolbarButtons.forEach(btn => {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
    });

    btn.addEventListener('click', () => {
      const command = btn.dataset.command;
      document.execCommand(command, false, null);
      updateToolbarState();
      entryContent.focus();
    });
  });

  entryContent.addEventListener('keyup', updateToolbarState);
  entryContent.addEventListener('mouseup', updateToolbarState);
  entryContent.addEventListener('paste', handlePaste);
}

/**
 * Highlights toolbar buttons that match the current selection's formatting.
 */
function updateToolbarState() {
  const toolbarButtons = editorToolbar.querySelectorAll('.toolbar-btn');
  toolbarButtons.forEach(btn => {
    const command = btn.dataset.command;
    const isActive = document.queryCommandState(command);
    btn.classList.toggle('active', isActive);
  });
}

/**
 * Handles paste events — strips to plain text.
 */
function handlePaste(e) {
  e.preventDefault();
  const text = e.clipboardData.getData('text/plain');
  document.execCommand('insertText', false, text);
}

// === API Functions ===

/**
 * Returns the Authorization header object for authenticated requests.
 */
function authHeaders() {
  return { 'Authorization': `Bearer ${currentToken}` };
}

/**
 * Fetches entries for the current user from the backend.
 */
async function fetchEntries() {
  if (!currentUser) {
    allEntries = [];
    renderEntries([]);
    return;
  }

  try {
    const res = await fetch(API_BASE, { headers: authHeaders() });
    if (!res.ok) throw new Error('Failed to fetch entries');
    allEntries = await res.json();
    renderEntries(allEntries);
  } catch (err) {
    console.error(err);
    showToast('Could not load entries. Please try again.', 'error');
  }
}

/**
 * Sends a new entry to the backend.
 * The user identity is determined server-side from the JWT.
 */
async function createEntry(content, tags) {
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ content, tags }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to create entry');
  }
  return res.json();
}

/**
 * Deletes an entry by ID from the backend.
 * Ownership is verified server-side via the JWT.
 */
async function deleteEntry(id) {
  const res = await fetch(`${API_BASE}/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to delete entry');
  }
  return res.json();
}

// === Event Handlers ===

/**
 * Handles the new entry form submission.
 */
async function handleFormSubmit(e) {
  e.preventDefault();

  // Check if user is logged in
  if (!currentUser) {
    showToast('Please login to save your data', 'error');
    return;
  }

  const content = entryContent.innerHTML.trim();
  const textOnly = entryContent.textContent.trim();
  if (!textOnly) return;

  const tags = parseTags(entryTags.value);

  try {
    await createEntry(content, tags);
    entryContent.innerHTML = '';
    entryTags.value = '';
    updateCharCount();
    showToast('Entry saved', 'success');
    await fetchEntries();
    document.getElementById('entries-section').scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    console.error(err);
    showToast(err.message, 'error');
  }
}

/**
 * Handles real-time search filtering.
 */
function handleSearch() {
  const query = searchInput.value.trim().toLowerCase();
  searchClear.classList.toggle('visible', query.length > 0);

  if (!query) {
    renderEntries(allEntries);
    return;
  }

  const filtered = allEntries.filter(entry => {
    const plainContent = stripHtml(entry.content).toLowerCase();
    const contentMatch = plainContent.includes(query);
    const tagMatch = entry.tags.some(tag => tag.toLowerCase().includes(query));
    return contentMatch || tagMatch;
  });

  renderEntries(filtered, true);
}

/**
 * Clears the search input and resets the view.
 */
function clearSearch() {
  searchInput.value = '';
  searchClear.classList.remove('visible');
  renderEntries(allEntries);
  searchInput.focus();
}

/**
 * Updates the character count display below the editor.
 */
function updateCharCount() {
  const len = entryContent.textContent.length;
  charCount.textContent = `${len} character${len !== 1 ? 's' : ''}`;
}

// === Rendering ===

/**
 * Renders a list of entries to the DOM.
 */
function renderEntries(entries, isSearchResult = false) {
  entriesList.innerHTML = '';

  entryCountEl.textContent = `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`;

  if (entries.length === 0 && !isSearchResult && allEntries.length === 0) {
    emptyState.style.display = '';
    noResultsState.style.display = 'none';
  } else if (entries.length === 0 && isSearchResult) {
    emptyState.style.display = 'none';
    noResultsState.style.display = '';
  } else {
    emptyState.style.display = 'none';
    noResultsState.style.display = 'none';
  }

  entries.forEach((entry, index) => {
    const card = createEntryCard(entry, index);
    entriesList.appendChild(card);
  });
}

/**
 * Creates a DOM element for a single entry card.
 */
function createEntryCard(entry, index) {
  const card = document.createElement('article');
  card.className = 'entry-card';
  card.style.animationDelay = `${index * 40}ms`;
  card.dataset.entryId = entry.id;

  const header = document.createElement('div');
  header.className = 'entry-card-header';

  const dateEl = document.createElement('time');
  dateEl.className = 'entry-date';
  dateEl.dateTime = entry.created_at;
  dateEl.textContent = formatDate(entry.created_at);

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'entry-delete-btn';
  deleteBtn.textContent = 'Delete';
  deleteBtn.title = 'Delete this entry';
  deleteBtn.addEventListener('click', () => showDeleteConfirmation(card, entry.id));

  header.appendChild(dateEl);
  header.appendChild(deleteBtn);

  const contentEl = document.createElement('div');
  contentEl.className = 'entry-content';
  contentEl.innerHTML = entry.content;

  const tagsContainer = document.createElement('div');
  tagsContainer.className = 'entry-tags';
  entry.tags.forEach(tag => {
    const tagEl = document.createElement('span');
    tagEl.className = 'tag';
    tagEl.textContent = `#${tag}`;
    tagsContainer.appendChild(tagEl);
  });

  card.appendChild(header);
  card.appendChild(contentEl);
  if (entry.tags.length > 0) {
    card.appendChild(tagsContainer);
  }

  return card;
}

/**
 * Shows an inline delete confirmation inside the entry card.
 */
function showDeleteConfirmation(card, entryId) {
  if (card.querySelector('.entry-confirm-delete')) return;

  const confirm = document.createElement('div');
  confirm.className = 'entry-confirm-delete';

  const label = document.createElement('span');
  label.textContent = 'Delete this entry?';

  const yesBtn = document.createElement('button');
  yesBtn.className = 'btn-confirm-yes';
  yesBtn.textContent = 'Yes, delete';
  yesBtn.addEventListener('click', async () => {
    try {
      await deleteEntry(entryId);
      card.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
      card.style.opacity = '0';
      card.style.transform = 'translateX(12px)';
      setTimeout(() => {
        fetchEntries();
        showToast('Entry deleted', 'success');
      }, 250);
    } catch (err) {
      console.error(err);
      showToast(err.message, 'error');
    }
  });

  const noBtn = document.createElement('button');
  noBtn.className = 'btn-confirm-no';
  noBtn.textContent = 'Cancel';
  noBtn.addEventListener('click', () => confirm.remove());

  confirm.appendChild(label);
  confirm.appendChild(yesBtn);
  confirm.appendChild(noBtn);
  card.appendChild(confirm);
}

// === Utility Functions ===

/**
 * Parses a comma-separated string into an array of trimmed, non-empty tags.
 */
function parseTags(input) {
  if (!input) return [];
  return input
    .split(',')
    .map(t => t.trim())
    .filter(t => t.length > 0);
}

/**
 * Strips HTML tags from a string, returning plain text.
 */
function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

/**
 * Formats an ISO date string into a human-friendly format.
 */
function formatDate(isoString) {
  const date = new Date(isoString);
  const options = {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  };
  return date.toLocaleDateString('en-US', options);
}

/**
 * Shows a toast notification.
 */
function showToast(message, type = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 350);
  }, 2500);
}
