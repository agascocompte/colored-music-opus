import type { MusicFrame } from '../../analysis/types';
import { clamp, damp } from '../common/math';
import { BeatClock } from '../common/pixel/BeatClock';
import { PAL } from '../common/pixel/palette';
import { Particles } from '../common/pixel/Particles';
import { drawText, textWidth } from '../common/pixel/PixelFont';
import { ditherEllipse, ellipse } from '../common/pixel/pixel';
import { Arena, ARENAS } from './Arena';
import { DuelComposer, type Beam, type Blast, type DuelEvent, type Strike } from './DuelComposer';
import { POSES, blendPose, newPose, type PoseName, type WPose } from './poses';
import { drawAura, drawBeam, drawBolt, drawColumn, drawFalling, drawLightning, drawRuneCircle, drawShield, drawSpikes } from './Spells';
import { WizardView } from './Wizard';
import { ELEMENTS, WIZARDS, type WizardDef } from './wizards';

interface Label { text: string; t: number; big: boolean; who?: number; color: string }
interface Anchors { x: number; y: number; face: 1 | -1; staff: [number, number]; head: [number, number]; chest: [number, number]; hatTip: [number, number] }
interface FallenHat { i: number; x: number; y: number; vx: number; vy: number; spin: number; vs: number; face: 1 | -1 }

const STANCES = new Set<PoseName>(['idle', 'idle2', 'taunt', 'charge', 'float', 'channel', 'castUp']);
const STRIKES = new Set<PoseName>(['castF', 'swing', 'swingUp', 'slam']);
const INK = PAL.ink;

/**
 * The duel. Like the runner, time flows in beats: poses, positions and spells
 * are read from the composer's score at the current beat, so nothing can
 * drift out of time; particles and secondary motion add the life on top.
 */
export class DuelGame {
  readonly clock = new BeatClock();
  private particles = new Particles();
  private defs: [WizardDef, WizardDef] = [WIZARDS[0], WIZARDS[1]];
  private views: [WizardView, WizardView] = [new WizardView(WIZARDS[0]), new WizardView(WIZARDS[1])];
  composer = new DuelComposer(this.clock, this.defs);
  private arena = new Arena(0, 1);
  private songId = -1;
  private started = false;
  private startedExact = false;
  private waitT = 0;
  private lastTime = 0;
  private lastP = 0;
  private time = 0;
  private camX = 0;
  private camYOff = 0;
  private shake = 0;
  private flash = 0;
  private flashColor = '#ffffff';
  private dark = 0;
  /** Anime-style impact frame: pale screen, ink silhouettes. */
  private impact = 0;
  private labels: Label[] = [];
  private hitFlash = [0, 0];
  shownHp = [1, 1];
  private trailHp = [1, 1];
  private pose: [WPose, WPose] = [newPose(), newPose()];
  private since = [0, 0];
  private curPose: PoseName[] = ['idle', 'idle'];
  private fx: Anchors[] = [0, 1].map((i) => ({ x: i ? 46 : -46, y: 0, face: (i ? -1 : 1) as 1 | -1, staff: [0, -20], head: [0, -18], chest: [0, -9], hatTip: [0, -28] }));
  private mu = { kick: 0, hat: 0, bass: 0 };
  /** 0..1 as the music climbs toward a drop / intense section. */
  private build = 0;
  /** 0..1 while an intense section plays. */
  private intense = 0;
  /** Decaying burst right after a drop. */
  private surge = 0;
  private skyFlash = 0;
  private flashWho = 0;
  private prevT = 0;
  private hats: FallenHat[] = [];
  private p = 0;
  hudTop = 30;

  // ---------------------------------------------------------------- setup

  private newSong(): void {
    const a = Math.floor(Math.random() * WIZARDS.length);
    let b = Math.floor(Math.random() * (WIZARDS.length - 1));
    if (b >= a) b++;
    this.defs = [WIZARDS[a], WIZARDS[b]];
    // ?wizards=ignis,borea forces a pairing (handy for testing).
    const forced = new URLSearchParams(location.search).get('wizards')?.split(',');
    const fa = forced && WIZARDS.find((w) => w.id === forced[0]);
    const fb = forced && WIZARDS.find((w) => w.id === forced[1]);
    if (fa && fb) this.defs = [fa, fb];
    this.views = [new WizardView(this.defs[0]), new WizardView(this.defs[1])];
    const qa = Number(new URLSearchParams(location.search).get('arena'));
    this.arena = new Arena(Number.isInteger(qa) && qa > 0 ? qa - 1 : Math.floor(Math.random() * ARENAS.length), Math.floor(Math.random() * 1e6));
    this.composer = new DuelComposer(this.clock, this.defs);
    this.started = false;
    this.waitT = 0;
    this.labels = [];
    this.hats = [];
    this.shownHp = [1, 1];
    this.trailHp = [1, 1];
    this.particles.clear();
  }

  private koSlot(unit: number): number {
    const tl = this.clock.timeline;
    if (!tl) return Infinity;
    const secs = tl.sections;
    const last = secs[secs.length - 1];
    let tKO = tl.duration - 3 * this.clock.period;
    if (last && last.level === 0 && last.start > tl.duration * 0.7) tKO = last.start;
    return Math.floor(this.clock.beatAt(tKO) / unit);
  }

  private startDuel(winner?: number): void {
    const unit = this.clock.bpm > 140 ? 2 : 1;
    const p = this.clock.beat / unit;
    let s = Math.ceil(p + 1.5);
    while ((s * unit) % 4 !== 0) s++;
    const ko = Math.max(this.koSlot(unit), s + 12);
    const w = winner ?? (Math.random() < 0.5 ? 0 : 1);
    this.composer.reset(Math.floor(Math.random() * 1e9), s, unit, w, ko);
    this.hats = [];
    this.started = true;
    this.lastP = p;
  }

