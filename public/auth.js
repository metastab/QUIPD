/**
 * Quipd — Auth Logic
 *
 * Handles:
 *  - Supabase Auth (Google OAuth & GitHub OAuth login/logout)
 *  - Auth state changes and UI updates
 *
 * Depends on: sbClient (Supabase client), authBtn, authBtnGithub (DOM refs)
 * Calls back into script.js via: onAuthChange(user) — injected at init time
 */

/**
 * Initializes auth: checks current session, sets up listener,
 * handles OAuth redirect, and wires up the auth buttons.
 *
 * @param {object} sbClient     - The Supabase client instance.
 * @param {HTMLElement} authBtn        - The Google auth button element.
 * @param {HTMLElement} authBtnGithub  - The GitHub auth button element.
 * @param {function} onAuthChange      - Callback invoked with the session on auth state changes.
 */
async function initAuth(sbClient, authBtn, authBtnGithub, onAuthChange) {
  // Check for existing session
  const { data: { session } } = await sbClient.auth.getSession();
  onAuthChange(session);

  // Listen for auth state changes (login, logout, token refresh)
  sbClient.auth.onAuthStateChange((_event, session) => {
    onAuthChange(session);
  });

  // Wire up auth buttons
  authBtn.addEventListener('click', () => handleAuthClick(sbClient, authBtn));
  authBtnGithub.addEventListener('click', () => handleGithubClick(sbClient));
}

/**
 * Updates the auth button UI based on whether a user is signed in.
 *
 * @param {object|null} user - The current Supabase user object, or null if signed out.
 * @param {HTMLElement} authBtn - The Google auth button element.
 */
function updateAuthUI(user, authBtn) {
  if (user) {
    authBtn.title = 'Sign out';
    authBtn.setAttribute('aria-label', 'Sign out');
  } else {
    authBtn.title = 'Sign in with Google';
    authBtn.setAttribute('aria-label', 'Sign in with Google');
  }
}

/**
 * Handles Google auth button click: login or logout.
 *
 * @param {object} sbClient - The Supabase client instance.
 * @param {HTMLElement} authBtn - The Google auth button element.
 */
async function handleAuthClick(sbClient, authBtn) {
  const isSignedIn = authBtn.title === 'Sign out';

  if (isSignedIn) {
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

/**
 * Handles GitHub auth button click: login or logout.
 *
 * @param {object} sbClient - The Supabase client instance.
 */
async function handleGithubClick(sbClient) {
  const { data: { session } } = await sbClient.auth.getSession();

  if (session && session.user) {
    // Already logged in — sign out
    const { error } = await sbClient.auth.signOut();
    if (error) {
      console.error('Sign out error:', error.message);
      showToast('Failed to sign out', 'error');
    } else {
      showToast('Signed out', 'success');
    }
  } else {
    const { error } = await sbClient.auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo: window.location.origin,
      },
    });
    if (error) {
      console.error('GitHub sign in error:', error.message);
      showToast('Failed to sign in with GitHub', 'error');
    }
  }
}
