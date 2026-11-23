/* ============================================================
   Paralir 的安全屋 — 音频引擎
   - Web Audio 合成音效（击杀小怪 / Boss / 通关 / 恐怖氛围 / 加菲猫风格滑稽音）
   - Web Speech API 配音（老夫人旁白 / 鬼马少女欢迎）
   - 音乐播放器（BGM 歌单 / Boss 循环曲 / 结算曲 / 自定义添加）
   ============================================================ */
window.SafehouseAudio = (function () {
  "use strict";

  /* ---------- Web Audio 合成基础 ---------- */
  let actx = null;
  function ac() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      actx = new AC();
    }
    if (actx.state === "suspended") actx.resume();
    return actx;
  }
  function tone(freq, dur, opt) {
    opt = opt || {};
    const c = ac(); if (!c) return;
    const t0 = c.currentTime + (opt.delay || 0);
    const o = c.createOscillator(), g = c.createGain();
    o.type = opt.type || "sine";
    o.frequency.setValueAtTime(freq, t0);
    if (opt.slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, opt.slideTo), t0 + dur);
    const vol = opt.vol == null ? 0.18 : opt.vol;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.03);
  }
  function noise(dur, opt) {
    opt = opt || {};
    const c = ac(); if (!c) return;
    const t0 = c.currentTime + (opt.delay || 0);
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = opt.filterType || "lowpass"; f.frequency.value = opt.filter || 1200;
    const g = c.createGain(); g.gain.value = opt.vol == null ? 0.12 : opt.vol;
    src.connect(f); f.connect(g); g.connect(c.destination);
    src.start(t0);
  }

  /* ---------- 游戏音效 ---------- */
  const SFX = {
    enabled: window.localStorage.getItem("ps_sfx") !== "0",
    hit() { // 击杀小怪：滑稽 boing + 打击（加菲猫式诙谐）
      if (!this.enabled) return;
      tone(660, 0.18, { type: "triangle", slideTo: 180, vol: 0.22 });
      tone(880, 0.12, { type: "square", slideTo: 320, vol: 0.08, delay: 0.06 });
      noise(0.1, { vol: 0.09, filter: 2400 });
    },
    hurt() { // 答错：低沉下坠
      if (!this.enabled) return;
      tone(220, 0.34, { type: "sawtooth", slideTo: 70, vol: 0.16 });
      noise(0.18, { vol: 0.06, filter: 600 });
    },
    enter() { // 进入战斗
      if (!this.enabled) return;
      tone(392, 0.1, { type: "triangle", vol: 0.14 });
      tone(587, 0.12, { type: "triangle", vol: 0.14, delay: 0.1 });
    },
    boss() { // Boss 出场：不谐和低音
      if (!this.enabled) return;
      tone(78, 1.0, { type: "sawtooth", vol: 0.14 });
      tone(83, 1.0, { type: "sawtooth", vol: 0.12 });
      tone(155, 0.7, { type: "square", vol: 0.05, delay: 0.15 });
      noise(0.9, { vol: 0.05, filter: 320 });
    },
    levelup() { // 通关：上行琶音
      if (!this.enabled) return;
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.26, { type: "triangle", vol: 0.16, delay: i * 0.12 }));
    },
    send() { // 发消息
      if (!this.enabled) return;
      tone(880, 0.06, { type: "sine", vol: 0.09 });
    },
    ghost() { // 恐怖点缀
      if (!this.enabled) return;
      tone(1400, 0.22, { type: "sine", slideTo: 300, vol: 0.05 });
      noise(0.3, { vol: 0.05, filterType: "highpass", filter: 2000 });
    },
    cat() { // 加菲猫风格滑稽音（合成替代，非原版版权音效）
      if (!this.enabled) return;
      tone(300, 0.45, { type: "triangle", slideTo: 900, vol: 0.14 });
      tone(900, 0.3, { type: "sine", slideTo: 420, vol: 0.1, delay: 0.42 });
    },
    cute() { // 可爱按键音：轻快的两声泡泡音（可在音效开关里关掉）
      if (!this.enabled) return;
      tone(880, 0.055, { type: "sine", vol: 0.055 });
      tone(1320, 0.075, { type: "sine", vol: 0.045, delay: 0.045 });
    },
    cuteBack() { // 可爱返回音：向下的小水滴
      if (!this.enabled) return;
      tone(720, 0.06, { type: "sine", vol: 0.05 });
      tone(520, 0.08, { type: "sine", vol: 0.04, delay: 0.045 });
    },
    ding() { // 学习计时结束提示音
      if (!this.enabled) return;
      tone(784, 0.12, { type: "sine", vol: 0.08 });
      tone(1047, 0.18, { type: "sine", vol: 0.07, delay: 0.11 });
    },
    toggle() { this.enabled = !this.enabled; window.localStorage.setItem("ps_sfx", this.enabled ? "1" : "0"); return this.enabled; }
  };

  /* ---------- TTS 配音 ---------- */
  function pickVoice(female) {
    try {
      const vs = window.speechSynthesis.getVoices() || [];
      const zh = vs.filter(v => /zh|cmn|Chinese/i.test(v.lang));
      const pool = zh.length ? zh : vs;
      if (!pool.length) return null;
      if (female) return pool.find(v => /female|女|huihui|yaoyao|xiaoxiao|tingting|mei|lin/i.test(v.name)) || pool[0];
      return pool.find(v => /male|男|kangkang|yunxi/i.test(v.name)) || pool[0];
    } catch (e) { return null; }
  }
  function speak(text, opt) {
    opt = opt || {};
    if (!("speechSynthesis" in window)) { opt.onend && opt.onend(); return null; }
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "zh-CN";
      u.pitch = opt.pitch == null ? 1 : opt.pitch;
      u.rate = opt.rate == null ? 1 : opt.rate;
      u.volume = opt.volume == null ? 1 : opt.volume;
      const v = pickVoice(opt.female !== false);
      if (v) u.voice = v;
      u.onend = () => opt.onend && opt.onend();
      u.onerror = () => opt.onend && opt.onend();
      window.speechSynthesis.speak(u);
      return u;
    } catch (e) { opt.onend && opt.onend(); return null; }
  }
  function speakOldLady(text, onend) { return speak(text, { pitch: 0.45, rate: 0.76, female: true, onend: onend }); }
  function speakGirl(text, onend) { return speak(text, { pitch: 1.75, rate: 1.22, female: true, onend: onend }); }
  function stopSpeak() { try { window.speechSynthesis.cancel(); } catch (e) {} }

  /* ---------- 恐怖背景氛围（合成 drone） ---------- */
  let drone = null;
  function startDrone() {
    if (drone || !SFX.enabled) return;
    const c = ac(); if (!c) return;
    const o1 = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
    o1.type = "sine"; o1.frequency.value = 55;
    o2.type = "sine"; o2.frequency.value = 82.5;
    g.gain.value = 0.045;
    lfo.frequency.value = 0.15; lg.gain.value = 0.02;
    lfo.connect(lg); lg.connect(g.gain);
    o1.connect(g); o2.connect(g); g.connect(c.destination);
    o1.start(); o2.start(); lfo.start();
    drone = { o1, o2, lfo, g };
  }
  function stopDrone() {
    if (!drone) return;
    try { drone.o1.stop(); drone.o2.stop(); drone.lfo.stop(); } catch (e) {}
    drone = null;
  }

  /* ---------- 音乐播放器 ---------- */
  const DEFAULT_TRACKS = [
    { id: "t1", title: "FREAK", artist: "宋雨琦 (YUQI)", file: "audio/t1_freak.mp3" },
    { id: "t2", title: "My Way", artist: "宋雨琦 (YUQI)", file: "audio/t2_myway.mp3" },
    { id: "t3", title: "Drink It Up (Feat. pH-1)", artist: "宋雨琦 (YUQI)、pH-1", file: "audio/t3_drink.mp3" },
    { id: "t4", title: "Red Rover", artist: "宋雨琦 (YUQI)", file: "audio/t4_redrover.mp3" },
    { id: "t5", title: "On Clap (Feat. Lexie Liu)", artist: "宋雨琦 (YUQI)、刘柏辛Lexie", file: "audio/t5_onclap.mp3" },
    { id: "t6", title: "Everytime (With MINNIE)", artist: "宋雨琦 (YUQI)、MINNIE", file: "audio/t6_everytime.mp3" },
    { id: "t7", title: "Could It Be", artist: "宋雨琦 (YUQI)", file: "audio/t7_coulditbe.mp3" }
  ];
  const MONSTER_TRACK = { title: "FREAK", artist: "刷小怪 · 循环", file: "audio/t1_freak.mp3" };
  const BOSS_TRACK = { title: "Red Rover", artist: "BOSS 出场 · 循环", file: "audio/boss.mp3" };
  const SETTLE_TRACK = { title: "My Way", artist: "结算 · 通关", file: "audio/settle.mp3" };
  let tracks = DEFAULT_TRACKS.slice();
  try {
    const custom = JSON.parse(window.localStorage.getItem("ps_tracks") || "[]");
    if (Array.isArray(custom)) tracks = tracks.concat(custom);
  } catch (e) {}
  let cur = 0, bgm = null, special = null, mode = "bgm", playing = false;
  let dockHost = null, dockOpen = false;
  // 音乐总开关：只控制背景音乐（歌单/小怪/Boss/结算），不碰按键音效与配音
  let musicOn = window.localStorage.getItem("ps_music") !== "0";

  function ensureBgm() {
    if (!bgm) { bgm = new Audio(); bgm.loop = true; bgm.volume = 0.55; }
    return bgm;
  }
  function playBgm(i) {
    if (i != null) cur = ((i % tracks.length) + tracks.length) % tracks.length;
    if (!musicOn) { renderDock(); return; }
    const a = ensureBgm();
    a.src = tracks[cur].file;
    a.play().then(() => { playing = true; renderDock(); }).catch(() => { playing = false; renderDock(); });
    mode = "bgm"; renderDock();
  }
  function togglePlay() {
    if (mode !== "bgm") return;
    if (!musicOn) { setMusicEnabled(true); return; }
    const a = ensureBgm();
    if (a.paused) a.play().then(() => { playing = true; renderDock(); }).catch(() => {});
    else { a.pause(); playing = false; renderDock(); }
  }
  function next() { playBgm(cur + 1); }
  function prev() { playBgm(cur - 1); }
  function startAll() { if (musicOn && tracks.length) playBgm(0); }
  function stopAll() {
    if (bgm) { bgm.pause(); }
    if (special) { try { special.pause(); } catch (e) {} special = null; }
    playing = false;
    stopBoss(); renderDock();
  }
  // 音乐总开关接口：只影响背景音乐，SFX 按键音与 TTS 配音不受影响
  function isMusicEnabled() { return musicOn; }
  function setMusicEnabled(on) {
    musicOn = !!on;
    try { window.localStorage.setItem("ps_music", musicOn ? "1" : "0"); } catch (e) {}
    if (!musicOn) stopAll();                 // 立即停掉正在播放的所有音乐
    else if (tracks.length) playBgm(cur);    // 重新开启时恢复歌单
    renderDock();
    try { var topBtn = document.getElementById("btnMusic"); if (topBtn) topBtn.textContent = musicOn ? "🎵" : "🔇"; } catch (e) {}
    return musicOn;
  }
  function toggleMusic() { return setMusicEnabled(!musicOn); }
  function playBoss() {
    if (!musicOn) return;
    if (bgm) bgm.pause();
    stopBoss();
    special = new Audio(BOSS_TRACK.file);
    special.loop = true; special.volume = 0.7;
    special.play().catch(() => {});
    mode = "boss"; playing = true; renderDock();
  }
  function stopBoss() { if (special) { try { special.pause(); } catch (e) {} special = null; } }
  function playMonster() { // 刷小怪专用：FREAK 循环，不影响歌单当前曲目 cur
    if (!musicOn) return;
    if (bgm) bgm.pause();
    stopBoss();
    special = new Audio(MONSTER_TRACK.file);
    special.loop = true; special.volume = 0.7;
    special.play().catch(() => {});
    mode = "monster"; playing = true; renderDock();
  }
  function resumeBgm() { // 结算/下一关后恢复歌单继续播放（已在播则不打断）
    if (!musicOn) return;
    if (special) { try { special.pause(); } catch (e) {} special = null; }
    mode = "bgm";
    if (!bgm || !bgm.src) { playBgm(cur); return; }
    if (bgm.paused) bgm.play().then(() => { playing = true; renderDock(); }).catch(() => { playing = false; renderDock(); });
    else { playing = true; renderDock(); }
  }
  function settleThenResume() {
    if (!musicOn) return;
    stopBoss();
    if (bgm) bgm.pause();
    mode = "settle"; playing = true; renderDock();
    special = new Audio(SETTLE_TRACK.file);
    special.volume = 0.8;
    const resume = () => { if (special) { special = null; } mode = "bgm"; playBgm(cur); };
    special.onended = resume;
    special.play().catch(() => { resume(); });
  }
  function addCustom(files) {
    let added = 0;
    Array.from(files || []).forEach(f => {
      const url = URL.createObjectURL(f);
      const name = f.name.replace(/\.[^.]+$/, "");
      tracks.push({ id: "c" + Date.now() + Math.random().toString(36).slice(2, 6), title: name, artist: "本地添加", file: url, local: true });
      added++;
    });
    // 网络 URL 型自定义歌可持久化；本地 objectURL 仅本次会话有效
    try {
      const persist = tracks.filter(t => !t.local);
      window.localStorage.setItem("ps_tracks", JSON.stringify(persist.filter(t => !DEFAULT_TRACKS.some(d => d.id === t.id))));
    } catch (e) {}
    renderDock();
    return added;
  }
  function addUrl(url, title) {
    if (!/^https?:\/\//i.test(url)) return false;
    tracks.push({ id: "u" + Date.now(), title: title || decodeURIComponent(url.split("/").pop()) || "网络音乐", artist: "网络添加", file: url });
    try { window.localStorage.setItem("ps_tracks", JSON.stringify(tracks.filter(t => !DEFAULT_TRACKS.some(d => d.id === t.id)))); } catch (e) {}
    renderDock(); return true;
  }

  /* ---------- 音乐工具栏 UI ---------- */
  function mountDock(host) {
    dockHost = host || document.body;
    if ($dock()) return;
    const dock = document.createElement("div");
    dock.id = "audioDock" + "";
    dock.innerHTML = `
      <div class="ad-toggle" id="adToggle" title="音乐工具栏">🎵</div>
      <div class="ad-panel" id="adPanel" style="display:none">
        <div class="ad-head"><b>🎵 音乐工具栏</b><span class="ad-x" id="adX">✕</span></div>
        <div class="ad-now" id="adNow"></div>
        <div class="ad-ctrl">
          <button id="adPrev" title="上一首">⏮</button>
          <button id="adPlay" title="播放/暂停">▶</button>
          <button id="adNext" title="下一首">⏭</button>
          <input type="range" id="adVol" min="0" max="1" step="0.05" value="0.55" title="音量">
        </div>
        <button class="ad-music-toggle" id="adMusicToggle" title="关闭所有背景音乐（按键音效与配音不受影响）">🔊 音乐：开</button>
        <div class="ad-list" id="adList"></div>
        <div class="ad-add">
          <label class="btn sm" for="adFile">＋ 添加本地歌曲</label>
          <input type="file" id="adFile" accept="audio/*" multiple style="display:none">
          <button class="btn sm" id="adUrlBtn">＋ 添加网络链接</button>
        </div>
      </div>`;
    dockHost.appendChild(dock);
    $("#adToggle").onclick = () => { dockOpen = !dockOpen; $("#adPanel").style.display = dockOpen ? "block" : "none"; };
    $("#adX").onclick = () => { dockOpen = false; $("#adPanel").style.display = "none"; };
    $("#adPrev").onclick = prev;
    $("#adNext").onclick = next;
    $("#adPlay").onclick = togglePlay;
    $("#adMusicToggle").onclick = () => { toggleMusic(); };
    $("#adVol").oninput = e => { const v = parseFloat(e.target.value); if (bgm) bgm.volume = v; if (special) special.volume = v; };
    $("#adFile").onchange = e => { addCustom(e.target.files); e.target.value = ""; };
    $("#adUrlBtn").onclick = () => {
      const url = window.prompt("粘贴音频的网络链接（http/https）：");
      if (!url) return;
      const title = window.prompt("歌曲名（可留空）：") || "";
      if (addUrl(url, title)) renderDock(); else alert("链接需以 http:// 或 https:// 开头");
    };
    renderDock();
  }
  function $dock() { return document.getElementById("audioDock"); }
  function $(s) { return document.querySelector(s); }
  function renderDock() {
    if (!$dock()) return;
    let t, sub;
    if (mode === "boss") { t = BOSS_TRACK; sub = "⚔ BOSS 战 · 击败前循环播放"; }
    else if (mode === "monster") { t = MONSTER_TRACK; sub = "👾 刷小怪 · FREAK 循环"; }
    else if (mode === "settle") { t = SETTLE_TRACK; sub = "🏆 结算进行中"; }
    else { t = tracks[cur] || {}; sub = "BGM 顺序播放 · " + (cur + 1) + "/" + tracks.length; }
    const now = $("#adNow");
    if (now) now.innerHTML = `<div class="ad-cover">🎧</div><div class="ad-meta"><b>${esc(t.title || "-")}</b><span>${esc(t.artist || "")}</span><span class="ad-sub">${esc(sub)}</span></div>`;
    const playBtn = $("#adPlay"); if (playBtn) playBtn.textContent = playing && musicOn ? "⏸" : "▶";
    const mt = $("#adMusicToggle");
    if (mt) { mt.textContent = musicOn ? "🔊 音乐：开" : "🔇 音乐：关"; mt.classList.toggle("off", !musicOn); }
    if (now) now.classList.toggle("music-off", !musicOn);
    const list = $("#adList");
    if (list) list.innerHTML = tracks.map((x, i) => `<div class="ad-item ${mode === "bgm" && i === cur ? "on" : ""}" data-ti="${i}">
        <span class="adi-num">${String(i + 1).padStart(2, "0")}</span>
        <span class="adi-meta"><b>${esc(x.title)}</b><small>${esc(x.artist)}</small></span>
        ${x.local ? '<span class="adi-tag">本地</span>' : ""}
      </div>`).join("");
    if (list) Array.from(list.querySelectorAll(".ad-item")).forEach(el => el.onclick = () => { playBgm(parseInt(el.dataset.ti, 10)); });
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function showDock() { const d = $dock(); if (d) d.style.display = ""; }
  function hideDock() { const d = $dock(); if (d) d.style.display = "none"; }

  return {
    SFX: SFX,
    speak: speak, speakOldLady: speakOldLady, speakGirl: speakGirl, stopSpeak: stopSpeak,
    startDrone: startDrone, stopDrone: stopDrone,
    play: (name) => { if (SFX[name]) SFX[name](); },
    mountDock: mountDock, showDock: showDock, hideDock: hideDock, renderDock: renderDock,
    startAll: startAll, stopAll: stopAll, playBgm: playBgm, togglePlay: togglePlay,
    playBoss: playBoss, playMonster: playMonster, resumeBgm: resumeBgm, settleThenResume: settleThenResume,
    isMusicEnabled: isMusicEnabled, setMusicEnabled: setMusicEnabled, toggleMusic: toggleMusic,
    get mode() { return mode; }, get trackCount() { return tracks.length; }
  };
})();
