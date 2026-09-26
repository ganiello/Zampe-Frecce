# Zampe & Frecce — Documentazione tecnica

Documentazione per Claude (o altro sviluppatore) che debba modificare il gioco
in una sessione futura. Il progetto è composto da **un solo file**:
`index.html`. Nessuna dipendenza, nessun build, funziona offline con doppio clic.

---

## 1. Panoramica del progetto

**Cosa è**: gioco da tavolo digitale per bambini di seconda elementare (7 anni)
che introduce il pensiero computazionale. Si gioca in 2-10 giocatori,
ciascuno con una pedina. Ad ogni turno si lancia un dado a 6 facce mappato
su 6 direzioni; il bambino deve toccare il punto della griglia corrispondente
alla direzione uscita. Se sbaglia, riceve una penalità matematica.
Vince chi raggiunge per primo l'ultima riga.

**Contesto d'uso**: PC, tablet, LIM (lavagna interattiva). Pulsanti ≥60px,
tocco supportato, layout responsive.

**Stack**: HTML + CSS + JavaScript vanilla, tutto inline in `index.html`.
Rendering della griglia in **SVG** (scala pulito su LIM, animabile via CSS).
Suoni via **Web Audio API** sintetizzati al volo (nessun file audio).
Coriandoli via CSS keyframes.

---

## 2. Struttura del file `index.html`

Ordine dall'alto verso il basso:

| Sezione | Righe (indicative) | Contenuto |
|---|---|---|
| `<head>` + `<style>` | 1 – ~500 | CSS globale, componenti UI, animazioni |
| `<body>` | ~505 – ~510 | Solo tre contenitori: `#app`, `#confetti`, `#toast` |
| `<script>` — costanti | ~515 – ~560 | `DICE_MAP`, `PALETTE`, limiti, timing |
| `<script>` — stato | ~562 – ~600 | Oggetto `State`, `makeInitialGameState`, `getStartingPositions` |
| `<script>` — logica pura | ~602 – ~700 | `attemptMove`, `checkWinner`, `advanceTurn`, `generateMathQuestion` |
| `<script>` — suoni | ~702 – ~790 | `playSound(type)` |
| `<script>` — utilità DOM | ~792 – ~830 | `el()` helper, `showToast()` |
| `<script>` — render config | ~832 – ~1080 | Schermata iniziale |
| `<script>` — render game | ~1082 – ~1400 | Schermata di gioco, griglia SVG, pannelli |
| `<script>` — gestori eventi | ~1402 – ~1650 | Roll, target, penalità, prediction |
| `<script>` — render vittoria | ~1652 – ~1720 | Schermata finale + coriandoli |
| `<script>` — avvio | ~1722 – ~1728 | Setup iniziale e primo render |
| `<script>` — `runTests()` | ~1732 – fine | Auto-test in fondo al file |

I numeri sono indicativi: usa Grep per trovare i punti esatti.

---

## 3. Costanti configurabili (in cima allo `<script>`)

Modifica qui per cambiare comportamento senza toccare la logica:

```js
// Mappatura dado -> direzione. UNICO PUNTO DA CAMBIARE se si vuole
// alterare cosa fanno le facce del dado.
const DICE_MAP = {
  1: { dx:  0, dy:  1, arrow: '↓',  name: 'GIÙ' },
  2: { dx:  1, dy:  1, arrow: '↘', name: 'GIÙ A DESTRA' },
  3: { dx:  1, dy:  0, arrow: '→',  name: 'DESTRA' },
  4: { dx: -1, dy:  0, arrow: '←',  name: 'SINISTRA' },
  5: { dx: -1, dy:  1, arrow: '↙', name: 'GIÙ A SINISTRA' },
  6: { dx:  0, dy: -1, arrow: '↑',  name: 'SU' }
};

// 10 pedine distinguibili (colore + emoji, ok anche per daltonici).
const PALETTE = [ { color, symbol, name }, ... ];

const MIN_PLAYERS = 2;   const MAX_PLAYERS = 10;
const MIN_GRID    = 5;   const MAX_GRID    = 40;
const CELL   = 42;       // dimensione cella in unità SVG
const MARGIN = 65;       // margine SVG (basta per mostrare bersagli fuori griglia)
const ROLL_DURATION_MS = 1000;   // durata animazione dado
const MOVE_DURATION_MS = 500;    // durata scivolamento pedina
const DEFAULT_PENALTY_SECONDS = 15;
const MIN_PENALTY_SECONDS     = 5;
const MAX_PENALTY_SECONDS     = 60;
```

