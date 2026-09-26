# Colored Music · Opus — Arquitectura

## Qué había en el proyecto antiguo

`colored-music` era un sketch de p5.js + p5.sound con seis visualizadores 2D (Spiral, Nebula,
Pulse, Aurora, Rainbow, Flying Mesh) dibujados en un canvas cuadrado de ≤680 px.

Problemas que motivan la reescritura:

- **Análisis duplicado y pobre.** Cada visualizador recalculaba sus bandas a partir del mismo
  array FFT de 0–255 y detectaba "beats" con `energía - energíaAnterior > 16`: un umbral fijo que
  depende del volumen del máster, dispara con cualquier fluctuación y no distingue kick de snare.
- **Acoplamiento.** `sketch.js` contenía `if (mode === 'rainbow') …` y listas de excepciones de
  fondo; el `UIManager` tocaba el diccionario global `visualizers`.
- **Rendimiento.** Degradados pintados con cientos de `rect()` por frame, `splice()` en bucles,
  objetos creados cada frame, sin `devicePixelRatio`, velocidades ligadas a frames (`time += 0.016`).
- **Sin seek, volumen, pantalla completa ni responsive**; el canvas era cuadrado y fijo.
- Scripts globales cargados en secuencia; p5 completo (1 MB) solo para dibujar y hacer FFT.

Se conserva la **idea** (música local → visuales por bandas) y el espíritu de algunas escenas,
pero no el código ni las tecnologías.

## Stack elegido

| Pieza | Elección | Por qué |
|---|---|---|
| Lenguaje / build | TypeScript + Vite | Tipos para contratos entre capas, módulos ES, dev server instantáneo, workers nativos. |
| UI | DOM + CSS a mano | La interfaz es pequeña; un framework no aporta y pesa. |
| Audio | Web Audio API directa | `MediaElementSource → Analyser`, con `GainNode` de volumen *después* del análisis para que el volumen no altere los visuales. |
| Análisis offline | Web Worker con FFT propia | Al cargar un archivo se decodifica y se analiza entero en segundo plano: tempo, rejilla de beats, kicks/snares/hats, curva de energía, secciones y *drops*. Permite **anticipación**. |
| Render 3D / shaders | WebGL2 sin librerías | Los visualizadores de shader (túnel, fluido, atractor) necesitan poco más que un quad y FBOs. Evitamos 600 KB de Three.js. |
| Render 2D / pixel art | Canvas 2D | Ideal para líneas con glow y para pixel art a resolución interna baja con escalado entero y sin filtrado. |

## Flujo de datos

```
AudioPlayer ──(AnalyserNode)──► RealtimeAnalyzer ─┐
    │                                             ├─► MusicEngine ──► MusicFrame ──► VisualizerHost ──► Visualizador activo
    └─(archivo decodificado)──► Worker offline ──► Timeline ┘            (solo lectura)
```

- **AudioPlayer** (`src/audio`) solo reproduce: carga, play/pause, seek, volumen.
- **RealtimeAnalyzer** (`src/analysis`) lee el analizador *una vez por frame* y produce señales
  continuas: RMS, bandas (sub, bass, lowMid, mid, highMid, treble), espectro logarítmico de 64 bandas,
  centroide, flujo espectral por banda. Todo pasa por un **AGC** (máximo móvil con caída lenta), así
  canciones flojas y fuertes producen rangos comparables, y por suavizado ataque/caída.
- **OnsetDetector** (compartido entre tiempo real y offline): umbral adaptativo = media + k·desviación
  del flujo reciente, más *cooldown* e histéresis. Se instancia para kick (flujo 40–140 Hz), snare
  (flujo 1–5 kHz ruidoso con cuerpo en 150–300 Hz) y hat (> 7 kHz).
- **Timeline** (`src/analysis/timeline`): resultado del análisis offline con API de consulta
  (`nextEvent`, `beatAt`, `energyAt`, `nextSectionChange`, `upcomingDrop`…).
- **MusicEngine** fusiona ambos: los valores continuos vienen del análisis en vivo; los eventos
  discretos (beat, kick, snare, hat, drop, cambio de sección) vienen del Timeline cuando está listo
  (precisos y con lookahead) y del detector en vivo mientras tanto. Publica un `MusicFrame`.

Los visualizadores **solo** ven `MusicFrame`; nunca tocan Web Audio.

## Visualizadores

Contrato (`src/visualizers/types.ts`): `mount(host)`, `resize(w, h, dpr)`, `update(frame)`,
`render()`, `dispose()`. El `VisualizerHost` crea cada escena con import dinámico, hace un fundido
cruzado de canvas a canvas y libera la anterior (incluido `WEBGL_lose_context`). Añadir un séptimo
visualizador = crear su carpeta y añadir una línea en `registry.ts`.

1. **Prism** — túnel *raymarched* en fragment shader: una catedral de costillas de cristal. Los
   kicks empujan la cámara hacia delante, los snares encienden las costillas, los agudos dan
   dispersión cromática, los cambios de sección rotan la paleta y la geometría.
2. **Ink** — simulación de fluido (Navier–Stokes estable, GPU, FBO ping-pong). Kicks inyectan
   tinta desde el centro, snares lanzan chorros laterales, la energía controla vorticidad y los
   drops invierten el flujo.
3. **Ridges** — cordillera de líneas (tributo a *Unknown Pleasures*): el historial del espectro se
   convierte en un paisaje que avanza hacia el horizonte bajo un sol que late con los graves.
4. **Attractor** — 40 000 partículas siguiendo un atractor extraño 3D (Aizawa/Thomas) cuyos
   parámetros modula la música; los drops cambian de atractor con una transición.
