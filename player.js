'use strict';

// ══════════════════════════════════════════════════
//  PLAYER  —  wraps the <audio> element
// ══════════════════════════════════════════════════
const PLAYER = (() => {
  const au = document.getElementById('audio-el');

  const st = {
    podcast:   null,
    episode:   null,
    sessionId: null,
    isPlaying: false,
    speed:     1.0,
    syncTimer: null,
  };

  // ── Formatters ──────────────────────────────────
  function fmtTime(s) {
    if (!s || isNaN(s)) return '0:00';
    const h   = Math.floor(s / 3600);
    const m   = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
    return `${m}:${String(sec).padStart(2,'0')}`;
  }

  // ── SVG icons ───────────────────────────────────
  const PLAY_SVG  = (sz) => `<svg width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
  const PAUSE_SVG = (sz) => `<svg width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;

  // ── UI helpers ──────────────────────────────────
  function setInner(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  function setTxt(id, txt) {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  }

  function setSrc(id, src) {
    const el = document.getElementById(id);
    if (el) el.src = src;
  }

  function setWidth(id, pct) {
    const el = document.getElementById(id);
    if (el) el.style.width = pct + '%';
  }

  function updatePlayBtns() {
    const p = st.isPlaying;
    setInner('mini-pp',  p ? PAUSE_SVG(20) : PLAY_SVG(20));
    setInner('full-pp',  p ? PAUSE_SVG(32) : PLAY_SVG(32));
    setInner('bar-pp',   p ? PAUSE_SVG(18) : PLAY_SVG(18));
  }

  function updateProgressUI() {
    if (!au.duration) return;
    const pct = (au.currentTime / au.duration) * 100;
    setWidth('mini-prog-fill', pct);
    setWidth('seek-fill',      pct);
    setWidth('bar-prog-fill',  pct);

    const cur = fmtTime(au.currentTime);
    const rem = '-' + fmtTime(au.duration - au.currentTime);
    setTxt('seek-cur', cur);
    setTxt('seek-rem', rem);
    setTxt('bar-cur',  cur);
    setTxt('bar-rem',  rem);
  }

  function updateAllSpeedLabels() {
    document.querySelectorAll('.speed-label').forEach(el => {
      el.textContent = st.speed + '×';
    });
  }

  // ── Progress sync ────────────────────────────────
  function syncProgress() {
    if (!st.podcast || !st.episode || !au.currentTime) return;
    ABS.syncProgress(
      st.podcast.id,
      st.episode.id,
      au.currentTime,
      au.duration || 0,
      false
    ).catch(() => {});
  }

  function startSyncTimer() {
    if (st.syncTimer) clearInterval(st.syncTimer);
    st.syncTimer = setInterval(() => {
      if (st.isPlaying) syncProgress();
    }, CONFIG.PROGRESS_SYNC_MS);
  }

  // ── Audio events ─────────────────────────────────
  au.addEventListener('play', () => {
    st.isPlaying = true;
    updatePlayBtns();
  });

  au.addEventListener('pause', () => {
    st.isPlaying = false;
    updatePlayBtns();
    syncProgress();
  });

  au.addEventListener('timeupdate', updateProgressUI);

  au.addEventListener('loadedmetadata', () => {
    setTxt('seek-dur', fmtTime(au.duration));
    setTxt('bar-dur',  fmtTime(au.duration));
  });

  au.addEventListener('ended', async () => {
    st.isPlaying = false;
    updatePlayBtns();
    if (st.podcast && st.episode) {
      await APP.markPlayed(st.podcast.id, st.episode.id, au.duration || 0, true);
    }
    APP.playNextInQueue();
  });

  au.addEventListener('error', () => {
    st.isPlaying = false;
    updatePlayBtns();
    APP.toast('Playback error — check your connection');
  });

  // ── Public API ───────────────────────────────────
  return {
    get podcast()    { return st.podcast;    },
    get episode()    { return st.episode;    },
    get isPlaying()  { return st.isPlaying;  },
    get speed()      { return st.speed;      },
    get currentTime(){ return au.currentTime; },
    get duration()   { return au.duration;   },

    fmtTime,

    isPlayingEpisode(episodeId) { return st.episode?.id === episodeId; },

    async play(podcast, episode) {
      if (!podcast || !episode) return;

      // Toggle if same episode
      if (st.episode?.id === episode.id) {
        this.toggle();
        return;
      }

      // Close previous session
      if (st.sessionId) {
        await ABS.closeSession(st.sessionId, au.currentTime);
        st.sessionId = null;
      }

      st.podcast = podcast;
      st.episode = episode;

      // Apply per-podcast speed
      const spd = APP.getSpeed(podcast.id);
      st.speed = spd;
      au.playbackRate = spd;

      // Show UI elements
      document.getElementById('mini-player')?.classList.remove('hidden');
      document.getElementById('player-bar')?.classList.remove('hidden');
      this.updateMetaUI();
      updatePlayBtns();

      try {
        const session = await ABS.startPlaySession(podcast.id, episode.id);
        st.sessionId = session.id;

        const track = session.audioTracks?.[0];
        if (!track?.contentUrl) throw new Error('No audio track returned by ABS');

        au.src = ABS.audioUrl(track.contentUrl);
        au.playbackRate = st.speed;

        // Resume from last position (ignore if near start)
        if (session.currentTime > 5) {
          au.currentTime = session.currentTime;
        }

        await au.play();
        startSyncTimer();

      } catch (e) {
        console.error('PLAYER.play error:', e);
        APP.toast('Could not start playback: ' + e.message);
        st.isPlaying = false;
        updatePlayBtns();
      }
    },

    toggle() {
      if (!st.episode) return;
      if (st.isPlaying) {
        au.pause();
      } else {
        au.play().catch(e => APP.toast('Playback error: ' + e.message));
      }
    },

    skipBack() {
      au.currentTime = Math.max(0, au.currentTime - CONFIG.SKIP_BACK_S);
    },

    skipFwd() {
      au.currentTime = Math.min(au.duration || Infinity, au.currentTime + CONFIG.SKIP_FWD_S);
    },

    seek(e) {
      const bar = document.getElementById('seek-wrap');
      if (!bar || !au.duration) return;
      const rect = bar.getBoundingClientRect();
      au.currentTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * au.duration;
    },

    barSeek(e) {
      const bar = document.getElementById('bar-seek-wrap');
      if (!bar || !au.duration) return;
      const rect = bar.getBoundingClientRect();
      au.currentTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * au.duration;
    },

    setSpeed(speed) {
      st.speed = speed;
      au.playbackRate = speed;
      updateAllSpeedLabels();
      if (st.podcast) APP.setSpeed(st.podcast.id, speed);
    },

    updateMetaUI() {
      if (!st.podcast || !st.episode) return;
      const cover   = ABS.coverUrl(st.podcast.id, 600);
      const coverSm = ABS.coverUrl(st.podcast.id, 100);
      const show    = APP.podTitle(st.podcast);
      const title   = APP.epTitle(st.episode);

      // Mini player
      setSrc('mini-art',   coverSm);
      setTxt('mini-show',  show);
      setTxt('mini-title', title);

      // Full player
      setSrc('full-art',   cover);
      setTxt('full-show',  show);
      setTxt('full-title', title);
      const bg = document.getElementById('player-bg');
      if (bg) { bg.style.backgroundImage = `url(${cover})`; bg.style.opacity = '1'; }

      // Desktop player bar
      setSrc('bar-art',   coverSm);
      setTxt('bar-show',  show);
      setTxt('bar-title', title);

      updatePlayBtns();
      updateAllSpeedLabels();
    },
  };
})();
