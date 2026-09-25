import type { MusicFrame } from '../../analysis/types';
import { clamp, damp } from '../common/math';
import { BeatClock } from './BeatClock';
import { Composer, type Act, type JumpAct } from './Composer';
import { EntityPool, type Entity } from './Entities';
import { Hero, type HeroState } from './Hero';
import { MOODS, PAL, type MoodName } from './palette';
import { Particles } from './Particles';
import { drawText, textWidth } from './PixelFont';
import { Scenery } from './Scenery';
import { TILE, World } from './World';

const WIND_SEC = 0.1; // attack wind-up before the beat
const RECOVER_SEC = 0.2;
const LAND_SEC = 0.13;
const SLAM_SEC = 0.35;

/**
 * The autoplatformer. Time flows in beats: every frame the song's beat
 * position is read from the clock, and the hero's position, pose and every
 * event (take-off, landing, strike, cascade) are derived from the composer's
 * score. Nothing is simulated that could fall out of time.
 */
export class Game {
  readonly world = new World();
  readonly entities = new EntityPool();
  readonly particles = new Particles();
  readonly hero = new Hero();
  readonly clock = new BeatClock();
  readonly composer = new Composer(this.world, this.entities, this.clock);
  private scenery = new Scenery();

  private camX = 0;
  private camY = 0;
  private shake = 0;
  private flash = 0;
  private flashColor: string = PAL.white;
  private time = 0;
  private mood: MoodName = 'dusk';
  private prevMood: MoodName = 'dusk';
  private moodBlend = 1;
  private overdrive = 0;
  private songId = -1;
  private stage = 0;
  private stageTitle = '';
  private stageT = 99;
  private lastTime = 0;
  private started = false;
  private waitT = 0;
  private lastP = 0;
  private landedAt = -99;
  private landedSpecial = false;
  private seed = 1;

  // HUD
  private score = 0;
  private shownScore = 0;
  private combo = 0;
  private label = '';
  private labelT = 9;
  private labelBig = false;
  hudTop = 30;

  private music = { kick: 0, snare: 0, hat: 0, bass: 0, mid: 0, treble: 0 };

  // ---------------------------------------------------------------- stage

  private newSong(title: string): void {
    this.stage++;
    this.stageTitle = title;
    this.stageT = 0;
    this.score = 0;
    this.shownScore = 0;
    this.started = false;
    this.waitT = 0;
    this.seed = 1000 + this.stage * 7919;
    this.idleStage();
  }

  /** Before the beat grid is known: the hero waits on a small meadow. */
  private idleStage(): void {
    this.entities.clear();
    this.particles.clear();
    this.composer.reset(this.seed, 1e6, 1, 5 * TILE, 11);
    this.hero.reset(5 * TILE, 11 * TILE);
    this.camX = this.hero.x - 90;
    this.camY = this.hero.y - 140;
  }

  /** Start (or restart after a seek) the score from the next downbeat. */
  private startScore(): void {
    const unit = this.clock.bpm > 140 ? 2 : 1;
    const p = this.clock.beat / unit;
    let s = Math.ceil(p + 1.5);
    while ((s * unit) % 4 !== 0) s++;
    const x0 = this.hero.x;
    this.entities.clear();
    this.composer.reset(this.seed++, s, unit, x0, 11);
    this.hero.reset(x0, 11 * TILE);
    this.combo = 0;
    this.started = true;
    this.lastP = p;
    this.landedAt = -99;
    this.label = 'READY';
    this.labelT = 0;
    this.labelBig = true;
  }

  // ---------------------------------------------------------------- update

