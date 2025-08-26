/*!
 * player-core.bundle.v3.3.js
 * Core + animation + full UI + drag-to-close + height-only layout (default).
 * Improvements:
 *  - Faster first open: create instance ASAP; optional inlineCSS for critical parts
 *  - Robust progress seek (pointer drag + click)
 *  - No conflict between drag-to-close and progress interactions
 *  - Default cover image via options.cover
 *  - Shows partTitle separately under title
 *  - Tries to reduce remote playback/system UI
 */
(function () {
  if (window.__AudioSheetBundleV33Loaded__) return;
  window.__AudioSheetBundleV33Loaded__ = true;

  // ---------- Config ----------
  const DEFAULTS = {
    portrait:  'views/portrait.css',
    landscape: 'views/landscape.css',
    breakpoint: 650,       // HEIGHT breakpoint in px
    layoutMode: 'height',  // 'height' | 'orientation' | 'forced'
    forcedLayout: 'portrait',
    cover: '',             // default cover url (optional)
    inlineCSS: ''          // optional inline CSS string to avoid extra request
  };
  const BOOT = (typeof window.AudioSheetOptions === 'object' && window.AudioSheetOptions) ? window.AudioSheetOptions : {};

  // ---------- Small utilities ----------
  const raf2 = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const TRANS_DUR = 'var(--sheet-open-dur)';
  const TRANS_EASE = 'var(--sheet-ease, cubic-bezier(.2,.7,0,1))';

  class XAudioSheet extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._state = { isOpen: false, lastOpener: null };
      this._opts = {
        portrait:     BOOT.portrait     || DEFAULTS.portrait,
        landscape:    BOOT.landscape    || DEFAULTS.landscape,
        breakpoint:   Number(BOOT.breakpoint ?? DEFAULTS.breakpoint),
        layoutMode:   BOOT.layoutMode   || DEFAULTS.layoutMode,
        forcedLayout: BOOT.forcedLayout || DEFAULTS.forcedLayout,
        cover:        BOOT.cover        || DEFAULTS.cover,
        inlineCSS:    BOOT.inlineCSS    || DEFAULTS.inlineCSS
      };

      // Shadow DOM
      const root = document.createElement('div');
      root.innerHTML = `
        ${this._opts.inlineCSS ? `<style id="inlineCSS">${this._opts.inlineCSS}</style>` : ''}
<link id="cssPortrait" rel="stylesheet" href="${this._opts.portrait}">
<link id="cssLandscape" rel="stylesheet" href="${this._opts.landscape}">

<div class="overlay" part="overlay" aria-hidden="true">
  <div class="sheet" part="sheet">
    <!-- ОБЛОЖКА -->
    <div class="cover"><div class="img" part="cover"></div></div>

    <!-- МЕТА: НАЗВАНИЕ / ГЛАВА / АВТОР -->
    <div class="meta">
      <h2 class="title"><span class="track"></span></h2>
      <div class="part"></div>
      <div class="author"></div>
    </div>

    <!-- КОНТРОЛЫ -->
    <div class="controls" id="controls">
      <button class="btn" id="prev" aria-label="Предыдущий">
        <img alt="" src="icon/prev.svg">
      </button>
      <button class="btn" id="back15" title="-15 сек" aria-label="Назад 15 секунд">
        <img alt="" src="icon/-15sec.svg">
      </button>
      <button class="btn play" id="pp" aria-label="Воспроизвести/Пауза">
        <img alt="" src="icon/play.svg">
      </button>
      <button class="btn" id="fwd30" title="+30 сек" aria-label="Вперёд 30 секунд">
        <img alt="" src="icon/+30sec.svg">
      </button>
      <button class="btn" id="next" aria-label="Следующий">
        <img alt="" src="icon/next.svg">
      </button>
    </div>

    <!-- ПРОГРЕСС -->
    <div class="progress-wrap">
      <div class="bar"><div class="fill"></div><div class="knob"></div></div>
      <div class="time"><span class="t-l">0:00</span><span class="t-r">0:00</span></div>
    </div>

    <audio class="audio" preload="metadata" playsinline></audio>
  </div>
</div>
      `;
      this.shadowRoot.appendChild(root);

      // Cache
      const $ = this.$ = {
        cssPortrait: this.shadowRoot.getElementById('cssPortrait'),
        cssLandscape: this.shadowRoot.getElementById('cssLandscape'),
        overlay:  this.shadowRoot.querySelector('.overlay'),
        sheet:    this.shadowRoot.querySelector('.sheet'),
        cover:    this.shadowRoot.querySelector('.cover .img'),
        title:    this.shadowRoot.querySelector('.title .track'),
        part:     this.shadowRoot.querySelector('.part'),
        author:   this.shadowRoot.querySelector('.author'),
        btnPrev:  this.shadowRoot.getElementById('prev'),
        btnBack:  this.shadowRoot.getElementById('back15'),
        btnPP:    this.shadowRoot.getElementById('pp'),
        btnFwd:   this.shadowRoot.getElementById('fwd30'),
        btnNext:  this.shadowRoot.getElementById('next'),
        bar:      this.shadowRoot.querySelector('.bar'),
        fill:     this.shadowRoot.querySelector('.fill'),
        knob:     this.shadowRoot.querySelector('.knob'),
        tL:       this.shadowRoot.querySelector('.time .t-l'),
        tR:       this.shadowRoot.querySelector('.time .t-r'),
        audio:    this.shadowRoot.querySelector('audio'),
      };

      // Apply initial layout mode
      this._applyLayoutMode();

      // Overlay click to close
      $.overlay.addEventListener('click', (ev) => {
        if (ev.target === $.overlay) this.close();
      });

      // Escape to close
      this._onKey = (e) => { if (e.key === 'Escape') this.close(); };

      // Bind
      this._bindDragToClose();
      this._bindControls();
      this._bindProgress();

      // Reduce remote playback popups
      try {
        $.audio.setAttribute('controlslist', 'noremoteplayback nodownload noplaybackrate');
        $.audio.disableRemotePlayback = true;
      } catch (e) {}
    }

    connectedCallback() {
      document.addEventListener('keydown', this._onKey);
      this.style.display = 'none';
      this.style.pointerEvents = 'none';
      this._onResize = () => this._applyLayoutMode();
      window.addEventListener('resize', this._onResize);
    }
    disconnectedCallback() {
      document.removeEventListener('keydown', this._onKey);
      window.removeEventListener('resize', this._onResize);
    }

    open(meta = {}) {
      const $ = this.$;

      // нормализуем поля
      let title = meta.title || '';
      let part  = meta.partTitle || '';
      if (!title && part) { title = part; part = meta.part || meta.partLabel || ''; }

      try {
        // название
        const trackEl = this.shadowRoot.querySelector('.title .track');
        if (trackEl) {
          trackEl.textContent = title || '';
          trackEl.setAttribute('data-text', trackEl.textContent);
        }
        // глава
        const partEl = this.shadowRoot.querySelector('.part');
        if (partEl) partEl.textContent = part || '';
        // автор
        const authEl = this.shadowRoot.querySelector('.author');
        if (authEl) authEl.textContent = meta.author || '';
        // обложка
        const coverURL = meta.cover || this._opts.cover || '';
        this.$.cover.style.backgroundImage = coverURL ? `url(${encodeURI(coverURL)})` : '';
        // аудио
        if (meta.src) {
          if (this.$.audio.src !== meta.src) this.$.audio.src = meta.src;
          try { this.$.audio.load(); } catch(e) {}
        }
      } catch(e) {}

      // после установки текста — настроить бегущую строку
      this._setupMarquee();

      // открыть шторку
      this._open(meta.opener || null, false);
    }

    close() { this._open(null, true); }

    // Runtime configure
    configure(opts = {}) {
      const { portrait, landscape, breakpoint, layoutMode, forcedLayout, cover, inlineCSS } = opts;
      const $ = this.$;
      if (portrait) { this._opts.portrait = portrait; $.cssPortrait.href = portrait; }
      if (landscape) { this._opts.landscape = landscape; $.cssLandscape.href = landscape; }
      if (typeof cover === 'string') { this._opts.cover = cover; }
      if (typeof inlineCSS === 'string') {
        let st = this.shadowRoot.getElementById('inlineCSS');
        if (!st) {
          st = document.createElement('style'); st.id = 'inlineCSS';
          this.shadowRoot.prepend(st);
        }
        st.textContent = inlineCSS;
        this._opts.inlineCSS = inlineCSS;
      }
      if (Number.isFinite(breakpoint)) this._opts.breakpoint = Number(breakpoint);
      if (layoutMode) this._opts.layoutMode = layoutMode;
      if (forcedLayout) this._opts.forcedLayout = forcedLayout;
      this._applyLayoutMode();
    }

    // ----------- Layout mode handling (height-first) -----------
    _applyLayoutMode() {
      const $ = this.$;
      const { layoutMode, breakpoint, forcedLayout } = this._opts;

      if (layoutMode === 'orientation') {
        $.cssPortrait.media  = '(orientation: portrait)';
        $.cssLandscape.media = '(orientation: landscape)';
        return;
      }

      if (layoutMode === 'forced') {
        if (forcedLayout === 'landscape') {
          $.cssPortrait.media  = 'not all';
          $.cssLandscape.media = 'all';
        } else {
          $.cssPortrait.media  = 'all';
          $.cssLandscape.media = 'not all';
        }
        return;
      }

      // Default: 'height'
      const bp = Number(breakpoint) || 650;
      $.cssPortrait.media  = `(min-height:${bp+1}px)`; // portrait for TALL screens
      $.cssLandscape.media = `(max-height:${bp}px)`;   // landscape for SHORT screens
    }

    // ----------- Internals -----------
_open(opener, closing = false) {
  const $ = this.$;

  if (this._closeTimer) { try { clearTimeout(this._closeTimer); } catch(e){} this._closeTimer = null; }
  if (this._onCloseEnd && $.sheet) {
    try { $.sheet.removeEventListener('transitionend', this._onCloseEnd); } catch(e){}
    this._onCloseEnd = null;
  }

  if (closing) {
    this._state.isOpen = false;
    $.overlay.classList.remove('open');
    if ($.sheet) {
      const cs = getComputedStyle($.sheet);
      if (!/transform/.test(cs.transition)) {
        $.sheet.style.transition = `transform var(--sheet-close-dur, 220ms) ${TRANS_EASE}`;
      }
      $.sheet.style.transform = 'translateY(100%)';
    }
    const onEnd = () => {
      this.style.pointerEvents = 'none';
      this.style.display = 'none';

      // вернуть поведение страницы после закрытия
      document.documentElement.style.overflow = '';
      document.body.style.overscrollBehavior = '';

      if ($.sheet) try { $.sheet.removeEventListener('transitionend', onEnd); } catch(e) {}
      if (opener && opener.focus) try { opener.focus({ preventScroll: true }); } catch(e) {}
    };
    this._onCloseEnd = onEnd;
    if ($.sheet) try { $.sheet.addEventListener('transitionend', onEnd, { once: true }); } catch(e) {}
    this._closeTimer = setTimeout(onEnd, 600);
    return;
  }

  // OPEN
  this._state.isOpen = true;
  this._state.lastOpener = opener || null;

  this.style.display = 'block';
  this.style.pointerEvents = 'auto';
  $.overlay.classList.add('open');
  $.overlay.removeAttribute('aria-hidden');

  // заблокировать прокрутку страницы под шторкой
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overscrollBehavior = 'contain';

  if ($.sheet) {
    $.sheet.style.transition = `transform ${TRANS_DUR} ${TRANS_EASE}`;
    $.sheet.style.transform  = 'translateY(100%)';
    raf2(() => { $.sheet.style.transform = 'translateY(0%)'; });
  }
}


    // ----- Controls binding -----
    _bindControls() {
      const $ = this.$;
      const a = $.audio;
      const playImg = $.btnPP.querySelector('img');

      const setIcon = () => {
        const src = a.paused ? 'icon/play.svg' : 'icon/pause.svg';
        if (playImg && playImg.getAttribute('src') !== src) {
          playImg.setAttribute('src', src);
        }
        $.btnPP.setAttribute('aria-pressed', a.paused ? 'false' : 'true');
      };

      // Клик по play/pause: переключаем состояние и даём «бамп»
      $.btnPP.addEventListener('click', () => {
        this._bump?.(playImg); // анимация толчка
        if (a.paused) { a.play().catch(()=>{}); } else { a.pause(); }
      });

      // ± сек
      $.btnBack.addEventListener('click', () => { a.currentTime = Math.max(0, a.currentTime - 15); });
      $.btnFwd.addEventListener('click',  () => { a.currentTime = Math.min((a.duration||a.currentTime+30), a.currentTime + 30); });

      // Синхронизация иконки по событиям плеера
      a.addEventListener('play', setIcon);
      a.addEventListener('pause', setIcon);
      a.addEventListener('ended', setIcon);

      // начальное состояние
      setIcon();

      // Пересчитать бегущую строку на ресайзах
      if (!this._onResizeMarq) {
        this._onResizeMarq = () => this._setupMarquee?.();
        window.addEventListener('resize', this._onResizeMarq);
      }
    }

    // ===== Бегущая строка для названия (speed-mode) =====
    _setupMarquee() {
      const sr = this.shadowRoot;
      const titleEl = sr && sr.querySelector('.title');
      const trackEl = sr && sr.querySelector('.title .track');
      if (!titleEl || !trackEl) return;

      // восстановить исходный текст и очистить прошлое состояние
      const raw = (trackEl.getAttribute('data-text') || trackEl.textContent || '').trim();
      trackEl.textContent = raw;
      trackEl.setAttribute('data-text', raw);
      titleEl.classList.remove('marquee', 'is-clip');
      trackEl.style.removeProperty('--dist');
      trackEl.style.removeProperty('--dur');
      trackEl.querySelectorAll('.clone').forEach(n => n.remove());

      const measure = () => {
        const wrapW = Math.ceil(titleEl.clientWidth || 0);
        const textW = Math.ceil(trackEl.scrollWidth || 0);

        if (textW > wrapW + 2) {
          titleEl.classList.add('is-clip');

          const clone = document.createElement('span');
          clone.className = 'clone';
          clone.textContent = raw;
          trackEl.appendChild(clone);

          const csTrack = getComputedStyle(trackEl);
          const gapPx = parseFloat(csTrack.gap) || 24;

          const dist = textW + gapPx;

          const csHost = getComputedStyle(sr.host);
          const speed = parseFloat(csHost.getPropertyValue('--marquee-speed')) || 18; // px/s
          const minS  = parseFloat(csHost.getPropertyValue('--marquee-min'))  || 0;   // 0 = off
          const maxS  = parseFloat(csHost.getPropertyValue('--marquee-max'))  || 0;   // 0 = off

          let dur = dist / speed;
          if (minS > 0) dur = Math.max(minS, dur);
          if (maxS > 0) dur = Math.min(maxS, dur);

          trackEl.style.setProperty('--dist', dist + 'px');
          trackEl.style.setProperty('--dur',  (dur > 0 ? dur : 14).toFixed(2) + 's');
          titleEl.classList.add('marquee');
        }
      };

      requestAnimationFrame(() => {
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
        else measure();
      });
    }

    // ===== Бамп 2px на иконке (клик-пульс) =====
    _bump(imgEl) {
      if (!imgEl) return;
      imgEl.classList.remove('bump');
      void imgEl.offsetWidth; // restart animation
      imgEl.classList.add('bump');
    }

    // ----- Progress binding (click + drag) -----
    _bindProgress() {
      const $ = this.$;
      const a = $.audio;

      const fmt = (t) => {
        if (!isFinite(t) || t < 0) t = 0;
        const m = Math.floor(t / 60);
        const s = Math.floor(t % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
      };

      const updateUI = () => {
        const dur = a.duration || 0;
        const cur = a.currentTime || 0;
        const p = dur ? clamp(cur / dur, 0, 1) : 0;
        $.fill.style.width = `${p * 100}%`;
        $.knob.style.left = `${p * 100}%`;
        $.tL.textContent = fmt(cur);
        $.tR.textContent = fmt(dur);
      };

      const posFromEvent = (ev) => {
        const rect = $.bar.getBoundingClientRect();
        const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
        const x = clamp(clientX - rect.left, 0, rect.width);
        return rect.width ? x / rect.width : 0;
      };

      let dragging = false;
      const onDown = (ev) => {
        dragging = true;
        a.pause && a.pause(); // pause while scrubbing
        const p = posFromEvent(ev);
        if (isFinite(a.duration)) a.currentTime = p * a.duration;
        updateUI();
        ev.preventDefault();
        ev.stopPropagation(); // <- не даём стартовать drag-to-close
      };
      const onMove = (ev) => {
        if (!dragging) return;
        const p = posFromEvent(ev);
        if (isFinite(a.duration)) a.currentTime = p * a.duration;
        updateUI();
        ev.preventDefault();
        ev.stopPropagation();
      };
      const onUp = (ev) => {
        if (!dragging) return;
        dragging = false;
        updateUI();
        ev.preventDefault();
        ev.stopPropagation();
      };

      // Click-to-seek
      $.bar.addEventListener('click', (ev) => {
        if (dragging) return;
        const p = posFromEvent(ev);
        if (isFinite(a.duration)) a.currentTime = p * a.duration;
        updateUI();
      });

      // Pointer/touch scrub
      $.bar.addEventListener('pointerdown', onDown);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      $.bar.addEventListener('touchstart', onDown, { passive: false });
      $.bar.addEventListener('touchmove', onMove, { passive: false });
      $.bar.addEventListener('touchend', onUp);

      a.addEventListener('timeupdate', updateUI);
      a.addEventListener('durationchange', updateUI);
      a.addEventListener('loadedmetadata', updateUI);
      a.addEventListener('seeked', updateUI);
    }

    // ----- Drag to close (desktop-safe; ignores controls & progress; capture only after start) -----
    _bindDragToClose() {
      const sr = this.shadowRoot;
      const overlay = sr.querySelector('.overlay');
      const sheet   = sr.querySelector('.sheet');
      if (!sheet || !overlay) return;

      const DRAG_START_PX  = 8;
      const CLOSE_DISTANCE = 120;
      const CLOSE_VELOCITY = 0.8;

      let active = false;
      let started = false;
      let startX = 0, startY = 0, lastY = 0;
      let t0 = 0;

      const inProgressArea = (e) => {
        const path = e.composedPath ? e.composedPath() : [];
        return path.some(el => el && el.classList && (
          el.classList.contains('progress-wrap') ||
          el.classList.contains('bar') ||
          el.classList.contains('knob') ||
          el.classList.contains('time')
        ));
      };

      const inControlsArea = (e) => {
        const path = e.composedPath ? e.composedPath() : [];
        return path.some(el => {
          if (!el || typeof el !== 'object') return false;
          if (el.tagName === 'BUTTON') return true;
          const c = el.closest?.('.controls');
          return !!c;
        });
      };

      const resetTransform = () => {
        sheet.style.transition = 'transform 280ms cubic-bezier(.2,.7,0,1)';
        sheet.style.transform  = 'translateY(0)';
        const onEnd = () => {
          sheet.style.transition = '';
          sheet.removeEventListener('transitionend', onEnd);
        };
        sheet.addEventListener('transitionend', onEnd);
      };

      const applyDrag = (dy) => {
        const k = 0.85;
        const y = dy < 0 ? 0 : dy * k;
        sheet.style.transition = '';
        sheet.style.transform  = `translateY(${y}px)`;
      };

      const onPointerDown = (e) => {
        if (e.button !== undefined && e.button !== 0) return; // только ЛКМ/основной палец

        // если клик начался на контролах или прогрессе — вовсе НЕ стартуем drag
        if (inControlsArea(e) || inProgressArea(e)) {
          active = false; started = false;
          return; // пускаем клик/скраб без вмешательства
        }

        active = true; started = false;
        startX = e.clientX ?? (e.touches && e.touches[0]?.clientX) ?? 0;
        startY = e.clientY ?? (e.touches && e.touches[0]?.clientY) ?? 0;
        lastY  = startY; t0 = e.timeStamp || performance.now();
        overlay.classList.add('drag-watch');
        // pointer capture НЕ берём до подтверждения жеста
      };

      const onPointerMove = (e) => {
        if (!active) return;
        const x = e.clientX ?? (e.touches && e.touches[0]?.clientX) ?? 0;
        const y = e.clientY ?? (e.touches && e.touches[0]?.clientY) ?? 0;
        const dx = x - startX;
        const dy = y - startY;

        if (!started) {
          if (Math.abs(dy) > DRAG_START_PX && Math.abs(dy) > Math.abs(dx)) {
            started = true;
            overlay.classList.add('dragging');
            try { sheet.setPointerCapture && sheet.setPointerCapture(e.pointerId); } catch {}
          } else {
            return; // ещё не уверены — не мешаем возможному клику
          }
        }

        if (dy <= 0) { applyDrag(0); return; }
        lastY = y;
        applyDrag(dy);
        e.preventDefault(); // не прокручиваем страницу
      };

      const onPointerUp = (e) => {
        if (!active) return;
        try { sheet.releasePointerCapture && sheet.releasePointerCapture(e.pointerId); } catch {}
        overlay.classList.remove('drag-watch');

        if (!started) {
          // был тап/клик — ничего не закрываем
          overlay.classList.remove('dragging');
          resetTransform();
          active = false; started = false;
          return;
        }

        const dy = Math.max(0, lastY - startY);
        const dt = Math.max(1, (e.timeStamp || performance.now()) - t0);
        const v  = dy / dt; // px/ms

        overlay.classList.remove('dragging');

        if (dy >= CLOSE_DISTANCE || v >= CLOSE_VELOCITY) {
          sheet.style.transition = 'transform 260ms cubic-bezier(.2,.7,0,1)';
          sheet.style.transform  = 'translateY(100%)';
          const onEnd = () => {
            sheet.removeEventListener('transitionend', onEnd);
            this.close();
            sheet.style.transition = '';
            sheet.style.transform  = 'translateY(100%)';
          };
          sheet.addEventListener('transitionend', onEnd);
        } else {
          resetTransform();
        }

        active = false; started = false;
      };

      sheet.addEventListener('pointerdown', onPointerDown);
      sheet.addEventListener('pointermove', onPointerMove);
      sheet.addEventListener('pointerup', onPointerUp);
      sheet.addEventListener('pointercancel', onPointerUp);

      // touch alias (на iOS/старых браузерах)
      sheet.addEventListener('touchstart', onPointerDown, { passive: true });
      sheet.addEventListener('touchmove', onPointerMove, { passive: false });
      sheet.addEventListener('touchend', onPointerUp);
    }
  }

  // Define once
  if (!customElements.get('x-audio-sheet')) {
    customElements.define('x-audio-sheet', XAudioSheet);
  }

  // Singleton + API
  (function ensureInstance(){
    if (window.AudioSheet && window.AudioSheet.__ready) return;
    let inst = document.querySelector('x-audio-sheet');
    if (!inst) {
      inst = document.createElement('x-audio-sheet');
      document.body.appendChild(inst);
    }
    window.AudioSheet = {
      __ready: true,
      open(meta) { inst.open(meta || {}); },
      close() { inst.close(); },
      configure(opts) { inst.configure(opts || {}); },
      get el() { return inst; }
    };

    const q = window.__xa_queue;
    if (Array.isArray(q) && q.length) {
      const last = q[q.length - 1];
      try { inst.open(last || {}); } catch(e) {}
      window.__xa_queue = [];
    }
  })();

})();
