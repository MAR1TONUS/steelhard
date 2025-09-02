(() => {
  const debounce = (fn, ms = 140) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  // === Новое: запоминаем, что сплэш уже закрывали ===
  const SEEN_KEY = 'launch_splash_seen_v1';
  const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

  class LaunchSplash extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });

      const ol = document.createElement('div'); ol.className = 'ol';
      const sheet = document.createElement('div'); sheet.className = 'sheet';
      sheet.innerHTML = `
        <div class="sky"></div>
        <div class="stars"></div>
        <div class="stars2"></div>

        <h1 class="ws-title" id="ttl"></h1>
        <p class="ws-text" id="txt"></p>

        <div class="ws-card ws-hide" id="card">
          <div class="ws-text" id="txt2"></div>
          <div class="ws-actions"><button class="ws-btn" id="btn"></button></div>
        </div>
      `;
      ol.appendChild(sheet);
      this.shadowRoot.append(ol);

      const cssHref = this.getAttribute('css') || 'splash.css';
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = cssHref;
      link.addEventListener('load', () => this._renderStars(true)); // контрольный перерисовок после загрузки CSS
      this.shadowRoot.prepend(link);

      this.$ = {
        sheet,
        s1: sheet.querySelector('.stars'),
        s2: sheet.querySelector('.stars2'),
        ttl: sheet.querySelector('#ttl'),
        txt: sheet.querySelector('#txt'),
        card: sheet.querySelector('#card'),
        txt2: sheet.querySelector('#txt2'),
        btn: sheet.querySelector('#btn'),
      };
    }

    static get observedAttributes() { return ['stars','stars2','twinkle-min','twinkle-max','size-min','size-max']; }
    attributeChangedCallback(){ if (this.isConnected) this._renderStars(true); }

    connectedCallback(){
      const soonText    = (this.getAttribute('soon-text')    || 'Совсем скоро здесь что-нибудь появится').trim();
      const welcomeText = (this.getAttribute('welcome-text') || 'Добро пожаловать!').trim();
      const btnText     =  this.getAttribute('btn-text')      || 'Начать';
      const appSel      =  this.getAttribute('app-target')    || '#app';
      const launchAtRaw =  this.getAttribute('launch-at');
      const PHASE2_AT   = launchAtRaw ? new Date(launchAtRaw) : null;

      // Если уже видели — сразу показываем приложение и не монтируем сплэш
      if (safeGet(SEEN_KEY) === '1') {
        this._revealApp(appSel);
        this.remove();
        return;
      }

      this._renderStars(false);

      this.$.ttl.textContent = '';
      this.$.txt.textContent = soonText;

      // === ВМЕСТО delay/setTimeout: строго по launch-at ===
      const enterPhase2 = () => {
        this.$.txt.classList.add('ws-phase-fade-out');

        const enter = () => {
          this.$.txt.remove();

          this.$.txt2.innerHTML = welcomeText
            .split(/\n\s*\n/).map(p => `<p>${p}</p>`).join('');

          this.$.btn.textContent = btnText;
          this.$.card.classList.remove('ws-hide');
          this.$.card.classList.add('ws-phase-fade-in');

          // pressed-состояние (включая iOS/Safari)
          document.addEventListener('touchstart', () => {}, { passive: true });
          const press   = () => this.$.btn.classList.add('is-pressed');
          const release = () => this.$.btn.classList.remove('is-pressed');
          this.$.btn.addEventListener('pointerdown',   press);
          this.$.btn.addEventListener('pointerup',     release);
          this.$.btn.addEventListener('pointercancel', release);
          this.$.btn.addEventListener('pointerleave',  release);

          // Клик: запоминаем факт закрытия, даём кнопке «сыграть», затем скрываем сплэш
          this.$.btn.addEventListener('click', () => {
            safeSet(SEEN_KEY, '1'); // <<< ключ
            const sheet = this.$.sheet;
            setTimeout(() => {
              sheet.style.transition = `opacity var(--sheet-out-dur) var(--sheet-out-ease), transform var(--sheet-out-dur) var(--sheet-out-ease)`;
              sheet.style.opacity = '0';
              sheet.style.transform = 'translateY(-12%)';
              setTimeout(() => { this._revealApp(appSel); this.remove(); }, 500);
            }, 120);
          });
        };

        this.$.txt.addEventListener('animationend', enter, { once:true });
        setTimeout(enter, 340);
      };

      const now = new Date();
      if (PHASE2_AT && now >= PHASE2_AT) {
        // Дата уже наступила — сразу включаем фазу 2
        enterPhase2();
      } else if (PHASE2_AT) {
        // «Сторож»: раз в секунду проверяем наступление времени
        const tid = setInterval(() => {
          if (new Date() >= PHASE2_AT) {
            clearInterval(tid);
            enterPhase2();
          }
        }, 1000);
      }

      const reStars = debounce(() => this._renderStars(true), 160);
      window.addEventListener('resize', reStars);
      if (window.visualViewport){
        visualViewport.addEventListener('resize', reStars);
        visualViewport.addEventListener('scroll', reStars);
      }
    }

    _revealApp(sel){
      const app = document.querySelector(sel);
      if (app){ app.removeAttribute('hidden'); app.classList.remove('is-hidden'); }
    }

    /* Звёзды: количество по площади — канвас-версия (быстро и без лагов на iOS) */
    _renderStars(fromResize){
      // ⚙️ множитель скорости можно задавать атрибутом элемента:
      // <launch-splash speed-mult="1.6"></launch-splash>
      const host = this; // custom element <launch-splash>
      const SPEED_MULT = Math.max(0.2, parseFloat(host.getAttribute('speed-mult') || '1')) || 1;

      // Отключаем тяжёлые DOM-слои (если были отрендерены ранее)
      const sheet = this.$.sheet;
      const s1 = this.$.s1, s2 = this.$.s2;
      if (s1) s1.style.display = 'none';
      if (s2) s2.style.display = 'none';

      // Находим контейнер неба
      const skyHost = sheet.querySelector('.sky');
      if (!skyHost) return;

      // Если канвас уже есть — удалим, чтобы пересоздать корректно под текущий размер
      const old = skyHost.querySelector('canvas.starfield-canvas');
      if (old) old.remove();

      // Создаём канвас поверх «неба»
      const canvas = document.createElement('canvas');
      canvas.className = 'starfield-canvas';
      Object.assign(canvas.style, {
        position: 'absolute',
        inset: '0',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: '0'
      });
      skyHost.style.position = 'absolute';
      skyHost.style.inset = '0';
      skyHost.appendChild(canvas);

      const ctx = canvas.getContext('2d');
      const DPR = Math.min(2, (window.devicePixelRatio || 1));

      let stars = [];
      let rafId = 0;
      let lastT = 0;
      let paused = false;

      // Чем больше — тем быстрее «живет» звезда (мигает)
      const TWINKLE_RATE = 0.02 * SPEED_MULT;

      function rand(a, b){ return a + Math.random()*(b-a); }

      function resize(){
        const rect = sheet.getBoundingClientRect();
        const w = Math.max(320, rect.width);
        const h = Math.max(480, rect.height);

        canvas.width  = Math.round(w * DPR);
        canvas.height = Math.round(h * DPR);
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

        // Кол-во звёзд по площади экрана (ориентир — iPhone 12/13)
        const baseArea = 390 * 844;
        const area = w * h;
        const scale = Math.min(1.5, Math.max(0.55, area / baseArea));
        const N = Math.round(100 * scale); // примерно 55..150

        stars = new Array(N).fill(0).map(() => {
          const speed = rand(0.15, 0.25) * SPEED_MULT;
          return {
            x: rand(0, w),
            y: rand(0, h),
            r: rand(0.5, 1.6),
            a: rand(0.5, 1.0),
            t: rand(0, Math.PI*2),
            speed
          };
        });
      }

      function draw(ts){
        if (paused) return;
        rafId = requestAnimationFrame(draw);
        if (!ts) ts = performance.now();
        const dt = Math.min(33, ts - lastT || 16);
        lastT = ts;

        ctx.clearRect(0,0,canvas.width, canvas.height);
        ctx.save();
        for (const s of stars){
          s.t += s.speed * dt * TWINKLE_RATE;
          const tw = 0.5 + Math.sin(s.t) * 0.5; // 0..1
          const alpha = (s.a * (0.65 + 0.35*tw));
          ctx.globalAlpha = alpha;
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, Math.PI*2);
          ctx.fillStyle = '#fff';
          ctx.fill();
        }
        ctx.restore();
      }

      const isReduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      const onVisibility = () => {
        const hidden = document.hidden || isReduced();
        paused = hidden;
        if (paused) {
          cancelAnimationFrame(rafId); rafId = 0;
        } else if (!rafId) {
          lastT = performance.now();
          rafId = requestAnimationFrame(draw);
        }
      };

      // iOS pull-to-refresh: пауза на время жеста
      let pulling = false;
      let startY = 0;
      const onTouchStart = (e) => {
        const sc = document.scrollingElement;
        if (sc && sc.scrollTop <= 0) {
          startY = e.touches ? e.touches[0].clientY : 0;
          pulling = true;
        }
      };
      const onTouchMove = (e) => {
        if (!pulling) return;
        const y = e.touches ? e.touches[0].clientY : 0;
        if (y - startY > 4) {
          paused = true;
          cancelAnimationFrame(rafId); rafId = 0;
        }
      };
      const onTouchEnd = () => { pulling = false; onVisibility(); };

      // Подписки
      const re = () => { resize(); onVisibility(); };
      re();

      const ro = new ResizeObserver(re);
      ro.observe(sheet);

      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('touchstart', onTouchStart, { passive: true });
      window.addEventListener('touchmove',  onTouchMove,  { passive: true });
      window.addEventListener('touchend',   onTouchEnd,   { passive: true });

      if (!isReduced()) rafId = requestAnimationFrame(draw);
    }

  }

  customElements.define('launch-splash', LaunchSplash);
})();