  // ---------------------------------------------------------------- update

  update(m: MusicFrame): void {
    const dt = Math.min(1 / 20, m.dt);
    this.time += dt;
    if (m.songId !== this.songId) { this.songId = m.songId; this.newSong(); }
    this.clock.update(m, dt);
    this.mu.kick = m.kickEnv;
    this.mu.hat = m.hatEnv;
    this.mu.bass = m.bands.bass;

    if (!this.started && m.playing) {
      this.waitT += dt;
      if (this.clock.exact || this.waitT > 6) { this.startDuel(); this.startedExact = this.clock.exact; }
    } else if (this.started && m.playing && (Math.abs(m.time - this.lastTime) > 0.5 || (!this.startedExact && this.clock.exact))) {
      // Seek (or the analysis just arrived): rewrite the score from here, same winner.
      this.flash = 0.5;
      this.flashColor = INK;
      this.startDuel(this.composer.winner);
      this.startedExact = this.clock.exact;
    }
    this.lastTime = m.time;

    const c = this.composer;
    const p = this.started ? this.clock.beat / c.unit : c.startSlot - 1;
    this.p = p;
    if (this.started) {
      c.compose(p + 16);
      if (p > this.lastP) for (const e of c.events) if (e.s > this.lastP && e.s <= p) this.onEvent(e);
      this.lastP = p;
    }

    this.updateEnergy(m, dt);

    // Sample both tracks
    for (const i of [0, 1]) {
      const tr = c.tracks[i];
      const k = tr.find(p);
      const f = this.fx[i];
      if (k < 0) continue;
      const a = tr.keys[k];
      const b = tr.keys[Math.min(k + 1, tr.keys.length - 1)];
      const u = b.s > a.s ? clamp((p - a.s) / (b.s - a.s)) : 1;
      const e = u * u * (3 - 2 * u);
      f.x = a.x + (b.x - a.x) * e;
      f.y = a.y + (b.y - a.y) * e;
      blendPose(POSES[a.pose], POSES[b.pose], u, this.pose[i]);
      let k0 = k;
      while (k0 > 0 && tr.keys[k0 - 1].pose === a.pose) k0--;
      this.since[i] = (p - tr.keys[k0].s) * c.unit;
      this.curPose[i] = a.pose;
      // Every beat, the stance dips (and the ascended float a little higher).
      if (STANCES.has(a.pose)) {
        const ph = p - Math.floor(p);
        const pulse = Math.exp(-ph * 6);
        const pz = this.pose[i];
        // A dip on the beat, then a breathing sway through the rest of it
        pz.crouch += 1.3 * pulse + 0.5 * (1 - Math.cos(ph * Math.PI * 2)) * 0.5;
        pz.sa += Math.sin(ph * Math.PI * 2 + i) * 0.07;
        pz.lean += Math.sin(this.time * 1.4 + i * 2) * 0.5;
        pz.flare += 0.15 + 0.1 * Math.sin(this.time * 3 + i);
        pz.eye = Math.max(pz.eye, this.build * 0.9);
        if (this.ascended(i) && a.pose !== 'charge') f.y -= 4 + Math.sin(this.time * 2.5 + i) * 1.5;
      }
    }
    for (const i of [0, 1]) this.fx[i].face = this.fx[1 - i].x >= this.fx[i].x ? 1 : -1;
    for (const i of [0, 1]) {
      const cp = this.curPose[i];
      const trail = cp === 'dash' || cp === 'knock' || (cp === 'float' && this.since[i] < 0.5);
      this.views[i].update(dt, this.fx[i].x, this.fx[i].y, this.fx[i].face, this.pose[i], trail);
    }

    // Spell trails
    for (const b of c.blasts) {
      if (p < b.s0 || p > b.s1) continue;
      const [x, y] = this.blastPos(b, p);
      const st = ELEMENTS[this.defs[b.from].element];
      const n = b.big ? 3 : 1;
      for (let k = 0; k < n; k++) this.particles.emit(x + (Math.random() - 0.5) * 3, y + (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20 - 10, 0.25 + Math.random() * 0.2, Math.random() < 0.5 ? st.main : st.light, b.big ? 2 : 1, -20, 2);
    }
    for (const s of c.strikes) this.strikeParticles(s, p);
    for (const bm of c.beams) {
      if (p < bm.s0 || p > bm.s1 || !bm.clash || bm.from !== 0 || p > bm.clash.until) continue;
      const x = this.clashX(p), y = this.beamY(bm);
      for (const i of [0, 1]) {
        const st = ELEMENTS[this.defs[i].element];
        this.particles.emit(x, y, (i ? 1 : -1) * (40 + Math.random() * 80), (Math.random() - 0.5) * 120, 0.3, Math.random() < 0.5 ? st.light : st.main, 1, 120, 1);
      }
      this.shake = Math.max(this.shake, 0.8);
    }
    // Ascended wizards shed embers from the hat
    for (const i of [0, 1]) {
      if (!this.ascended(i) || p >= c.st[i].deadAt || Math.random() > 0.35) continue;
      const st = ELEMENTS[this.defs[i].element];
      const [hx, hy] = this.fx[i].hatTip;
      this.particles.emit(hx + (Math.random() - 0.5) * 2, hy, (Math.random() - 0.5) * 10, -20 - Math.random() * 20, 0.5 + Math.random() * 0.4, Math.random() < 0.5 ? st.main : st.light, 1, -10, 1);
    }

    // Darken while magic gathers
    let dk = 0;
    for (const i of [0, 1]) dk = Math.max(dk, this.auraAt(i, p) * 0.6);
    if (c.beams.some((bm) => bm.clash && p >= bm.s0 && p < bm.clash.until + 0.3)) dk = 1;
    this.dark = damp(this.dark, dk, 0.3, dt);

    // Camera: frame both wizards
    const alive = [0, 1].filter((i) => p < c.st[i].deadAt);
    // (a fallen hat stays in frame next to the winner)
    const xs = [...alive.map((i) => this.fx[i].x), ...this.hats.map((hh) => hh.x)];
    const mid = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
    this.camX = damp(this.camX, mid, 0.25, dt);
    const minY = Math.min(this.fx[0].y, this.fx[1].y);
    this.camYOff = damp(this.camYOff, Math.max(0, -minY - 16) * 0.6, 0.3, dt);

    for (const i of [0, 1]) {
      const hp = this.hpAt(i, p);
      this.shownHp[i] = damp(this.shownHp[i], hp, 0.08, dt);
      this.trailHp[i] = this.trailHp[i] > this.shownHp[i] ? damp(this.trailHp[i], this.shownHp[i], 0.6, dt) : this.shownHp[i];
      this.hitFlash[i] = Math.max(0, this.hitFlash[i] - dt);
    }
    // Fallen hats
    for (const hat of this.hats) {
      hat.vy += 420 * dt;
      hat.x += hat.vx * dt;
      hat.y += hat.vy * dt;
      hat.spin += hat.vs * dt;
      if (hat.y > 0) {
        hat.y = 0;
        hat.vy = Math.abs(hat.vy) > 40 ? -hat.vy * 0.35 : 0;
        hat.vx *= 0.5;
        hat.vs = 0;
        hat.spin = damp(hat.spin, 0, 0.05, dt);
      }
    }
    // Victory fireworks on every beat
    if (c.finished && p > c.koSlot + 4 && Math.floor(p) !== Math.floor(p - dt / Math.max(0.05, this.clock.period))) {
      const w = c.winner;
      const st = ELEMENTS[this.defs[w].element];
      const x = this.fx[w].x + (Math.random() - 0.5) * 80, y = -50 - Math.random() * 30;
      this.particles.burst(x, y, 22, 110, [st.main, st.light, PAL.white], { life: 0.9, grav: 60 });
    }
    this.particles.update(dt);
    this.impact = Math.max(0, this.impact - dt);
    this.shake = Math.max(0, this.shake - dt * 12);
    this.flash = Math.max(0, this.flash - dt * 3);
    for (const l of this.labels) l.t += dt;
    this.labels = this.labels.filter((l) => l.t < (l.big ? 1.4 : 0.9));
  }

  /** Build-ups, drops and intense stretches, read ahead from the timeline. */
  private updateEnergy(m: MusicFrame, dt: number): void {
    const tl = this.clock.timeline;
    let build = 0;
    let intense = m.sectionLevel === 2 ? 1 : 0;
    if (tl) {
      const t = m.time;
      const cur = tl.sectionAt(t);
      const next = tl.nextSection(t);
      if (next && (next.isDrop || next.level > (cur?.level ?? 0))) {
        const len = next.isDrop ? 16 : 8;
        const beatsTo = this.clock.beatAt(next.start) - this.clock.beat;
        if (beatsTo < len) build = clamp(1 - beatsTo / len) * (next.isDrop ? 1 : 0.6);
      }
      intense = cur?.level === 2 ? 1 : 0;
      if (m.playing && this.started && t > this.prevT && t - this.prevT < 0.5) {
        for (const s of tl.sections) if (s.start > this.prevT && s.start <= t && (s.isDrop || s.level === 2)) this.surgeBurst(s.isDrop ? 1 : 0.6);
      }
    } else build = clamp(m.trend * 6) * 0.6;
    this.prevT = m.time;
    this.build = damp(this.build, build, 0.15, dt);
    this.intense = damp(this.intense, intense, 0.6, dt);
    this.surge = Math.max(0, this.surge - dt * 0.6);
    this.skyFlash = Math.max(0, this.skyFlash - dt * 5);
    if (!this.started) return;
    const els = [0, 1].map((i) => ELEMENTS[this.defs[i].element]);
    const alive = (i: number) => this.p < this.composer.st[i].deadAt;
    // As the music rises, the arena's magic streams into both staffs.
    const rate = this.build * this.build * 110 * dt;
    const n = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const i = Math.random() < 0.5 ? 0 : 1;
      if (!alive(i)) continue;
      const [tx, ty] = this.fx[i].staff;
      const a = Math.random() * Math.PI * 2, r = 45 + Math.random() * 70;
      const x0 = tx + Math.cos(a) * r, y0 = ty + Math.sin(a) * r * 0.6;
      const life = 0.4 + Math.random() * 0.25;
      this.particles.emit(x0, y0, (tx - x0) / life, (ty - y0) / life, life, Math.random() < 0.5 ? els[i].main : els[i].light, 1, 0, 0);
    }
    this.shake = Math.max(this.shake, this.build > 0.7 ? (this.build - 0.7) * 3 : 0);
    // Intense stretches: the floor answers every kick, the sky every snare.
    if (this.intense > 0.5) {
      if (m.kick) for (const i of [0, 1]) if (alive(i)) this.particles.emit(this.fx[i].x, -1, 0, 0, 0.35, els[i].main, 22, 0, 0, 4);
      if (m.snare) { this.skyFlash = 1; this.flashWho = Math.random() < 0.5 ? 0 : 1; }
    }
  }