  update(m: MusicFrame, viewW: number, viewH: number): void {
    const dt = Math.min(1 / 20, m.dt);
    this.time += dt;
    if (m.songId !== this.songId) {
      this.songId = m.songId;
      this.newSong(m.songTitle);
    }
    this.clock.update(m, dt);
    const mu = this.music;
    mu.kick = m.kickEnv; mu.snare = m.snareEnv; mu.hat = m.hatEnv;
    mu.bass = damp(mu.bass, m.bands.bass, 0.08, dt);
    mu.mid = damp(mu.mid, m.bands.mid, 0.1, dt);
    mu.treble = damp(mu.treble, m.bands.treble, 0.1, dt);
    this.composer.liveIntensity = m.intensity;
    this.composer.liveLevel = m.sectionLevel;
    this.updateMood(m, dt);

    // Start once the exact beat grid is available (or after a grace period).
    const wasExact = this.startedExact;
    if (!this.started && m.playing) {
      this.waitT += dt;
      if (this.clock.exact || this.waitT > 6) { this.startScore(); this.startedExact = this.clock.exact; }
    } else if (this.started && m.playing) {
      // Seek, or the exact grid arrived after a fallback start: rebuild here.
      if (Math.abs(m.time - this.lastTime) > 0.5 || (!wasExact && this.clock.exact)) {
        this.flash = 0.6;
        this.flashColor = PAL.ink;
        this.startScore();
        this.startedExact = this.clock.exact;
      }
    }
    this.lastTime = m.time;

    const unit = this.composer.unit;
    const p = this.started ? this.clock.beat / unit : 0;
    if (this.started) {
      this.composer.compose(this.camX + viewW + 120);
      this.events(this.lastP, p, m);
      this.lastP = p;
    }
    this.drive(p, dt, m.playing);

    this.entities.update(dt, this.world, mu.kick, mu.hat);
    this.collide();
    this.particles.update(dt);
    this.ambient(dt, viewW, viewH);
    this.entities.sweep(this.camX - 80);

    // Camera: the hero's motion is already smooth, so follow x closely.
    const lead = viewW * 0.3;
    this.camX = damp(this.camX, this.hero.x - lead, 0.08, dt);
    const ground = this.started ? this.composer.groundY(p) : this.hero.y;
    const refY = Math.min(ground, this.hero.y + 30);
    this.camY = damp(this.camY, refY - viewH * 0.7, 0.35, dt);

    this.shake = Math.max(0, this.shake - dt * 14);
    this.flash = Math.max(0, this.flash - dt * 4);
    this.labelT += dt;
    this.stageT += dt;
    this.shownScore += (this.score - this.shownScore) * (1 - Math.exp(-dt / 0.2));
  }

  private startedExact = false;

  /** Pose the hero from the score at slot position p. */
  private drive(p: number, dt: number, playing: boolean): void {
    const c = this.composer;
    const h = this.hero;
    const secPerSlot = this.clock.period * c.unit;
    if (!this.started || p < c.startSlot) {
      h.animate(dt, { x: this.started ? c.slotX(p) : h.x, y: this.started ? c.groundY(p) : h.y, speed: 0, vy: 0, onGround: true, state: 'idle', stateT: this.time, runPhase: 0, charge: 0, anticipation: 0 });
      return;
    }
    const x = c.slotX(p);
    const ppb = c.ppbAt(p);
    const speed = c.isDashSlot(p) ? ppb * 3 / secPerSlot * (1 - (p % 1)) : ppb / secPerSlot;
    let y = c.groundY(p);
    let vy = 0;
    let onGround = true;
    let state: HeroState = playing && ppb > 0 ? 'run' : 'idle';
    let stateT = playing ? 0 : this.time;
    let charge = 0;
    let anticipation = 0;
    let attackWind: number | undefined;
    let nextJump = Infinity;

    for (const a of c.acts) {
      if (a.kind === 'jump') {
        if (p >= a.s0 && p < a.s1) {
          const u = (p - a.s0) / (a.s1 - a.s0);
          y = this.arcY(a, u);
          vy = (this.arcY(a, Math.min(1, u + 0.02)) - y) / (0.02 * (a.s1 - a.s0) * secPerSlot);
          onGround = false;
          state = a.style === 'special' ? 'special' : vy < 0 ? 'jump' : 'fall';
          stateT = (p - a.s0) * secPerSlot;
        } else if (a.s0 > p) nextJump = Math.min(nextJump, a.s0);
      } else if (a.kind === 'charge' && p >= a.s0 && p < a.s1 + 2) {
        charge = clamp((p - a.s0) / (a.s1 - a.s0));
      }
    }
    if (onGround && playing) {
      const since = (p - this.landedAt) * secPerSlot;
      if (this.landedSpecial && since < SLAM_SEC) { state = 'slam'; stateT = since; }
      else if (since < LAND_SEC) { state = 'land'; stateT = since; }
      for (const a of c.acts) {
        if (a.kind === 'strike') {
          const t = (p - a.s) * secPerSlot;
          if (t > -WIND_SEC && t < RECOVER_SEC) { state = 'attack'; stateT = t + WIND_SEC; attackWind = WIND_SEC; }
        } else if (a.kind === 'dash' && p >= a.s0 && p < a.s1) {
          state = 'dash';
          stateT = (p - a.s0) * secPerSlot;
        }
      }
      const toJump = (nextJump - p) * secPerSlot;
      if (toJump < 0.09) anticipation = clamp(1 - toJump / 0.09);
    }
    // One leg cycle per beat when running, per two beats when walking:
    // a foot lands on every beat.
    const steps = ppb / secPerSlot > 55 ? 2 : 1;
    const runPhase = p * Math.PI * steps + Math.PI / 2;
    h.animate(dt, { x, y, speed, vy, onGround, state, stateT, runPhase, charge, anticipation, attackWind });
  }

