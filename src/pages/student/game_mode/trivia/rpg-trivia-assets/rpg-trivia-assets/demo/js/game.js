/* RPG Trivia demo — game engine mini (canvas 2D, tile 16px, sprite 32px).
   Data peta dari js/maps.js (RPG_MAPS). Semua gambar dimuat relatif dari folder demo/. */
(function () {
  'use strict';
  var TS = 16, VW = 400, VH = 288;
  var cv = document.getElementById('cv'), ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  /* ---------- data quiz ---------- */
  var QUESTIONS = [
    { q: 'Planet terbesar di Tata Surya adalah...', a: ['Mars', 'Jupiter', 'Bumi'], c: 1 },
    { q: 'Berapa hasil 9 x 7 ?', a: ['56', '72', '63'], c: 2 },
    { q: 'Gunung tertinggi di dunia adalah...', a: ['Gunung Everest', 'Gunung Rinjani', 'Puncak Jayawijaya'], c: 0 },
    { q: 'Mana yang BUKAN warna primer?', a: ['Merah', 'Hijau', 'Biru'], c: 1 },
    { q: 'Mantra sihir untuk mengangkat benda di dunia penyihir adalah...', a: ['Abracadabra', 'Sim Sala Bim', 'Wingardium Leviosa'], c: 2 }
  ];

  /* ---------- preload gambar ---------- */
  var IMG = {};
  function loadImgs(list, done) {
    var n = 0;
    list.forEach(function (p) {
      var im = new Image();
      im.onload = im.onerror = function () { if (++n === list.length) done(); };
      im.src = p; IMG[p] = im;
    });
  }
  var need = ['../tilesets/overworld.png', '../tilesets/interior.png', '../tilesets/trivia.png',
    '../characters/player.png', '../characters/archmage.png', '../characters/librarian.png',
    '../characters/student.png', '../characters/guard.png', '../characters/shade.png',
    '../objects/tree.png', '../ui/heart.png', '../ui/star.png'];

  /* ---------- state ---------- */
  var D = RPG_MAPS;
  var maps = {}, cur = null;
  D.maps.forEach(function (m) { maps[m.id] = m; });
  var player = { x: D.spawn.x, y: D.spawn.y, dir: 0, frame: 0, anim: 0, moving: false };
  var hearts = 3, stars = 0, quizIdx = 0, quizDone = false;
  var dialogOpen = false, quizOpen = false, doorLock = false;
  var keys = {};

  var DIRS = { down: 0, left: 1, right: 2, up: 3 };

  function switchMap(id, sp) {
    cur = maps[id];
    player.x = sp.x; player.y = sp.y;
    player.dir = DIRS[sp.dir] || 0;
    doorLock = true;
    setTimeout(function () { doorLock = false; }, 350);
  }

  /* ---------- collision ---------- */
  function solidAt(px, py) {
    if (px < 0 || py < 0 || px >= cur.w * TS || py >= cur.h * TS) return true;
    var t = cur.tiles[(py / TS) | 0][(px / TS) | 0];
    return cur.solids.indexOf(t) !== -1;
  }
  function canMove(nx, ny, dir) {
    // Hitbox karakter: area kaki (lebar 16px, tinggi 6px di bawah sprite)
    // dan cek ujung gerakan sesuai arah agar tidak melintasi dinding
    var hx = nx + 8, hy = ny + 20, hw = 16, hh = 6;
    var pts;
    if (dir === 'up') {
      // Saat naik, cek titik di atas badan (kepala)
      pts = [
        [hx, hy - 2], [hx + hw - 1, hy - 2],
        [hx, hy], [hx + hw - 1, hy]
      ];
    } else if (dir === 'down') {
      // Saat turun, cek titik di kaki
      pts = [
        [hx, hy + hh], [hx + hw - 1, hy + hh],
        [hx, hy + hh - 1], [hx + hw - 1, hy + hh - 1]
      ];
    } else if (dir === 'left') {
      pts = [
        [hx - 2, hy], [hx - 2, hy + hh - 1],
        [hx, hy], [hx, hy + hh - 1]
      ];
    } else if (dir === 'right') {
      pts = [
        [hx + hw + 1, hy], [hx + hw + 1, hy + hh - 1],
        [hx + hw - 1, hy], [hx + hw - 1, hy + hh - 1]
      ];
    } else {
      // default: cek kaki (compatible dengan gerakan diagonal)
      pts = [
        [nx + 7, ny + 26], [nx + 24, ny + 26],
        [nx + 7, ny + 21], [nx + 24, ny + 21]
      ];
    }
    for (var i = 0; i < pts.length; i++) if (solidAt(pts[i][0], pts[i][1])) return false;
    return true;
  }

  /* ---------- pintu / trigger ---------- */
  function doorAt(px, py) {
    var tx = (px / TS) | 0, ty = (py / TS) | 0;
    for (var i = 0; i < cur.doors.length; i++) {
      var d = cur.doors[i];
      if (d.x === tx && d.y === ty) return d;
    }
    return null;
  }
  function handleDoor(d) {
    if (d.to === 'quiz') { openQuiz(); return; }
    var key = cur.id + '->' + d.to;
    var sp = D.doorSpawns[key];
    if (sp) switchMap(d.to, sp);
  }

  /* ---------- HUD ---------- */
  var heartsEl = document.getElementById('hearts'), starsEl = document.getElementById('stars');
  function drawHUD() {
    var h = '';
    for (var i = 0; i < hearts; i++) h += '<span><img src="../ui/heart.png"></span>';
    heartsEl.innerHTML = h;
    var s = '';
    for (var j = 0; j < 5; j++) s += '<span><img src="../ui/star.png" style="opacity:' + (j < stars ? 1 : 0.22) + '"></span>';
    starsEl.innerHTML = s;
  }

  /* ---------- dialog NPC ---------- */
  var dlg = document.getElementById('dialog');
  function openDialog(npc) {
    document.getElementById('dlgName').textContent = npc.name;
    document.getElementById('dlgText').textContent = npc.text;
    dlg.style.display = 'block';
    dialogOpen = true;
  }
  function closeDialog() { dlg.style.display = 'none'; dialogOpen = false; }

  function tryInteract() {
    var pcx = player.x + 16, pcy = player.y + 16;
    for (var i = 0; i < cur.npcs.length; i++) {
      var n = cur.npcs[i];
      var nx = n.x * TS, ny = n.y * TS;
      if (Math.abs(pcx - nx) < 26 && Math.abs(pcy - ny) < 26) { openDialog(n); return; }
    }
  }

  /* ---------- quiz ---------- */
  var quizEl = document.getElementById('quiz');
  function openQuiz() {
    if (quizDone) { showResult(); return; }
    quizOpen = true; quizIdx = 0; renderQuiz();
    quizEl.style.display = 'flex';
  }
  function renderQuiz() {
    var Q = QUESTIONS[quizIdx];
    document.getElementById('qNo').textContent = 'Pertanyaan ' + (quizIdx + 1) + ' / ' + QUESTIONS.length;
    document.getElementById('qText').textContent = Q.q;
    document.getElementById('feedback').textContent = '';
    document.getElementById('feedback').className = '';
    var box = document.getElementById('answers');
    box.innerHTML = '';
    Q.a.forEach(function (txt, i) {
      var b = document.createElement('button');
      b.textContent = txt;
      b.onclick = function () { answer(i, b); };
      box.appendChild(b);
    });
  }
  function answer(i, btn) {
    if (document.getElementById('feedback').textContent) return;
    var Q = QUESTIONS[quizIdx], fb = document.getElementById('feedback');
    var buttons = document.querySelectorAll('#answers button');
    buttons[Q.c].className = 'correct';
    if (i === Q.c) {
      stars++; fb.textContent = 'Benar! +1 bintang'; fb.className = 'ok';
    } else {
      btn.className = 'wrong'; hearts--; fb.textContent = 'Salah... -1 nyawa'; fb.className = 'no';
    }
    drawHUD();
    setTimeout(function () {
      quizIdx++;
      if (hearts <= 0) { showResult(true); return; }
      if (quizIdx < QUESTIONS.length) renderQuiz(); else showResult();
    }, 900);
  }
  function showResult(fail) {
    quizDone = !fail;
    var box = document.getElementById('quizBox');
    var msg = fail
      ? 'Cahayamu padam... Bayangan mengusirmu! (Tekan tombol untuk mencoba lagi)'
      : (stars >= 4 ? 'LUAR BIASA! Kamu lulus Ujian Trivia dengan ' + stars + ' bintang!'
        : 'Kamu lulus Ujian Trivia dengan ' + stars + ' bintang. Kepala Sekolah pasti bangga!');
    box.innerHTML = '<h2>HASIL UJIAN</h2><div class="qtext">' + msg + '</div>' +
      '<div id="answers"><button id="qOk">' + (fail ? 'Coba Lagi' : 'Kembali ke Kelas') + '</button></div>';
    document.getElementById('qOk').onclick = function () {
      quizEl.style.display = 'none'; quizOpen = false;
      if (fail) {
        hearts = 3; stars = 0; quizIdx = 0; drawHUD();
        // turunkan pemain dari portal agar tidak langsung memicu quiz lagi
        player.y += 48;
      } else {
        // kembali ke kelas
        var sp = D.doorSpawns['trivia->interior'];
        switchMap('interior', sp);
      }
    };
  }

  /* ---------- input ---------- */
  document.addEventListener('keydown', function (e) {
    keys[e.key.toLowerCase()] = true;
    if ((e.key === 'e' || e.key === 'E' || e.key === ' ')) {
      if (quizOpen) return;
      if (dialogOpen) closeDialog(); else tryInteract();
      e.preventDefault();
    }
  });
  document.addEventListener('keyup', function (e) { keys[e.key.toLowerCase()] = false; });

  /* ---------- update ---------- */
  function update() {
    if (dialogOpen || quizOpen) { player.moving = false; return; }
    var dx = 0, dy = 0, sp = 1.6;
    if (keys['arrowleft'] || keys['a']) { dx = -sp; player.dir = 1; }
    else if (keys['arrowright'] || keys['d']) { dx = sp; player.dir = 2; }
    if (keys['arrowup'] || keys['w']) { dy = -sp; player.dir = 3; }
    else if (keys['arrowdown'] || keys['s']) { dy = sp; player.dir = 0; }
    player.moving = (dx !== 0 || dy !== 0);
    if (dx && dy) { dx *= 0.72; dy *= 0.72; }
    if (player.moving) {
      var moveDir = '';
      if (dy < 0) moveDir = 'up';
      else if (dy > 0) moveDir = 'down';
      else if (dx < 0) moveDir = 'left';
      else if (dx > 0) moveDir = 'right';
      if (canMove(player.x + dx, player.y, moveDir)) player.x += dx;
      if (canMove(player.x, player.y + dy, moveDir)) player.y += dy;
      player.anim += 0.18;
      player.frame = ((player.anim | 0) % 4);
    } else { player.anim = 0; player.frame = 0; }
    // pintu
    if (!doorLock) {
      var d = doorAt(player.x + 16, player.y + 26);
      if (d) handleDoor(d);
    }
  }

  /* ---------- draw ---------- */
  var tilesetCache = {};
  function tileImg(name) { return IMG['../tilesets/' + name]; }
  function drawTileset(t) {
    var tx = (t % 8) * TS, ty = ((t / 8) | 0) * TS;
    ctx.drawImage(tileImg(cur.tileset), tx, ty, TS, TS, 0, 0, TS, TS);
  }
  function draw() {
    var mw = cur.w * TS, mh = cur.h * TS;
    var camX = Math.max(0, Math.min(player.x + 16 - VW / 2, mw - VW));
    var camY = Math.max(0, Math.min(player.y + 16 - VH / 2, mh - VH));

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, VW, VH);
    ctx.save();
    ctx.translate(-Math.round(camX), -Math.round(camY));

    // lantai
    var x0 = (camX / TS) | 0, y0 = (camY / TS) | 0;
    for (var y = y0; y <= y0 + VH / TS + 1 && y < cur.h; y++) {
      for (var x = x0; x <= x0 + VW / TS + 1 && x < cur.w; x++) {
        var t = cur.tiles[y][x];
        ctx.drawImage(tileImg(cur.tileset), (t % 8) * TS, ((t / 8) | 0) * TS, TS, TS, x * TS, y * TS, TS, TS);
      }
    }
    // daftar gambar yang diurut berdasar Y (kaki)
    var draws = [];
    cur.objects.forEach(function (o) {
      var im = IMG['../objects/' + o.img];
      if (!im) return;
      draws.push({ y: o.y * TS + TS, fn: function () { ctx.drawImage(im, o.x * TS, o.y * TS + TS - im.height); } });
    });
    cur.npcs.forEach(function (n) {
      var im = IMG['../characters/' + n.sheet];
      var bob = (Math.sin(Date.now() / 400) > 0) ? 0 : 1;
      draws.push({ y: n.y * TS, fn: function () { ctx.drawImage(im, 0, 0, 32, 32, n.x * TS - 8, n.y * TS - 16 - bob, 32, 32); } });
    });
    var pf = player.moving ? player.frame : 0;
    var pim = IMG['../characters/player.png'];
    draws.push({
      y: player.y + 26,
      fn: function () { ctx.drawImage(pim, pf * 32, player.dir * 32, 32, 32, Math.round(player.x), Math.round(player.y), 32, 32); }
    });
    draws.sort(function (a, b) { return a.y - b.y; });
    draws.forEach(function (d) { d.fn(); });

    ctx.restore();
  }

  /* ---------- loop ---------- */
  var last = 0;
  function loop(ts) {
    update(); draw();
    requestAnimationFrame(loop);
  }

  /* ---------- start ---------- */
  loadImgs(need, function () {
    cur = maps.over;
    drawHUD();
    requestAnimationFrame(loop);
  });
})();