  /** The drop lands: shockwave across the arena, debris, the world lights up. */
  private surgeBurst(k: number): void {
    const f0 = this.fx[0], f1 = this.fx[1];
    const mid = (f0.x + f1.x) / 2;
    this.surge = k;
    this.flash = Math.max(this.flash, 0.9 * k);
    this.flashColor = '#ffffff';
    this.shake = Math.max(this.shake, 7 * k);
    this.particles.emit(mid, -2, 0, 0, 0.9, PAL.white, 240, 0, 0, 4);
    for (const i of [0, 1]) this.particles.emit(mid, -2, 0, 0, 1.1 + i * 0.2, ELEMENTS[this.defs[i].element].main, 170 + i * 40, 0, 0, 4);
    const g = this.arena.def.ground;
    this.particles.burst(mid, 0, Math.round(40 * k), 260, [g.top, g.fill, g.rim], { life: 1.2, grav: 500, up: 120, size: 2 });
    this.particles.dust(f0.x, 0, 10, 0, 2.5);
    this.particles.dust(f1.x, 0, 10, 0, 2.5);
  }

  /** Big rune circle between the wizards: it draws itself during the build-up (one glyph lit per beat), then pulses through intense parts. */
  private drawDuelCircle(c: CanvasRenderingContext2D, ox: number, oy: number, p: number): void {
    const k = Math.max(this.build, this.intense * 0.7, this.surge);
    if (k < 0.03) return;
    const alive = [0, 1].filter((i) => p < this.composer.st[i].deadAt);
    if (alive.length < 2) return;
    const [f0, f1] = this.fx;
    const left = f0.x <= f1.x ? 0 : 1;
    const elL = ELEMENTS[this.defs[left].element], elR = ELEMENTS[this.defs[1 - left].element];
    const cx = (f0.x + f1.x) / 2 - ox, cy = -oy + 1;
    const rx = Math.max(46, Math.abs(f0.x - f1.x) / 2 + 20) * (1 + this.mu.kick * 0.04 * this.intense);
    const prog = this.intense > 0.6 || this.surge > 0 ? 1 : clamp(this.build * 1.05);
    const rot = this.time * (0.25 + this.build * 1.5);
    const n = Math.round(rx * 5);
    for (let i = 0; i < n; i++) {
      const u = i / n;
      if (u > prog) break;
      const a = -Math.PI / 2 + rot + u * Math.PI * 2;
      const ca = Math.cos(a);
      const el = ca < 0 ? elL : elR;
      c.globalAlpha = Math.min(1, k * 1.2);
      c.fillStyle = i % 4 ? el.main : el.light;
      c.fillRect(Math.round(cx + ca * rx), Math.round(cy + Math.sin(a) * rx * 0.2), 1, 1);
      if (i % 3 === 0) {
        const b = -a - rot * 2;
        c.fillStyle = el.dark;
        c.fillRect(Math.round(cx + Math.cos(b) * rx * 0.82), Math.round(cy + Math.sin(b) * rx * 0.82 * 0.2), 1, 1);
      }
    }
    // Twelve glyphs; a chaser runs around them, one per beat
    const beat = Math.floor(p);
    const ph = p - beat;
    for (let j = 0; j < 12; j++) {
      const u = j / 12;
      if (u > prog) break;
      const a = -Math.PI / 2 + rot + u * Math.PI * 2;
      const gx = Math.round(cx + Math.cos(a) * rx), gy = Math.round(cy + Math.sin(a) * rx * 0.2);
      const hot = ((beat % 12) + 12) % 12 === j;
      const el = Math.cos(a) < 0 ? elL : elR;
      c.globalAlpha = Math.min(1, k * (hot ? 1.5 - ph : 0.8));
      c.fillStyle = hot ? PAL.white : el.light;
      c.fillRect(gx - 1, gy - 1, 3, 1);
      c.fillRect(gx, gy - 2, 1, 3);
      if (hot) {
        c.fillStyle = el.main;
        c.fillRect(gx, gy - 6 - Math.round(ph * 6), 1, 4);
      }
    }
    c.globalAlpha = 1;
  }

