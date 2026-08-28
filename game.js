(() => {
  const COLS = 6;
  const ROWS = 8;
  const HOME = 3 + 4 * COLS;
  const FILL_TO_WIN = 22;
  const MAX_NIGHTS = 6;
  const CLAIMS = [7, 6, 5, 5, 4, 4];
  const ENEMIES = [5, 7, 9, 11, 13, 15];
  const SPEED = [0.5, 0.62, 0.78, 0.98, 1.22, 1.5];
  const FACTORY_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#7c2d12" d="M3 20V11h5l3-5h2v5h8v9H3zm2-2h2v-3H5v3zm4 0h2v-3H9v3zm4 0h2v-3h-2v3zm4 0h2v-3h-2v3z"/></svg>';

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
  let factory;
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

  function at(c, r) {
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return null;
    return idx(c, r);
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

  function neighbors8(i) {
    const { c, r } = cell(i);
    const out = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dc && !dr) continue;
        const nc = c + dc;
        const nr = r + dr;
        if (nc >= 0 && nc < COLS && nr >= 0 && nr < ROWS) out.push(idx(nc, nr));
      }
    }
    return out;
  }

  function isClaimable(i) {
    return !owned[i] && neighbors(i).some((n) => owned[n]);
  }

  function coverage() {
    let n = 0;
    for (let i = 0; i < owned.length; i++) {
      if (!owned[i]) continue;
      n += i === factory ? 2 : 1;
    }
    return n;
  }

  function pickFactory() {
    const h = cell(HOME);
    const candidates = [];
    for (let i = 0; i < COLS * ROWS; i++) {
      if (i === HOME) continue;
      const p = cell(i);
      if (Math.abs(p.c - h.c) + Math.abs(p.r - h.r) < 2) continue;
      candidates.push(i);
    }
    factory = candidates[Math.floor(Math.random() * candidates.length)];
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
    } else if (kind === "steal") {
      tone(196, 0.14, "sine", 0.05);
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
    let size = Math.max(32, Math.min(52, Math.min(gapX, gapY) * 0.46));
    padX = Math.max(padX, size / 2 + 8);
    padY = Math.max(padY, size / 2 + 8);
    gapX = COLS === 1 ? 0 : (w - padX * 2) / (COLS - 1);
    gapY = ROWS === 1 ? 0 : (h - padY * 2) / (ROWS - 1);
    size = Math.max(32, Math.min(52, Math.min(gapX, gapY) * 0.46));
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
      el.classList.toggle("factory", i === factory);
      el.classList.toggle(
        "claimable",
        phase === "day" && isClaimable(i)
      );
      if (i !== HOME) {
        el.setAttribute("aria-label", i === factory ? "factory" : "dot");
      }
      if (i === HOME) continue;
      if (i === factory) {
        if (!el.querySelector("svg")) el.innerHTML = FACTORY_SVG;
      } else if (el.querySelector("svg")) {
        el.innerHTML = "";
      }
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
      helpEl.textContent = "Tap the balloons!";
      tokensEl.innerHTML = "";
    } else {
      tokensEl.innerHTML = "";
    }
  }

  function burstAt(i, kind) {
    const p = positions[i];
    const b = document.createElement("div");
    b.className = "burst" + (kind === "steal" ? " steal" : "");
    b.style.left = `${p.x}px`;
    b.style.top = `${p.y}px`;
    fxEl.appendChild(b);
    setTimeout(() => b.remove(), 400);
  }

  function unownDot(i) {
    if (i === HOME || !owned[i]) return;
    owned[i] = false;
    burstAt(i, "steal");
    const el = nodeEls[i];
    el.classList.remove("pop");
    void el.offsetWidth;
    el.classList.add("pop");
    sfx("steal");
    layout();
    paintNodes();
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
    if (coverage() >= FILL_TO_WIN) {
      endGame(true);
      return;
    }
    if (claimsLeft <= 0) {
      setTimeout(() => {
        if (playing && phase === "day") startNight();
      }, 420);
    }
  }

  function bfsPath(start, adjacent) {
    const prev = new Map([[start, null]]);
    const q = [start];
    while (q.length) {
      const cur = q.shift();
      if (cur === HOME) break;
      for (const n of adjacent(cur)) {
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

  function pathStraight(start) {
    return bfsPath(start, neighbors);
  }

  function pathDiagonal(start) {
    return bfsPath(start, neighbors8);
  }

  function pathWeave(start) {
    const path = [start];
    let cur = start;
    let side = 1;
    const seen = new Set([start]);
    const h = cell(HOME);
    while (cur !== HOME && path.length < COLS * ROWS * 2) {
      const { c, r } = cell(cur);
      const dc = Math.sign(h.c - c);
      const dr = Math.sign(h.r - r);
      const order = [];
      if (path.length % 2 === 0) {
        if (dc) order.push(at(c + dc, r + side));
        if (dr) order.push(at(c + side, r + dr));
        if (dc) order.push(at(c + dc, r));
        if (dr) order.push(at(c, r + dr));
      } else {
        if (dc) order.push(at(c + dc, r));
        if (dr) order.push(at(c, r + dr));
        if (dc && dr) order.push(at(c + dc, r + dr));
      }
      if (dc && dr) order.push(at(c + dc, r + dr));
      let next = null;
      for (const n of order) {
        if (n == null || n === cur) continue;
        const p = cell(n);
        if (Math.abs(p.c - c) > 1 || Math.abs(p.r - r) > 1) continue;
        if (n === HOME) {
          next = n;
          break;
        }
        if (!seen.has(n)) {
          next = n;
          break;
        }
      }
      if (next == null) {
        return path.concat(pathStraight(cur).slice(1));
      }
      path.push(next);
      seen.add(next);
      cur = next;
      side *= -1;
    }
    return path;
  }

  function pathForMotion(start, motion) {
    if (motion === "diagonal") return pathDiagonal(start);
    if (motion === "weave") return pathWeave(start);
    return pathStraight(start);
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

  function spawnEnemy(start, motion) {
    const path = pathForMotion(start, motion);
    const el = document.createElement("button");
    el.type = "button";
    el.className = "enemy";
    el.setAttribute("aria-label", "balloon");
    const enemy = {
      id: ++enemySeq,
      path,
      step: 0,
      t: 0,
      wait: 0.28,
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
    const jig = ((enemy.id % 5) - 2) * 7;
    enemy.el.style.left = `${x + jig}px`;
    enemy.el.style.top = `${y}px`;
    const s = Math.max(36, (a.size || 40) * 1.08);
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
    helpEl.textContent = "Tap the balloons!";
    tokensEl.innerHTML = "";
    phaseIcon.textContent = "🌙";
    phaseNum.textContent = String(dayIndex + 1);
    sfx("night");
    paintNodes();
    const count = ENEMIES[Math.min(dayIndex, ENEMIES.length - 1)];
    spawnTotal = count;
    spawnedCount = 0;
    const spots = edgeSpawns();
    const motions = ["straight", "diagonal", "weave"];
    for (let i = spots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = spots[i];
      spots[i] = spots[j];
      spots[j] = tmp;
    }
    for (let i = 0; i < count; i++) {
      const start = spots[i % spots.length];
      const motion = motions[i % 3];
      setTimeout(() => {
        if (!playing || phase !== "night") return;
        spawnedCount += 1;
        spawnEnemy(start, motion);
      }, 60 + Math.floor(i / 2) * 150);
    }
  }

  function surviveNight() {
    if (dayIndex + 1 >= MAX_NIGHTS) {
      endGame(coverage() >= FILL_TO_WIN);
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
        if (enemy.wait <= 0) {
          const start = enemy.path[0];
          if (owned[start] && start !== HOME) {
            unownDot(start);
            popEnemy(enemy);
            continue;
          }
        }
        placeEnemy(enemy);
        continue;
      }
      const here = enemy.path[enemy.step];
      const slow = owned[here] ? 0.7 : 1;
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
        const landed = enemy.path[enemy.step];
        if (owned[landed] && landed !== HOME) {
          unownDot(landed);
          popEnemy(enemy);
          break;
        }
      }
      placeEnemy(enemy);
    }
  }

  function reset() {
    owned = Array(COLS * ROWS).fill(false);
    owned[HOME] = true;
    pickFactory();
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
      btn.setAttribute(
        "aria-label",
        i === HOME ? "home" : "dot"
      );
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
