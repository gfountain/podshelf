'use strict';

// ══════════════════════════════════════════════════
//  AUTH  —  ABS username/password login
//  Token stored in localStorage (remember me)
//  or sessionStorage (session only)
// ══════════════════════════════════════════════════
const AUTH = {
  token:    null,
  username: null,

  // ── Load saved token ──────────────────────────
  // Returns true if a valid-looking token was found
  load() {
    const t = localStorage.getItem('ps_token') || sessionStorage.getItem('ps_token');
    if (t) {
      this.token    = t;
      this.username = localStorage.getItem('ps_username') || sessionStorage.getItem('ps_username');
      return true;
    }
    return false;
  },

  // ── Login ─────────────────────────────────────
  async login(username, password, remember) {
    const res = await fetch(`${CONFIG.ABS_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error('Invalid username or password');
    }
    if (!res.ok) {
      throw new Error(`Login failed (${res.status})`);
    }

    const data = await res.json();
    const token = data.user?.token;
    if (!token) throw new Error('No token returned from ABS');

    this.token    = token;
    this.username = data.user?.username || username;

    const store = remember ? localStorage : sessionStorage;
    store.setItem('ps_token',    token);
    store.setItem('ps_username', this.username);

    return data.user;
  },

  // ── Logout ────────────────────────────────────
  logout() {
    this.token    = null;
    this.username = null;
    localStorage.removeItem('ps_token');
    localStorage.removeItem('ps_username');
    sessionStorage.removeItem('ps_token');
    sessionStorage.removeItem('ps_username');
  },

  // ── Check if logged in ────────────────────────
  get isLoggedIn() { return !!this.token; },
};
