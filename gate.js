/* ============================================================
   Paralir 的安全屋 — 世界观门禁 / 开场引导
   未登录 / 未注册前只允许观看世界观，看完出现欢迎语，再进入登录注册。
   ============================================================ */
(function () {
  "use strict";
  const A = window.SafehouseAudio;

  const SCENES = [
    {
      era: "纪元 · 失序之前",
      title: "网络，曾是秩序之城",
      text: "很久以前，网络空间是一座秩序井然的城市。知识与逻辑是它的砖石，协议与算法是它的血脉。每一位求知者都能在这里自由穿行。",
      icon: "🌐"
    },
    {
      era: "纪元 · 病毒降临",
      title: "她来了，带着笑意",
      text: "直到有一天，名为 Pary 的病毒自深渊苏醒。她率小弟小 Rarys 侵占了五大讲义世界——Web、PWN、Reverse、Crypto、Misc 尽数沦陷。",
      icon: "🦠"
    },
    {
      era: "纪元 · 居民的记录",
      title: "被侵占者留下的低语",
      text: "家园被夺的 Papa 居民们没有沉默。他们把毕生所学编成一段段故事、一道道谜题，藏在关卡深处，等待一个足够勇敢的人听见。",
      icon: "📜"
    },
    {
      era: "纪元 · 安全屋",
      title: "这里，是最后的据点",
      text: "于是有了这间安全屋。它收容迷失的求知者，保管从讲义中提炼的知识与术语。欲踏入此地者，须先证明自己的智慧。",
      icon: "🏚️"
    }
  ];

  let sceneIdx = 0, started = false;

  // 世界观中机器朗读容易读错的英文术语：在画面上标注正确读法（文字本身不变）
  const PRON_NOTE = {
    Web: "维布", PWN: "碰", Reverse: "瑞沃斯", Crypto: "克里普托", Misc: "米斯克",
    Pary: "帕瑞", Rarys: "瑞瑞斯", HTTP: "艾尺提提皮", CTF: "西提艾弗"
  };
  function markPron(text) {
    const keys = Object.keys(PRON_NOTE).sort((a, b) => b.length - a.length);
    const re = new RegExp("(" + keys.join("|") + ")", "g");
    return String(text || "").replace(re, (m) =>
      `<span class="gate-pron" title="朗读提示：读「${PRON_NOTE[m]}」">${m}<i>${PRON_NOTE[m]}</i></span>`);
  }
  function pronTip(text) {
    const hits = [];
    Object.keys(PRON_NOTE).forEach((w) => {
      if (new RegExp("\\b" + w + "\\b").test(text) && !hits.includes(w)) hits.push(w);
    });
    if (!hits.length) return "";
    return `<div class="gs-pron-tip">🗣 本幕发音标注：${hits.map((w) => `${w} → 读「${PRON_NOTE[w]}」`).join("　·　")}<br><span>机器朗读可能不准确，以上标注为正确读法。</span></div>`;
  }

  // 中文 TTS 直接念英文缩写会变成逐字母乱码，这里只在「朗读」时替换为中文谐音，画面文字保持不变
  const SPEAK_MAP = [
    [/Web Security/gi, "维布 安全"],
    [/Web/g, "维布"],
    [/PWN/g, "碰"],
    [/Reverse/g, "瑞沃斯"],
    [/Crypto/g, "克里普托"],
    [/Misc/g, "米斯克"],
    [/Rarys/g, "瑞瑞斯"],
    [/Pary/g, "帕瑞"],
    [/HTTP/g, "艾尺提提皮"],
    [/CTF/g, "西提艾弗"]
  ];
  function forSpeech(text) {
    let out = String(text || "");
    SPEAK_MAP.forEach(([re, say]) => { out = out.replace(re, say); });
    return out;
  }
  function sayOld(text, done) { A.speakOldLady(forSpeech(text), done); }
  function sayGirl(text, done) { A.speakGirl(forSpeech(text), done); }

  function el(id) { return document.getElementById(id); }
  function render() {
    const s = SCENES[sceneIdx];
    const stage = el("gateStage");
    if (!stage) return;
    stage.innerHTML = `
      <div class="gate-scene">
        <div class="gs-era">${s.era}</div>
        <div class="gs-icon">${s.icon}</div>
        <h2 class="gs-title">${s.title}</h2>
        <p class="gs-text">${markPron(s.text)}</p>
        ${pronTip(s.text)}
        <div class="gs-dots">${SCENES.map((_, i) => `<i class="${i === sceneIdx ? "on" : ""} ${i < sceneIdx ? "past" : ""}"></i>`).join("")}</div>
        <button class="gate-next" id="gateNextRaw">${sceneIdx === SCENES.length - 1 ? '见证终章 →' : '继续 →'}</button>
      </div>`;
    document.getElementById("gateNextRaw").onclick = nextScene;
  }

  function nextScene() {
    if (sceneIdx < SCENES.length - 1) {
      sceneIdx++;
      A.SFX.ghost();
      render();
      sayOld(SCENES[sceneIdx].text);
    } else {
      showWelcome();
    }
  }

  function showWelcome() {
    A.stopSpeak();
    A.stopDrone();
    A.SFX.cat();
    const stage = el("gateStage");
    stage.innerHTML = `
      <div class="gate-welcome">
        <div class="gw-glow"></div>
        <div class="gw-virus"><svg viewBox="0 0 200 200" width="120" height="120">
          <circle cx="100" cy="105" r="88" fill="#0d3b34" opacity="0.55"/>
          <path d="M100 24 L118 52 L150 42 L146 76 L178 88 L152 110 L170 142 L136 140 L128 174 L102 150 L76 174 L68 140 L34 142 L52 110 L26 88 L58 76 L54 42 L86 52 Z" fill="#0f7a5a" stroke="#7fd1b6" stroke-width="6" stroke-linejoin="round"/>
          <ellipse cx="100" cy="98" rx="30" ry="26" fill="#f4f7f5"/>
          <circle cx="100" cy="98" r="17" fill="#0b2a21"/><circle cx="100" cy="98" r="11" fill="#c0392b"/>
          <circle cx="95" cy="93" r="4" fill="#ff6b5e"/>
          <path d="M70 52 Q92 8 140 30 Q152 36 156 54 L120 66 Z" fill="#eef6f2" stroke="#cfded7" stroke-width="3"/>
        </svg></div>
        <div class="gw-line1">欢 迎 来 到 我 的 安 全 屋</div>
        <div class="gw-line2">Welcome to my safe house</div>
        <p class="gw-hint">门已开启。请证明你属于这里。</p>
        <button class="btn primary gw-enter" id="gateEnter">进入安全屋 →</button>
      </div>`;
    // 鬼马少女音欢迎（笑着说话的感觉 + 恐怖音效点缀）
    setTimeout(() => { A.SFX.ghost(); sayGirl("嘿嘿，欢迎来到我的安全屋！准备好了吗？"); }, 320);
    el("gateEnter").onclick = finish;
  }

  function finish() {
    A.stopSpeak();
    A.SFX.enter();
    const gate = el("gate");
    gate.classList.add("fade-out");
    setTimeout(() => {
      gate.style.display = "none";
      gate.classList.remove("fade-out");
      if (window.__safehouseOnGateDone) window.__safehouseOnGateDone();
    }, 700);
  }

  function begin() {
    if (started) return;
    started = true;
    A.SFX.enter();
    A.startDrone();           // 苍凉背景音
    sceneIdx = 0;
    render();
    sayOld(SCENES[0].text);
    const skip = el("gateSkip");
    if (skip) {
      skip.style.display = "";
      // 跳过开场：直接结束门禁（此前仅显示按钮却未绑定点击，点了无反应）
      skip.onclick = finish;
    }
  }

  window.SafehouseGate = {
    show(onDone) {
      window.__safehouseOnGateDone = onDone || null;
      const gate = el("gate");
      const logo = el("gateLogo");
      if (logo) logo.src = window.AVATAR || "";
      sceneIdx = 0; started = false;
      gate.style.display = "flex";
      gate.classList.remove("fade-out");
      const skipBtn = el("gateSkip");
      if (skipBtn) skipBtn.style.display = "none";
      const stage = el("gateStage");
      stage.innerHTML = `
        <div class="gate-intro">
          <div class="gi-logo"><img src="${window.AVATAR || ''}" alt=""></div>
          <div class="gi-kicker">AN ORIGIN STORY</div>
          <h1 class="gi-title">Paralir 的安全屋</h1>
          <p class="gi-sub">注册之前，先听完这个故事。</p>
          <div class="gi-warn">⚠ 注册前请先听完世界观 · 已有账号请直接登录</div>
          <button class="btn primary gi-start" id="gateStartRaw">聆听世界观 →</button>
          <div class="gi-foot">建议开启声音 · 深色叙事 · 轻微恐怖元素</div>
        </div>`;
      document.getElementById("gateStartRaw").onclick = function () {
        this.style.display = "none";
        begin();
      };
    },
    hide() {
      A.stopSpeak(); A.stopDrone();
      const g = el("gate"); if (g) g.style.display = "none";
    }
  };
})();
