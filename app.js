'use strict';

// ══════════════════════════════════════════════════
//  APP
// ══════════════════════════════════════════════════
const APP = (() => {

  // ── State ────────────────────────────────────────
  const ST = {
    libId:       null,
    podcasts:    [],
    speeds:      {},   // {podcastId: speed} — from Supabase
    allEpsPlId:  null, // "All Episodes" ABS playlist ID
    playlists:   [],   // user's custom ABS playlists (All Episodes excluded)
    inProgress:  [],
    view:        'home',
    podcast:     null, // currently viewed podcast (full, with episodes)
    episodes:    [],   // sorted episodes for current podcast detail view
    epFilter:    'all',
    podSearch:   '',
    queue:       JSON.parse(localStorage.getItem('ps_queue') || '[]'),
    epCache:     JSON.parse(localStorage.getItem('ps_ep_cache') || '{}'),
    // epCache: {podcastId: {count: N, ids: [episodeId,...]}}
  };

  let _sheetCtx   = null; // {podcastId, episodeId}
  let _plPickCtx  = null; // {podcastId, episodeId}

  // ── Helpers ──────────────────────────────────────
  function podTitle(p) {
    return p?.media?.metadata?.title || p?.metadata?.title || 'Unknown Podcast';
  }

  function epTitle(e) {
    return e?.title || 'Unknown Episode';
  }

  function epDur(e) {
    return e?.audioFile?.duration || e?.duration || 0;
  }

  function fmtDur(s) {
    if (!s) return '';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  function fmtDate(ts) {
    if (!ts) return '';
    const d    = new Date(ts * 1000);
    const now  = new Date();
    const diff = (now - d) / 1000;
    if (diff < 86400)   return 'Today';
    if (diff < 172800)  return 'Yesterday';
    if (diff < 604800)  return d.toLocaleDateString('en-US', { weekday: 'short' });
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function saveQueue()   { localStorage.setItem('ps_queue',      JSON.stringify(ST.queue));   }
  function saveEpCache() { localStorage.setItem('ps_ep_cache',   JSON.stringify(ST.epCache)); }

  function getSpeed(podcastId)        { return ST.speeds[podcastId] ?? 1.0; }
  function setSpeedLocal(id, spd)     { ST.speeds[id] = spd; DB.setSpeed(id, spd); }

  function greet() {
    const h = new Date().getHours();
    return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  }

  // ── Toast ────────────────────────────────────────
  let _toastTimer;
  function toast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { t.style.opacity = '0'; }, 2500);
  }

  // ── Overlay helpers ──────────────────────────────
  function openOverlay(id)  { document.getElementById(id)?.classList.add('open');    }
  function closeOverlay(id) { document.getElementById(id)?.classList.remove('open'); }

  // ── Navigation ───────────────────────────────────
  function navigate(view, data) {
    ST.view = view;
    document.querySelectorAll('.nav-tab, .sidebar-link').forEach(el => {
      el.classList.toggle('active', el.dataset.view === view);
    });
    const V = document.getElementById('view');
    if (V) { V.scrollTop = 0; V.classList.remove('fade'); void V.offsetWidth; V.classList.add('fade'); }

    switch (view) {
      case 'home':     renderHome(V);           break;
      case 'podcasts': renderPodcasts(V);       break;
      case 'detail':   renderDetail(V, data);   break;
      case 'queue':    renderQueue(V);          break;
      case 'episodes': renderEpisodes(V);       break;
      case 'discover': renderDiscover(V);       break;
      case 'profile':  renderProfile(V);        break;
      case 'playlist': renderPlaylist(V, data); break;
    }
  }

  function refreshView() { navigate(ST.view, ST.podcast); }

  // ── Episode row ──────────────────────────────────
  function epRow(ep, pod, opts = {}) {
    const isNow = PLAYER.isPlayingEpisode(ep.id);
    const prog  = ep.userEpisodeProgress;
    const pct   = prog?.duration > 0 ? Math.round(prog.currentTime / prog.duration * 100) : 0;
    const done  = !!prog?.isFinished;
    const isNew = !prog?.currentTime && !done;
    const dur   = fmtDur(epDur(ep));
    const pub   = ep.publishedAt ? fmtDate(ep.publishedAt / 1000) : '';

    return `<div class="ep-row${isNow ? ' now-playing' : ''}">
      <img class="ep-art" src="${ABS.coverUrl(pod.id)}" alt="" loading="lazy"
        onerror="this.style.opacity='.15'">
      <div class="ep-body" onclick="APP.playEp('${pod.id}','${ep.id}')">
        ${opts.showPod ? `<div class="ep-show">${podTitle(pod)}</div>` : ''}
        <div class="ep-title">${epTitle(ep)}</div>
        <div class="ep-meta">
          ${pub ? `<span>${pub}</span>` : ''}
          ${dur ? `<span>·</span><span>${dur}</span>` : ''}
          ${pct > 0 && !done ? `<span>·</span><span class="pct-lbl">${pct}%</span>` : ''}
          ${done ? `<span class="done-badge">✓ played</span>` : ''}
          ${isNew ? `<span class="new-badge">NEW</span>` : ''}
        </div>
        ${pct > 0 && !done
          ? `<div class="ep-prog"><div class="ep-prog-fill" style="width:${pct}%"></div></div>`
          : ''}
      </div>
      <div class="ep-acts">
        <button class="ib ib-sm${isNow && PLAYER.isPlaying ? ' ib-accent' : ''}"
          onclick="APP.playEp('${pod.id}','${ep.id}')" aria-label="Play">
          ${isNow && PLAYER.isPlaying
            ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`
            : `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`}
        </button>
        <button class="ib ib-sm" onclick="APP.openSheet('${pod.id}','${ep.id}')" aria-label="Options">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2
              2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
          </svg>
        </button>
      </div>
    </div>`;
  }

  // ── VIEW: HOME ───────────────────────────────────
  async function renderHome(V) {
    V.innerHTML = `<div class="ph">
      <div class="ph-row">
        <div>
          <div class="ph-title">Good ${greet()}, Greg</div>
          <div class="ph-sub">${ST.podcasts.length} podcast${ST.podcasts.length !== 1 ? 's' : ''}</div>
        </div>
        <button class="ib" onclick="APP.refreshHome()" aria-label="Refresh">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8
              c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6
              c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
          </svg>
        </button>
      </div>
    </div>
    <div id="home-body"><div class="loading"><div class="spin"></div></div></div>`;
    loadHomeBody();
  }

  async function loadHomeBody() {
    ST.inProgress = await ABS.getInProgress().catch(() => []);
    const B = document.getElementById('home-body');
    if (!B) return;

    const podIds = new Set(ST.podcasts.map(p => p.id));
    const cont   = ST.inProgress.filter(i =>
      podIds.has(i.libraryItemId || i.id) && i.recentEpisode
    );
    const recent = ST.podcasts.slice(0, 9);

    B.innerHTML = `
      ${cont.length ? `
      <div class="sec">
        <div class="sec-hd">
          <div class="sec-title">Continue Listening</div>
          <button class="sec-link" onclick="APP.nav('episodes')">See all</button>
        </div>
        <div class="h-scroll">
          ${cont.map(i => {
            const ep   = i.recentEpisode;
            const pod  = ST.podcasts.find(p => p.id === (i.libraryItemId || i.id)) || i;
            const prog = i.userMediaProgress;
            const pct  = prog?.duration > 0 ? Math.round(prog.currentTime / prog.duration * 100) : 0;
            const left = prog?.duration > 0 ? fmtDur(prog.duration - prog.currentTime) : '';
            return `<div class="cont-card" onclick="APP.playEp('${pod.id}','${ep.id}')">
              <img class="cont-art" src="${ABS.coverUrl(pod.id)}" alt=""
                onerror="this.style.opacity='.15'">
              <div class="cont-info">
                <div class="cont-pod">${podTitle(pod)}</div>
                <div class="cont-title">${epTitle(ep)}</div>
                <div class="cont-bar"><div class="cont-fill" style="width:${pct}%"></div></div>
                ${left ? `<div class="cont-left">${left} left</div>` : ''}
              </div>
              <div class="cont-play">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                  <path d="M8 5v14l11-7z"/>
                </svg>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>` : ''}

      <div class="sec">
        <div class="sec-hd">
          <div class="sec-title">Your Podcasts</div>
          <button class="sec-link" onclick="APP.nav('podcasts')">See all</button>
        </div>
        <div class="pod-grid">${recent.map(podCard).join('')}</div>
      </div>

      ${ST.queue.length ? `
      <div class="sec">
        <div class="sec-hd">
          <div class="sec-title">Up Next</div>
          <button class="sec-link" onclick="APP.nav('queue')">View queue</button>
        </div>
        <div class="ep-list">
          ${ST.queue.slice(0, 3).map((q, i) => `
            <div class="q-row">
              <img class="q-art" src="${q.artUrl || ''}" alt=""
                onerror="this.style.opacity='.15'">
              <div class="q-info">
                <div class="q-pod">${q.podcast}</div>
                <div class="q-title">${q.title}</div>
                <div class="q-dur">${fmtDur(q.duration)}</div>
              </div>
              <button class="ib ib-sm ib-accent" onclick="APP.playQItem(${i})" aria-label="Play">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z"/>
                </svg>
              </button>
            </div>`).join('')}
        </div>
      </div>` : ''}
    `;
  }

  function podCard(p) {
    return `<div class="pod-card" onclick="APP.openPod('${p.id}')">
      <img class="pod-art" src="${ABS.coverUrl(p.id)}" alt="" loading="lazy"
        onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
      <div class="pod-art-ph" style="display:none" aria-hidden="true">🎙</div>
      <div class="pod-name">${podTitle(p)}</div>
      <div class="pod-cnt">${p.media?.numEpisodes ?? '?'} eps</div>
    </div>`;
  }

  // ── VIEW: PODCASTS ───────────────────────────────
  function renderPodcasts(V) {
    V.innerHTML = `<div class="ph">
      <div class="ph-row">
        <div>
          <div class="ph-title">Podcasts</div>
          <div class="ph-sub">${ST.podcasts.length} shows</div>
        </div>
        <button class="btn-accent-sm" onclick="APP.nav('discover')">+ Add</button>
      </div>
    </div>
    <div class="search-wrap">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0
          3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5
          9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
      </svg>
      <input type="search" placeholder="Search your library…"
        value="${ST.podSearch}" oninput="APP.filterPods(this.value)">
    </div>
    <div class="pod-grid" id="pod-grid">${podGrid()}</div>`;
  }

  function podGrid() {
    let list = ST.podcasts;
    if (ST.podSearch) {
      const q = ST.podSearch.toLowerCase();
      list = list.filter(p => podTitle(p).toLowerCase().includes(q));
    }
    if (!list.length) return `
      <div class="empty" style="grid-column:1/-1">
        <div class="empty-icon">🔍</div>
        <div>No podcasts found</div>
      </div>`;
    return list.map(podCard).join('');
  }

  // ── VIEW: PODCAST DETAIL ─────────────────────────
  async function openPod(id) {
    const V = document.getElementById('view');
    V.innerHTML = '<div class="loading"><div class="spin"></div></div>';
    try {
      const pod = await ABS.getPodcast(id);
      ST.podcast  = pod;
      ST.episodes = [...(pod.media?.episodes || [])].sort(
        (a, b) => (b.publishedAt || 0) - (a.publishedAt || 0)
      );
      ST.epFilter = 'all';
      renderDetail(V, pod);
    } catch (e) {
      V.innerHTML = `<div class="empty">
        <div class="empty-icon">⚠️</div><div>Failed to load podcast</div>
        <button class="btn-primary" style="margin-top:12px;width:auto;padding:10px 20px"
          onclick="APP.openPod('${id}')">Retry</button>
      </div>`;
    }
  }

  function renderDetail(V, pod) {
    if (!pod) return;
    ST.view = 'detail';
    document.querySelectorAll('.nav-tab, .sidebar-link').forEach(el => el.classList.remove('active'));
    const desc = (pod.media?.metadata?.description || '').replace(/<[^>]*>/g, '');
    const spd  = getSpeed(pod.id);

    V.innerHTML = `<div class="det-hd">
      <button class="det-back" onclick="APP.nav('podcasts')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
        </svg>
        Podcasts
      </button>
      <div class="det-hero">
        <img class="det-art" src="${ABS.coverUrl(pod.id, 300)}" alt=""
          onerror="this.style.opacity='.15'">
        <div class="det-meta">
          <div class="det-title">${podTitle(pod)}</div>
          <div class="det-author">${pod.media?.metadata?.author || ''}</div>
          <div class="det-count">${ST.episodes.length} episodes</div>
          <div class="det-speed-row">
            <span class="det-speed-lbl">Speed:</span>
            <button class="speed-chip speed-label"
              onclick="APP.openSpeedPicker('${pod.id}')">${spd}×</button>
          </div>
        </div>
      </div>
      ${desc ? `
        <div class="det-desc" id="det-desc">${desc}</div>
        <button class="det-desc-btn" id="det-desc-btn" onclick="APP.toggleDesc()">
          Show more
        </button>` : ''}
      <div class="det-btns">
        <button class="btn-primary" onclick="APP.playLatest()">▶ Play Latest</button>
        <button class="btn-ghost"   onclick="APP.queueAll()">+ Queue All</button>
      </div>
    </div>
    <div class="chips">
      <div class="chip on"  onclick="APP.filterEps('all',this)">All</div>
      <div class="chip"     onclick="APP.filterEps('new',this)">Unplayed</div>
      <div class="chip"     onclick="APP.filterEps('prog',this)">In Progress</div>
      <div class="chip"     onclick="APP.filterEps('done',this)">Finished</div>
    </div>
    <div class="ep-list" id="det-eps">${epListHtml(ST.episodes, pod)}</div>`;

    V.scrollTop = 0;
  }

  function epListHtml(eps, pod) {
    if (!eps.length) return `
      <div class="empty"><div class="empty-icon">📭</div><div>No episodes</div></div>`;
    return eps.map(e => epRow(e, pod)).join('');
  }

  // ── VIEW: EPISODES (in-progress) ─────────────────
  async function renderEpisodes(V) {
    V.innerHTML = `<div class="ph"><div class="ph-title">Episodes</div></div>
      <div class="loading"><div class="spin"></div><div>Loading…</div></div>`;

    ST.inProgress = await ABS.getInProgress().catch(() => []);
    const podIds  = new Set(ST.podcasts.map(p => p.id));
    const items   = ST.inProgress.filter(
      i => podIds.has(i.libraryItemId || i.id) && i.recentEpisode
    );

    V.innerHTML = `<div class="ph"><div class="ph-title">Episodes</div></div>
      ${items.length ? `<div class="ep-list">
        ${items.map(i => {
          const ep   = i.recentEpisode;
          const pod  = ST.podcasts.find(p => p.id === (i.libraryItemId || i.id)) || i;
          const prog = i.userMediaProgress;
          const pct  = prog?.duration > 0 ? Math.round(prog.currentTime / prog.duration * 100) : 0;
          return epRow({ ...ep, userEpisodeProgress: prog }, pod, { showPod: true });
        }).join('')}
      </div>`
      : `<div class="empty">
          <div class="empty-icon">📋</div>
          <div>No episodes in progress</div>
          <div class="empty-sub">Open a podcast to start listening</div>
        </div>`}`;
  }

  // ── VIEW: QUEUE ──────────────────────────────────
  function renderQueue(V) {
    const nowPod = PLAYER.podcast;
    const nowEp  = PLAYER.episode;

    V.innerHTML = `<div class="ph">
      <div class="ph-row">
        <div>
          <div class="ph-title">Up Next</div>
          <div class="ph-sub">${ST.queue.length} episode${ST.queue.length !== 1 ? 's' : ''}</div>
        </div>
        ${ST.queue.length
          ? `<button class="sec-link" onclick="APP.clearQueue()">Clear</button>` : ''}
      </div>
    </div>

    ${nowEp ? `
      <div class="now-wrap">
        <div class="now-label">NOW PLAYING</div>
        <div class="cont-card now-card" onclick="APP.openFullPlayer()"
          style="width:100%;border:1px solid var(--accent-dim);background:var(--accent-bg)">
          <img class="cont-art" src="${ABS.coverUrl(nowPod?.id || '')}" alt="">
          <div class="cont-info">
            <div class="cont-pod">${podTitle(nowPod)}</div>
            <div class="cont-title">${epTitle(nowEp)}</div>
          </div>
          <button class="cont-play" onclick="event.stopPropagation();PLAYER.toggle()" aria-label="Play/Pause">
            ${PLAYER.isPlaying
              ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`
              : `<svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>`}
          </button>
        </div>
      </div>` : ''}

    ${ST.queue.length ? `
      <div class="sec-label-row">QUEUE (${ST.queue.length})</div>
      <div class="ep-list">
        ${ST.queue.map((q, i) => `
          <div class="q-row">
            <img class="q-art" src="${q.artUrl || ''}" alt=""
              onerror="this.style.opacity='.15'">
            <div class="q-info" onclick="APP.playQItem(${i})">
              <div class="q-pod">${q.podcast}</div>
              <div class="q-title">${q.title}</div>
              <div class="q-dur">${fmtDur(q.duration)}</div>
            </div>
            <div style="display:flex;gap:6px">
              <button class="ib ib-sm ib-accent" onclick="APP.playQItem(${i})" aria-label="Play">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z"/>
                </svg>
              </button>
              <button class="ib ib-sm" onclick="APP.removeQItem(${i})" aria-label="Remove">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19
                    12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
              </button>
            </div>
          </div>`).join('')}
      </div>` : `
      <div class="q-empty">
        <div class="q-empty-icon">⏭</div>
        <div style="font-size:17px;font-weight:700">Queue is empty</div>
        <div style="font-size:13px;color:var(--text3)">Add episodes from any podcast</div>
      </div>`}

    <div class="sec" style="padding:0 20px;margin-top:24px">
      <div class="sec-hd" style="padding:0 0 12px">
        <div class="sec-title">Playlists</div>
        <button class="sec-link" onclick="APP.promptNewPlaylist()">+ New</button>
      </div>
      ${playlistCards()}
    </div>`;
  }

  function playlistCards() {
    if (!ST.playlists.length) return `
      <div style="color:var(--text2);font-size:14px;padding:4px 0">No playlists yet</div>`;
    return ST.playlists.map(pl => `
      <div class="pl-card" onclick="APP.openPlaylist('${pl.id}')">
        <div class="pl-icon" aria-hidden="true">🎵</div>
        <div class="pl-info">
          <div class="pl-name">${pl.name}</div>
          <div class="pl-cnt">${pl.items?.length || 0} episodes</div>
        </div>
        <button class="ib ib-sm" onclick="event.stopPropagation();APP.deletePlaylist('${pl.id}')"
          aria-label="Delete playlist">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19
              12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      </div>`).join('');
  }

  // ── VIEW: PLAYLIST DETAIL ────────────────────────
  async function openPlaylist(id) {
    const V = document.getElementById('view');
    V.innerHTML = '<div class="loading"><div class="spin"></div></div>';
    try {
      const all = await ABS.getPlaylists();
      const pl  = all.find(p => p.id === id);
      if (pl) renderPlaylist(V, pl);
    } catch (e) {
      V.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div>
        <div>Failed to load playlist</div></div>`;
    }
  }

  function renderPlaylist(V, pl) {
    ST.view = 'playlist';
    document.querySelectorAll('.nav-tab, .sidebar-link').forEach(el => el.classList.remove('active'));
    document.querySelector('[data-view="queue"]')?.classList.add('active');

    V.innerHTML = `<div class="det-hd" style="padding-bottom:0">
      <button class="det-back" onclick="APP.nav('queue')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
        </svg>
        Up Next
      </button>
      <div class="ph-row" style="margin-bottom:16px">
        <div>
          <div class="ph-title">${pl.name}</div>
          <div class="ph-sub">${pl.items?.length || 0} episodes</div>
        </div>
        <button class="btn-primary" style="width:auto;padding:10px 16px;font-size:13px"
          onclick="APP.playPlaylist('${pl.id}')">▶ Play All</button>
      </div>
    </div>
    <div class="ep-list">
      ${(pl.items || []).map(item => {
        const pod = ST.podcasts.find(p => p.id === item.libraryItemId);
        const ep  = item.episode;
        return `<div class="q-row">
          <img class="q-art" src="${ABS.coverUrl(item.libraryItemId)}" alt=""
            onerror="this.style.opacity='.15'">
          <div class="q-info" onclick="APP.playEp('${item.libraryItemId}','${item.episodeId}')">
            <div class="q-pod">${pod ? podTitle(pod) : ''}</div>
            <div class="q-title">${ep ? epTitle(ep) : item.episodeId}</div>
            <div class="q-dur">${ep ? fmtDur(epDur(ep)) : ''}</div>
          </div>
          <div style="display:flex;gap:6px">
            <button class="ib ib-sm ib-accent"
              onclick="APP.playEp('${item.libraryItemId}','${item.episodeId}')" aria-label="Play">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </button>
            <button class="ib ib-sm"
              onclick="APP.rmFromPl('${pl.id}','${item.libraryItemId}','${item.episodeId}')"
              aria-label="Remove from playlist">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19
                  12 13.41 17.59 19 19 17.59 13.41 12z"/>
              </svg>
            </button>
          </div>
        </div>`;
      }).join('')}
      ${!pl.items?.length
        ? `<div class="empty"><div class="empty-icon">🎵</div><div>Playlist is empty</div></div>`
        : ''}
    </div>`;
    V.scrollTop = 0;
  }

  // ── VIEW: DISCOVER ───────────────────────────────
  function renderDiscover(V) {
    V.innerHTML = `<div class="ph">
      <div class="ph-title">Discover</div>
      <div class="ph-sub">Search iTunes · Podcast Index</div>
    </div>
    <div class="search-wrap">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0
          3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5
          9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
      </svg>
      <input type="search" id="disc-input" placeholder="Search for podcasts…"
        onkeydown="if(event.key==='Enter')APP.doDiscover(this.value)">
    </div>
    <div id="disc-results">
      <div class="empty" style="padding-top:40px">
        <div class="empty-icon">🔍</div>
        <div>Search to find and subscribe to podcasts</div>
      </div>
    </div>`;
    setTimeout(() => document.getElementById('disc-input')?.focus(), 50);
  }

  async function doDiscover(term) {
    const R = document.getElementById('disc-results');
    if (!R || !term?.trim()) return;
    R.innerHTML = '<div class="loading"><div class="spin"></div><div>Searching…</div></div>';
    try {
      const results = await ABS.searchPodcasts(term.trim());
      if (!results.length) {
        R.innerHTML = `<div class="empty">
          <div class="empty-icon">😕</div><div>No results for "${term}"</div>
        </div>`;
        return;
      }
      R.innerHTML = `<div class="ep-list">
        ${results.slice(0, 25).map((r, i) => {
          const safe = encodeURIComponent(JSON.stringify(r));
          return `<div class="disc-row">
            <img class="ep-art" src="${r.artworkUrl || r.imageUrl || ''}" alt=""
              loading="lazy" onerror="this.style.opacity='.1'">
            <div class="ep-body" style="cursor:default">
              <div class="ep-title">${r.collectionName || r.title || 'Unknown'}</div>
              <div class="ep-meta">
                <span>${r.artistName || r.author || ''}</span>
                ${r.trackCount ? `<span>·</span><span>${r.trackCount} eps</span>` : ''}
              </div>
            </div>
            <button class="btn-accent-sm" onclick="APP.subscribe(${i})"
              id="sub-btn-${i}" data-feed='${safe}'>Subscribe</button>
          </div>`;
        }).join('')}
      </div>`;
    } catch (e) {
      R.innerHTML = `<div class="empty">
        <div class="empty-icon">⚠️</div><div>Search failed — check ABS connection</div>
      </div>`;
    }
  }

  async function subscribe(idx) {
    const btn = document.getElementById(`sub-btn-${idx}`);
    if (!btn) return;
    const feedData = JSON.parse(decodeURIComponent(btn.dataset.feed));
    btn.textContent = '…';
    btn.disabled = true;
    try {
      await ABS.subscribeToPodcast(ST.libId, feedData);
      btn.textContent = '✓ Added';
      btn.style.background = 'var(--teal)';
      ST.podcasts = await ABS.getPodcasts(ST.libId).catch(() => ST.podcasts);
      toast(`Subscribed to ${feedData.collectionName || feedData.title}`);
    } catch (e) {
      btn.textContent = 'Failed';
      btn.disabled = false;
      toast('Subscribe failed — check ABS logs');
    }
  }

  // ── VIEW: PROFILE ────────────────────────────────
  function renderProfile(V) {
    V.innerHTML = `<div class="ph"><div class="ph-title">Profile</div></div>
    <div style="padding:0 20px 24px">
      <div class="profile-card">
        <div class="profile-avatar">G</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:18px;font-weight:700">Greg</div>
          <div style="font-size:12px;color:var(--text2);margin-top:2px;word-break:break-all">
            ${CONFIG.ABS_URL}
          </div>
        </div>
        <button class="btn-ghost" style="width:auto;padding:8px 14px;font-size:13px"
          onclick="APP.logout()">Sign out</button>
      </div>
    </div>

    <div class="settings-label">Library</div>
    <div class="settings-group">
      <div class="s-item">
        <div class="s-ico" aria-hidden="true">🎙</div>
        <div class="s-lbl">Podcast Library</div>
        <div class="s-val">${ST.podcasts.length} shows</div>
      </div>
      <div class="s-item" onclick="APP.refreshLib()">
        <div class="s-ico" aria-hidden="true">🔄</div>
        <div class="s-lbl">Refresh Library</div>
      </div>
      <div class="s-item" onclick="APP.triggerSync()">
        <div class="s-ico" aria-hidden="true">📋</div>
        <div class="s-lbl">Sync "All Episodes" Now</div>
        <div class="s-val" id="sync-lbl">Tap to run</div>
      </div>
    </div>

    <div style="height:20px"></div>
    <div class="settings-label">Playback</div>
    <div class="settings-group">
      <div class="s-item">
        <div class="s-ico" aria-hidden="true">⏮</div>
        <div class="s-lbl">Skip Back</div>
        <div class="s-val">${CONFIG.SKIP_BACK_S}s</div>
      </div>
      <div class="s-item">
        <div class="s-ico" aria-hidden="true">⏭</div>
        <div class="s-lbl">Skip Forward</div>
        <div class="s-val">${CONFIG.SKIP_FWD_S}s</div>
      </div>
      <div class="s-item" onclick="APP.openSpeedPicker(PLAYER.podcast?.id)">
        <div class="s-ico" aria-hidden="true">⚡</div>
        <div class="s-lbl">Current Speed</div>
        <div class="s-val speed-label">${PLAYER.speed}×</div>
      </div>
    </div>

    <div style="height:20px"></div>
    <div class="settings-label">About</div>
    <div class="settings-group">
      <div class="s-item">
        <div class="s-ico" aria-hidden="true">📻</div>
        <div class="s-lbl">Podshelf</div>
        <div class="s-val">v1.0</div>
      </div>
      <div class="s-item">
        <div class="s-ico" aria-hidden="true">🗄</div>
        <div class="s-lbl">ABS Version</div>
        <div class="s-val">2.35.1</div>
      </div>
    </div>
    <div style="height:48px"></div>`;
  }

  // ── SPEED PICKER ─────────────────────────────────
  function openSpeedPicker(podcastId) {
    const list    = document.getElementById('speed-list');
    const titleEl = document.getElementById('speed-sheet-pod');
    if (!list) return;

    const current = getSpeed(podcastId || '');
    if (titleEl) {
      const pod = ST.podcasts.find(p => p.id === podcastId);
      titleEl.textContent = pod ? podTitle(pod) : 'Current Podcast';
    }

    list.innerHTML = CONFIG.SPEEDS.map(s => `
      <div class="sheet-item${s === current ? ' sheet-selected' : ''}"
        onclick="APP.pickSpeed(${JSON.stringify(podcastId)}, ${s})">
        <div style="font-size:18px;font-weight:700;color:${s === current ? 'var(--accent)' : 'var(--text)'}">${s}×</div>
        ${s === current
          ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="var(--accent)">
               <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
             </svg>` : ''}
      </div>`).join('');
    openOverlay('speed-overlay');
  }

  function pickSpeed(podcastId, speed) {
    PLAYER.setSpeed(speed);
    if (podcastId) setSpeedLocal(podcastId, speed);
    closeOverlay('speed-overlay');
    // Update speed chip in detail header if visible
    document.querySelectorAll('.speed-chip').forEach(el => { el.textContent = speed + '×'; });
    toast(`Speed set to ${speed}×`);
  }

  // ── EPISODE ACTIONS SHEET ────────────────────────
  function openSheet(podcastId, episodeId) {
    _sheetCtx = { podcastId, episodeId };
    const titleEl = document.getElementById('sheet-ep-title');
    const listEl  = document.getElementById('sheet-list');
    if (!titleEl || !listEl) return;

    // Try to get episode title from cached state
    let title = 'Episode';
    if (ST.podcast?.id === podcastId) {
      const ep = ST.episodes.find(e => e.id === episodeId);
      if (ep) title = epTitle(ep);
    }
    titleEl.textContent = title;

    listEl.innerHTML = `
      <div class="sheet-item" onclick="APP._sheetPlay()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z"/>
        </svg>
        <div class="sheet-lbl">Play Now</div>
      </div>
      <div class="sheet-item" onclick="APP._sheetQueue()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M3 18h13v-2H3v2zm0-5h10v-2H3v2zm0-7v2h13V6H3zm18 9.59L17.42
            12 21 8.41 19.59 7l-5 5 5 5L21 15.59z"/>
        </svg>
        <div class="sheet-lbl">Add to Up Next</div>
      </div>
      <div class="sheet-item" onclick="APP._sheetAddPl()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5
            c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/>
        </svg>
        <div class="sheet-lbl">Add to Playlist</div>
      </div>
      <div class="sheet-item" onclick="APP._sheetMarkPlayed()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
        </svg>
        <div class="sheet-lbl">Mark as Played</div>
      </div>`;
    openOverlay('ep-actions-overlay');
  }

  async function _sheetPlay() {
    const ctx = _sheetCtx;
    closeOverlay('ep-actions-overlay');
    if (ctx) await playEp(ctx.podcastId, ctx.episodeId);
  }

  async function _sheetQueue() {
    const ctx = _sheetCtx;
    closeOverlay('ep-actions-overlay');
    if (!ctx) return;
    // Get episode info from cache
    let title = 'Episode', podName = '', duration = 0, artUrl = '';
    if (ST.podcast?.id === ctx.podcastId) {
      const ep = ST.episodes.find(e => e.id === ctx.episodeId);
      if (ep) { title = epTitle(ep); duration = epDur(ep); }
      podName = podTitle(ST.podcast);
      artUrl  = ABS.coverUrl(ctx.podcastId);
    }
    addToQueue(ctx.podcastId, ctx.episodeId, title, podName, duration, artUrl);
  }

  function _sheetAddPl() {
    const ctx = _sheetCtx;
    closeOverlay('ep-actions-overlay');
    if (ctx) openPlPicker(ctx.podcastId, ctx.episodeId);
  }

  async function _sheetMarkPlayed() {
    const ctx = _sheetCtx;
    closeOverlay('ep-actions-overlay');
    if (!ctx) return;
    let duration = 0;
    if (ST.podcast?.id === ctx.podcastId) {
      const ep = ST.episodes.find(e => e.id === ctx.episodeId);
      if (ep) duration = epDur(ep);
    }
    await markPlayed(ctx.podcastId, ctx.episodeId, duration, false);
  }

  // ── PLAYLIST PICKER ──────────────────────────────
  function openPlPicker(podcastId, episodeId) {
    _plPickCtx = { podcastId, episodeId };
    const listEl = document.getElementById('pl-pick-list');
    if (!listEl) return;
    listEl.innerHTML = ST.playlists.length
      ? ST.playlists.map(pl => `
          <div class="sheet-item" onclick="APP.addToPl('${pl.id}')">
            <div style="font-size:20px" aria-hidden="true">🎵</div>
            <div class="sheet-lbl">
              ${pl.name}
              <span style="color:var(--text3)">(${pl.items?.length || 0})</span>
            </div>
          </div>`).join('')
      : `<div style="color:var(--text2);font-size:14px;padding:8px 0">
           No playlists yet — create one below
         </div>`;
    document.getElementById('pl-new-input').value = '';
    openOverlay('playlist-overlay');
  }

  async function addToPl(playlistId) {
    if (!_plPickCtx) return;
    const { podcastId, episodeId } = _plPickCtx;
    closeOverlay('playlist-overlay');
    try {
      await ABS.addToPlaylist(playlistId, [{ libraryItemId: podcastId, episodeId }]);
      await refreshPlaylists();
      const pl = ST.playlists.find(p => p.id === playlistId);
      toast(`Added to ${pl?.name || 'playlist'}`);
    } catch (e) {
      toast('Failed to add to playlist');
    }
  }

  async function createPlFromInput() {
    const input = document.getElementById('pl-new-input');
    const name  = input?.value?.trim();
    if (!name) return;
    try {
      const pl = await ABS.createPlaylist(ST.libId, name);
      await refreshPlaylists();
      if (_plPickCtx) {
        await addToPl(pl.id);
      } else {
        closeOverlay('playlist-overlay');
        toast(`"${name}" created`);
      }
    } catch (e) {
      toast('Failed to create playlist');
    }
  }

  async function refreshPlaylists() {
    const all   = await ABS.getPlaylists();
    ST.allEpsPlId = all.find(p => p.name === CONFIG.ALL_EPS_PLAYLIST)?.id || ST.allEpsPlId;
    ST.playlists  = all.filter(p => p.name !== CONFIG.ALL_EPS_PLAYLIST);
  }

  // ── MARK AS PLAYED ───────────────────────────────
  // Called from: episode sheet, full player Done btn, audio ended event
  async function markPlayed(podcastId, episodeId, duration = 0, fromPlayer = false) {
    try {
      // 1. Sync to ABS as finished
      await ABS.syncProgress(podcastId, episodeId, duration, duration, true);

      // 2. Remove from All Episodes playlist
      if (ST.allEpsPlId) {
        await ABS.removeFromPlaylist(ST.allEpsPlId, [{ libraryItemId: podcastId, episodeId }])
          .catch(() => {}); // not fatal if already absent
      }

      // 3. Remove from local queue if present
      const qi = ST.queue.findIndex(q =>
        q.podcastId === podcastId && q.episodeId === episodeId
      );
      if (qi >= 0) { ST.queue.splice(qi, 1); saveQueue(); }

      if (!fromPlayer) {
        toast('Marked as played');
        refreshView();
      }
    } catch (e) {
      console.error('markPlayed error:', e);
      toast('Error marking as played');
    }
  }

  // ── PLAY EPISODE BY ID ───────────────────────────
  async function playEp(podcastId, episodeId) {
    let pod     = ST.podcasts.find(p => p.id === podcastId);
    let episode = null;

    // Try from current detail view cache
    if (ST.podcast?.id === podcastId && ST.podcast?.media?.episodes) {
      episode = ST.episodes.find(e => e.id === episodeId);
      pod     = ST.podcast;
    }

    // Fetch full podcast if episode not cached
    if (!episode) {
      try {
        const full = await ABS.getPodcast(podcastId);
        episode    = full.media?.episodes?.find(e => e.id === episodeId);
        pod        = full;
        // Update cached detail if this is the viewed podcast
        if (ST.podcast?.id === podcastId) {
          ST.podcast  = full;
          ST.episodes = [...(full.media?.episodes || [])].sort(
            (a, b) => (b.publishedAt || 0) - (a.publishedAt || 0)
          );
        }
      } catch (e) {
        toast('Could not load episode');
        return;
      }
    }

    if (!episode) { toast('Episode not found'); return; }
    await PLAYER.play(pod, episode);
  }

  // ── QUEUE ACTIONS ────────────────────────────────
  function addToQueue(podcastId, episodeId, title, podcast, duration, artUrl) {
    if (ST.queue.some(q => q.podcastId === podcastId && q.episodeId === episodeId)) {
      toast('Already in queue');
      return;
    }
    ST.queue.push({ podcastId, episodeId, title, podcast, duration, artUrl });
    saveQueue();
    toast('Added to Up Next');
  }

  async function playQItem(index) {
    const item = ST.queue[index];
    if (!item) return;
    ST.queue.splice(index, 1);
    saveQueue();
    await playEp(item.podcastId, item.episodeId);
    if (ST.view === 'queue') renderQueue(document.getElementById('view'));
  }

  async function playNextInQueue() {
    if (!ST.queue.length) return;
    const item = ST.queue.shift();
    saveQueue();
    try {
      await playEp(item.podcastId, item.episodeId);
    } catch (e) {
      playNextInQueue(); // try next on failure
    }
  }

  function removeQItem(index) {
    ST.queue.splice(index, 1);
    saveQueue();
    renderQueue(document.getElementById('view'));
  }

  function clearQueue() {
    if (!confirm('Clear the entire queue?')) return;
    ST.queue = [];
    saveQueue();
    renderQueue(document.getElementById('view'));
  }

  // ── PLAYLIST ACTIONS ─────────────────────────────
  async function deletePlaylist(id) {
    if (!confirm('Delete this playlist?')) return;
    try {
      await ABS.deletePlaylist(id);
      await refreshPlaylists();
      navigate('queue');
      toast('Playlist deleted');
    } catch (e) {
      toast('Failed to delete playlist');
    }
  }

  async function playPlaylist(id) {
    try {
      const all  = await ABS.getPlaylists();
      const pl   = all.find(p => p.id === id);
      if (!pl?.items?.length) { toast('Playlist is empty'); return; }
      const newQ = pl.items.map(item => ({
        podcastId: item.libraryItemId,
        episodeId: item.episodeId,
        title:     item.episode ? epTitle(item.episode) : 'Episode',
        podcast:   item.libraryItem ? podTitle(item.libraryItem) : '',
        duration:  item.episode ? epDur(item.episode) : 0,
        artUrl:    ABS.coverUrl(item.libraryItemId),
      }));
      ST.queue = [...newQ, ...ST.queue];
      saveQueue();
      await playQItem(0);
    } catch (e) {
      toast('Failed to play playlist');
    }
  }

  async function rmFromPl(playlistId, libraryItemId, episodeId) {
    try {
      await ABS.removeFromPlaylist(playlistId, [{ libraryItemId, episodeId }]);
      await openPlaylist(playlistId);
      toast('Removed from playlist');
    } catch (e) {
      toast('Failed to remove');
    }
  }

  function promptNewPlaylist() {
    _plPickCtx = null;
    document.getElementById('pl-new-input') && (document.getElementById('pl-new-input').value = '');
    const listEl = document.getElementById('pl-pick-list');
    if (listEl) listEl.innerHTML = `<div style="color:var(--text2);font-size:14px;padding:8px 0">
      Enter a name below to create a new playlist</div>`;
    openOverlay('playlist-overlay');
  }

  // ── PODCAST DETAIL ACTIONS ───────────────────────
  function playLatest() {
    if (ST.episodes.length && ST.podcast) {
      playEp(ST.podcast.id, ST.episodes[0].id);
    }
  }

  function queueAll() {
    if (!ST.podcast) return;
    const items = ST.episodes.map(e => ({
      podcastId: ST.podcast.id,
      episodeId: e.id,
      title:     epTitle(e),
      podcast:   podTitle(ST.podcast),
      duration:  epDur(e),
      artUrl:    ABS.coverUrl(ST.podcast.id),
    }));
    items.forEach(i => {
      if (!ST.queue.some(q => q.podcastId === i.podcastId && q.episodeId === i.episodeId)) {
        ST.queue.push(i);
      }
    });
    saveQueue();
    toast(`${items.length} episodes added to queue`);
  }

  function filterPods(q) {
    ST.podSearch = q;
    const g = document.getElementById('pod-grid');
    if (g) g.innerHTML = podGrid();
  }

  function filterEps(filter, el) {
    ST.epFilter = filter;
    document.querySelectorAll('.chips .chip').forEach(c => c.classList.remove('on'));
    el.classList.add('on');
    let eps = ST.episodes;
    if (filter === 'new')  eps = eps.filter(e => !e.userEpisodeProgress?.currentTime && !e.userEpisodeProgress?.isFinished);
    if (filter === 'prog') eps = eps.filter(e => e.userEpisodeProgress?.currentTime > 0 && !e.userEpisodeProgress?.isFinished);
    if (filter === 'done') eps = eps.filter(e => e.userEpisodeProgress?.isFinished);
    const list = document.getElementById('det-eps');
    if (list) list.innerHTML = epListHtml(eps, ST.podcast);
  }

  function toggleDesc() {
    const d = document.getElementById('det-desc');
    const b = document.getElementById('det-desc-btn');
    if (!d || !b) return;
    d.classList.toggle('open');
    b.textContent = d.classList.contains('open') ? 'Show less' : 'Show more';
  }

  // ── REFRESH ACTIONS ──────────────────────────────
  async function refreshHome() {
    ST.podcasts   = await ABS.getPodcasts(ST.libId).catch(() => ST.podcasts);
    ST.inProgress = await ABS.getInProgress().catch(() => []);
    navigate('home');
  }

  async function refreshLib() {
    toast('Refreshing…');
    ST.podcasts = await ABS.getPodcasts(ST.libId).catch(() => ST.podcasts);
    toast('Library refreshed');
    navigate('profile');
  }

  // ── FULL PLAYER ──────────────────────────────────
  function openFullPlayer() {
    PLAYER.updateMetaUI();
    document.getElementById('full-player').classList.add('open');
  }

  function closeFullPlayer() {
    document.getElementById('full-player').classList.remove('open');
  }

  // ── ALL EPISODES SYNC (on open) ──────────────────
  async function syncAllEps() {
    const statusEl = document.getElementById('sync-lbl');
    if (statusEl) statusEl.textContent = 'Syncing…';
    try {
      // Get or create "All Episodes" playlist
      const all   = await ABS.getPlaylists();
      let allPl   = all.find(p => p.name === CONFIG.ALL_EPS_PLAYLIST);
      if (!allPl) {
        allPl = await ABS.createPlaylist(
          ST.libId, CONFIG.ALL_EPS_PLAYLIST,
          'Auto-managed: all unplayed episodes'
        );
      }
      ST.allEpsPlId = allPl.id;

      // Index existing playlist items
      const inPl = new Set(
        (allPl.items || []).map(i => `${i.libraryItemId}::${i.episodeId}`)
      );

      // Find new episodes across all podcasts
      const toAdd = [];
      for (const pod of ST.podcasts) {
        const cached = ST.epCache[pod.id];
        const count  = pod.media?.numEpisodes || 0;

        // Skip if podcast episode count hasn't changed since last sync
        if (cached && cached.count === count) continue;

        try {
          const full = await ABS.getPodcast(pod.id);
          const eps  = full.media?.episodes || [];
          ST.epCache[pod.id] = { count, ids: eps.map(e => e.id) };

          for (const ep of eps) {
            const key = `${pod.id}::${ep.id}`;
            if (!inPl.has(key) && !ep.userEpisodeProgress?.isFinished) {
              toAdd.push({ libraryItemId: pod.id, episodeId: ep.id });
            }
          }
        } catch (e) {
          console.warn(`Could not sync podcast ${pod.id}:`, e.message);
        }
      }
      saveEpCache();

      // Batch add in groups of 50
      if (toAdd.length) {
        for (let i = 0; i < toAdd.length; i += 50) {
          await ABS.addToPlaylist(ST.allEpsPlId, toAdd.slice(i, i + 50));
        }
        toast(`Added ${toAdd.length} new episode${toAdd.length !== 1 ? 's' : ''} to All Episodes`);
      }

      if (statusEl) statusEl.textContent = 'Up to date';
    } catch (e) {
      console.error('syncAllEps error:', e);
      if (statusEl) statusEl.textContent = 'Sync failed';
    }
  }

  function triggerSync() {
    syncAllEps().catch(console.warn);
  }

  // ── LOGIN SCREEN ─────────────────────────────────
  function showLogin(errorMsg = '') {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('shell').classList.add('hidden');
    document.getElementById('error-screen').classList.add('hidden');

    const screen = document.getElementById('login-screen');
    screen.classList.remove('hidden');

    const errEl = document.getElementById('login-error');
    if (errEl) errEl.textContent = errorMsg;

    // Focus username field
    setTimeout(() => document.getElementById('login-pass')?.focus(), 100);
  }

  async function doLogin() {
    const password = document.getElementById('login-pass')?.value;
    const remember = document.getElementById('login-remember')?.checked;
    const errEl    = document.getElementById('login-error');
    const btn      = document.getElementById('login-btn');

    if (!password) {
      if (errEl) errEl.textContent = 'Please enter the password';
      return;
    }

    if (errEl) errEl.textContent = '';

    try {
      AUTH.login(password, remember);
      document.getElementById('login-screen').classList.add('hidden');
      await bootApp();
    } catch (e) {
      if (errEl) errEl.textContent = e.message;
      btn.disabled    = false;
      btn.textContent = 'Sign In';
      document.getElementById('login-pass').value = '';
      document.getElementById('login-pass').focus();
    }
  }

  function logout() {
    AUTH.logout();
    // Reset state
    ST.libId = null; ST.podcasts = []; ST.speeds = {};
    ST.allEpsPlId = null; ST.playlists = []; ST.inProgress = [];
    ST.queue = []; ST.podcast = null; ST.episodes = [];
    document.getElementById('shell').classList.add('hidden');
    document.getElementById('mini-player')?.classList.add('hidden');
    document.getElementById('player-bar')?.classList.add('hidden');
    showLogin();
  }

  // ── BOOT (after auth) ─────────────────────────────
  async function bootApp() {
    document.getElementById('loading').style.display = 'flex';
    try {
      ST.speeds = await DB.getSpeeds();

      const libs    = await ABS.getLibraries();
      const podLibs = libs.filter(l => l.mediaType === 'podcast');
      if (!podLibs.length) throw new Error('No podcast library found in your ABS account.');
      ST.libId = podLibs[0].id;

      ST.podcasts = await ABS.getPodcasts(ST.libId);

      const all     = await ABS.getPlaylists();
      ST.allEpsPlId = all.find(p => p.name === CONFIG.ALL_EPS_PLAYLIST)?.id || null;
      ST.playlists  = all.filter(p => p.name !== CONFIG.ALL_EPS_PLAYLIST);

      document.getElementById('loading').style.display = 'none';
      document.getElementById('shell').classList.remove('hidden');

      navigate('home');

      syncAllEps().catch(e => console.warn('Background sync failed:', e.message));

    } catch (e) {
      console.error('Boot failed:', e);
      document.getElementById('loading').style.display = 'none';
      document.getElementById('error-screen').classList.remove('hidden');
      const msgEl = document.getElementById('err-msg');
      if (msgEl) msgEl.textContent = e.message;
    }
  }

  // ── INIT ─────────────────────────────────────────
  async function init() {
    document.getElementById('loading').style.display = 'flex';

    // Check for saved token first
    if (AUTH.load()) {
      await bootApp();
    } else {
      showLogin();
    }
  }

  // ── PUBLIC API ───────────────────────────────────
  return {
    init, nav: navigate, doLogin, logout,
    toast, openOverlay, closeOverlay,
    podTitle, epTitle,
    getSpeed, setSpeed: setSpeedLocal,

    // Home
    refreshHome,

    // Podcasts
    openPod, filterPods,

    // Detail
    filterEps, toggleDesc, playLatest, queueAll,

    // Episodes
    playEp, openSheet,

    // Queue
    playQItem, removeQItem, clearQueue,
    addToQueue, playNextInQueue,

    // Playlists
    openPlaylist, playPlaylist, rmFromPl,
    deletePlaylist, promptNewPlaylist,
    addToPl, createPlFromInput,

    // Sheet actions (called from inline HTML)
    _sheetPlay, _sheetQueue, _sheetAddPl, _sheetMarkPlayed,

    // Speed
    openSpeedPicker, pickSpeed,

    // Mark played
    markPlayed,

    // Discovery
    doDiscover, subscribe,

    // Full player
    openFullPlayer, closeFullPlayer,

    // Profile
    refreshLib, triggerSync,
  };
})();