  /** Parabolic arc between (s0, y0) and (s1, y1), apex `h` above the chord. */
  private arcY(a: JumpAct, u: number): number {
    return (1 - u) * a.y0 + u * a.y1 - 4 * a.h * u * (1 - u);
  }

  /** Fire every scored event whose slot was crossed this frame. */
  private events(p0: number, p1: number, m: MusicFrame): void {
    if (p1 <= p0) return;
    const c = this.composer;
    const crossed = (s: number) => s > p0 && s <= p1;
    const h = this.hero;
    // A foot lands on every beat: tiny squash, dust on strong kicks.
    if (p1 >= c.startSlot && !c.isRest(p1) && h.onGround && Math.floor(p1) !== Math.floor(p0)) {
      const k = this.clock.kickAt(Math.floor(p1) * c.unit);
      h.pulse(0.15 + k * 0.3);
      if (k > 0.6 && m.playing) this.particles.dust(h.x - 2, h.y, 2, -1, 0.5);
    }
    if (crossed(c.startSlot)) { this.label = 'GO!'; this.labelT = 0; this.labelBig = true; }
    for (const a of c.acts) this.fire(a, crossed);
  }

  private fire(a: Act, crossed: (s: number) => boolean): void {
    const h = this.hero;
    const c = this.composer;
    switch (a.kind) {
      case 'jump':
        if (crossed(a.s0)) {
          h.pulse(a.style === 'special' ? -1 : -0.6);
          this.particles.dust(c.slotX(a.s0), a.y0, 5, 0, 0.8);
          if (a.style === 'bounce') this.particles.emit(c.slotX(a.s0), a.y0, 0, 0, 0.25, PAL.white, 12, 0, 0, 4);
        }
        if (crossed(a.s1)) {
          this.landedAt = a.s1;
          this.landedSpecial = a.style === 'special';
          if (a.style === 'stomp') return; // the bounce continues; the kill act handles FX
          const kick = this.clock.kickAt(Math.round(a.s1) * c.unit);
          const lx = c.slotX(a.s1);
          h.pulse(0.45 + kick * 0.5);
          this.particles.dust(lx, a.y1, 6 + Math.round(kick * 8), 0, 0.7 + kick);
          if (a.style === 'special') this.special(lx, a.y1);
          else if (kick > 0.45) {
            this.shake = Math.max(this.shake, 1 + kick * 1.5);
            this.particles.emit(lx, a.y1, 0, 0, 0.3, MOODS[this.mood].rim, 22, 0, 0, 4);
            this.addCombo('');
          }
        }
        break;
      case 'strike':
        if (crossed(a.s)) {
          h.strike(a.air);
          this.particles.burst(h.x + 14, h.y - 10, 5, 90, [PAL.white, PAL.cyan], { life: 0.2, grav: 0, spread: 1.2 });
          this.kill(a.target);
          this.addCombo('');
        }
        break;
      case 'kill':
        if (crossed(a.s)) {
          if (!a.target.arena) this.addCombo('STOMP');
          this.kill(a.target);
        }
        break;
      case 'dash':
        if (crossed(a.s0)) {
          this.particles.dust(h.x, h.y, 8, -1, 1.4);
          this.addCombo('DASH');
        }
        break;
      case 'charge':
        break;
    }
  }

  private addCombo(label: string): void {
    this.combo++;
    this.score += 50 * Math.min(this.combo, 20);
    if (label) { this.label = label; this.labelT = 0; this.labelBig = false; }
    else if (this.combo % 10 === 0) { this.label = `${this.combo} COMBO!`; this.labelT = 0; this.labelBig = false; }
  }

  // ---------------------------------------------------------------- effects