**Regole d'oro**:
- Cambia `DICE_MAP` liberamente: legenda, frecce, targets, tutto si allinea.
- Se aggiungi facce (dado a 8/10), cambia anche `PIP_LAYOUTS` (posizionamento
  pallini) e forse la UI del pannello dado.
- `MARGIN` deve rimanere ≥ `CELL + 22` (raggio bersaglio), altrimenti i
  bersagli fuori griglia vengono clippati.

---

## 4. Stato dell'applicazione

Un unico oggetto globale `State` in memoria, tre sezioni:

```js
State = {
  screen: 'config' | 'game' | 'victory',

  config: {
    numPlayers, players: [{name, colorIndex}],
    cols, rows, maxTurns, maxTurnsManuallySet,
    predictMode, soundOn,
    penaltyEnabled, penaltySeconds
  },

  game: {                     // null in schermata config
    positions: [{x,y}, ...],  // posizione attuale di ogni pedina
    paths:     [[{x,y,arrow,cancelled,start,penalty}], ...], // storia mosse
    stars:     [n, ...],      // stelline per la modalità Prevedi
    currentPlayer,            // indice del giocatore di turno
    roundNumber,              // round corrente (1..maxTurns)
    rolling, animating,       // flag di transizione
    lastDice,                 // valore ultimo lancio (1..6)
    predictionPending,        // in attesa che l'alunno indovini la freccia
    awaitingMove,             // in attesa che l'alunno tocchi il bersaglio
    penaltyActive,            // overlay penalità aperto
    penaltyQuestion, penaltyInput, penaltyTimeLeft, penaltyTimerId
  },

  victory: { winners: [i, ...], reason: 'traguardo' | 'turni' }
};
```

**Principio**: la logica pura (funzioni in §5) accetta `state` e lo modifica.
Il rendering (§6) legge `State` e disegna. Non c'è un observer/reattività:
le funzioni di gestione eventi modificano `State` e poi chiamano `render()`
esplicitamente.

---

## 5. Logica pura di gioco

Testabile senza DOM. Convenzioni:

- Le coordinate sono `{x, y}` con **y che cresce verso il basso** (ultima riga
  = traguardo).
- `attemptMove(state, diceValue)` — applica una mossa. Se dentro griglia
  aggiorna `positions` e aggiunge un entry a `paths`. Se fuori griglia,
  aggiunge un entry `cancelled: true` senza spostare. Ritorna `{moved, from, to, cancelled, arrow}`.
- `computeDestination(pos, diceValue)` — calcolo puro senza check bordi.
- `isInside(pos, cols, rows)` — bounds check.
- `checkWinner(state)` — ritorna indice giocatore su ultima riga, o -1.
- `getWinnersByPosition(state)` — vincitori "ai punti" (chi è sulla riga
  più bassa, può essere > 1 in caso di pareggio).
- `advanceTurn(state)` — passa al giocatore successivo, incrementa `roundNumber`
  quando torna al primo. Ritorna `true` se è iniziato un nuovo round.
- `calculateDefaultMaxTurns(rows)` — restituisce `rows * 3`.
- `getStartingPositions(cols, numPlayers)` — posizioni equidistanti sulla
  prima riga: `x = floor((i + 0.5) * cols / numPlayers)`.
- `generateMathQuestion()` — 50% addizioni (0..10 + 0..10) e 50% sottrazioni
  (5..20 − 0..a, sempre risultato ≥ 0).

Tutte queste funzioni accettano sia lo stato reale (`{config, game}`) sia uno
stato "test" costruito da `mkTestState(cols, rows, positions)` in fondo al file.

---

## 6. Ciclo di rendering

Punto unico di ingresso: **`render()`** — svuota `#app` e appende la schermata
giusta in base a `State.screen`:

```
render()
├── renderConfig()   → schermata setup
├── renderGame()     → gioco (header + banner + grid + side + players)
│   ├── renderGridSvg()      → griglia + traguardo + pedine + bersagli
│   ├── renderPlayerStrip()  → una riga per giocatore (una alla volta)
│   ├── renderLegend()       → 6 frecce attorno a un punto centrale
│   ├── renderPredictChoices() (solo se predictionPending)
│   └── renderPenaltyOverlay() (solo se penaltyActive)
└── renderVictory()  → schermata finale
```

