# Colored Music · Opus

Reinterpretación moderna de *Colored Music*: una experiencia audiovisual a pantalla completa con siete
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
| `1`–`7` | Cambiar de escena (sin cortar la música) |
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
7. **Duel** — un duelo de magos en pixel art, con la misma estética y paleta que el Runner. Todo
   el duelo es una partitura sobre la rejilla de beats: los proyectiles salen en la corchea previa y
   impactan en el beat, los magos se lanzan hechizos como en un partido de tenis, se protegen con
   escudos de runas, se teletransportan y chocan los bastones en los tiempos fuertes. Antes de los
   grandes hechizos cantan su conjuro sílaba a sílaba en los beats previos; cada drop es un choque de
   rayos que se rompe justo en el drop (y el primero hace que ambos *asciendan*: levitan, les orbitan
   runas y les arde la punta del sombrero). En cada canción la pareja, el escenario, el ganador y el
   tipo de duelo (remontada, dominio, intercambio constante o igualado) son aleatorios; el hechizo
   final cae al terminar el último tramo intenso y del derrotado solo queda el sombrero. Las subidas se
   notan: la magia del escenario fluye hacia los bastones y un gran círculo rúnico se va dibujando en
   el suelo (una runa por beat) hasta el drop, que estalla en una onda expansiva; en los tramos
   intensos aparecen auroras con los colores de ambos magos, el suelo responde a cada bombo y el
   cielo a cada caja.

   Magos (personajes originales): **Ignis** (fuego), **Borea** (hielo), **Volta** (tormenta),
   **Silva** (naturaleza), **Umbra** (sombra) y **Astra** (estrellas), cada uno con sus hechizos
   (meteoro, glaciar, relámpago, espinas, rayos…). Escenarios: torre a la luz de la luna, bosque al
   atardecer, ruinas flotantes y caverna de cristal. Añadir un mago es añadir una entrada en
   `src/visualizers/duel/wizards.ts`.

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
