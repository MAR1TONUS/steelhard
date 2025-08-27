(() => {
  const debounce = (fn, ms = 140) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

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
      const delay       = +(this.getAttribute('delay')        || 5000);

      this._renderStars(false);

      this.$.ttl.textContent = '';
      this.$.txt.textContent = soonText;

      setTimeout(() => {
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

          // Клик: дать кнопке «сыграть», затем скрыть сплэш
          this.$.btn.addEventListener('click', () => {
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
      }, delay);

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

    /* Звёзды: количество по площади + отрицательная задержка мерцания */
    _renderStars(fromResize){
      const cssNum = (name, fb) => { const v=getComputedStyle(this).getPropertyValue(name).trim(); return v?+v:fb; };
      const attrNum= (name, fb) => (this.hasAttribute(name) ? +this.getAttribute(name) : fb);

      const base1 = attrNum('stars',  cssNum('--stars-1',160));
      const base2 = attrNum('stars2', cssNum('--stars-2', 90));

      const area = Math.max(320, innerWidth) * Math.max(480, innerHeight);
      const baseArea = 390 * 844; // iPhone 12 Pro
      const scale = Math.min(1.7, Math.max(0.55, area / baseArea));

      const n1 = Math.round(base1 * scale);
      const n2 = Math.round(base2 * scale);

      const tMin=attrNum('twinkle-min', cssNum('--twinkle-min',6));
      const tMax=attrNum('twinkle-max', cssNum('--twinkle-max',10));
      const zMin=attrNum('size-min',    cssNum('--star-size-min',1));
      const zMax=attrNum('size-max',    cssNum('--star-size-max',2));

      const mk = (wrap, n) => {
        wrap.replaceChildren();
        const frag = document.createDocumentFragment();

        for (let i = 0; i < n; i++){
          const e = document.createElement('i');
          e.className = 'star';

          // координаты
          const x = Math.random() * 100;
          const y = Math.random() * 100;

          // размер (px) и альфа
          const sz = (zMin + Math.random()*(zMax - zMin)).toFixed(2);
          const alp = (0.6 + Math.random()*0.4).toFixed(2); // 0.60..1.00

          // мерцание и небольшая «рассинхронизация»
          const tw= (tMin + Math.random()*(tMax - tMin)).toFixed(2);
          const de= (-Math.random()*tw).toFixed(2);

          // лёгкий рандом поворота
          const ang = (Math.random()*360).toFixed(1) + 'deg';

          // Позиция отдельными свойствами → анимация transform не ломает координаты
          e.style.left = x + 'vw';
          e.style.top  = y + 'vh';
          e.style.transform = `rotate(${ang})`;

          // CSS-переменные для .star
          e.style.setProperty('--sz',  sz + 'px');
          e.style.setProperty('--a',   alp);     // ВАЖНО: это альфа, не градусы!
          e.style.setProperty('--tw',  tw + 's');
          e.style.setProperty('--de',  de + 's');

          frag.appendChild(e);
        }
        wrap.appendChild(frag);
      };

      mk(this.$.s1, n1);
      mk(this.$.s2, n2);
    }
  }

  customElements.define('launch-splash', LaunchSplash);
})();