  private ascended(i: number): boolean { return this.p >= this.composer.st[i].ascFrom; }

  private hpAt(i: number, p: number): number {
    let hp = 1;
    for (const e of this.composer.st[i].hp) { if (e.s <= p) hp = e.hp; else break; }
    return hp;
  }

  private rangeK(rs: { s0: number; s1: number }[], p: number, fadeIn = 0.3, fadeOut = 0.5): number {
    let k = 0;
    for (const r of rs) if (p >= r.s0 - fadeIn && p <= r.s1 + fadeOut) k = Math.max(k, clamp((p - r.s0 + fadeIn) / fadeIn) * clamp((r.s1 + fadeOut - p) / fadeOut));
    return k;
  }

  private auraAt(i: number, p: number): number { return this.rangeK(this.composer.st[i].aura, p); }

  private inRange(rs: { s0: number; s1: number }[], p: number): boolean { return rs.some((r) => p >= r.s0 && p < r.s1); }

  private label(text: string, big: boolean, who?: number, color: string = PAL.yellow): void {
    this.labels.push({ text, t: 0, big, who, color });
  }

  private onEvent(e: DuelEvent): void {
    const f = (i: number) => this.fx[i];
    const el = (i: number) => ELEMENTS[this.defs[i].element];
    switch (e.kind) {
      case 'hit': {
        const t = f(e.target), st = el(1 - e.target);
        const [x, y] = t.chest;
        this.particles.burst(x, y, e.heavy ? 16 : 8, e.heavy ? 170 : 110, [PAL.white, st.light, st.main], { life: 0.3, grav: 0 });
        this.particles.emit(x, y, 0, 0, 0.2, PAL.white, e.heavy ? 16 : 9, 0, 0, 4);
        this.hitFlash[e.target] = 0.07;
        this.shake = Math.max(this.shake, e.heavy ? 4 : 1.5);
        if (e.heavy) this.impact = 0.06;
        break;
      }
      case 'block': {
        const t = f(e.target), st = el(e.target);
        const x = t.x + t.face * 9, y = t.chest[1];
        this.particles.burst(x, y, 6, 80, [st.light, PAL.white], { life: 0.2, grav: 0, spread: 1.4 });
        break;
      }
      case 'cast': {
        const st = el(e.who);
        const [x, y] = f(e.who).staff;
        this.particles.emit(x, y, 0, 0, 0.18, st.light, 7, 0, 0, 4);
        this.particles.burst(x, y, 5, 60, [st.main, st.light], { life: 0.2, grav: 0 });
        break;
      }
      case 'dust': {
        const t = f(e.who);
        this.particles.dust(t.x, 0, e.big ? 10 : 5, 0, e.big ? 1.8 : 1);
        break;
      }
      case 'text':
        this.label(e.text, e.big, e.who, e.who === undefined ? PAL.yellow : el(e.who).light === PAL.white ? el(e.who).main : el(e.who).light);
        break;
      case 'explode': {
        const t = f(e.who), st = el(e.from);
        const [x, y] = t.chest;
        this.particles.emit(x, y, 0, 0, 0.35, PAL.white, e.size * 1.4, 0, 0, 4);
        this.particles.emit(x, y, 0, 0, 0.5, st.main, e.size * 2.2, 0, 0, 4);
        this.particles.burst(x, y, Math.round(e.size * 1.6), 50 + e.size * 8, [PAL.white, st.light, st.main, st.dark], { life: 0.55, grav: 40 });
        if (e.size > 12) { this.flash = Math.max(this.flash, 0.5); this.flashColor = st.light; }
        this.shake = Math.max(this.shake, e.size * 0.15);
        break;
      }
      case 'ascend': {
        const t = f(e.who), st = el(e.who);
        this.flash = 0.9;
        this.flashColor = st.light;
        this.particles.burst(t.x, t.y - 14, 40, 200, [st.main, st.light, PAL.white], { life: 0.9, grav: -60 });
        this.particles.emit(t.x, t.y - 12, 0, 0, 0.6, st.light, 40, 0, 0, 4);
        this.label('ASCENDED!', true, e.who, st.light);
        break;
      }
      case 'ko':
        this.flash = 1;
        this.flashColor = '#ffffff';
        this.shake = 6;
        this.label('K.O.', true, undefined, PAL.red);
        break;
      case 'death': {
        const t = f(e.who), d = this.defs[e.who], st = el(e.who);
        // The wizard dissolves into sparks; the hat is all that remains.
        for (let k = 0; k < 70; k++) {
          const col = [d.robe, d.robeShade, d.trim, st.main, st.light][k % 5];
          this.particles.emit(t.x + (Math.random() - 0.5) * 22, t.y - Math.random() * 6, (Math.random() - 0.5) * 30, -20 - Math.random() * 60, 0.8 + Math.random() * 0.9, col, Math.random() < 0.3 ? 2 : 1, -30, 1);
        }
        this.hats.push({ i: e.who, x: t.x - t.face * 6, y: -6, vx: -t.face * 25, vy: -140, spin: 0, vs: -t.face * 8, face: t.face });
        this.flash = 0.6;
        this.flashColor = st.light;
        break;
      }
      case 'duel':
        this.label('DUEL!', true, undefined, PAL.yellow);
        this.flash = 0.4;
        this.flashColor = '#ffffff';
        break;
      case 'clash': {
        const x = (f(0).x + f(1).x) / 2, y = (f(0).chest[1] + f(1).chest[1]) / 2 - 4;
        this.impact = 0.07;
        this.shake = 5;
        this.particles.emit(x, y, 0, 0, 0.45, PAL.white, 50, 0, 0, 4);
        for (const i of [0, 1]) this.particles.burst(x, y, 14, 200, [el(i).main, el(i).light], { life: 0.4, grav: 0 });
        this.particles.dust(x, 0, 12, 0, 2.2);
        break;
      }
      case 'blink': {
        const t = f(e.who), st = el(e.who);
        this.particles.burst(t.x, t.y - 12, 16, 120, [st.main, st.light, PAL.white], { life: 0.3, grav: 0 });
        this.particles.emit(t.x, t.y - 12, 0, 0, 0.25, st.light, 12, 0, 0, 4);
        break;
      }
    }
  }

