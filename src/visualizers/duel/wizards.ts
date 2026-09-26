import { PAL } from '../common/pixel/palette';

/**
 * WIZARDS — the cast of the duel. Original characters: every visual trait
 * (robe, hat, staff, eyes glowing under the brim) and every spell lives here,
 * so adding a wizard is adding an entry.
 */

/** A few colours on top of Sweetie 16 for magic that needs them. */
export const EX = {
  violet: '#7d4fc4',
  pink: '#f77fbe',
  gold: '#e8b33a',
  bone: '#e8dcc0',
  wood: '#8a5a3c',
  woodDark: '#5a3a2a',
  periwinkle: '#9db4ff',
} as const;

export type Element = 'fire' | 'ice' | 'storm' | 'nature' | 'shadow' | 'star';

/**
 * How spells look, per element:
 *  bolt    the basic projectile (flame, shard, spark, leaf, wisp, star)
 *  sky     big spell from above: a lightning bolt, something falling, or a column of light
 *  pillar  eruption under the opponent: a flame column or a crown of spikes
 *  beam    the channelled ray (clashes at the drops): wavy, jagged or smooth
 */
export interface ElementStyle {
  main: string;
  light: string;
  dark: string;
  bolt: 'flame' | 'shard' | 'spark' | 'leaf' | 'wisp' | 'star';
  sky: 'bolt' | 'fall' | 'column';
  pillar: 'flame' | 'spikes';
  beam: 'wavy' | 'jagged' | 'smooth';
}

export const ELEMENTS: Record<Element, ElementStyle> = {
  fire: { main: PAL.orange, light: PAL.yellow, dark: PAL.red, bolt: 'flame', sky: 'fall', pillar: 'flame', beam: 'wavy' },
  ice: { main: PAL.cyan, light: PAL.white, dark: PAL.blue, bolt: 'shard', sky: 'fall', pillar: 'spikes', beam: 'smooth' },
  storm: { main: PAL.yellow, light: PAL.white, dark: EX.violet, bolt: 'spark', sky: 'bolt', pillar: 'flame', beam: 'jagged' },
  nature: { main: PAL.lime, light: '#e4ffb8', dark: PAL.green, bolt: 'leaf', sky: 'column', pillar: 'spikes', beam: 'wavy' },
  shadow: { main: EX.pink, light: '#ffd6ee', dark: EX.violet, bolt: 'wisp', sky: 'column', pillar: 'spikes', beam: 'jagged' },
  star: { main: EX.periwinkle, light: PAL.white, dark: PAL.blue, bolt: 'star', sky: 'fall', pillar: 'flame', beam: 'smooth' },
};

export type SpellShape = 'orb' | 'beam' | 'sky' | 'pillar';

export interface Spell {
  name: string;
  shape: SpellShape;
  /** Syllables chanted on the beats before the cast (last one on the cast beat). */
  chant: string[];
}

export type HatStyle = 'cone' | 'crooked' | 'wide' | 'hood';
export type StaffHead = 'orb' | 'fork' | 'leaf' | 'skull' | 'star' | 'crook';

export interface WizardDef {
  id: string;
  name: string;
  element: Element;
  /** Height factor (1 ≈ 28 px from boots to hat tip). */
  height: number;
  robe: string;
  robeShade: string;
  trim: string;
  hat: string;
  hatBand: string;
  hatStyle: HatStyle;
  hand: string;
  eyes: string;
  beard?: string;
  cape?: string;
  /** Tiny pattern dots on the robe. */
  dots?: string;
  staff: string;
  head: StaffHead;
  spells: Spell[];
}

