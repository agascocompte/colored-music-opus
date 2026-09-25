# Colored Music · Opus

Reinterpretación moderna de *Colored Music*: una experiencia audiovisual a pantalla completa con seis
escenas que escuchan la canción, entienden su estructura y reaccionan a ella.

## Uso

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # comprobación de tipos + build de producción en dist/
```

Formas de poner música:

- **Mi biblioteca** (tecla **L**): las canciones de [colored-music-library](https://github.com/agascocompte/colored-music-library),
  el mismo catálogo que usan colored-music y colored-music-astra. Al terminar una, suena la siguiente.
- **Buscar**: cualquier canción de iTunes (vista previa de 30 s).
- Un archivo local (botón, tecla **O** o arrastrar y soltar).
- **Probar la demo**: una pista de 124 BPM sintetizada en el navegador.

| Tecla | Acción |
|---|---|
| `1`–`6` | Cambiar de escena (sin cortar la música) |
| `Espacio` | Reproducir / pausa |
| `←` `→` | Saltar 5 s |
| `F` | Pantalla completa |
| `M` | Silenciar |
| `L` | Biblioteca y búsqueda |

La interfaz desaparece sola mientras suena la música y vuelve al mover el ratón.

## Escenas

1. **Prism** — vuelo por un túnel de cristal. Los kicks empujan la cámara, los paneles son un
   ecualizador, los snares lanzan anillos de luz y cada sección cambia la forma del túnel.
2. **Ink** — simulación de fluido en GPU. Tres boquillas (graves, medios y agudos) giran al tempo, los
   kicks abren coronas de tinta y los drops provocan un vórtice.
3. **Ridges** — cordillera espectral bajo un sol retro. Dos crestas nuevas por beat, así que el
   paisaje avanza a tempo.
4. **Attractor** — 40 000 partículas sobre atractores extraños. Los graves deforman el atractor y
   cada drop pasa al siguiente (Aizawa, Lorenz, Thomas, Halvorsen, Rössler).
5. **Loom** — tabla de multiplicar modular tejida con luz. La figura avanza en cada compás.
6. **Runner** — un plataformas en pixel art que se juega solo. El nivel se escribe como una
   partitura sobre la rejilla de beats: cada salto, golpe y aterrizaje cae en un beat, y los drops
   tienen su momento especial.

## Arquitectura

Ver [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). En resumen:

```
AudioPlayer → RealtimeAnalyzer ─┐
            → Worker (análisis   ├→ MusicEngine → MusicFrame → VisualizerHost → escena
              offline: Timeline)┘
```

Para añadir una séptima escena, crea `src/visualizers/<nombre>/` con una clase que implemente
`Visualizer` y añade una línea en `src/visualizers/registry.ts`.

## Tecnología

TypeScript, Vite, Web Audio API, WebGL2 (sin librerías) y Canvas 2D. Sin dependencias en runtime.