  // ---------------------------------------------------------------- geometry

  private blastPos(b: Blast, p: number): [number, number] {
    const u = clamp((p - b.s0) / (b.s1 - b.s0));
    const a = this.fx[b.from], t = this.fx[b.to];
    const [x0, y0] = a.staff;
    const [x1, y1] = t.chest;
    const x = x0 + (x1 - x0) * u;
    const y = y0 + (y1 - y0) * u - Math.sin(u * Math.PI) * (b.arc + (b.big ? 4 : 0)) + (b.big ? Math.sin(p * 20) : 0);
    return [x, y];
  }

  private beamY(bm: Beam): number {
    if (bm.clash) return Math.round((this.fx[0].staff[1] + this.fx[1].staff[1]) / 2);
    return Math.round(this.fx[bm.from].staff[1]);
  }

  /** The point where two rays meet, pushed back and forth on the beat. */
  private clashX(p: number): number {
    const mid = (this.fx[0].x + this.fx[1].x) / 2;
    return mid + Math.sin(p * Math.PI) * 5 + Math.sin(p * 0.7) * 3;
  }

  private strikeParticles(s: Strike, p: number): void {
    const st = ELEMENTS[this.defs[s.from].element];
    const t = this.fx[s.to];
    if (p >= s.s - 0.5 && p < s.s + 0.6 && s.kind === 'pillar' && Math.random() < 0.6) {
      // The crack running along the ground
      const u = clamp((p - s.s0) / (s.s - s.s0));
      const x = this.fx[s.from].x + (t.x - this.fx[s.from].x) * u;
      this.particles.emit(x, -1, (Math.random() - 0.5) * 30, -30 - Math.random() * 40, 0.4, Math.random() < 0.5 ? st.main : st.dark, 1, 200, 1);
    }
    if (s.kind === 'sky' && p >= s.s0 && p < s.s && Math.random() < 0.5) {
      this.particles.emit(t.x + (Math.random() - 0.5) * 24, -80 - Math.random() * 20, 0, 30, 0.6, st.main, 1, 0, 0);
    }
  }