  private kill(e: Entity): void {
    if (!e.alive) return;
    e.alive = false;
    e.dying = 0.25;
    this.shake = Math.max(this.shake, e.kind === 'golem' ? 4 : 1.5);
    const cy = e.y - e.height / 2;
    const colors = e.kind === 'slime' ? [PAL.lime, PAL.green, PAL.white] : e.kind === 'bat' ? [PAL.plum, PAL.red, PAL.yellow]
      : e.kind === 'crate' ? [PAL.orange, PAL.red, PAL.plum] : e.kind === 'golem' ? [PAL.slate, PAL.orange, PAL.yellow, PAL.white] : [PAL.plum, PAL.silver, PAL.white];
    this.particles.burst(e.x, cy, e.kind === 'golem' ? 34 : 16, e.kind === 'golem' ? 220 : 150, colors, { life: 0.6, grav: 380, up: 40, size: e.kind === 'crate' ? 2 : 1 });
    this.particles.burst(e.x, cy, 6, 60, [PAL.white], { life: 0.25, grav: 0 });
    this.score += e.kind === 'golem' ? 500 : 100;
  }

  private special(x: number, y: number): void {
    this.flash = 1;
    this.flashColor = PAL.white;
    this.shake = 5;
    this.overdrive = 6;
    this.prevMood = this.mood;
    this.mood = 'neon';
    this.moodBlend = 0.4;
    this.particles.emit(x, y, 0, 0, 0.55, PAL.white, 90, 0, 0, 4);
    this.particles.emit(x, y, 0, 0, 0.75, PAL.cyan, 150, 0, 0, 4);
    this.particles.burst(x, y - 2, 40, 260, [PAL.white, PAL.cyan, PAL.sky, PAL.yellow], { life: 0.8, grav: 420, up: 60, spread: Math.PI * 1.2 });
    this.particles.dust(x, y, 16, 0, 2.2);
    this.score += 1000;
    this.label = 'DROP!';
    this.labelT = 0;
    this.labelBig = true;
  }

  private updateMood(m: MusicFrame, dt: number): void {
    let want: MoodName = this.mood;
    const tl = m.timeline;
    if (tl) {
      const lvl = m.sectionLevel;
      const late = m.time > tl.duration * 0.82;
      want = lvl >= 2 ? 'neon' : lvl === 1 ? 'night' : late ? 'dawn' : 'dusk';
    } else if (m.playing) {
      if (m.intensity > 0.68) want = 'neon';
      else if (m.intensity > 0.4) want = 'night';
      else if (m.intensity < 0.3) want = 'dusk';
    }
    if (this.overdrive > 0) { want = 'neon'; this.overdrive -= dt; }
    if (want !== this.mood && this.moodBlend >= 1) {
      this.prevMood = this.mood;
      this.mood = want;
      this.moodBlend = 0;
    }
    this.moodBlend = Math.min(1, this.moodBlend + dt / 1.6);
  }

  /** Only pick-ups and dash-throughs need collisions; everything else is scored. */
  private collide(): void {
    const h = this.hero;
    const hx0 = h.x - 5, hx1 = h.x + 5, hy0 = h.y - 16, hy1 = h.y;
    for (const e of this.entities.items) {
      if (!e.alive) continue;
      const ex0 = e.x - e.halfW, ex1 = e.x + e.halfW;
      if (hx1 < ex0 || hx0 > ex1 || hy1 < e.top || hy0 > e.bottom) continue;
      if (e.kind === 'gem') {
        e.alive = false;
        e.dying = 0.2;
        this.particles.burst(e.x, e.y, 10, 70, [PAL.cyan, PAL.white, PAL.sky], { life: 0.4, grav: -40 });
        this.score += 25;
      } else if ((h.state === 'dash' || h.state === 'special') && e.kind === 'crate') {
        this.kill(e);
      }
    }
  }

