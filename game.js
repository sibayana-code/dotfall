(() => {
  const COLS = 5;
  const ROWS = 6;
  const HOME = 2 + 3 * COLS;
  const NIGHTS_TO_WIN = 3;
  const FILL_TO_WIN = 20;
  const CLAIMS = [6, 6, 7];
  const ENEMIES = [2, 3, 4];
  const SPEED = [0.28, 0.36, 0.44];

  const board = document.getElementById("board");
  const nodesEl = document.getElementById("nodes");
  const edgesEl = document.getElementById("edges");
  const enemiesEl = document.getElementById("enemies");
  const fxEl = document.getElementById("fx");
  const tokensEl = document.getElementById("tokens");
  const helpEl = document.getElementById("help");
  const phaseIcon = document.getElementById("phaseIcon");
  const phaseNum = document.getElementById("phaseNum");
  const overlay = document.getElementById("overlay");
  const cardTitle = document.getElementById("cardTitle");
  const cardMark = document.getElementById("cardMark");
  const again = document.getElementById("again");

  let owned;
  let phase; // "day" | "night" | "end"
  let dayIndex;
  let claimsLeft;
  let enemies;
  let enemySeq;
  let spawnTotal;
  let spawnedCount;
  let positions;
  let nodeEls;
  let playing;
  let lastTs;
  let audioCtx;

  function idx(c, r) {
    return r * COLS + c;
  }

  function cell(i) {
    return { c: i % COLS, r: Math.floor(i / COLS) };
  }

  function neighbors(i) {
    const { c, r } = cell(i);
    const out = [];
    if (c > 0) out.push(idx(c - 1, r));
    if (c < COLS - 1) out.push(idx(c + 1, r));
    if (r > 0) out.push(idx(c, r - 1));
    if (r < ROWS - 1) out.push(idx(c, r + 1));
    return out;
  }

  function isClaimable(i) {
    return !owned[i] && neighbors(i).some((n) => owned[n]);
  }

  function ownedCount() {
    return owned.reduce((n, v) => n + (v ? 1 : 0), 0);
  }

  function ensureAudio() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  }

  function tone(freq, dur, type, gain) {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + dur);
  }

  function sfx(kind) {
    if (kind === "claim") {
      tone(620, 0.09, "triangle", 0.05);
      tone(880, 0.12, "sine", 0.04);
    } else if (kind === "pop") {
      tone(320, 0.08, "square", 0.04);
      tone(180, 0.12, "triangle", 0.05);
    } else if (kind === "win") {
      tone(523, 0.15, "triangle", 0.05);
      setTimeout(() => tone(659, 0.15, "triangle", 0.05), 90);
      setTimeout(() => tone(784, 0.22, "triangle", 0.06), 180);
    } else if (kind === "lose") {
      tone(220, 0.28, "sine", 0.05);
    } else if (kind === "night") {
      tone(392, 0.16, "sine", 0.04);
    } else if (kind === "day") {
      tone(784, 0.14, "triangle", 0.04);
    }
  }

  function layout() {
    const w = board.clientWidth;
    const h = board.clientHeight;
    let padX = Math.max(36, w * 0.1);
    let padY = Math.max(32, h * 0.08);
    let gapX = COLS === 1 ? 0 : (w - padX * 2) / (COLS - 1);
    let gapY = ROWS === 1 ? 0 : (h - padY * 2) / (ROWS - 1);
    let size = Math.max(48, Math.min(80, Math.min(gapX, gapY) * 0.66));
    padX = Math.max(padX, size / 2 + 10);
    padY = Math.max(padY, size / 2 + 10);
    gapX = COLS === 1 ? 0 : (w - padX * 2) / (COLS - 1);
    gapY = ROWS === 1 ? 0 : (h - padY * 2) / (ROWS - 1);
    size = Math.max(48, Math.min(80, Math.min(gapX, gapY) * 0.66));
    positions = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        positions.push({ x: padX + c * gapX, y: padY + r * gapY, size });
      }
    }

    edgesEl.setAttribute("viewBox", `0 0 ${w} ${h}`);
    edgesEl.setAttribute("width", w);
    edgesEl.setAttribute("height", h);
    let lines = "";
    for (let i = 0; i < COLS * ROWS; i++) {
      for (const n of neighbors(i)) {
        if (n < i) continue;
        const a = positions[i];
        const b = positions[n];
        const lit = owned[i] && owned[n];
        lines += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${
          lit ? "var(--line-owned)" : "var(--line)"
        }" stroke-width="${lit ? 5 : 3}" stroke-linecap="round" />`;
      }
    }
    edgesEl.innerHTML = lines;

    for (let i = 0; i < nodeEls.length; i++) {
      const p = positions[i];
      const el = nodeEls[i];
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
      el.style.width = `${p.size}px`;
      el.style.height = `${p.size}px`;
    }
  }

  function paintNodes() {
    for (let i = 0; i < nodeEls.length; i++) {
      const el = nodeEls[i];
      el.classList.toggle("owned", owned[i]);
      el.classList.toggle("home", i === HOME);
      el.classList.toggle(
        "claimable",
        phase === "day" && isClaimable(i)
      );
    }
  }

  function paintHud() {
    const n = Math.min(dayIndex, CLAIMS.length - 1) + 1;
    phaseIcon.textContent = phase === "night" ? "🌙" : "☀️";
    phaseNum.textContent = String(n);
    if (phase === "day") {
      helpEl.textContent = "Tap a neighbor to take it";
      const max = CLAIMS[Math.min(dayIndex, CLAIMS.length - 1)];
      tokensEl.innerHTML = "";
      for (let i = 0; i < max; i++) {
        const t = document.createElement("span");
        t.className = "token" + (i < claimsLeft ? " on" : "");
        tokensEl.appendChild(t);
      }
    } else if (phase === "night") {
      helpEl.textContent = "Tap the blobs!";
      tokensEl.innerHTML = "";
    } else {
      tokensEl.innerHTML = "";
    }
  }

  function burstAt(i) {
    const p = positions[i];
    const b = document.createElement("div");
    b.className = "burst";
    b.style.left = `${p.x}px`;
    b.style.top = `${p.y}px`;
    fxEl.appendChild(b);
    setTimeout(() => b.remove(), 400);
  }

  function onNodeTap(i) {
    if (!playing) return;
    if (phase === "night") {
      const hit = enemies.find((e) => {
        if (e.gone) return false;
        const a = e.path[e.step];
        const b = e.path[Math.min(e.step + 1, e.path.length - 1)];
        return a === i || b === i;
      });
      if (hit) popEnemy(hit);
      return;
    }
    tryClaim(i);
  }

  function tryClaim(i) {
    if (!playing || phase !== "day") return;
    if (!isClaimable(i)) return;
    owned[i] = true;
    claimsLeft -= 1;
    burstAt(i);
    const el = nodeEls[i];
    el.classList.remove("pop");
    void el.offsetWidth;
    el.classList.add("pop");
    sfx("claim");
    if (navigator.vibrate) navigator.vibrate(12);
    layout();
    paintNodes();
    paintHud();
    if (ownedCount() >= FILL_TO_WIN) {
      endGame(true);
      return;
    }
    if (claimsLeft <= 0) {
      setTimeout(() => {
        if (playing && phase === "day") startNight();
      }, 420);
    }
  }

  function pathToHome(start) {
    const prev = new Map([[start, null]]);
    const q = [start];
    while (q.length) {
      const cur = q.shift();
      if (cur === HOME) break;
      for (const n of neighbors(cur)) {
        if (!prev.has(n)) {
          prev.set(n, cur);
          q.push(n);
        }
      }
    }
    if (!prev.has(HOME)) return [start];
    const path = [];
    let cur = HOME;
    while (cur !== null) {
      path.push(cur);
      cur = prev.get(cur);
    }
    path.reverse();
    return path;
  }

  function edgeSpawns() {
    const corners = [
      idx(0, 0),
      idx(COLS - 1, 0),
      idx(0, ROWS - 1),
      idx(COLS - 1, ROWS - 1),
    ];
    const rest = [];
    for (let c = 0; c < COLS; c++) {
      rest.push(idx(c, 0), idx(c, ROWS - 1));
    }
    for (let r = 1; r < ROWS - 1; r++) {
      rest.push(idx(0, r), idx(COLS - 1, r));
    }
    const seen = new Set();
    const list = [];
    for (const i of [...corners, ...rest]) {
      if (i === HOME || seen.has(i)) continue;
      seen.add(i);
      list.push(i);
    }
    return list;
  }

  function spawnEnemy(start) {
    const path = pathToHome(start);
    const el = document.createElement("button");
    el.type = "button";
    el.className = "enemy";
    el.setAttribute("aria-label", "blob");
    const enemy = {
      id: ++enemySeq,
      path,
      step: 0,
      t: 0,
      wait: 0.55,
      el,
      gone: false,
    };
    const tap = (e) => {
      e.preventDefault();
      e.stopPropagation();
      popEnemy(enemy);
    };
    el.addEventListener("pointerdown", tap);
    el.addEventListener("click", tap);
    enemiesEl.appendChild(el);
    enemies.push(enemy);
    placeEnemy(enemy);
  }

  function placeEnemy(enemy) {
    const a = positions[enemy.path[enemy.step]];
    const b = positions[enemy.path[Math.min(enemy.step + 1, enemy.path.length - 1)]];
    const x = a.x + (b.x - a.x) * enemy.t;
    const y = a.y + (b.y - a.y) * enemy.t;
    const jig = ((enemy.id % 5) - 2) * 11;
    enemy.el.style.left = `${x + jig}px`;
    enemy.el.style.top = `${y}px`;
    const s = Math.max(52, (a.size || 56) * 0.92);
    enemy.el.style.width = `${s}px`;
    enemy.el.style.height = `${s}px`;
  }

  function popEnemy(enemy) {
    if (!playing || phase !== "night" || enemy.gone) return;
    enemy.gone = true;
    enemy.el.classList.add("zap");
    sfx("pop");
    if (navigator.vibrate) navigator.vibrate(18);
    setTimeout(() => enemy.el.remove(), 200);
    enemies = enemies.filter((e) => e !== enemy);
    maybeFinishNight();
  }

  function maybeFinishNight() {
    if (
      playing &&
      phase === "night" &&
      spawnedCount >= spawnTotal &&
      enemies.length === 0
    ) {
      surviveNight();
    }
  }

  function startDay() {
    phase = "day";
    document.body.classList.remove("night");
    claimsLeft = CLAIMS[Math.min(dayIndex, CLAIMS.length - 1)];
    enemies.forEach((e) => e.el.remove());
    enemies = [];
    sfx("day");
    layout();
    paintNodes();
    paintHud();
  }

  function startNight() {
    phase = "night";
    document.body.classList.add("night");
    helpEl.textContent = "Tap the blobs!";
    tokensEl.innerHTML = "";
    phaseIcon.textContent = "🌙";
    phaseNum.textContent = String(dayIndex + 1);
    sfx("night");
    paintNodes();
    const count = ENEMIES[Math.min(dayIndex, ENEMIES.length - 1)];
    spawnTotal = count;
    spawnedCount = 0;
    const spots = edgeSpawns();
    for (let i = 0; i < count; i++) {
      const start = spots[i % spots.length];
      setTimeout(() => {
        if (!playing || phase !== "night") return;
        spawnedCount += 1;
        spawnEnemy(start);
      }, 450 + i * 900);
    }
  }

  function surviveNight() {
    if (dayIndex + 1 >= NIGHTS_TO_WIN) {
      endGame(true);
      return;
    }
    dayIndex += 1;
    setTimeout(() => {
      if (playing && phase === "night") startDay();
    }, 500);
  }

  function endGame(won) {
    playing = false;
    phase = "end";
    overlay.classList.remove("hidden");
    cardTitle.textContent = won ? "You win!" : "Oh no!";
    cardMark.textContent = won ? "★" : "•";
    sfx(won ? "win" : "lose");
  }

  function tick(ts) {
    requestAnimationFrame(tick);
    if (!lastTs) lastTs = ts;
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;
    if (!playing || phase !== "night") return;
    const speed = SPEED[Math.min(dayIndex, SPEED.length - 1)];
    for (const enemy of [...enemies]) {
      if (enemy.gone) continue;
      if (enemy.wait > 0) {
        enemy.wait -= dt;
        placeEnemy(enemy);
        continue;
      }
      const here = enemy.path[enemy.step];
      const slow = owned[here] ? 0.48 : 1;
      enemy.t += dt * speed * slow;
      while (enemy.t >= 1) {
        enemy.t -= 1;
        enemy.step += 1;
        if (enemy.step >= enemy.path.length - 1) {
          enemy.gone = true;
          enemy.el.remove();
          enemies = enemies.filter((e) => e !== enemy);
          endGame(false);
          return;
        }
      }
      placeEnemy(enemy);
    }
  }

  function reset() {
    owned = Array(COLS * ROWS).fill(false);
    owned[HOME] = true;
    phase = "day";
    dayIndex = 0;
    claimsLeft = CLAIMS[0];
    enemies = [];
    enemySeq = 0;
    spawnTotal = 0;
    spawnedCount = 0;
    playing = true;
    overlay.classList.add("hidden");
    document.body.classList.remove("night");
    enemiesEl.innerHTML = "";
    fxEl.innerHTML = "";
    layout();
    paintNodes();
    paintHud();
  }

  function build() {
    nodesEl.innerHTML = "";
    nodeEls = [];
    for (let i = 0; i < COLS * ROWS; i++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "node";
      btn.setAttribute("aria-label", i === HOME ? "home" : "dot");
      if (i === HOME) {
        btn.innerHTML =
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#b45309" d="M12 4 3 12h2.5v8h5v-5h3v5h5v-8H21z"/></svg>';
      }
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        ensureAudio();
        onNodeTap(i);
      });
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        ensureAudio();
        onNodeTap(i);
      });
      nodesEl.appendChild(btn);
      nodeEls.push(btn);
    }
  }

  again.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    ensureAudio();
    reset();
  });
  again.addEventListener("click", (e) => {
    e.preventDefault();
    ensureAudio();
    reset();
  });

  window.addEventListener("resize", () => {
    if (!positions) return;
    layout();
    enemies.forEach(placeEnemy);
  });

  document.addEventListener(
    "touchmove",
    (e) => {
      e.preventDefault();
    },
    { passive: false }
  );

  build();
  reset();
  window.addEventListener("load", () => {
    layout();
    paintNodes();
  });
  requestAnimationFrame(() => {
    layout();
    paintNodes();
    requestAnimationFrame(tick);
  });
})();