Helper `el(tag, attrs, children)` — crea elementi HTML o SVG in base al tag.
Riconosce automaticamente i tag SVG (`svg`, `g`, `circle`, `text`, ...).
Supporta:
- Attributi normali → `setAttribute`
- Chiavi `on*` (es. `onclick`) → `addEventListener`
- `style: {...}` come oggetto → Object.assign
- `class: '...'` con `replace_all: false` — attenzione: NON usare `className`

**Attenzione all'animazione delle pedine**: `render()` distrugge e ricrea
l'SVG, quindi la transizione CSS `transform` NON parte. Per animare le pedine
si usano funzioni di aggiornamento mirato che mutano il DOM esistente:

- `updatePiecePositions()` — cambia solo il `transform` dei `<g class="piece">`
- `updatePathLines()` — ricrea le polyline
- `updatePlayerStrips()` — ricrea le strisce dei giocatori

Chiamate da `executeMove()` invece di `render()` per far partire la transizione.

---

## 7. Flusso di un turno

```
[Utente preme LANCIA] onRollDice()
  ├─ g.rolling = true, playSound('dice'), animazione facce ~1s
  └─ finale:
      ├─ predictMode ON  → g.predictionPending = true, render()
      │                    [utente sceglie freccia] onPredictChoice()
      │                    ├─ giusto → stars++, playSound('star')
      │                    └─ sempre → g.awaitingMove = true, render()
      └─ predictMode OFF → g.awaitingMove = true, render()

[Utente tocca un bersaglio] onTargetClick(diceValue)
  ├─ direzione GIUSTA  → g.awaitingMove = false, executeMove(diceValue)
  └─ direzione SBAGLIATA:
      ├─ lampeggio rosso bersaglio
      ├─ penaltyEnabled ON  → triggerPenalty()
      │                       ├─ overlay + setInterval 1s
      │                       ├─ risposta giusta → resolvePenalty(true)
      │                       │                    → toast bravo, awaitingMove resta true
      │                       └─ tempo scaduto → resolvePenalty(false)
      │                                          → mossa cancellata, finishTurn()
      └─ penaltyEnabled OFF → toast, l'utente riprova liberamente

executeMove(diceValue)
  ├─ attemptMove(state, diceValue)  → aggiorna positions e paths
  ├─ updatePiecePositions() + updatePathLines() + updatePlayerStrips()
  ├─ playSound('step') o 'oops'
  └─ dopo MOVE_DURATION_MS:
      ├─ se checkWinner() → endGameByFinish() → screen 'victory' + coriandoli
      └─ else finishTurn()

finishTurn()
  ├─ advanceTurn(state)
  ├─ se roundNumber > maxTurns → endGameByTurns() → screen 'victory'
  └─ else render()
```

---

## 8. Dettagli SVG della griglia

`renderGridSvg()` costruisce un `<svg>` con `viewBox` che scala al contenitore.

Ordine di disegno (importante per z-index):

1. `<defs>` con `<pattern id="checker">` per il traguardo a scacchi.
2. Fascia rettangolare del traguardo + due bandierine 🏁.
3. Polyline dei percorsi di ogni giocatore (`<polyline class="path-line">`).
4. Dots della griglia (cerchi grigi; dot del traguardo bianchi con bordo
   rosso; dot di partenza colorati con simbolo).
5. Pedine `<g class="piece" data-player="i" transform="translate(cx, cy)">`
   con dentro `<circle>` + `<text>` (emoji). La pedina del turno corrente
   ha classe extra `current-turn` che innesca il pulsare.
6. Bersagli (solo se `g.awaitingMove`): un `<g class="target">` per ogni
   direzione del dado, con `data-dice="N"` per identificarli.

Coordinate: `cx = MARGIN + x * CELL`, `cy = MARGIN + y * CELL`.
Pedine sovrapposte allo stesso punto: sfalsate in cerchio con raggio
`min(CELL/3, 12)`.

---

## 9. Convenzioni chiave (da rispettare)

1. **Testo in stampatello maiuscolo** ovunque (CSS `text-transform: uppercase`
   su `body`).
2. **Frasi brevi**, tono positivo, mai punitivo.
3. **Tutto in italiano** — anche le variabili nei messaggi visibili.
4. **Nessuna richiesta di rete** né uso obbligatorio di localStorage.
5. **Pulsanti ≥60px**, touch-friendly. Le nuove UI devono rispettare questo.
6. **Non introdurre nuove regole** senza chiedere prima.
7. **Costanti in cima**: se aggiungi un parametro configurabile, mettici
   la costante e/o l'opzione in `State.config`.
