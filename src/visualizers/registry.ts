import type { VisualizerDescriptor } from './types';

/**
 * The single list of scenes. To add a new visualizer, create its folder
 * exporting a default class implementing `Visualizer`, and add one entry here.
 */
export const VISUALIZERS: VisualizerDescriptor[] = [
  { id: 'prism', name: 'Prism', tagline: 'Túnel de cristal', accent: '#8be9ff', load: () => import('./prism/PrismVisualizer') },
  { id: 'ink', name: 'Ink', tagline: 'Tinta en fluido', accent: '#ff7ab6', load: () => import('./ink/InkVisualizer') },
  { id: 'ridges', name: 'Ridges', tagline: 'Cordillera espectral', accent: '#ffb86b', load: () => import('./ridges/RidgesVisualizer') },
  { id: 'attractor', name: 'Attractor', tagline: 'Caos en órbita', accent: '#b69cff', load: () => import('./attractor/AttractorVisualizer') },
  { id: 'loom', name: 'Loom', tagline: 'Telar modular', accent: '#7dffb2', load: () => import('./loom/LoomVisualizer') },
  { id: 'platformer', name: 'Runner', tagline: 'Plataformas autojugado', accent: '#ffd84a', load: () => import('./platformer/PlatformerVisualizer') },
];