5. **Loom** — telar geométrico: tabla de multiplicar modular sobre un círculo (cardioides,
   nefroides…). El multiplicador salta con los beats, las bandas tiñen los hilos.
6. **Autoplatformer** — ver abajo.
7. **Duel** — duelo de magos en pixel art, ver abajo.

## Autoplatformer: el nivel como partitura

La primera versión simulaba física y un director reaccionaba sobre la marcha; en la práctica el
héroe llegaba tarde, chocaba con cajas y parecía ir "a su bola". Se rehízo con otro principio:

```
BeatClock (beat continuo de la canción) ─► Composer ─► terreno + enemigos + acciones del héroe
                                                    └─► Game lee la partitura en cada frame
```

- **BeatClock** convierte tiempo de canción ↔ beat continuo usando la rejilla del análisis offline.
- **Composer** divide la canción en *slots* (1 beat, o 2 en canciones de más de 140 BPM) y compases
  de 4. La x del héroe es una función pura del slot, así que el compositor sabe dónde estará el héroe
  en cada beat y escribe a la vez el nivel y la coreografía:
  - un foso se corta para despegar en el beat *s* y aterrizar en *s+1* (o *s+2* si ahí hay un kick
    más fuerte);
  - un enemigo se coloca a un espadazo de donde el héroe estará en un beat, y el golpe se programa en
    ese beat;
  - un *drop* se anuncia compases antes: carga, salto dos beats antes, *slam* exacto en el drop y
    la multitud revienta en cascada en las corcheas siguientes.
- La energía y el nivel de sección deciden la velocidad (píxeles por beat, constante dentro de cada
  compás) y la densidad de patrones (fosos, escalones, enemigos, cajas, dash, stomp, plataformas…).
  En pasajes muy tranquilos el héroe a veces se para un compás.
- **Game** no simula nada que pueda desincronizarse: posición, salto, golpe, aterrizaje y pisadas
  (una por beat) se derivan del beat actual. Tras un *seek* la partitura se reescribe desde el
  siguiente tiempo fuerte.

## Duel: un duelo de magos como partitura

Reutiliza el mismo principio que el Runner y sus piezas comunes en `common/pixel` (reloj de beats,
fuente, partículas, primitivas de píxel y la paleta Sweetie 16).

- **DuelComposer** escribe, compás a compás, pistas de *keyframes* (posición y pose) para los dos
  magos y listas de proyectiles, rayos, golpes desde el cielo/suelo y eventos. Los proyectiles salen
  en la corchea previa y llegan en el beat; los bastonazos caen en beats; los grandes hechizos se
  cantan en los beats previos y su impacto cae en un beat; cada drop es un choque de rayos que se
  rompe exactamente en el drop.
- **Guion aleatorio**: en cada reproducción se eligen pareja, arena, ganador y tipo de duelo; el daño
  se reparte para que las barras sigan las curvas de ese guion y el K.O. caiga al final del último
  tramo intenso.
- **Wizard** es una marioneta de píxeles: las poses (`poses.ts`) son unos pocos números que se
  interpolan entre *keyframes* (el bastón viaja del amago al lanzamiento). Se dibuja mirando a la
  derecha en un canvas pequeño y se compone con volteo, inclinación y *squash & stretch*. Movimiento
  secundario: la punta del sombrero es un muelle que reacciona a las aceleraciones, la capa es una
  cadena *verlet*, y hay estelas en los desplazamientos rápidos.
- **Spells** dibuja cada efecto por capas de color del elemento del mago (oscuro → principal → claro
  → núcleo blanco); los halos son tramados (sin mezcla alfa) para mantener el aspecto pixel art.
- **Energía**: `DuelGame` lee por adelantado la línea de tiempo: a medida que se acerca un drop (o una
  sección más intensa) crece `build` (partículas que fluyen a los bastones, círculo rúnico que se
  completa runa a runa, cielo que se oscurece, temblor); al cruzar el drop, onda expansiva; durante
  las secciones intensas, auroras, anillos en cada bombo y destellos en cada caja.
- **Arena**: cielo con tramado por bandas, astro, dos capas de parallax y suelo en losas; ventanas,
  cristales y setas se encienden con el bombo y las islas flotantes se mecen en el beat.

## Rendimiento

- Una sola lectura del `AnalyserNode` por frame; buffers `Float32Array` reutilizados.
- Pools de partículas y entidades; sin `splice` en caliente.
- Delta time acotado en todas las escenas; el plataformas no integra física: todo es función del beat, así que no hay deriva aunque haya tirones de frame.
- Recursos GPU creados una vez por escena y liberados en `dispose()`.

## Ajustes hechos con canciones reales

El análisis se validó con la demo sintética y con tres canciones reales de la biblioteca antigua:

| Canción | Tempo real | Detectado |
|---|---|---|
| Demo (sintética) | 124 | 123,8 |
| Something Just Like This | ~103 | 102,8 |
| Yellow | ~87 | 86,7 |
| Thunder | 168 (84 a medio tiempo) | 83,9 |

- El tempo puntúa cada periodo candidato por su autocorrelación y la de sus múltiplos ×2 y ×4
  (medio compás y compás), lo que evita errores 4:3.
- Los niveles de sección son relativos a la dinámica de cada canción (z-score), y solo las subidas
  más fuertes hacia secciones intensas cuentan como *drop* (máximo ~1 por minuto).
- Los *drops* se ajustan al kick en tiempo fuerte donde el escalón de graves es más brusco.