8. **Rendering ≠ logica**: le funzioni pure non devono toccare il DOM.
9. **Modifica atomica dello stato**: prima aggiorna `State`, poi chiama
   `render()` (o l'update mirato).

---

## 10. Modifiche tipiche — ricette rapide

### Cambiare cosa fa una faccia del dado
Modifica `DICE_MAP`. Fine.

### Aggiungere una nuova opzione alla schermata iniziale
1. Aggiungi il campo a `State.config` (con default).
2. Nella funzione `renderConfig()`, all'interno della card "OPZIONI",
   aggiungi un `<label class="toggle">` con checkbox o uno `makeStepper()`.
3. Nel gestore `onchange`/callback, aggiorna `cfg.<campo>` e chiama
   `render()` se serve un ridisegno.
4. Usa il valore dove serve. Se è booleano che cambia una fase del turno,
   probabilmente aggiungerai un check in `onRollDice`, `onTargetClick` o
   nel rendering.

### Aggiungere una nuova palette di colori
Aggiungi voci a `PALETTE`. Se superi 10, cambia `MAX_PLAYERS` e verifica
che l'UI del selettore colore regga (usa `flex-wrap`).

### Cambiare le operazioni della penalità (es. anche moltiplicazioni)
Modifica `generateMathQuestion()`. Restituisci sempre `{a, b, op, answer}`.
Il display formatta come `${a} ${op} ${b} = ?`. Se serve operatore
custom (es. `×`), aggiungilo lì.

### Aggiungere un suono nuovo
In `playSound(type)`, aggiungi un `else if (type === 'nuovo') { ... }`.
Usa oscillatori base (`sine`, `square`, `triangle`) e `gain.gain.exponentialRampToValueAtTime`
per evitare click.

### Cambiare l'aspetto della griglia (colori, dimensioni)
- Colori dei dot: CSS `.grid-dot`, `.grid-dot.start`, o attributi `fill`
  nelle chiamate `el('circle', ...)` in `renderGridSvg()`.
- Colore del traguardo: `<pattern id="checker">` in `renderGridSvg()`.
- Dimensione pedina: cambia `r: 16` nella creazione delle pedine e il
  `--r: '16'` nello style del `<g>`.

### Aggiungere una nuova modalità di gioco
1. Aggiungi il flag a `State.config`.
2. Se cambia il flusso del turno, aggiungi un branch in `onRollDice`,
   `onTargetClick` o `executeMove`.
3. Se serve una nuova UI intermedia (tipo la modalità Prevedi), aggiungi
   un flag di stato in `State.game` (es. `newModePending`) e una funzione
   di rendering `renderNewModePanel()` chiamata dentro `renderGame`.

### Cambiare il calcolo automatico del limite turni
Modifica `calculateDefaultMaxTurns(rows)`. Il valore si applica
automaticamente ogni volta che l'utente cambia le righe (a meno che
non abbia toccato lo stepper turni, nel qual caso `maxTurnsManuallySet` è
`true` e il calcolo non parte).

---

## 11. Test automatici (`runTests()`)

Da console browser (F12): `runTests()`. Da Node (con stub DOM):
vedi `runtests.js` d'esempio più sotto.

I test coprono la **logica pura** (dado, bordi, vittoria, turni, penalità).
Non testano il rendering né gli eventi.

**Struttura**:

```js
function runTests() {
  const results = [];
  function assert(cond, msg) { ... push, log }

  // 1..N: assert(...)

  return { passed, failed, total, results };
}
```

**Come aggiungere test**:

```js
// N. Descrizione
const s = mkTestState(cols, rows, positions);
// operazioni...
assert(<condizione>, 'Descrizione del test');
```

`mkTestState(cols, rows, positions)` è l'helper in fondo al file: costruisce
uno `state` con la stessa forma di quello reale ma senza dipendere dal DOM.

**Eseguire da Node** (utile in una nuova sessione Claude Code):