  private ambient(dt: number, w: number, h: number): void {
    const mu = this.music;
    const rim = MOODS[this.mood].rim;
    const rate = (0.6 + mu.treble * 6 + mu.hat * 10) * dt;
    if (Math.random() < rate) {
      const x = this.camX + Math.random() * w;
      const y = this.camY + h * (0.3 + Math.random() * 0.5);
      if (this.mood === 'neon') this.particles.emit(x, y + 40, (Math.random() - 0.5) * 10, -30 - Math.random() * 30, 1.6, Math.random() < 0.5 ? PAL.cyan : PAL.white, 1, -5, 0.5, 3);
      else if (this.mood === 'dawn') this.particles.emit(x, this.camY - 5, 12 + Math.random() * 10, 18 + Math.random() * 12, 4, Math.random() < 0.5 ? PAL.red : PAL.white, 1, 0, 0.1, 3);
      else this.particles.emit(x, y, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 8, 2.2, Math.random() < 0.3 ? PAL.white : rim, 1, 0, 0.2, 3);
    }
  }

  // ---------------------------------------------------------------- render

  render(c: CanvasRenderingContext2D, w: number, h: number): void {
    const sx = this.shake > 0 ? Math.round((Math.random() - 0.5) * this.shake * 2) : 0;
    const sy = this.shake > 0 ? Math.round((Math.random() - 0.5) * this.shake * 2) : 0;
    const cx = Math.round(this.camX) + sx;
    const cy = Math.round(this.camY) + sy;
    const mu = this.music;
    this.scenery.drawBackground(c, w, h, cx, cy, this.mood, this.prevMood, this.moodBlend, this.time, { bass: mu.bass, hat: mu.hat, kick: mu.kick });
    this.scenery.drawTerrain(c, this.world, cx, cy, w, h, this.time, { kick: mu.kick, hat: mu.hat, mid: mu.mid }, MOODS[this.mood].rim);
    this.entities.render(c, cx, cy, this.time);
    this.hero.render(c, cx, cy);
    this.particles.render(c, cx, cy);
    this.scenery.drawVignette(c, w, h);
    if (this.flash > 0.01) {
      c.globalAlpha = Math.min(1, this.flash) * 0.85;
      c.fillStyle = this.flashColor;
      c.fillRect(0, 0, w, h);
      c.globalAlpha = 1;
    }
    this.drawHud(c, w, h);
  }

  private drawHud(c: CanvasRenderingContext2D, w: number, h: number): void {
    const ink = PAL.ink;
    const sc = String(Math.round(this.shownScore)).padStart(7, '0');
    drawText(c, sc, w - textWidth(sc) - 8, this.hudTop, PAL.white, 1, ink);
    if (this.combo > 1) {
      const t = `x${this.combo}`;
      drawText(c, t, w - textWidth(t) - 8, this.hudTop + 8, this.combo >= 10 ? PAL.yellow : PAL.cyan, 1, ink);
    }
    if (!this.started && this.stageT > 3.2 && Math.floor(this.time * 2) % 2 === 0) {
      const t = 'LISTENING...';
      drawText(c, t, w / 2 - textWidth(t) / 2, Math.round(h * 0.3), PAL.silver, 1, ink);
    }
    if (this.labelT < 0.8 && this.label) {
      const scale = this.labelBig ? 2 : 1;
      const hx = Math.round(this.hero.x - this.camX);
      const hy = Math.round(this.hero.y - this.camY) - 34 - Math.round(this.labelT * 12);
      if (this.labelT < 0.5 || Math.floor(this.labelT * 20) % 2 === 0) {
        drawText(c, this.label, hx - textWidth(this.label, scale) / 2, hy, this.labelBig ? PAL.yellow : PAL.white, scale, ink);
      }
    }
    if (this.stageT < 3.2 && this.stageTitle) {
      const a = this.stageT < 0.3 ? this.stageT / 0.3 : this.stageT > 2.6 ? (3.2 - this.stageT) / 0.6 : 1;
      c.globalAlpha = clamp(a);
      const title = `STAGE ${this.stage}`;
      const maxChars = Math.max(8, Math.floor((w - 16) / 4));
      const sub = this.stageTitle.length > maxChars ? this.stageTitle.slice(0, maxChars - 2) + '..' : this.stageTitle;
      const y = Math.round(h * 0.26);
      c.fillStyle = ink;
      c.fillRect(0, y - 8, w, 30);
      c.fillStyle = PAL.yellow;
      c.fillRect(0, y - 8, w, 1);
      c.fillRect(0, y + 21, w, 1);
      drawText(c, title, w / 2 - textWidth(title, 2) / 2, y - 3, PAL.white, 2, PAL.plum);
      drawText(c, sub, w / 2 - textWidth(sub) / 2, y + 12, PAL.silver);
      c.globalAlpha = 1;
    }
  }
}
