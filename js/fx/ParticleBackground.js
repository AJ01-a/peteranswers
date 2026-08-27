/**
 * ParticleBackground.js — ambient drifting motes on a canvas.
 * Cheap by design: one rAF loop, no per-frame allocation, paused when the tab
 * is hidden or the user asked for reduced motion.
 */

import { on } from '../core/bus.js';

const MAX_PARTICLES = 90;
const MIN_PARTICLES = 26;

export class ParticleBackground {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.particles = [];
    this.activity = 0;          // 0 = calm, 1 = processing
    this.targetActivity = 0;
    this.running = false;
    this.enabled = true;
    this.dpr = 1;
    this.accent = 'rgba(125,211,252,1)';
    this._frame = 0;

    this._resize = this._resize.bind(this);
    this._tick = this._tick.bind(this);

    window.addEventListener('resize', this._resize, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stop();
      else if (this.enabled) this.start();
    });

    on('runtime:change', ({ patch }) => {
      if (!patch || !('peterState' in patch)) return;
      const s = patch.peterState;
      this.targetActivity = s === 'processing' ? 1 : s === 'answering' ? 0.5 : s === 'attentive' ? 0.25 : 0;
    });

    this._resize();
  }

  _readAccent() {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    this.accent = raw || '#7dd3fc';
  }

  _resize() {
    const { canvas } = this;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width || window.innerWidth);
    const h = Math.max(1, rect.height || window.innerHeight);
    // 1.5 is indistinguishable for 1-2px dots and cuts the fill rate by ~44%.
    this.dpr = Math.min(1.5, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * this.dpr);
    canvas.height = Math.round(h * this.dpr);
    this.w = w;
    this.h = h;
    this._seed();
  }

  _seed() {
    const area = this.w * this.h;
    const count = Math.round(
      Math.min(MAX_PARTICLES, Math.max(MIN_PARTICLES, area / 17000))
    );
    const next = [];
    for (let i = 0; i < count; i++) {
      const existing = this.particles[i];
      next.push(existing || {
        x: Math.random() * this.w,
        y: Math.random() * this.h,
        r: 0.5 + Math.random() * 1.5,
        vx: (Math.random() - 0.5) * 0.10,
        vy: -0.04 - Math.random() * 0.12,
        a: 0.10 + Math.random() * 0.35,
        p: Math.random() * Math.PI * 2,     // phase for twinkle
        s: 0.4 + Math.random() * 0.9,       // twinkle speed
      });
    }
    // keep in bounds after a resize
    for (const q of next) {
      if (q.x > this.w) q.x = Math.random() * this.w;
      if (q.y > this.h) q.y = Math.random() * this.h;
    }
    this.particles = next;
  }

  setEnabled(flag) {
    this.enabled = flag;
    if (flag) this.start();
    else {
      this.stop();
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  start() {
    if (this.running || !this.enabled) return;
    this._readAccent();
    this.running = true;
    this._raf = requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  _tick(now) {
    if (!this.running) return;
    const { ctx, dpr } = this;
    this._frame++;
    if (this._frame % 120 === 0) this._readAccent();

    // ease activity toward its target
    this.activity += (this.targetActivity - this.activity) * 0.03;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    const boost = 1 + this.activity * 2.1;
    const glow = 0.55 + this.activity * 0.75;
    const t = now * 0.001;

    ctx.fillStyle = this.accent;
    for (const q of this.particles) {
      q.x += q.vx * boost;
      q.y += q.vy * boost;

      if (q.y < -8) { q.y = this.h + 8; q.x = Math.random() * this.w; }
      if (q.x < -8) q.x = this.w + 8;
      else if (q.x > this.w + 8) q.x = -8;

      const twinkle = 0.62 + 0.38 * Math.sin(t * q.s + q.p);
      ctx.globalAlpha = Math.min(1, q.a * twinkle * glow);
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.r * (1 + this.activity * 0.4), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    this._raf = requestAnimationFrame(this._tick);
  }

  destroy() {
    this.stop();
    window.removeEventListener('resize', this._resize);
  }
}
