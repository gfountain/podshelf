'use strict';

// ══════════════════════════════════════════════════
//  AUTH  —  local app password gate
//  No network request needed — password is checked
//  against CONFIG.APP_PASSWORD locally.
//  Token stored in localStorage (remember me)
//  or sessionStorage (session only).
// ══════════════════════════════════════════════════
const AUTH = {

  // Check for saved auth flag
  load() {
    return localStorage.getItem('ps_auth') === '1' ||
           sessionStorage.getItem('ps_auth') === '1';
  },

  // Verify password and store auth flag
  login(password, remember) {
    if (password !== CONFIG.APP_PASSWORD) {
      throw new Error('Incorrect password');
    }
    const store = remember ? localStorage : sessionStorage;
    store.setItem('ps_auth', '1');
  },

  // Clear auth flag
  logout() {
    localStorage.removeItem('ps_auth');
    sessionStorage.removeItem('ps_auth');
  },

  get isLoggedIn() { return this.load(); },
};
