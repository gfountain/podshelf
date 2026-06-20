'use strict';

// ══════════════════════════════════════════════════
//  AUDIOBOOKSHELF API CLIENT
// ══════════════════════════════════════════════════
const ABS = {
  async req(method, path, body) {
    const opts = {
      method,
      headers: {
        'Authorization': `Bearer ${CONFIG.ABS_API_KEY}`,
        'Content-Type': 'application/json',
      },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(CONFIG.ABS_URL + path, opts);
    if (!res.ok) {
      const msg = await res.text().catch(() => res.statusText);
      throw new Error(`ABS ${res.status}: ${msg}`);
    }
    if (res.status === 204) return null;
    return res.json();
  },

  get:   (p)    => ABS.req('GET',    p),
  post:  (p, b) => ABS.req('POST',   p, b),
  patch: (p, b) => ABS.req('PATCH',  p, b),
  del:   (p)    => ABS.req('DELETE', p),

  // ── Libraries ──────────────────────────────────
  async getLibraries() {
    const d = await this.get('/api/libraries');
    return d.libraries || [];
  },

  // ── Podcasts ────────────────────────────────────
  async getPodcasts(libraryId) {
    const d = await this.get(
      `/api/libraries/${libraryId}/items?sort=media.metadata.title&desc=0&minified=1&limit=1000`
    );
    return d.results || [];
  },

  async getPodcast(itemId) {
    return this.get(`/api/items/${itemId}?expanded=1`);
  },

  // ── Progress ────────────────────────────────────
  async getInProgress() {
    const d = await this.get('/api/me/items-in-progress');
    return d.libraryItems || [];
  },

  async syncProgress(libraryItemId, episodeId, currentTime, duration, isFinished = false) {
    return this.post(`/api/me/progress/${libraryItemId}/${episodeId}`, {
      currentTime,
      duration,
      isFinished,
      progress: duration > 0 ? currentTime / duration : 0,
    });
  },

  // ── Play sessions ───────────────────────────────
  async startPlaySession(libraryItemId, episodeId) {
    return this.post(`/api/items/${libraryItemId}/play/${episodeId}`, {
      forceDirectPlay:    true,
      forceTranscode:     false,
      supportedMimeTypes: ['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/webm'],
      mediaPlayer:        'podshelf',
      deviceId:           'podshelf-web',
      deviceName:         'Podshelf Web',
      clientVersion:      '1.0.0',
    });
  },

  async closeSession(sessionId, currentTime) {
    if (!sessionId) return;
    return this.post(`/api/session/${sessionId}/close`, { currentTime }).catch(() => {});
  },

  // ── Playlists ───────────────────────────────────
  async getPlaylists() {
    const d = await this.get('/api/playlists');
    return d.playlists || [];
  },

  async createPlaylist(libraryId, name, description = '') {
    return this.post('/api/playlists', { libraryId, name, description, items: [] });
  },

  async addToPlaylist(playlistId, items) {
    // items: [{libraryItemId, episodeId}]
    return this.post(`/api/playlists/${playlistId}/batch/add`, { items });
  },

  async removeFromPlaylist(playlistId, items) {
    // items: [{libraryItemId, episodeId}]
    return this.post(`/api/playlists/${playlistId}/batch/remove`, { items });
  },

  async deletePlaylist(playlistId) {
    return this.del(`/api/playlists/${playlistId}`);
  },

  async getPlaylist(playlistId) {
    return this.get(`/api/playlists/${playlistId}`);
  },

  // ── Discovery ───────────────────────────────────
  async searchPodcasts(term) {
    const d = await this.get(`/api/podcasts/search?term=${encodeURIComponent(term)}`);
    // ABS can return array or {podcast: [...]}
    if (Array.isArray(d))             return d;
    if (Array.isArray(d?.podcast))    return d.podcast;
    if (d?.podcast && typeof d.podcast === 'object') return [d.podcast];
    return [];
  },

  async subscribeToPodcast(libraryId, feedData) {
    return this.post('/api/podcasts', {
      libraryId,
      url:         feedData.feedUrl,
      title:       feedData.collectionName || feedData.title || '',
      author:      feedData.artistName    || feedData.author || '',
      description: feedData.description  || '',
      feedUrl:     feedData.feedUrl      || '',
      imageUrl:    feedData.artworkUrl   || feedData.imageUrl || '',
      itunesId:    feedData.collectionId || feedData.id || null,
      autoDownloadEpisodes: false,
    });
  },

  // ── URL helpers ─────────────────────────────────
  coverUrl(libraryItemId, w = 200) {
    if (!libraryItemId) return '';
    return `${CONFIG.ABS_URL}/api/items/${libraryItemId}/cover?token=${CONFIG.ABS_API_KEY}&format=webp&width=${w}`;
  },

  audioUrl(contentUrl) {
    if (!contentUrl) return '';
    const base = contentUrl.startsWith('http') ? contentUrl : CONFIG.ABS_URL + contentUrl;
    const sep  = base.includes('?') ? '&' : '?';
    return `${base}${sep}token=${CONFIG.ABS_API_KEY}`;
  },
};

// ══════════════════════════════════════════════════
//  SUPABASE CLIENT  (per-podcast speeds only)
// ══════════════════════════════════════════════════
const DB = {
  _h(extra = {}) {
    return {
      'apikey':        CONFIG.SUPABASE_ANON,
      'Authorization': `Bearer ${CONFIG.SUPABASE_ANON}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=representation',
      ...extra,
    };
  },

  async req(method, path, body, extra = {}) {
    const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1${path}`, {
      method,
      headers: this._h(extra),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`DB ${res.status}`);
    return json;
  },

  async getSpeeds() {
    try {
      const rows = await this.req('GET', '/podcast_speeds?select=podcast_id,speed');
      const map = {};
      (rows || []).forEach(r => { map[r.podcast_id] = parseFloat(r.speed); });
      return map;
    } catch (e) {
      console.warn('Supabase getSpeeds failed:', e.message);
      return {};
    }
  },

  async setSpeed(podcastId, speed) {
    try {
      await this.req(
        'POST',
        '/podcast_speeds',
        { podcast_id: podcastId, speed, updated_at: new Date().toISOString() },
        { 'Prefer': 'resolution=merge-duplicates,return=representation' }
      );
    } catch (e) {
      console.warn('Supabase setSpeed failed:', e.message);
    }
  },
};