  // ---------------------------------------------------------------- render

  render(c: CanvasRenderingContext2D, w: number, h: number): void {
    const comp = this.composer;
    const p = this.p;
    // Portrait screens: keep the action near the middle instead of under a huge sky.
    const gy = Math.round(Math.min(h * 0.74, h * 0.5 + 70));
    const sx = this.shake > 0 ? Math.round((Math.random() - 0.5) * this.shake * 2) : 0;
    const sy = this.shake > 0 ? Math.round((Math.random() - 0.5) * this.shake) : 0;
    // world → screen: X = x - ox, Y = y - oy
    const ox = Math.round(this.camX - w / 2) - sx;
    const oy = -gy - Math.round(this.camYOff) - sy;
    const impact = this.impact > 0;

    if (impact) {
      c.fillStyle = '#f4f4f4';
      c.fillRect(0, 0, w, h);
    } else {
      const cols: [string, string] = [ELEMENTS[this.defs[0].element].main, ELEMENTS[this.defs[1].element].main];
      this.arena.draw(c, w, h, this.camX, gy + Math.round(this.camYOff) + sy, this.time, {
        kick: this.mu.kick, hat: this.mu.hat, bass: this.mu.bass, beat: p, dark: Math.max(this.dark, this.build * 0.8),
        intense: Math.max(this.intense, this.surge), surge: this.surge, skyFlash: this.skyFlash, colors: cols, flashWho: this.flashWho,
      });
    }

    const pulse = Math.exp(-(p - Math.floor(p)) * 5);
    if (!impact) {
      // Rune circles under casters; strike telegraphs on the ground
      for (const i of [0, 1]) {
        const k = this.rangeK(comp.st[i].circle, p, 0.25, 0.3);
        if (k > 0.02) drawRuneCircle(c, ELEMENTS[this.defs[i].element], this.fx[i].x - ox, -oy + 1, 16, this.time * (i ? -1 : 1), k, pulse);
      }
      for (const s of comp.strikes) this.drawStrikeGround(c, s, p, ox, oy);
      this.drawDuelCircle(c, ox, oy, p);
    }

    // Wizards (the one being hit is drawn first)
    const order = this.hitFlash[0] > this.hitFlash[1] ? [0, 1] : [1, 0];
    for (const i of order) {
      const st = comp.st[i];
      if (p >= st.deadAt) continue;
      const f = this.fx[i];
      const el = ELEMENTS[this.defs[i].element];
      const x = f.x - ox, y = f.y - oy;
      if (!impact) {
        // Contact shadow (shrinks when airborne) and, in dark arenas, a soft back light
        const air = clamp(-f.y / 40);
        c.globalAlpha = 0.35 * (1 - air * 0.7);
        ellipse(c, x, -oy + 1, 8 - air * 4, 1.5, INK);
        const bl = this.arena.def.backlight;
        if (bl) {
          c.globalAlpha = 0.14;
          ellipse(c, x, y - 12, 12, 16, bl);
        }
        c.globalAlpha = 1;
      }
      const aura = this.auraAt(i, p);
      if (aura > 0.02 && !impact) drawAura(c, el, x, y, aura, this.time + i);
      if (this.inRange(st.vanish, p)) continue;
      const asc = this.ascended(i);
      if (asc && !impact) this.drawOrbit(c, i, x, y, false);
      // Squash & stretch on top of the pose
      let ssx = 1, ssy = 1;
      const cp = this.curPose[i];
      if (STANCES.has(cp)) { ssy -= 0.06 * pulse; ssx += 0.04 * pulse; }
      else if (STRIKES.has(cp)) { const pop = Math.exp(-this.since[i] * 12); ssx += 0.14 * pop; ssy -= 0.05 * pop; }
      else if (cp === 'hit') { const r = Math.exp(-this.since[i] * 10); ssx -= 0.1 * r; ssy += 0.05 * r; }
      const glow = Math.max(this.rangeK(st.glow, p, 0.3, 0.3), pulse * this.mu.kick * 0.5, this.build * 0.8);
      // Power trembles while charging in a build-up
      const tremble = (cp === 'charge' || cp === 'channel') && this.build > 0.3 ? (Math.floor(this.time * 40) % 2 ? 1 : -1) * Math.round(this.build) : 0;
      const res = this.views[i].render(c, x + tremble, y, f.face, this.pose[i], {
        tint: impact ? INK : this.hitFlash[i] > 0 ? '#ffffff' : undefined,
        sx: ssx, sy: ssy, asc: asc ? 1 : 0, glow,
      });
      f.staff = [res.staff[0] + ox, res.staff[1] + oy];
      f.head = [res.head[0] + ox, res.head[1] + oy];
      f.chest = [res.chest[0] + ox, res.chest[1] + oy];
      f.hatTip = [res.hatTip[0] + ox, res.hatTip[1] + oy];
      if (asc && !impact) this.drawOrbit(c, i, x, y, true);
      if (cp === 'block' && !impact) drawShield(c, el, x + f.face * 5, f.chest[1] - oy, f.face, clamp(1 - this.since[i] * 0.8, 0.5, 1), this.time);
    }

    if (!impact) {
      for (const hat of this.hats) this.views[hat.i].drawHat(c, hat.x - ox, hat.y - oy - 2, hat.face, hat.spin);
      for (const b of comp.blasts) {
        if (p < b.s0 || p > b.s1) continue;
        const [x, y] = this.blastPos(b, p);
        const [x2, y2] = this.blastPos(b, Math.min(b.s1, p + 0.02));
        drawBolt(c, ELEMENTS[this.defs[b.from].element], x - ox, y - oy, x2 - x || this.fx[b.from].face, y2 - y, this.time, b.big);
      }
      for (const bm of comp.beams) this.drawBeamAt(c, bm, p, ox, oy);
      for (const s of comp.strikes) this.drawStrikeAir(c, s, p, ox, oy, gy);
    }
    this.particles.render(c, ox, oy);

    if (this.flash > 0.01) {
      c.globalAlpha = Math.min(1, this.flash) * 0.7;
      c.fillStyle = this.flashColor;
      c.fillRect(0, 0, w, h);
      c.globalAlpha = 1;
    }
    this.drawHud(c, w, h, p, ox, oy);
  }

