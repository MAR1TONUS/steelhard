// Mini Player (bottom card) — script
// Non-invasive: creates DOM programmatically and patches AudioSheet only if present.
(() => {
  const onReady = (fn) => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  };

  onReady(() => {
    // --- Create DOM ---
    const wrapper = document.createElement('div');
    wrapper.id = 'miniPlayer';
    wrapper.className = 'mini-player';
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', 'Мини-плеер');

    wrapper.innerHTML = `
      <img id="mpCover" class="mp-cover" alt="" src="">
      <div class="mp-text">
        <div class="mp-title" id="mpTitle">—</div>
        <div class="mp-sub"   id="mpSub">—</div>
      </div>
      <button id="mpPP" class="mp-btn" type="button" aria-label="Воспроизвести/Пауза">
        <img id="mpIcon" alt="" src="icon/play_out.svg">
      </button>
    `;

    document.body.appendChild(wrapper);

    // --- Refs ---
    const wrap   = wrapper;
    const cover  = wrapper.querySelector('#mpCover');
    const tTitle = wrapper.querySelector('#mpTitle');
    const tSub   = wrapper.querySelector('#mpSub');
    const btnPP  = wrapper.querySelector('#mpPP');
    const icoPP  = wrapper.querySelector('#mpIcon');

    let nowMeta = null;

    // Find <audio> used by main player (AudioSheet -> shadowRoot -> audio), fallback to first audio
    const getAudio = () => {
      const el = (window.AudioSheet && window.AudioSheet.el);
      if (el && el.shadowRoot) {
        const a = el.shadowRoot.querySelector('audio');
        if (a) return a;
      }
      return document.querySelector('audio');
    };

    function syncIcon(){
      const a = getAudio(); if (!a) return;
      icoPP.src = a.paused ? 'icon/play_out.svg' : 'icon/pause_out.svg';
      btnPP.setAttribute('aria-pressed', a.paused ? 'false' : 'true');
    }

    function applyMeta(meta){
      // expected fields: title (name), partTitle (chapter/number), cover (url)
      try {
        tTitle.textContent = meta?.title ?? '';
        tSub.textContent   = meta?.partTitle ?? meta?.part ?? '';
        const coverUrl     = meta?.cover ?? meta?.img ?? meta?.poster ?? '';
        if (coverUrl) { cover.src = coverUrl; cover.style.visibility='visible'; }
        else { cover.removeAttribute('src'); cover.style.visibility='hidden'; }
      } catch {}
    }

    function showMini(meta){
      if (meta) nowMeta = meta;
      if (nowMeta) applyMeta(nowMeta);
      wrap.classList.add('show');
      syncIcon();
      queueMicrotask(updatePageBottomSpace);
    }
    function hideMini(){
      wrap.classList.remove('show');
      queueMicrotask(updatePageBottomSpace);
    }

    // Whole card opens main player (except play/pause button)
    wrap.addEventListener('click', (e) => {
      if (e.target.closest('#mpPP')) return; // let button handle its own click
      if (nowMeta && window.AudioSheet && typeof window.AudioSheet.open === 'function'){
        window.AudioSheet.open(nowMeta);
      }
    });

    // Play/Pause button logic
    btnPP.addEventListener('click', (e) => {
      e.stopPropagation();
      const a = getAudio(); if (!a) return;
      if (a.paused) { a.play().catch(()=>{}); } else { a.pause(); }
    });

    // Bind <audio> events once available
    const tryBind = () => {
      const a = getAudio();
      if (!a || a.__miniBound) return;
      a.addEventListener('play',   syncIcon);
      a.addEventListener('pause',  syncIcon);
      a.addEventListener('ended',  syncIcon);
      a.addEventListener('loadedmetadata', syncIcon);
      a.__miniBound = true;
      syncIcon();
    };
    const t = setInterval(() => { tryBind(); if (getAudio()) clearInterval(t); }, 120);

    // Patch AudioSheet to sync show/hide + meta
    const ready = () => !!(window.AudioSheet && window.AudioSheet.open && window.AudioSheet.close);
    const patch = () => {
      if (!ready() || window.AudioSheet.__miniPatched) return;
      window.AudioSheet.__miniPatched = true;

      const _open  = window.AudioSheet.open.bind(window.AudioSheet);
      const _close = window.AudioSheet.close.bind(window.AudioSheet);

      window.AudioSheet.open = (meta = {}) => {
        hideMini(); // hide the card while the main sheet is open
        if (meta && (meta.title || meta.partTitle || meta.src || meta.cover)) {
          nowMeta = meta;
        }
        return _open(meta);
      };

      window.AudioSheet.close = () => {
        _close();
        if (nowMeta) showMini(); // show card after closing main sheet
      };
    };
    const t2 = setInterval(() => { patch(); if (ready()) clearInterval(t2); }, 120);

    // ==== Avoid being hidden under bottom browser bars (Yandex etc.) ====
    const root = document.documentElement;
    function updateSafeInset(){
      const vv = window.visualViewport;
      if (!vv) return;
      const bottomInset = Math.max(0, (window.innerHeight - vv.height - vv.offsetTop));
      root.style.setProperty('--mp-safe-extra', bottomInset + 'px');
    }
    if (window.visualViewport){
      visualViewport.addEventListener('resize', updateSafeInset);
      visualViewport.addEventListener('scroll', updateSafeInset);
      updateSafeInset();
    }

    // Add page bottom padding so content isn't covered by the card
    function updatePageBottomSpace(){
      if (!wrap.classList.contains('show')) {
        document.body.style.paddingBottom = '';
        return;
      }
      const h = wrap.getBoundingClientRect().height;
      document.body.style.paddingBottom = (h + 8) + 'px';
    }
    window.addEventListener('resize', updatePageBottomSpace);

    // Expose minimal API for debugging/testing
    window.MiniPlayer = {
      show: (meta) => showMini(meta),
      hide: () => hideMini(),
      setMeta: (meta) => { nowMeta = meta; applyMeta(meta); },
      _getAudio: getAudio
    };
  });
})();