```js
// runtests.js
function mkNode() {
  const n = { innerHTML:'', style:{}, classList:{add:()=>{}, remove:()=>{}}, children:[] };
  n.appendChild=()=>{}; n.insertBefore=()=>{}; n.setAttribute=()=>{};
  n.getAttribute=()=>'0'; n.addEventListener=()=>{}; n.querySelector=()=>null;
  n.querySelectorAll=()=>[]; n.remove=()=>{}; n.append=()=>{};
  return n;
}
global.document = {
  getElementById:()=>mkNode(), createElement:()=>mkNode(),
  createElementNS:()=>mkNode(), createTextNode:()=>mkNode(),
  querySelector:()=>null, querySelectorAll:()=>[], addEventListener:()=>{}
};
global.window={}; global.requestAnimationFrame=(fn)=>setTimeout(fn,16);
global.setTimeout=()=>0; global.setInterval=()=>0; global.clearInterval=()=>{};
global.confirm=()=>true; global.performance={now:()=>Date.now()};

const fs = require('fs');
const html = fs.readFileSync('index.html','utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
const script = m[1].replace('window.runTests = runTests;', 'global.runTests = runTests;');
new Function(script)();
const r = global.runTests();
console.log(`${r.passed}/${r.total} passati`);
process.exit(r.failed === 0 ? 0 : 1);
```

Poi: `node runtests.js` dalla cartella del progetto.

---

## 12. Trappole note

- **Non fare re-render completo durante le animazioni**: il `render()` distrugge
  e ricrea l'SVG, spezzando le transizioni CSS. Usa gli update mirati
  (`updatePiecePositions`, `updatePathLines`, `updatePlayerStrips`).
- **`className` non funziona sui nodi SVG**: usa sempre `setAttribute('class', ...)`.
  L'helper `el()` lo gestisce già.
- **CSS `transform` su SVG sostituisce l'attributo `transform`**: se vuoi
  animare uno shake su un `<g>` che ha già `transform="translate(...)"`,
  usa una classe che anima `fill`/`opacity` (come fa `.wrong-flash`) invece
  di aggiungere un `transform` CSS.
- **Il timer della penalità va sempre pulito** in caso di uscita dal gioco.
  `confirmNewGame()` lo fa già; se aggiungi altre uscite, ricordati di
  chiamare `clearInterval(g.penaltyTimerId)`.
- **`AudioContext` va creato in risposta a un gesto utente**: `ensureAudio()`
  lo crea al primo `playSound()` (che avviene dopo un click), quindi va tutto
  bene. Se sposti la prima chiamata `playSound` prima del primo click,
  potresti trovare l'audio muto sui browser strict (Safari, iOS).
- **`viewBox` SVG e `MARGIN`**: `MARGIN` deve essere ≥ `CELL + 22` per far
  entrare i bersagli fuori griglia. Se ridimensioni `CELL`, ricontrolla.
- **Emoji nei `<text>` SVG**: `text-anchor: middle` + `dominant-baseline: central`
  centra bene su Chrome/Edge/Firefox. Su Safari il baseline è un po' spostato,
  è accettabile.

---

## 13. Come aprire e provare

- **Utente finale**: doppio clic su `C:\Progetti\giocoDavide\index.html`
  in qualsiasi browser moderno (Chrome, Edge, Firefox).
- **Sviluppatore**: apri il file nel browser, apri la console (F12) e digita
  `runTests()` per gli auto-test. Modifiche live: salva il file e ricarica
  con **Ctrl+F5** (bypass cache).
- **Nessun server, nessun build, nessuna dipendenza esterna**.

---

## 14. Log delle iterazioni fatte finora

Utile per capire il "perché" delle scelte se ti chiedono modifiche:

1. **v1**: gioco base con movimento automatico dopo il lancio del dado.
   Modalità Prevedi opzionale (3 frecce fra cui scegliere).
2. **v2**: movimento **manuale** — dopo il lancio l'alunno deve toccare
   uno dei 6 bersagli attorno alla pedina. Direzione sbagliata → solo un
   avviso, si può riprovare.
3. **v3**: introdotta la **penalità matematica** su errore. Overlay con
   operazione + timer 15s + tastierino. Risposta corretta → altro tentativo;
   tempo scaduto → turno passa e mossa cancellata.
4. **v4**: penalità e secondi timer resi **configurabili** dalla schermata
   iniziale (`penaltyEnabled` on/off, `penaltySeconds` 5-60 con stepper).

Ogni iterazione ha mantenuto il principio *"la logica di gioco è pura, il
rendering è dichiarativo e ricostruttivo"* — eccezione: durante l'animazione
di movimento si aggiornano solo i nodi interessati.