  /** Three runes orbiting an ascended wizard (back half, then front half). */
  private drawOrbit(c: CanvasRenderingContext2D, i: number, x: number, y: number, front: boolean): void {
    const st = ELEMENTS[this.defs[i].element];
    for (let k = 0; k < 3; k++) {
      const a = this.time * 2.4 + (k / 3) * Math.PI * 2 + i;
      const isFront = Math.sin(a) > 0;
      if (isFront !== front) continue;
      const rx = Math.round(x + Math.cos(a) * 12), ry = Math.round(y - 12 + Math.sin(a) * 4);
      c.fillStyle = front ? st.light : st.dark;
      c.fillRect(rx - 1, ry, 3, 1);
      c.fillRect(rx, ry - 1, 1, 3);
      if (front) { c.fillStyle = PAL.white; c.fillRect(rx, ry, 1, 1); }
    }
  }

  private drawBeamAt(c: CanvasRenderingContext2D, bm: Beam, p: number, ox: number, oy: number): void {
    if (p < bm.s0 || p > bm.s1) return;
    const a = this.fx[bm.from], t = this.fx[1 - bm.from];
    const st = ELEMENTS[this.defs[bm.from].element];
    const x0 = a.staff[0];
    const y = this.beamY(bm) - oy;
    const grow = clamp((p - bm.s0) / 0.15);
    const fade = clamp((bm.s1 - p) / 0.2);
    let x1 = t.chest[0];
    if (bm.clash) {
      const cx = this.clashX(p);
      if (p < bm.clash.until) x1 = cx;
      else if (bm.clash.win) x1 = cx + (t.chest[0] - cx) * clamp((p - bm.clash.until) / 0.3);
      else x1 = cx - (cx - x0) * clamp((p - bm.clash.until) / 0.3);
    }
    x1 = x0 + (x1 - x0) * grow;
    const width = (bm.clash ? 4 : 3.5) * (0.4 + 0.6 * fade);
    drawBeam(c, st, x0 - ox, x1 - ox, y, this.time, width);
    // Flare at the staff and a burst at the head
    const pulse = Math.sin(this.time * 40) > 0 ? 1 : 0;
    const ph = Math.floor(this.time * 20);
    ditherEllipse(c, x0 - ox, y, 4 + pulse, 4 + pulse, st.light, ph);
    ellipse(c, x0 - ox, y, 2, 2, PAL.white);
    ditherEllipse(c, x1 - ox, y, 5 + pulse, 5 + pulse, st.main, ph + 1);
    ellipse(c, x1 - ox, y, 2 + pulse, 2 + pulse, PAL.white);
  }

  private drawStrikeGround(c: CanvasRenderingContext2D, s: Strike, p: number, ox: number, oy: number): void {
    const st = ELEMENTS[this.defs[s.from].element];
    const t = this.fx[s.to];
    if (s.kind === 'sky' && p >= s.s0 && p < s.s) {
      // Target sigil under the victim
      const k = clamp((p - s.s0) / (s.s - s.s0));
      drawRuneCircle(c, st, t.x - ox, -oy + 1, 8 + 10 * (1 - k), this.time * 3, 0.5 + 0.5 * k, Math.exp(-(p % 1) * 5));
    }
    if (s.kind === 'pillar' && p >= s.s0 && p < s.s + 0.1) {
      // Glowing crack racing to the target
      const a = this.fx[s.from];
      const u = clamp((p - s.s0) / (s.s - s.s0));
      const xa = a.x, xb = xa + (t.x - xa) * u;
      c.fillStyle = st.main;
      for (let x = Math.min(xa, xb); x <= Math.max(xa, xb); x += 1) {
        const yy = -oy + ((Math.floor(x) * 7) % 3 === 0 ? 1 : 0);
        c.fillRect(Math.round(x - ox), yy, 1, 1);
      }
      c.fillStyle = st.light;
      c.fillRect(Math.round(xb - ox) - 1, -oy - 1, 3, 2);
    }
  }

