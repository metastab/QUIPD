/**
 * Quipd — Frontend Logic
 *
 * Handles:
 *  - Supabase Auth (Google OAuth login/logout)
 *  - Dark mode toggle with localStorage persistence
 *  - Rich text editor (bold, italic, underline)
 *  - Fetching and rendering diary entries
 *  - Creating new entries (POST) linked to user
 *  - Deleting entries (DELETE) with confirmation
 *  - Real-time search/filter by content and tags
 *  - Toast notifications for user feedback
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

// === State ===
let allEntries = [];
let currentUser = null;

// === Initialization ===
document.addEventListener('DOMContentLoaded', init);

async function init() {
  initTheme();
  await initAuth();
  attachEventListeners();
  initEditor();
}

function attachEventListeners() {
  entryForm.addEventListener('submit', handleFormSubmit);
  entryContent.addEventListener('input', updateCharCount);
  searchInput.addEventListener('input', handleSearch);
  searchClear.addEventListener('click', clearSearch);
}

// === Auth ===

/**
 * Initializes auth: checks current session, sets up listener,
 * handles OAuth redirect, and wires up the auth button.
 */
async function initAuth() {
  // Check for existing session
  const { data: { session } } = await sbClient.auth.getSession();
  handleAuthChange(session);

  // Listen for auth state changes (login, logout, token refresh)
  sbClient.auth.onAuthStateChange((_event, session) => {
    handleAuthChange(session);
  });

  // Wire up auth button
  authBtn.addEventListener('click', handleAuthClick);
}

/**
 * Updates UI and state based on auth session.
 */
function handleAuthChange(session) {
  if (session && session.user) {
    currentUser = session.user;
    document.body.setAttribute('data-auth', 'true');
    authBtn.title = 'Sign out';
    authBtn.setAttribute('aria-label', 'Sign out');
    fetchEntries();
  } else {
    currentUser = null;
    document.body.removeAttribute('data-auth');
    authBtn.title = 'Sign in with Google';
    authBtn.setAttribute('aria-label', 'Sign in with Google');
    // Clear entries when logged out
    allEntries = [];
    renderEntries([]);
  }
}

/**
 * Handles auth button click: login or logout.
 */
async function handleAuthClick() {
  if (currentUser) {
    // Logout
    const { error } = await sbClient.auth.signOut();
    if (error) {
      console.error('Sign out error:', error.message);
      showToast('Failed to sign out', 'error');
    } else {
      showToast('Signed out', 'success');
    }
  } else {
    // Login with Google
    const { error } = await sbClient.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
      },
    });
    if (error) {
      console.error('Sign in error:', error.message);
      showToast('Failed to sign in', 'error');
    }
  }
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
 * Fetches entries for the current user from the backend.
 */
async function fetchEntries() {
  if (!currentUser) {
    allEntries = [];
    renderEntries([]);
    return;
  }

  try {
    const res = await fetch(`${API_BASE}?user_id=${currentUser.id}`);
    if (!res.ok) throw new Error('Failed to fetch entries');
    allEntries = await res.json();
    renderEntries(allEntries);
  } catch (err) {
    console.error(err);
    showToast('Could not load entries. Please try again.', 'error');
  }
}

/**
 * Sends a new entry to the backend with user_id.
 */
async function createEntry(content, tags) {
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, tags, user_id: currentUser.id }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to create entry');
  }
  return res.json();
}

/**
 * Deletes an entry by ID from the backend.
 */
async function deleteEntry(id) {
  const res = await fetch(`${API_BASE}/${id}`, { method: 'DELETE' });
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
