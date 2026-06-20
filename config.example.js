// ─────────────────────────────────────────────────
// PODSHELF CONFIG  —  copy this file to config.js
//                     and fill in your values.
//                     config.js is gitignored.
// ─────────────────────────────────────────────────
const CONFIG = {
  ABS_URL:          'https://your-abs-server.com',       // no trailing slash
  ABS_API_KEY:      'your-abs-api-key-here',
  SUPABASE_URL:     'https://your-project.supabase.co',
  SUPABASE_ANON:    'your-supabase-anon-key-here',

  ALL_EPS_PLAYLIST: 'All Episodes',   // ABS playlist name (auto-managed)
  SKIP_BACK_S:      15,               // seconds to skip back
  SKIP_FWD_S:       30,               // seconds to skip forward
  SPEEDS:           [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0],
  PROGRESS_SYNC_MS: 15000,            // sync playback progress every N ms
};