export const WIZARDS: WizardDef[] = [
  {
    id: 'ignis', name: 'IGNIS', element: 'fire', height: 0.95,
    robe: PAL.red, robeShade: PAL.plum, trim: PAL.yellow, hat: PAL.red, hatBand: PAL.orange, hatStyle: 'cone',
    hand: '#f2c29a', eyes: PAL.yellow, cape: PAL.orange, staff: EX.wood, head: 'orb',
    spells: [
      { name: 'METEOR!', shape: 'sky', chant: ['IGNIS', 'CAELI', 'CADE!'] },
      { name: 'FLAME PILLAR!', shape: 'pillar', chant: ['ARDE', 'SURGE!'] },
      { name: 'INFERNO!', shape: 'beam', chant: ['FLAMMA', 'VORAX!'] },
      { name: 'SUNFIRE!', shape: 'orb', chant: ['SOL', 'IGNIS!'] },
    ],
  },
  {
    id: 'borea', name: 'BOREA', element: 'ice', height: 1.05,
    robe: PAL.blue, robeShade: PAL.navy, trim: PAL.white, hat: PAL.navy, hatBand: PAL.cyan, hatStyle: 'wide',
    hand: '#e9c9a8', eyes: PAL.cyan, beard: PAL.white, staff: PAL.silver, head: 'crook',
    spells: [
      { name: 'ICEFALL!', shape: 'sky', chant: ['GLACIES', 'RUAT!'] },
      { name: 'GLACIER!', shape: 'pillar', chant: ['FRIGUS', 'SURGE!'] },
      { name: 'FROST RAY!', shape: 'beam', chant: ['HIEMS', 'AETERNA!'] },
      { name: 'HAIL ORB!', shape: 'orb', chant: ['GRANDO!'] },
    ],
  },
  {
    id: 'volta', name: 'VOLTA', element: 'storm', height: 1.08,
    robe: PAL.navy, robeShade: PAL.ink, trim: PAL.yellow, hat: PAL.shadow, hatBand: PAL.yellow, hatStyle: 'crooked',
    hand: '#c98a5c', eyes: PAL.yellow, cape: EX.violet, staff: PAL.slate, head: 'fork',
    spells: [
      { name: 'THUNDER!', shape: 'sky', chant: ['TONITRUS', 'FERI!'] },
      { name: 'STORM ORB!', shape: 'orb', chant: ['FULGUR', 'ORBIS!'] },
      { name: 'ARC RAY!', shape: 'beam', chant: ['VOLT', 'ARCUS!'] },
    ],
  },
  {
    id: 'silva', name: 'SILVA', element: 'nature', height: 0.92,
    robe: PAL.green, robeShade: PAL.teal, trim: PAL.lime, hat: PAL.teal, hatBand: EX.pink, hatStyle: 'cone',
    hand: '#a8704a', eyes: PAL.lime, staff: EX.wood, head: 'leaf',
    spells: [
      { name: 'THORNS!', shape: 'pillar', chant: ['SPINA', 'CRESCE!'] },
      { name: 'SUNBEAM!', shape: 'sky', chant: ['LUX', 'VIRIDIS!'] },
      { name: 'VERDANT RAY!', shape: 'beam', chant: ['FLORA', 'VIVAT!'] },
      { name: 'SEED BOMB!', shape: 'orb', chant: ['SEMEN!'] },
    ],
  },
  {
    id: 'umbra', name: 'UMBRA', element: 'shadow', height: 1,
    robe: PAL.plum, robeShade: PAL.ink, trim: EX.violet, hat: PAL.shadow, hatBand: EX.violet, hatStyle: 'hood',
    hand: EX.bone, eyes: EX.pink, cape: PAL.shadow, staff: PAL.slate, head: 'skull',
    spells: [
      { name: 'NIGHTFALL!', shape: 'sky', chant: ['NOX', 'VENI!'] },
      { name: 'GRASP!', shape: 'pillar', chant: ['UMBRAE', 'TENETE!'] },
      { name: 'VOID RAY!', shape: 'beam', chant: ['VACUUM!'] },
      { name: 'SOUL ORB!', shape: 'orb', chant: ['ANIMA', 'I!'] },
    ],
  },
  {
    id: 'astra', name: 'ASTRA', element: 'star', height: 1,
    robe: PAL.navy, robeShade: PAL.ink, trim: EX.gold, hat: PAL.blue, hatBand: EX.gold, hatStyle: 'cone',
    hand: '#f2c29a', eyes: PAL.white, dots: PAL.white, cape: PAL.blue, staff: EX.gold, head: 'star',
    spells: [
      { name: 'STARFALL!', shape: 'sky', chant: ['STELLAE', 'CADITE!'] },
      { name: 'NOVA!', shape: 'orb', chant: ['NOVA', 'NASCERE!'] },
      { name: 'MOONBEAM!', shape: 'beam', chant: ['LUNA', 'LUCE!'] },
    ],
  },
];