  private drawStrikeAir(c: CanvasRenderingContext2D, s: Strike, p: number, ox: number, oy: number, gy: number): void {
    const st = ELEMENTS[this.defs[s.from].element];
    const t = this.fx[s.to];
    const tx = t.x - ox, ground = -oy;
    if (s.kind === 'sky') {
      if (st.sky === 'bolt') {
        if (p >= s.s - 0.12 && p < s.s) drawLightning(c, st, tx, 0, ground, Math.floor(this.time * 40), 0.3);
        if (p >= s.s && p < s.s + 0.4) drawLightning(c, st, tx, 0, ground, Math.floor(this.time * 20), 1 - (p - s.s) * 1.5);
      } else if (st.sky === 'fall') {
        const dir = this.fx[s.from].face;
        if (p >= s.s - 0.7 && p < s.s) {
          const u = (p - (s.s - 0.7)) / 0.7;
          const x0 = tx - dir * 70, y0 = -30;
          const x1 = tx, y1 = t.chest[1] - oy;
          const e = u * u;
          drawFalling(c, st, x0 + (x1 - x0) * e, y0 + (y1 - y0) * e, x1 - x0, y1 - y0, this.time);
          if (st.bolt === 'star') {
            for (let k = 1; k < 3; k++) {
              const uk = clamp(e - k * 0.12);
              if (uk > 0) drawBolt(c, st, x0 + k * 14 * dir + (x1 - x0) * uk, y0 + (y1 - y0) * uk, 1, 1, this.time, true);
            }
          }
        }
      } else if (p >= s.s - 0.3 && p < s.s + 0.6) {
        const k = p < s.s ? 0.2 : 1 - (p - s.s) / 0.6;
        drawColumn(c, st, tx, 0, ground, 2 + 9 * k, this.time, false);
      }
      void gy;
    } else if (p >= s.s && p < s.s + 0.9) {
      const u = (p - s.s) / 0.9;
      if (st.pillar === 'flame') {
        const k = u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85;
        drawColumn(c, st, tx, ground - 60 * k, ground, 9 * Math.max(0.3, k), this.time, true);
      } else {
        const k = u < 0.12 ? u / 0.12 : u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4;
        drawSpikes(c, st, tx, ground, k, s.s * 13);
      }
    }
  }

  private drawHud(c: CanvasRenderingContext2D, w: number, h: number, p: number, ox: number, oy: number): void {
    const top = this.hudTop;
    const bw = Math.min(130, Math.floor(w * 0.36));
    for (const i of [0, 1]) {
      const d = this.defs[i], st = ELEMENTS[d.element];
      const x = i === 0 ? 8 : w - 8 - bw;
      c.fillStyle = INK;
      c.fillRect(x - 1, top - 1, bw + 2, 7);
      c.fillStyle = PAL.shadow;
      c.fillRect(x, top, bw, 5);
      const tw = Math.round(bw * clamp(this.trailHp[i]));
      const hw = Math.round(bw * clamp(this.shownHp[i]));
      c.fillStyle = PAL.red;
      c.fillRect(i === 0 ? x : x + bw - tw, top, tw, 5);
      c.fillStyle = this.hitFlash[i] > 0 ? PAL.white : st.main;
      c.fillRect(i === 0 ? x : x + bw - hw, top, hw, 5);
      c.fillStyle = st.light;
      c.fillRect(i === 0 ? x : x + bw - hw, top, hw, 1);
      c.fillStyle = st.dark;
      c.fillRect(i === 0 ? x : x + bw - hw, top + 4, hw, 1);
      const name = d.name;
      drawText(c, name, i === 0 ? x : x + bw - textWidth(name), top + 9, PAL.white, 1, INK);
      // Element gem next to the name
      const gx = i === 0 ? x + textWidth(name) + 4 : x + bw - textWidth(name) - 7;
      c.fillStyle = st.main;
      c.fillRect(gx, top + 10, 3, 3);
      c.fillStyle = st.light;
      c.fillRect(gx, top + 10, 1, 1);
    }
    // Metronome gem between the bars
    const ph = p - Math.floor(p);
    const r = 2 + Math.round(2 * Math.exp(-ph * 6));
    const cx = Math.round(w / 2), cy = top + 2;
    c.fillStyle = INK;
    for (let k = -r - 1; k <= r + 1; k++) c.fillRect(cx - (r + 1 - Math.abs(k)), cy + k, (r + 1 - Math.abs(k)) * 2 + 1, 1);
    c.fillStyle = Math.floor(p) % 4 === 0 ? PAL.yellow : PAL.silver;
    for (let k = -r; k <= r; k++) c.fillRect(cx - (r - Math.abs(k)), cy + k, (r - Math.abs(k)) * 2 + 1, 1);

    if (!this.started) {
      const t = `${this.defs[0].name}  VS  ${this.defs[1].name}`;
      drawText(c, t, w / 2 - textWidth(t, 2) / 2, Math.round(h * 0.3), PAL.yellow, 2, INK);
      const a = this.arena.def.name;
      drawText(c, a, w / 2 - textWidth(a) / 2, Math.round(h * 0.3) + 16, PAL.silver, 1, INK);
    }
    // Floating labels
    let bigRow = 0;
    for (const l of this.labels) {
      const scale = l.big ? 2 : 1;
      const width = textWidth(l.text, scale);
      let x: number, y: number;
      if (l.who !== undefined) {
        const f = this.fx[l.who];
        x = Math.round(clamp(f.x - ox - width / 2, 4, w - width - 4));
        y = Math.round(Math.min(f.y - 40, f.hatTip[1] - 12) - oy - l.t * 10);
      } else {
        x = Math.round(w / 2 - width / 2);
        y = Math.round(h * 0.34) + bigRow++ * 14;
      }
      if (l.t < 0.08 || Math.floor(l.t * 30) % 2 === 0 || l.t < 0.8) drawText(c, l.text, x, y, l.color, scale, INK);
    }
  }
}
