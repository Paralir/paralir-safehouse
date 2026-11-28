/* ============ Paralir 的安全屋 — App Logic ============ */
(function(){
"use strict";

/* ---------- Cloud client ---------- */
const cloud = WorkBuddyCloud.createWorkBuddyCloud({
  endpoint: window.CLOUD_CONFIG.endpoint,
  oauthRelayBaseUrl: window.CLOUD_CONFIG.oauthRelayBaseUrl,
  publishableKey: window.CLOUD_CONFIG.publishableKey,
});

/* ---------- Global state ---------- */
const S = {
  user: null, page: "home",
  lexQ: "", lexCat: "", lexLimit:120, lexFavOnly:false, favs: new Set(safeParseJSON(localStorage.getItem("ps_favs"),[])||[]),
  storyDir:null, storyBattle:null, storyProgress:{},
  gameDir:null, battle:null, progress:{}, studyTestedWords:new Set(),
  team:null, teamMax:4,
  chatTab:"world", chatRoom:"", chatGroupId:null, chatPeer:null, chatTimer:null, chatMsgs:[], chatMsgSig:null, chatRecallOpen:null,
  friends:[], groups:[], invites:[], users:[], announcements:[], dmPeers:[],
  leaderboardTab:"world", leaderboard:[], returnModalOpen:false,
  lectureAccessList:[], lectureAccess:new Set(),
};
const GENDERS = ["男","女","非二元性别","性别酷儿","双性别","泛性别","无性别","跨性别男性","跨性别女性","异装","双性人","第三性别","流变性别","自述（在昵称中说明）","不愿透露"];
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
/* 安全解析 localStorage JSON：数据被污染时返回兜底值，避免整个脚本崩溃 */
function safeParseJSON(raw, fallback){
  try{ const v=JSON.parse(raw); return v??fallback; }catch(e){ return fallback; }
}
/* 云端请求加超时，防止网络挂起导致启动遮罩一直不收 */
function withTimeout(p,ms=8000){
  return Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(new Error("cloud timeout")),ms))]);
}

/* 讲义中心白名单：只有 Paralir 能管理，不绑定管理员角色 */
const OWNER_USERNAME = "Paralir";
const LECTURE_ACCESS_KEY = "lectures_access_usernames";
const OWNER_LECTURES_URL = "lectures/index.html" + (typeof location!=="undefined" && location.search ? location.search : "");
function isSafehouseOwner(u=S.user){
  return !!u && String(u.username||"").toLocaleLowerCase() === OWNER_USERNAME.toLocaleLowerCase();
}
function normalizeLectureAccess(names){
  const seen=new Set(), out=[];
  [OWNER_USERNAME,...(Array.isArray(names)?names:[])].forEach(n=>{
    const s=String(n||"").trim(); if(!s) return;
    const k=s.toLocaleLowerCase(); if(seen.has(k)) return;
    seen.add(k); out.push(s);
  });
  return out;
}
function applyLectureAccess(names){
  S.lectureAccessList=normalizeLectureAccess(names);
  S.lectureAccess=new Set(S.lectureAccessList.map(n=>n.toLocaleLowerCase()));
  syncOwnerLecturesEntry();
}
async function loadLectureAccess(){
  try{
    const {data}=await cloud.database.from("app_settings").select("*").eq("key",LECTURE_ACCESS_KEY);
    let names=[OWNER_USERNAME];
    if(data&&data[0]){
      try{const parsed=JSON.parse(data[0].value||"[]");if(Array.isArray(parsed))names=parsed;}catch(e){}
    }
    applyLectureAccess(names);
  }catch(e){ applyLectureAccess([OWNER_USERNAME]); }
}
async function saveLectureAccess(names){
  const list=normalizeLectureAccess(names);
  const value=JSON.stringify(list), now=new Date().toISOString();
  const {data:existing}=await cloud.database.from("app_settings").select("id").eq("key",LECTURE_ACCESS_KEY).maybeSingle();
  let error;
  if(existing) ({error}=await cloud.database.from("app_settings").update({value,updated_at:now}).eq("id",existing.id));
  else ({error}=await cloud.database.from("app_settings").insert({key:LECTURE_ACCESS_KEY,value,updated_at:now}));
  if(error) throw new Error(error.message);
  applyLectureAccess(list);
}
function canUseLectures(u=S.user){
  if(!u) return false;
  if(isSafehouseOwner(u)) return true;
  return !!(S.lectureAccess && S.lectureAccess.has(String(u.username||"").toLocaleLowerCase()));
}
function openOwnerLectures(){
  // 讲义中心改为主站内嵌页，不再新开窗口
  go("owner-lectures");
}
/* ---------- 讲义中心：主站内嵌（iframe） ---------- */
function activatePageTab(page){
  S.page=page;
  $$(".tab").forEach(t=>t.classList.toggle("active",t.dataset.page===page));
  window.scrollTo(0,0);
}
function lectureEmbedSrc(dir,anchor){
  const q = (typeof location!=="undefined" && location.search) ? location.search : "";
  const base = dir ? ("lectures/"+dir+"/index.html") : "lectures/index.html";
  return base + q + (anchor ? ("#"+anchor) : "");
}
/* 在主内容区内嵌讲义；dir/anchor 为空时显示讲义中心首页；returnFn 负责返回原页面 */
function renderLecturesEmbed(main,dir,anchor,returnFn){
  if(!canUseLectures()){ toast("该讲义仅对 Paralir 授权的账号开放",true); return false; }
  stopLevelTimer();   // 看讲义期间暂停关卡倒计时，返回时由 returnFn 恢复
  if(typeof returnFn==="function") S.lecturesReturn=returnFn;
  const src=lectureEmbedSrc(dir,anchor);
  const title=dir ? (String(dir).toUpperCase()+" 讲义") : "CTF 讲义中心";
  activatePageTab("owner-lectures");
  main.innerHTML=`<div class="lec-embed">
    <div class="lec-embed-bar">
      <button class="btn sm" id="lecBack">← 返回</button>
      <div class="lec-embed-title">📚 ${esc(title)}</div>
      <div class="lec-embed-hint">讲义已内嵌在安全屋内 · 点击章节可在框内直接跳转，无需离开当前网站</div>
    </div>
    <iframe id="lecFrame" class="lec-frame" src="${esc(src)}" title="${esc(title)}" referrerpolicy="no-referrer"></iframe>
  </div>`;
  $("#lecBack").onclick=()=>{ const fn=S.lecturesReturn; S.lecturesReturn=null; if(fn) fn(); else go("home"); };
  return true;
}
/* 升级之路关卡 → 讲义章节：白名单判断 + sharecode 透传 + 锚点定位（内嵌） */
function storyLectureUrl(dir,anchor){
  const q = (typeof location!=="undefined" && location.search) ? location.search : "";
  return "lectures/"+dir+"/index.html"+q+"#"+anchor;
}
function openStoryLecture(dir,anchor){
  try{ SFX.play("enter"); }catch(e){}
  const main=$("#main");
  // 记录进入前所在页面，供「返回」还原：用当前 DOM 判断是否真在关卡战斗/学习页
  let backFn;
  const b=S.storyBattle;
  const inBattle=!!(document.querySelector(".battle-wrap") || document.querySelector(".story-intro"));
  if(S.page==="story" && inBattle && b && b.level){
    const phase=b.phase;
    // 关卡战斗/学习页：返回后恢复对应阶段并重绘（计时器在看讲义期间已暂停）
    backFn=()=>{
      drawStoryBattle();
      if(phase==="story") startStudyClock(b,()=>drawStoryBattle());
      else if(phase==="monster"||phase==="boss"||phase==="retry") startBattleClock(b,()=>drawStoryBattle(),true);
    };
  }else if(S.page==="story" && S.storyDir){
    const key=S.storyDir;
    backFn=()=>{ activatePageTab("story"); openStoryDirection(key); };
  }else{
    const prev=(S.page&&S.page!=="owner-lectures")?S.page:"home";
    backFn=()=>go(prev);
  }
  renderLecturesEmbed(main,dir,anchor,backFn);
}
function lectureChipsHTML(chapters){
  if(!Array.isArray(chapters)||!chapters.length) return "";
  return chapters.map(c=>`<button type="button" class="lec-chip" data-lecdir="${esc(c.dir)}" data-lecanchor="${esc(c.a)}" title="跳转到讲义对应章节">📖 ${esc(c.t)}</button>`).join("");
}
function bindLectureChips(root){
  const nodes = root && root.querySelectorAll ? root.querySelectorAll(".lec-chip") : [];
  Array.from(nodes).forEach(btn=>{
    btn.onclick=(e)=>{ e.stopPropagation(); openStoryLecture(btn.dataset.lecdir,btn.dataset.lecanchor); };
  });
}
function syncOwnerLecturesEntry(){
  const nav = $("#topnav");
  if(!nav || typeof nav.insertBefore!=="function") return;
  let btn = $("#ownerLecturesTab");
  if(canUseLectures(S.user)){
    if(!btn){
      btn = document.createElement("button");
      btn.className = "tab owner-only";
      btn.id = "ownerLecturesTab";
      btn.dataset.page = "owner-lectures";
      btn.innerHTML = '<span class="ti">📚</span>CTF 讲义中心';
      nav.insertBefore(btn, nav.querySelector('.tab[data-page="admin"]') || null);
    }
  }else if(btn && typeof btn.remove==="function"){
    btn.remove();
  }
}
const CATS = {
  general:{en:"General & CTF Basics",zh:"通用与 CTF 基础",color:"#2dd4bf"},
  web:{en:"Web Security",zh:"Web 安全",color:"#34d399"},
  pwn:{en:"Binary Exploitation",zh:"二进制利用 / PWN",color:"#a3e635"},
  reverse:{en:"Reverse Engineering",zh:"逆向工程",color:"#6ee7b7"},
  crypto:{en:"Cryptography",zh:"密码学",color:"#86efac"},
  misc:{en:"Misc & Forensics",zh:"杂项与取证",color:"#bef264"},
  cet4:{en:"CET-4 Vocabulary",zh:"四级词汇",color:"#22c55e"},
  cet6:{en:"CET-6 Vocabulary",zh:"六级词汇",color:"#4ade80"},
  kaoyan:{en:"Postgraduate · Cybersecurity",zh:"考研 · 网安方向",color:"#84cc16"},
};
const STORY_DIRS = window.STORY.directions;
const WORD_DIRS = window.GAME.directions;
const IPA = window.IPA || {};
const VOCAB = window.VOCAB || {cet4:[],cet6:[],kaoyan:[]};
const EXAM_CATS = ["cet4","cet6","kaoyan"];

/* 把大词库接进检索系统：每个词生成完整词条（音标单独在 IPA 表按词查询） */
let __termId = 100000;
EXAM_CATS.forEach(cat=>{
  (VOCAB[cat]||[]).forEach((row,i)=>{
    const k=String(row[0]||""), z=String(row[1]||"");
    window.TERMS.terms.push({
      // 可搜索字段只包含词本身与中文释义：分类英文名(如 Vocabulary/Postgraduate)含字母 a，
      // 若写进 d/n 会导致搜 a 时全部词条被误命中
      id:__termId++, k, f:k, z, d:k, dz:z, n:"", vocab:true,
      lv:Math.min(9,1+Math.floor(i/1200)), cat
    });
  });
});

/* 把大词库按「释义话题 / 词性」归类到关卡，避免字母切片导致标题与考点不符 */
function vocabThemeIndex(cat,meaning){
  const m=String(meaning||""),has=re=>re.test(m);
  if(cat==="kaoyan"){
    if(has(/ctf|夺旗|漏洞|攻击|加密|逆向|取证|扫描|载荷|注入|利用|网络安全|flag|密码|渗透/i))return 0;
    if(has(/学术|研究|理论|分析|框架|实验|数据|方法|证明|概念|论文/i))return 1;
    if(has(/写作|论述|表达|阐述|强调|描述|作文/i))return 2;
    if(has(/翻译|译|含义|释义|措辞|语言|措/i))return 3;
    if(has(/完形|语境|搭配|连词|介词|句式|结构/i))return 4;
    if(has(/社会|经济|政治|文化|法律|教育|制度/i))return 5;
    if(has(/自然|科学|生物|化学|物理|环境|天文|地质|生态/i))return 6;
    if(has(/态度|评价|观点|赞成|反对|乐观|悲观|批判/i))return 7;
    if(has(/长难句|从句|虚拟|倒装|强调句|语法/i))return 8;
  }else{
    if(has(/校园|学校|学生|课程|考试|老师|课堂|学习|大学|作业|图书馆|教授/i))return 4;
    if(has(/科技|网络|计算机|互联网|数据|软件|电子|数字|机器|信息|通信|程序/i))return 5;
    if(has(/社会|职场|工作|公司|管理|经济|法律|市场|职业|商业|政府/i))return 6;
    if(has(/情感|态度|高兴|悲伤|愤怒|喜爱|厌恶|乐观|恐惧|情绪|满意/i))return 7;
  }
  if((m.match(/\b(?:vt?|vi|n|adj|adv)\./g)||[]).length>=2)return 8;
  if(/^\s*(?:v|vt|vi)\./.test(m))return 0;
  if(/^\s*n\./.test(m))return 1;
  if(/^\s*adj\./.test(m))return 2;
  return 3;
}
EXAM_CATS.forEach(cat=>{
  const d=WORD_DIRS.find(x=>x.key===cat);
  if(!d||!(VOCAB[cat]||[]).length)return;
  const arr=VOCAB[cat],per=Math.ceil(arr.length/d.levels.length);
  d.wordTotal=arr.length;
  const buckets=d.levels.map(()=>[]);
  arr.forEach(row=>buckets[Math.min(d.levels.length-1,vocabThemeIndex(cat,row[1]))].push(row));
  const used=new Set();
  d.levels.forEach((lv,i)=>{
    lv.pool=buckets[i].filter(r=>!used.has(r[0])).slice(0,per);
    lv.pool.forEach(r=>used.add(r[0]));
  });
  // 余词按原顺序补进未满的关卡，保证全部词都被覆盖且不重复
  const left=arr.filter(r=>!used.has(r[0]));
  d.levels.forEach(lv=>{
    const need=per-lv.pool.length;
    if(need>0){const add=left.splice(0,need);add.forEach(r=>used.add(r[0]));lv.pool=lv.pool.concat(add);}
  });
});
/* 技术方向：把关卡标题改成与该关实际考点一致，避免挂羊头卖狗肉 */
const NETSEC_THEME_RULES={
  web:[[/http|cookie|header|url|get|post|https|token|jwt|session/i,"HTTP 与会话"],[/sql|sqli|union|inject|xss|ssrf|xxe|ssti|deserial/i,"注入与脚本"],[/nmap|sqlmap|dirsearch|burp|proxy|repeater|waf|magic/i,"工具与探测"],[/file|path|upload|include|phar|traversal/i,"文件与路径"],[/idor|csrf|disclosure|logic|error/i,"逻辑与信息泄露"]],
  pwn:[[/stack|rbp|rsp|frame|ret2|shellcode|gadget|rop|pop|csu/i,"栈与 ROP"],[/canary|nx|pie|aslr|relro|fortify|checksec|保护/i,"保护机制"],[/heap|malloc|free|tcache|fastbin|chunk|bin|uaf|double free/i,"堆利用"],[/format|printf|fmtstr|fsop|hook/i,"格式化与劫持"],[/elf|got|plt|gdb|pwntools|cyclic|offset|leak|one_gadget/i,"调试与利用基础"]],
  reverse:[[/assembly|asm|opcode|register|mnemonic|nop|x86|arm/i,"汇编与寄存器"],[/ida|ghidra|x64dbg|radare|ollydbg|angr|unicorn|jd-gui/i,"逆向工具"],[/disassembl|decompil|pseudocode|control flow|cfg/i,"反汇编与伪代码"],[/pe\b|elf|section|import|iat|rva|va\b|entry/i,"文件格式与节区"],[/pack|oep|obfus|anti-debug|patch|keygen|shellcode|dll/i,"加壳反调试与patch"]],
  crypto:[[/xor|流密码|otp|rc4|密钥重用/i,"异或与流密码"],[/rsa|欧拉|欧拉|模逆|gcd|exgcd|coppersmith|common modulus/i,"RSA 与数论"],[/base|rot|vigenere|caesar|编码|古典|摩斯/i,"编码与古典密码"],[/aes|des|ecb|cbc|ctr|gcm|分组|padding|iv\b/i,"分组密码"],[/hash|md5|sha|mac|碰撞|collision/i,"哈希与消息认证"],[/lattice|lll|lwe|knapsack|格/i,"格密码"],[/ecc|离散对数|diffie|椭圆/i,"公钥与离散对数"],[/lcg|mt19937|random|seed|伪随机/i,"伪随机数"],[/side|channel|timing|后量子|quantum/i,"侧信道与后量子"]],
  misc:[[/base|hex|ascii|utf|二进制|进制|编码/i,"编码与进制"],[/png|jpg|jpeg|gif|bmp|ihdr|idat|exif|steg|隐写/i,"图片隐写"],[/wav|mp3|audacity|spectrogram|sstv|dtmf|音频|频谱/i,"音频隐写"],[/pcap|wireshark|tcp|udp|dns|icmp|http|流量|tshark/i,"流量分析"],[/zip|rar|foremost|binwalk|文件头|magic|magic number|文件识别/i,"文件识别与隐写"],[/memory|dump|volatility|registry|注册表|磁盘|取证/i,"内存与磁盘取证"],[/word|pdf|doc|document|文字|文档/i,"文档隐写"]]
};
WORD_DIRS.filter(d=>!EXAM_CATS.includes(d.key)).forEach(d=>{
  const rules=NETSEC_THEME_RULES[d.key]||[];
  d.levels.forEach(lv=>{
    const text=(lv.monsters||[]).concat(lv.boss||[]).map(q=>String(q.src||"")+" "+String(q.q||"")).join(" ");
    const hits=rules.map(([re,label])=>({label,n:(text.match(new RegExp(re.source,"gi"))||[]).length}))
      .filter(x=>x.n>0).sort((a,b)=>b.n-a.n);
    if(hits.length)lv.theme=hits.slice(0,2).map(x=>x.label).join(" · ");
  });
});
function shuffle(a){const r=a.slice();for(let i=r.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[r[i],r[j]]=[r[j],r[i]];}return r;}
/* 打乱单题选项并按内容重算答案位置：让正确答案随机落在 A/B/C/D，每次挑战都不同 */
function reshuffleQ(q){
  if(!q||!Array.isArray(q.options)||q.options.length<2)return q;
  const right=q.options[q.answer];
  const opts=shuffle(q.options);
  return Object.assign({},q,{options:opts,answer:Math.max(0,opts.indexOf(right))});
}
/* 对一组题目：打乱题目顺序 + 每题选项重新洗牌 */
function shuffleQuestionSet(arr){
  return shuffle((arr||[]).map(reshuffleQ));
}
/* 题目难度估算：题干/选项越长、反向选择（英文→中文、缩写全称、辨析）越难 */
function questionDifficulty(q){
  const text=String(q&&q.q||""), opts=(q&&q.options)||[];
  let d=Math.min(24,Math.floor(text.length/7));
  d+=Math.min(18,Math.floor(opts.reduce((n,o)=>n+String(o).length,0)/16));
  if(/英文|术语|全称|缩写|简称|对应的是|指的是/.test(text)) d+=13;
  if(/下列|以下|哪个|哪项|不属于|错误|正确|不是|除了/.test(text)) d+=8;
  if(/假如|场景|情景|日志|流量|发现|收到|攻击|绕过|利用|伪装/.test(text)) d+=6;
  return d;
}
/* 去掉剧情前缀，便于按难度重新分配角色后仍能对上当前 NPC */
function coreQuestion(text){
  let t=String(text||"").trim();
  t=t.replace(/^[^：:]{1,20}(说|问|道|喊|讲|笑道|低语|拦住)[：:]\s*/,"");
  t=t.replace(/^Pary[^：:]{0,20}[：:]\s*/,"");
  return t;
}
function phaseQuestion(q,phase,isStory){
  if(!isStory||!q) return q;
  const core=coreQuestion(q.q);
  const prefix=phase==="boss"?"Pary 冷笑着拦住你：":"小 Rarys 跳出来：";
  return Object.assign({},q,{q:prefix+core});
}
/* 小怪题偏基础、Boss 题偏进阶；两组内部各自随机排序，每题选项也随机重排 */
function prepareLevelQuestions(monsters,boss,isStory){
  const seen=new Set();
  const all=[].concat(monsters||[],boss||[]).filter(q=>{
    if(!q||!q.q) return false;
    const key=q.q+"|"+(q.options||[]).map(String).join("|");
    if(seen.has(key)) return false; seen.add(key); return true;
  }).map(q=>Object.assign({},q));
  const bossCount=Math.max(1,Math.min(3,(boss||[]).length||3));
  const ranked=all.slice().sort((a,b)=>questionDifficulty(a)-questionDifficulty(b));
  const easy=ranked.slice(0,Math.max(1,ranked.length-bossCount));
  const hard=ranked.slice(Math.max(1,ranked.length-bossCount));
  return {
    monsters:shuffleQuestionSet(easy.map(q=>phaseQuestion(q,"monster",isStory))),
    boss:shuffleQuestionSet(hard.map(q=>phaseQuestion(q,"boss",isStory)))
  };
}
/* 统一释义呈现：预习清单 / 小怪选项 / Boss 题干 全部使用本函数，保证逐字一致。
   保留词性前缀(v./n./adj.)，仅去掉括号补充说明、压缩空白与标点两侧空格，统一截断长度。 */
function canonicalZh(z,n){
  const t=String(z||"")
    .replace(/[\[（(【].*?[\]）)】]/g,"")
    .replace(/\s+/g," ")
    .replace(/\s*([，,；;：:])\s*/g,"$1")
    .replace(/^\s+|\s+$/g,"");
  return t.length>n?t.slice(0,n)+"…":t;
}
const DISPLAY_ZH_LEN=46;
/* 关卡标题若点明词性，则该关词条必须与该词性一致，避免“基础动词”里混进名词/形容词 */
function expectedPos(theme){
  const t=String(theme||"");
  if(/动词/.test(t))return "(?:v|vt|vi)";
  if(/名词/.test(t))return "n";
  if(/形容词|描述/.test(t))return "adj";
  if(/副词/.test(t))return "adv";
  return null;
}
function hasOnlyPos(meaning,posRe){
  const m=String(meaning||"");
  const tags=m.match(/\b(?:vt?|vi|n|adj|adv|prep|conj|pron|num|art|int)\./gi)||[];
  const wanted=new RegExp("^"+posRe+"\\.","i");
  return tags.length===1 && wanted.test(m.trim());
}
/* 从本关词库搜集约 30 词作为学习池：词性关先取“释义只含该词性”的词，不够再放宽到该词性开头 */
function buildStudyPool(lv,theme){
  const all=(lv.pool||[]).filter(r=>r&&r[0]&&String(r[1]||"").trim());
  const pos=expectedPos(theme);
  let pick=all;
  if(pos){
    const strict=all.filter(r=>hasOnlyPos(r[1],pos));
    if(strict.length>=STUDY_POOL_SIZE)pick=strict;
    else{
      const loose=all.filter(r=>new RegExp("^"+pos+"\\.","i").test(String(r[1]).trim()));
      if(loose.length>=STUDY_POOL_SIZE)pick=loose;
    }
  }
  return shuffle(pick).slice(0,STUDY_POOL_SIZE);
}
/* 题目与全部干扰项只从传入的 30 词学习池中生成，保证“预习=考题”完全一致。
   关键：学习清单、小怪选项、Boss 题干统一使用 canonicalZh 呈现同一份文本。 */
function poolQuestions(studyPool,dirName,theme){
  const pool=shuffle((studyPool||[]).slice());
  // 每个词先固化一份「显示释义」，三处共用，确保逐字一致
  const disp=new Map(pool.map(row=>[row[0],canonicalZh(row[1],DISPLAY_ZH_LEN)]));
  // 按词条自身复杂度分层：短词给小怪，长词/多义释义留给 Boss
  const complexity=row=>String(row[0]||"").length*1.4+String(row[1]||"").length*0.12+((/[,，;；]/.test(String(row[1]||"")))?5:0);
  const sorted=pool.slice().sort((a,b)=>complexity(a)-complexity(b));
  const cut=Math.max(4,Math.ceil(sorted.length*0.55));
  const easy=sorted.slice(0,cut), hard=sorted.slice(cut);
  const monsters=shuffle(easy).slice(0,4).map(row=>{
    const w=row[0],ans=disp.get(w)||w;
    const ds=shuffle(pool.filter(x=>x[0]!==w&&disp.get(x[0])!==ans)).slice(0,3).map(x=>disp.get(x[0]));
    const opts=shuffle([ans,...ds]);
    return {q:`「${w}」的中文意思是？`,options:opts,answer:opts.indexOf(ans),explain:`${w} = ${ans}`,src:dirName+" · "+theme};
  });
  const bossRows=shuffle(hard.length>=3?hard:pool).slice(0,3);
  const boss=bossRows.map(row=>{
    const w=row[0], zh=disp.get(w);
    // Boss 干扰项优先挑长度/首字母接近的同池词，避免一眼排除
    const cand=pool.filter(x=>x[0]!==w);
    const near=cand.slice().sort((a,b)=>{
      const ka=String(a[0]).toLowerCase(), kb=String(b[0]).toLowerCase(), kw=String(w).toLowerCase();
      return (ka[0]===kw[0]?0:1)*10+Math.abs(ka.length-kw.length)-((kb[0]===kw[0]?0:1)*10+Math.abs(kb.length-kw.length));
    }).slice(0,6);
    const ds=shuffle(near.length>=3?near:cand).slice(0,3).map(x=>x[0]);
    const opts=shuffle([w,...ds]);
    return {q:`「${zh}」对应的英文术语是？`,options:opts,answer:opts.indexOf(w),explain:`${w} = ${zh}`,src:dirName+" · Boss Pary"};
  });
  while(boss.length<3) boss.push(monsters[boss.length%monsters.length]||monsters[0]);
  const study=pool.map(row=>[row[0],disp.get(row[0])]);
  const tested=new Set(monsters.concat(boss).map(q=>String(q.explain||"").split(" = ")[0]).filter(Boolean));
  return {monsters,boss,study,tested};
}

/* 音标：英式 / 美式，按单词查表；短语逐词显示 */
function ipaOne(word){
  const e=IPA[String(word||"").trim().toLowerCase()];
  return e&&(e.uk||e.us)?e:null;
}
function ipaInline(word){
  const e=ipaOne(word);
  if(!e) return "";
  return `<span class="ipa-mini">${e.uk?`<i>英</i>${esc(e.uk)}`:""}${e.uk&&e.us?"　":""}${e.us?`<i>美</i>${esc(e.us)}`:""}</span>`;
}
function ipaBlock(text){
  const ws=String(text||"").match(/[A-Za-z][A-Za-z'\-]*/g)||[];
  const parts=[];
  ws.forEach(w=>{const e=ipaOne(w);if(e)parts.push(`<span class="ipa-w"><b>${esc(w)}</b> ${e.uk?`<i>英</i>${esc(e.uk)}`:""}${e.uk&&e.us?"　":""}${e.us?`<i>美</i>${esc(e.us)}`:""}</span>`);});
  return parts.length?`<div class="ipa-line">${parts.join("")}</div>`:"";
}
function qIpa(q){
  const m=String(q||"").match(/「([^」]+)」/);
  if(!m) return "";
  return ipaInline(m[1].split(" / ")[0].split("（")[0].trim());
}

/* ---------- Utils ---------- */
function toast(msg,err){const t=$("#toast");t.textContent=msg;t.className="toast show"+(err?" err":"");clearTimeout(t._h);t._h=setTimeout(()=>t.className="toast",2600);}
function modal(html,small){const m=$("#modal");$("#modalBox").className="modal"+(small?" sm":"");$("#modalBox").innerHTML=html;m.style.display="grid";}
function closeModal(){$("#modal").style.display="none";}
document.addEventListener("click",e=>{if(e.target.id==="modal"&&!S.returnModalOpen)closeModal();});
async function sha256(str){const buf=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(str));return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");}
async function passHash(u,p){return sha256("PARALIR_SAFEHOUSE_SALT|"+u+"|"+p);}
function copy(txt){navigator.clipboard.writeText(txt).catch(()=>{const a=document.createElement("textarea");a.value=txt;document.body.appendChild(a);a.select();document.execCommand("copy");a.remove();});}
function timeAgo(ts){if(!ts)return"";const d=Date.now()-new Date(ts).getTime();const m=Math.floor(d/60000);if(m<1)return"刚刚";if(m<60)return m+"分钟前";const h=Math.floor(m/60);if(h<24)return h+"小时前";return new Date(ts).toLocaleDateString();}
function dmRoom(a,b){return [a,b].sort().join("|");}

/* ---------- Sound hook (桥接到音频引擎) ---------- */
const AUDIO = window.SafehouseAudio;
const SFX = {
  get enabled(){return AUDIO.SFX.enabled;},
  play(name){ AUDIO.play(name); },
  toggle(){return AUDIO.SFX.toggle();}
};

/* ---------- Boss mascot: Pary ---------- */
const PARY_SVG = `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
  <circle cx="100" cy="105" r="88" fill="#0d3b34" opacity="0.55"/>
  <path d="M100 24 L118 52 L150 42 L146 76 L178 88 L152 110 L170 142 L136 140 L128 174 L102 150 L76 174 L68 140 L34 142 L52 110 L26 88 L58 76 L54 42 L86 52 Z" fill="#0f7a5a" stroke="#7fd1b6" stroke-width="6" stroke-linejoin="round"/>
  <path d="M100 46 L112 68 L138 61 L134 86 L156 98 L136 112 L148 136 L121 132 L114 158 L100 140 L86 158 L79 132 L52 136 L64 112 L44 98 L66 86 L62 61 L88 68 Z" fill="#128a66" opacity="0.9"/>
  <ellipse cx="100" cy="98" rx="30" ry="26" fill="#f4f7f5"/>
  <circle cx="100" cy="98" r="17" fill="#0b2a21"/>
  <circle cx="100" cy="98" r="11" fill="#c0392b"/>
  <circle cx="95" cy="93" r="4" fill="#ff6b5e"/>
  <path d="M70 52 Q92 8 140 30 Q152 36 156 54 L120 66 Z" fill="#eef6f2" stroke="#cfded7" stroke-width="3"/>
  <path d="M138 26 Q158 16 168 34 Q172 44 162 50 Q150 44 138 26 Z" fill="#d0342c"/>
  <circle cx="166" cy="44" r="13" fill="#f6fbf8"/>
  <rect x="66" y="52" width="66" height="16" rx="8" fill="#f6fbf8" stroke="#cfded7" stroke-width="2"/>
</svg>`;
const PARY_LINES = ["你也是来送分数的吗？","答错一次，我就吸走你一点血。","想通关？先过我这关！","我的小 Rarys 可没那么好对付。","答对 20 题？你有这个本事吗？"];

/* ---------- Auth ---------- */
async function loadUser(){
  const saved=safeParseJSON(localStorage.getItem("ps_user"),null);
  if(!saved) return null;
  const {data,error}=await cloud.database.from("app_users").select("*").eq("id",saved.id).maybeSingle();
  // 网络/服务异常时返回 undefined（保留登录态，下次刷新重试）；只有账号确实不存在或被禁用才清除
  if(error) return undefined;
  if(!data||data.status!=="active"){ localStorage.removeItem("ps_user"); return null; }
  return data;
}
function setUser(u,opts){
  S.user=u;
  // 本地只保存定位用的最小信息：不落 pass_hash / 邮箱 / 手机号等敏感字段
  if(u) localStorage.setItem("ps_user",JSON.stringify({id:u.id,username:u.username}));
  else if(!(opts&&opts.keepSession)) localStorage.removeItem("ps_user");
  renderUserBox();
  const adminTab=$(".tab[data-page=admin]");
  if(adminTab) adminTab.style.display=(u&&u.role==="admin")?"":"none";
  syncOwnerLecturesEntry();
}
async function login(username,password){
  const {data,error}=await cloud.database.from("app_users").select("*").eq("username",username).maybeSingle();
  if(error) throw new Error("连接失败，请稍后重试");
  if(!data) throw new Error("账号或密码错误");
  const h=await passHash(username,password);
  if(h!==data.pass_hash) throw new Error("账号或密码错误");
  // 先验密码再看账号状态，避免未登录者探测某个账号是否存在
  if(data.status!=="active") throw new Error(data.status==="pending"?"账号尚在审核中，请等待管理员通过":"账号已被拒绝，请联系管理员");
  if(data.muted) toast("注意：你的账号当前处于禁言状态");
  await loadLectureAccess();
  setUser(data);
  toast("欢迎回来，"+ (data.nickname||data.username));
  return data;
}
async function register(f){
  if(!f.username||!f.password) throw new Error("请填写账号和密码");
  if(!/^[A-Za-z0-9_]{3,20}$/.test(f.username)) throw new Error("账号需为3-20位字母、数字或下划线");
  if(f.birthday && new Date(f.birthday) > new Date()) throw new Error("生日不能是未来日期");
  if(nicknameTaken(f.nickname||f.username)) throw new Error("该昵称已被使用");
  const {data:dup}=await cloud.database.from("app_users").select("id").eq("username",f.username).maybeSingle();
  if(dup) throw new Error("该账号已被使用");
  // 注册时还没有用户列表，直接查库保证昵称唯一（不区分大小写，且不能与别人账号同名）
  const n=String(f.nickname||f.username).trim().toLocaleLowerCase();
  const {data:allUsers}=await cloud.database.from("app_users").select("username,nickname");
  if((allUsers||[]).some(u=>String(u.username).toLocaleLowerCase()===n||String(u.nickname||"").trim().toLocaleLowerCase()===n)) throw new Error("该昵称已被使用");
  const h=await passHash(f.username,f.password);
  const {error}=await cloud.database.from("app_users").insert({
    username:f.username,pass_hash:h,role:"user",status:"pending",
    nickname:f.nickname||f.username,birthday:f.birthday||null,birthday_changed_at:f.birthday?new Date().toISOString():null,
    gender:f.gender||null,avatar_url:f.avatar_url||null,email:f.email||null,phone:f.phone||null
  });
  if(error) throw new Error(/nickname_unique|duplicate key/i.test(String(error.message||""))?"该昵称已被使用":"注册失败："+error.message);
  toast("注册成功，请等待管理员审核");
}

/* ---------- Progress (两套游戏，用前缀区分) ---------- */
async function loadProgress(){
  if(!S.user) return;
  const {data}=await cloud.database.from("game_progress").select("*").eq("owner_id",S.user.username);
  (data||[]).forEach(r=>{
    const p={level:r.level,cleared:r.cleared,total_correct:r.total_correct};
    if(r.direction.indexOf("story:")===0) S.storyProgress[r.direction.slice(6)]=p;
    else if(r.direction.indexOf("word:")===0) S.progress[r.direction.slice(5)]=p;
  });
}
async function saveProgress(prefix,dir){
  if(!S.user) return;
  const store=prefix==="story"?S.storyProgress:S.progress;
  const p=store[dir]; if(!p) return;
  const direction=prefix+":"+dir;
  const row={level:p.level,cleared:p.cleared,total_correct:p.total_correct,updated_at:new Date().toISOString()};
  const existing=await cloud.database.from("game_progress").select("id").eq("owner_id",S.user.username).eq("direction",direction).maybeSingle();
  if(existing.data) await cloud.database.from("game_progress").update(row).eq("id",existing.data.id);
  else await cloud.database.from("game_progress").insert(Object.assign({owner_id:S.user.username,direction},row));
}
async function loadSettings(){
  const {data}=await cloud.database.from("app_settings").select("*");
  (data||[]).forEach(r=>{ if(r.key==="team_max_size") S.teamMax=parseInt(r.value)||4; });
}

/* ---------- Render: user box ---------- */
function renderUserBox(){
  const box=$("#userbox");
  if(!S.user){
    box.innerHTML='<button class="btn" id="btnLogin">登录</button><button class="btn primary" id="btnReg">注册</button>';
    $("#btnLogin").onclick=showLogin;
    $("#btnReg").onclick=showRegister;
  }else{
    const av=S.user.avatar_url||window.AVATAR;
    box.innerHTML=`<img class="avatar-sm" src="${esc(av)}" id="uAvatar">
      <span class="u-name" id="uName">${esc(S.user.nickname||S.user.username)}</span>
      <span class="points-chip" id="myPoints" title="闯关积分：升级之路与我是单词均可获得">🏅 ${Number(S.user.points)||0} 分</span>
      <span class="badge-role ${S.user.role==='admin'?'admin':''}">${S.user.role==='admin'?'管理员':'用户'}</span>
      ${isSafehouseOwner()?'<button class="btn sm ghost" id="btnLectureAccess" title="讲义中心可见名单（仅屋主）">🗝</button>':''}
      <button class="btn sm ghost" id="btnMusic" title="背景音乐总开关（歌单/小怪/Boss/结算）">${AUDIO.isMusicEnabled()?'🎵':'🔇'}</button>
      <button class="btn sm ghost" id="btnSfx" title="可爱按键音效开关">${SFX.enabled?'🔊':'🔇'}</button>
      <button class="btn sm ghost" id="btnLogout">退出</button>`;
    $("#uAvatar").onclick=$("#uName").onclick=()=>go("profile");
    if($("#btnLectureAccess")) $("#btnLectureAccess").onclick=showLectureAccessManager;
    $("#btnMusic").onclick=()=>{const on=AUDIO.toggleMusic();$("#btnMusic").textContent=on?"🎵":"🔇";toast(on?"背景音乐已开启":"背景音乐已关闭（按键音效不受影响）");};
    $("#btnSfx").onclick=()=>{const on=SFX.toggle();$("#btnSfx").textContent=on?"🔊":"🔇";toast(on?"按键音效已开启":"按键音效已关闭");};
    $("#btnLogout").onclick=()=>{battleEpoch++;stopLevelTimer();stopChat();AUDIO.stopAll();AUDIO.hideDock();setUser(null);S.storyBattle=null;S.battle=null;S.storyProgress={};S.progress={};showLogin();toast("已退出登录");};
  }
}

/* ---------- Navigation ---------- */
function go(page){
  // 门禁：未登录时禁止使用任何功能页，显示登录引导
  if(!S.user){
    const main=$("#main");
    if(main) main.innerHTML=`<div class="gate-locked">
      <div class="gl-icon">🔒</div>
      <h2>此区域需要身份验证</h2>
      <p>安全屋仅对已登录的居民开放。请先登录或注册，经管理员审核后方可进入。</p>
      <div class="gl-actions"><button class="btn primary" id="glLogin">登录</button><button class="btn" id="glReg">注册</button></div>
    </div>`;
    if($("#glLogin")) $("#glLogin").onclick=showLogin;
    if($("#glReg")) $("#glReg").onclick=showRegister;
    window.scrollTo(0,0);
    return;
  }
  if(page==="admin"&&!(S.user&&S.user.role==="admin")){toast("无权访问",true);return;}
  if(page==="owner-lectures"){
    if(!canUseLectures()){toast("无权访问",true);return;}
    const prev=(S.page&&S.page!=="owner-lectures")?S.page:"home";
    renderLecturesEmbed($("#main"),null,null,()=>go(prev));
    return;
  }
  if((S.page==="story"||S.page==="game")&&page!==S.page) stopLevelTimer();  // 离开关卡页时停止计时
  if(S.chatTimer){stopChat();}
  S.page=page;
  $$(".tab").forEach(t=>t.classList.toggle("active",t.dataset.page===page));
  const main=$("#main");
  if(page==="home") renderHome(main);
  else if(page==="lexicon") renderLexicon(main);
  else if(page==="story") renderStoryHome(main);
  else if(page==="game") renderWordHome(main);
  else if(page==="profile") renderProfile(main);
  else if(page==="admin") renderAdmin(main);
  window.scrollTo(0,0);
}

/* ============================================================
   主页面 HOME — 聊天系统
   ============================================================ */
async function renderHome(main){
  if(!S.user){
    main.innerHTML=`<div class="hero-welcome">
      <div class="hw-left"><img class="hw-logo" src="${window.AVATAR}"><div><h1>Paralir 的安全屋</h1>
      <p>网络空间安全 · 趣味学习 & 训练平台</p></div></div>
      <div class="hw-actions"><button class="btn primary" id="hLogin">登录</button><button class="btn" id="hReg">注册</button></div></div>
      <div class="home-grid">
        ${homeCard("⌕","术语检索系统","370 条网络安全英文专业术语，中英双语即时检索。","lexicon")}
        ${homeCard("📖","Paralir 的升级之路","听 Papa 居民讲讲义故事，击败小 Rarys 与病毒 Boss Pary。","story")}
        ${homeCard("🔤","我是单词","单词挑战 + 组队模式，和伙伴一起闯关。","game")}
      </div>
      <div class="notice info">登录后即可进入世界频道聊天、加好友、建群聊与组队。</div>`;
    $("#hLogin").onclick=showLogin;$("#hReg").onclick=showRegister;
    $$("[data-gocard]").forEach(c=>c.onclick=()=>go(c.dataset.gocard));
    return;
  }
  main.innerHTML=`<div class="home-hero">
      <div class="hh-greet"><div class="hh-avatar"><img src="${esc(S.user.avatar_url||window.AVATAR)}"></div>
        <div><div class="hh-title">欢迎回来，${esc(S.user.nickname||S.user.username)} 👋</div>
        <div class="hh-sub">Paralir 的安全屋 · 今天也要变强哦</div></div></div>
      <div class="hh-quick">
        <button class="qcard" data-gocard="story"><span>📖</span><b>升级之路</b></button>
        <button class="qcard" data-gocard="game"><span>🔤</span><b>我是单词</b></button>
        <button class="qcard" data-gocard="lexicon"><span>⌕</span><b>术语检索</b></button>
        ${canUseLectures(S.user)?'<button class="qcard owner-qcard" id="ownerLecturesCard"><span>📚</span><b>讲义中心</b></button>':""}
      </div></div>
    <div class="chat-layout">
      <aside class="chat-side">
        <div class="cs-tabs">
          <button class="cs-tab active" data-cstab="channels">频道</button>
          <button class="cs-tab" data-cstab="friends">好友</button>
          <button class="cs-tab" data-cstab="invites">邀请 <span id="inviteBadge" class="badge">0</span></button>
        </div>
        <div id="csBody" class="cs-body"></div>
      </aside>
      <section class="chat-main" id="chatMain"></section>
    </div>`;
  $$("[data-gocard]").forEach(c=>c.onclick=()=>go(c.dataset.gocard));
  if($("#ownerLecturesCard")) $("#ownerLecturesCard").onclick=openOwnerLectures;
  $$(".cs-tab").forEach(t=>t.onclick=()=>{
    $$(".cs-tab").forEach(x=>x.classList.remove("active"));t.classList.add("active");
    renderSide(t.dataset.cstab);
  });
  await Promise.all([loadFriends(),loadGroups(),loadInvites(),loadUsers(),loadAnnouncements()]);
  loadDmPeers();
  renderSide("channels");
  openWorld();
  updateInviteBadge();
}
function homeCard(icon,title,desc,page){
  return `<div class="home-card" data-gocard="${page}"><div class="hc-icon">${icon}</div><h3>${title}</h3><p>${desc}</p><div class="hc-go">进入 →</div></div>`;
}
async function loadUsers(){const{data}=await cloud.database.from("app_users").select("username,nickname,role,status,muted,avatar_url,points").eq("status","active").order("points",{ascending:false});S.users=data||[];}
// 昵称全局唯一（不区分大小写，含他人的登录账号兜底昵称）
function nicknameTaken(nick,exceptUsername){
  const n=String(nick||"").trim().toLocaleLowerCase();
  if(!n)return false;
  return (S.users||[]).some(u=>u.username!==exceptUsername&&(String(u.username).toLocaleLowerCase()===n||String(u.nickname||"").trim().toLocaleLowerCase()===n));
}
async function loadFriends(){const{data}=await cloud.database.from("friends").select("*").eq("owner",S.user.username);S.friends=data||[];}
// 私聊过的对象（含非好友）记在本机，方便从侧栏直接回到会话
function loadDmPeers(){try{S.dmPeers=JSON.parse(localStorage.getItem("ps_dm_peers")||"[]").filter(x=>typeof x==="string"&&x&&x!==(S.user&&S.user.username));}catch(e){S.dmPeers=[];}}
function rememberDmPeer(u){if(!u||u===S.user.username)return;if(!S.dmPeers.includes(u)){S.dmPeers.push(u);try{localStorage.setItem("ps_dm_peers",JSON.stringify(S.dmPeers));}catch(e){}}}
// 建立双方好友关系：已存在记录则更新为 active，不存在才插入，避开 UNIQUE(owner,friend) 冲突
async function setFriendActive(owner,friend){
  const{data:exist}=await cloud.database.from("friends").select("id").eq("owner",owner).eq("friend",friend).maybeSingle();
  if(exist){ await cloud.database.from("friends").update({status:"active"}).eq("id",exist.id); }
  else{ await cloud.database.from("friends").insert({owner,friend,status:"active"}); }
}
async function establishFriendship(a,b){ await setFriendActive(a,b); await setFriendActive(b,a); }
async function loadGroups(){
  const{data}=await cloud.database.from("chat_groups").select("*");
  S.groups=(data||[]).filter(g=>{try{return JSON.parse(g.members||"[]").includes(S.user.username);}catch(e){return false;}});
}
async function loadInvites(){const{data}=await cloud.database.from("invitations").select("*").eq("invitee",S.user.username).eq("status","pending");S.invites=data||[];}
function updateInviteBadge(){const b=$("#inviteBadge");if(b)b.textContent=S.invites.length;}

function renderSide(tab){
  const body=$("#csBody");
  if(!body)return;   // 已离开首页时忽略异步回调，避免空节点写入报错
  if(tab==="channels"){
    const isAdmin=!!(S.user&&S.user.role==="admin");
    const dms=[...new Set([...S.friends.filter(f=>f.status==="active").map(f=>f.friend),...(S.dmPeers||[])])].filter(u=>u&&u!==S.user.username);
    body.innerHTML=`<div class="cs-group-title">公共频道</div>
      <div class="cs-item active-ch" id="chWorld"><span class="ci-ico">🌐</span><span>世界频道</span></div>
      <div class="cs-group-title">排行榜</div>
      <div class="lb-tabs">
        <button class="lb-tab ${S.leaderboardTab==='world'?'active':''}" data-lb="world">🌍 世界排名</button>
        <button class="lb-tab ${S.leaderboardTab==='friends'?'active':''}" data-lb="friends">🧑‍🤝‍🧑 好友排名</button>
      </div>
      <div id="lbBody" class="lb-body"></div>
      <div class="cs-group-title">我的群聊 <button class="cs-add" id="addGroup">＋</button></div>
      ${S.groups.map(g=>`<div class="cs-item" data-group="${g.id}"><span class="ci-ico">👥</span><span>${esc(g.name)}</span></div>`).join("")||'<div class="cs-hint">暂无群聊</div>'}
      <div class="cs-group-title">私聊 ${isAdmin?'<button class="cs-add" id="adminDm" title="与任意成员私聊">✉️</button>':''}<button class="cs-add" id="addFriend">＋</button></div>
      ${isAdmin?'<div class="cs-item" id="adminDmConsole"><span class="ci-ico">🔎</span><span>管理员私聊</span></div>':''}
      ${dms.map(u=>`<div class="cs-item" data-dm="${esc(u)}"><span class="ci-ico">💬</span><span>${esc(nickOf(u))}</span><span class="dm-dot" id="dot-${esc(u)}"></span></div>`).join("")||`<div class="cs-hint">${isAdmin?'添加好友或发起私聊':'添加好友开始私聊'}</div>`}`;
    $("#chWorld").onclick=openWorld;
    $("#addGroup").onclick=showCreateGroup;
    $("#addFriend").onclick=showAddFriend;
    if($("#adminDm"))$("#adminDm").onclick=showAdminDM;
    if($("#adminDmConsole"))$("#adminDmConsole").onclick=openAdminDMConsole;
    $$("[data-group]").forEach(el=>el.onclick=()=>openGroup(+el.dataset.group));
    $$("[data-dm]").forEach(el=>el.onclick=()=>openDM(el.dataset.dm));
    $$("[data-lb]").forEach(b=>b.onclick=()=>{S.leaderboardTab=b.dataset.lb;$$("[data-lb]").forEach(x=>x.classList.toggle("active",x.dataset.lb===S.leaderboardTab));renderLeaderboard();});
    renderLeaderboard();
  }else if(tab==="friends"){
    const active=S.friends.filter(f=>f.status==="active");
    const pending=S.friends.filter(f=>f.status==="pending"&&f.friend!==S.user.username);
    body.innerHTML=`<div class="cs-group-title">我的好友（${active.length}）</div>
      ${active.map(f=>`<div class="friend-item"><span class="ci-ico">🧑</span><span class="fi-name">${esc(nickOf(f.friend))}</span>
        <button class="fi-chat" data-fchat="${esc(f.friend)}">私聊</button><button class="fi-del" data-fdel="${f.id}">✕</button></div>`).join("")||'<div class="cs-hint">还没有好友</div>'}
      ${pending.length?`<div class="cs-group-title">等待对方确认（${pending.length}）</div>`+pending.map(f=>`<div class="friend-item"><span class="ci-ico">⏳</span><span class="fi-name">已向 ${esc(nickOf(f.friend))} 发出申请</span>
        <button class="fi-del" data-frej="${f.id}" title="撤回申请">✕ 撤回</button></div>`).join(""):""}
      <button class="btn sm" id="addFriend2" style="margin-top:10px;width:100%">＋ 添加好友</button>
      ${S.user&&S.user.role==='admin'?'<button class="btn sm" id="adminDm2" style="margin-top:8px;width:100%">✉️ 发起私聊（任意成员）</button>':''}`;
    $("#addFriend2").onclick=showAddFriend;
    if($("#adminDm2"))$("#adminDm2").onclick=showAdminDM;
    $$("[data-fchat]").forEach(b=>b.onclick=()=>openDM(b.dataset.fchat));
    $$("[data-fdel]").forEach(b=>b.onclick=async()=>{await cloud.database.from("friends").delete().eq("id",+b.dataset.fdel);toast("已删除好友");loadFriends();renderSide("friends");});
    $$("[data-frej]").forEach(b=>b.onclick=async()=>{await cloud.database.from("friends").delete().eq("id",+b.dataset.frej);toast("已撤回申请");loadFriends();renderSide("friends");});
  }else if(tab==="invites"){
    body.innerHTML=`<div class="cs-group-title">收到的邀请（${S.invites.length}）</div>
      ${S.invites.map(v=>`<div class="invite-item"><div class="ii-type">${inviteIcon(v.type)} ${inviteLabel(v.type)}</div>
        <div class="ii-from">来自 <b>${esc(nickOf(v.inviter))}</b></div><div class="ii-content">${esc(v.content)}</div>
        <div class="ii-actions"><button class="btn sm primary" data-iacc="${v.id}" data-itype="${v.type}" data-iref="${esc(v.ref)}" data-ifrom="${esc(v.inviter)}">接受</button>
        <button class="btn sm" data-irej="${v.id}">忽略</button></div></div>`).join("")||'<div class="cs-hint">暂无邀请</div>'}`;
    $$("[data-iacc]").forEach(b=>b.onclick=()=>acceptInvite(+b.dataset.iacc,b.dataset.itype,b.dataset.iref,b.dataset.ifrom));
    $$("[data-irej]").forEach(b=>b.onclick=async()=>{await cloud.database.from("invitations").update({status:"rejected"}).eq("id",+b.dataset.irej);toast("已忽略");loadInvites();renderSide("invites");updateInviteBadge();});
  }
}
function renderLeaderboard(){
  const body=$("#lbBody");if(!body||!S.user)return;
  const friends=new Set((S.friends||[]).filter(f=>f.status==="active").map(f=>f.friend));
  friends.add(S.user.username);
  let users=(S.users||[]).filter(u=>u.status==="active");
  if(S.leaderboardTab==="friends")users=users.filter(u=>friends.has(u.username));
  users=users.slice().sort((a,b)=>(Number(b.points)||0)-(Number(a.points)||0)||String(a.username).localeCompare(String(b.username)));
  S.leaderboard=users;
  body.innerHTML=users.slice(0,20).map((u,i)=>{
    const medal=i===0?"🥇":i===1?"🥈":i===2?"🥉":String(i+1).padStart(2,"0");
    return `<div class="lb-row ${u.username===S.user.username?'me':''}"><span class="lb-rank">${medal}</span><span class="lb-name">${esc(u.nickname||u.username)}${u.username===S.user.username?'（我）':''}</span><span class="lb-pts">${Number(u.points)||0} 分</span></div>`;
  }).join("")||'<div class="cs-hint">暂无排行数据</div>';
}
function inviteIcon(t){return ({friend:"🧑",team:"🛡️",group:"👥",word:"🔤",dm:"💬"})[t]||"✉️";}
function inviteLabel(t){return ({friend:"好友申请",team:"组队邀请",group:"群聊邀请",word:"单词组队",dm:"私聊邀请"})[t]||"邀请";}
function nickOf(u){const x=S.users.find(a=>a.username===u);return x?(x.nickname||x.username):u;}

function chatHeader(html){return `<div class="chat-head">${html}</div>`;}
// 管理员专属：世界频道成员昵称搜索，可直接切换私聊对象
function adminDmSearchBar(){return `<div class="admin-dm-search"><input id="adminDmSearch" placeholder="搜索昵称，切换私聊对象…" maxlength="40" autocomplete="off"><div id="adminDmResults" class="admin-dm-results"></div></div>`;}
function bindAdminDmSearch(){
  const inp=$("#adminDmSearch"),box=$("#adminDmResults");if(!inp||!box)return;
  inp.oninput=()=>{
    const q=(inp.value||"").trim().toLocaleLowerCase();
    if(!q){box.innerHTML="";return;}
    const list=(S.users||[]).filter(u=>u.status==="active"&&u.username!==S.user.username&&String(u.nickname||u.username).toLocaleLowerCase().includes(q)).slice(0,12);
    box.innerHTML=list.map(u=>`<button class="admin-dm-hit" data-dmstart="${esc(u.username)}"><span>💬 ${esc(u.nickname||u.username)}</span><small>@${esc(u.username)}</small></button>`).join("")||'<div class="cs-hint" style="padding:8px 12px">没有找到这个昵称</div>';
    $$("[data-dmstart]").forEach(b=>b.onclick=()=>{if(b.dataset.dmstart!==S.chatPeer)startAdminDM(b.dataset.dmstart);});
  };
}
function openAdminDMConsole(){
  if(!(S.user&&S.user.role==="admin")){toast("仅管理员可使用",true);return;}
  stopChat();
  S.chatTab="dm";S.chatRoom="";S.chatGroupId=null;S.chatPeer=null;S.chatMsgSig=null;S.chatRecallOpen=null;
  $("#chatMain").innerHTML=chatHeader(`<div><div class="ch-title">🔎 管理员私聊</div><div class="ch-sub">搜索昵称，与世界频道成员单独聊天（昵称唯一）</div></div>${adminDmSearchBar()}`)
    +'<div id="announceBar"></div>'+msgArea();
  renderAnnounceBar();bindAdminDmSearch();
  const list=$("#msgList");if(list)list.innerHTML='<div class="cs-hint" style="padding:20px">输入对方昵称，选择后开始私聊</div>';
  $$(".cs-item").forEach(x=>x.classList.remove("active-ch"));$("#adminDmConsole")&&$("#adminDmConsole").classList.add("active-ch");
}
function openWorld(){
  if(!$("#chatMain"))return;   // 已离开首页时忽略异步回调
  S.chatTab="world";S.chatRoom="";S.chatGroupId=null;S.chatPeer=null;S.chatMsgSig=null;S.chatRecallOpen=null;
  const isAdmin=!!(S.user&&S.user.role==="admin");
  $("#chatMain").innerHTML=chatHeader(`<div><div class="ch-title">🌐 世界频道</div><div class="ch-sub">所有安全屋成员都能看到你的消息</div></div>
    ${isAdmin?'<button class="btn sm" id="btnAnnounce">📢 公告管理</button>':'<span class="ch-mute-tip">管理员可禁言违规成员</span>'}`)
    +'<div id="announceBar"></div>'+msgArea();
  if($("#btnAnnounce"))$("#btnAnnounce").onclick=showAnnounceManager;
  renderAnnounceBar();
  bindSend();startChatPolling();
  $$(".cs-item").forEach(x=>x.classList.remove("active-ch"));$("#chWorld")&&$("#chWorld").classList.add("active-ch");
}
function openDM(user){
  S.chatTab="dm";S.chatRoom=dmRoom(S.user.username,user);S.chatGroupId=null;S.chatPeer=user;S.chatMsgSig=null;S.chatRecallOpen=null;
  rememberDmPeer(user);
  const admin=!!(S.user&&S.user.role==="admin");
  $("#chatMain").innerHTML=chatHeader(`<div><div class="ch-title">💬 ${esc(nickOf(user))}</div><div class="ch-sub">私聊 · 仅你俩可见</div></div>${admin?adminDmSearchBar():''}`)+'<div id="announceBar"></div>'+msgArea();
  renderAnnounceBar();
  if(admin)bindAdminDmSearch();
  bindSend();startChatPolling();
  $$(".cs-item").forEach(x=>x.classList.remove("active-ch"));
}
function openGroup(id){
  const g=S.groups.find(x=>x.id===id);if(!g)return;
  S.chatTab="group";S.chatGroupId=id;S.chatRoom="g"+id;S.chatPeer=null;S.chatMsgSig=null;S.chatRecallOpen=null;
  let members=[];try{members=JSON.parse(g.members||"[]");}catch(e){}
  $("#chatMain").innerHTML=chatHeader(`<div><div class="ch-title">👥 ${esc(g.name)}</div><div class="ch-sub">${members.length} 位成员 · 群主 ${esc(nickOf(g.owner))}</div></div>
    <button class="btn sm" id="inviteGroup">＋ 邀请入群</button>`)+'<div id="announceBar"></div>'+msgArea();
  $("#inviteGroup").onclick=()=>showInvite("group",String(id),"邀请你加入群聊「"+g.name+"」",null);
  renderAnnounceBar();
  bindSend();startChatPolling();
  $$(".cs-item").forEach(x=>x.classList.remove("active-ch"));
  $(`[data-group="${id}"]`)&&$(`[data-group="${id}"]`).classList.add("active-ch");
}
function msgArea(){return `<div class="msg-list" id="msgList"><div class="cs-hint" style="padding:20px">加载消息中…</div></div>
  <div class="msg-input"><input id="msgText" placeholder="输入消息，按 Enter 发送…" maxlength="500"><button class="btn primary" id="msgSend">发送</button></div>`;}
function bindSend(){
  const send=async()=>{
    const inp=$("#msgText");if(!inp)return;const txt=inp.value.trim();if(!txt)return;
    if(S.user.muted){toast("你已被管理员禁言，无法发言",true);return;}
    inp.value="";
    const row={channel:S.chatTab,room:S.chatRoom,sender:S.user.username,sender_name:S.user.nickname||S.user.username,content:txt,kind:"text"};
    const{error}=await cloud.database.from("chat_messages").insert(row);
    if(error){toast("发送失败",true);return;}
    SFX.play("send");refreshMessages();
  };
  $("#msgSend").onclick=send;
  $("#msgText").onkeydown=e=>{if(e.key==="Enter")send();};
  const msgList=$("#msgList");
  if(msgList)msgList.onclick=e=>{
    const btn=e.target.closest&&e.target.closest("[data-recall]");
    if(btn){e.stopPropagation();recallMessage(Number(btn.dataset.recall));return;}
    const box=e.target.closest&&e.target.closest(".msg[data-recallable='1']");
    if(!box){
      if(S.chatRecallOpen!==null){S.chatRecallOpen=null;$$("#msgList .msg-recall-bar").forEach(b=>b.remove());}
      return;
    }
    const id=Number(box.dataset.msg),was=S.chatRecallOpen===id;
    $$("#msgList .msg-recall-bar").forEach(b=>b.remove());
    S.chatRecallOpen=was?null:id;
    if(!was){
      const bar=document.createElement("div");
      bar.className="msg-recall-bar";
      const b=document.createElement("button");
      b.className="msg-recall";b.dataset.recall=String(id);b.title="撤回这条消息";b.textContent="🗑 撤回消息";
      bar.appendChild(b);box.appendChild(bar);
      if(typeof sessionStorage!=="undefined"&&!sessionStorage.getItem("ps_recall_tip")){
        sessionStorage.setItem("ps_recall_tip","1");toast("已展开消息操作：点「撤回消息」即可撤回");
      }
    }
  };
}
function startChatPolling(){if(S.chatTimer)clearInterval(S.chatTimer);refreshMessages();renderAnnounceBar();S.chatTimer=setInterval(()=>{refreshMessages();renderAnnounceBar();},4000);}
function stopChat(){if(S.chatTimer){clearInterval(S.chatTimer);S.chatTimer=null;}}
const RECALL_WINDOW_MS=7*24*60*60*1000;  // 普通用户仅可撤回 7 天内的消息
function canRecallMessage(m,user,now){
  if(!m||!user||m.kind==="system"||m.recalled)return false;
  if(user.role==="admin")return true;                       // 管理员不受时间限制，也可撤回他人消息
  if(m.sender!==user.username)return false;                 // 普通用户只能撤回自己的消息
  const t=Date.parse(m.created_at||"");
  if(!isFinite(t))return false;
  const cur=now||Date.now();
  return cur>=t-60000 && cur-t<=RECALL_WINDOW_MS;           // 7 天内（容忍 1 分钟时钟偏差）
}
async function recallMessage(id){
  const m=S.chatMsgs.find(x=>x.id===id);
  if(!m||m.recalled)return;
  if(!canRecallMessage(m,S.user)){toast("没有权限撤回这条消息",true);return;}
  if(!confirm("确认撤回这条消息？撤回后所有人都将无法看到原文。"))return;
  const{error}=await cloud.database.from("chat_messages")
    .update({recalled:true,recalled_at:new Date().toISOString(),recalled_by:S.user.username}).eq("id",id);
  if(error){toast("撤回失败："+error.message,true);return;}
  SFX.play("cute");toast("消息已撤回");
  S.chatRecallOpen=null;
  await refreshMessages(true);
}
async function refreshMessages(force){
  if(S.page!=="home"||!S.user)return;
  const list=$("#msgList");if(!list)return;
  let q=cloud.database.from("chat_messages").select("*").eq("channel",S.chatTab);
  if(S.chatTab==="world"){} else if(S.chatTab==="dm") q=q.eq("room",S.chatRoom); else if(S.chatTab==="group") q=q.eq("room",S.chatRoom);
  const{data}=await q.order("created_at",{ascending:true}).limit(200);
  const msgs=data||[];
  const sig=msgs.map(m=>m.id+":"+(m.recalled?"1":"0")+":"+(m.recalled_by||"")).join("|");
  if(force || sig!==S.chatMsgSig){
    S.chatMsgSig=sig;
    S.chatMsgs=msgs;
    list.innerHTML=msgs.map(m=>{
      const mine=m.sender===S.user.username;
      const sys=m.kind==="system";
      if(sys)return `<div class="msg-sys">${esc(m.content)}</div>`;
      const recallable=!m.recalled&&canRecallMessage(m,S.user);
      const showRecall=recallable&&S.chatRecallOpen===m.id;
      const meta=`<div class="msg-meta"><b>${esc(m.sender_name||nickOf(m.sender))}</b><span>${timeAgo(m.created_at)}</span></div>`;
      const body=m.recalled
        ? `<div class="msg-bubble recalled">↩️ ${esc(m.sender_name||nickOf(m.sender))} 撤回了一条消息${m.recalled_by&&m.recalled_by!==m.sender?`（由 ${esc(m.recalled_by)} 撤回）`:''}</div>`
        : `<div class="msg-bubble">${esc(m.content)}</div>`;
      const action=showRecall?`<div class="msg-recall-bar"><button class="msg-recall" data-recall="${m.id}" title="撤回这条消息">🗑 撤回消息</button></div>`:'';
      return `<div class="msg ${mine?'mine':''}" data-msg="${m.id}"${recallable?' data-recallable="1"':''}>${meta}${body}${action}</div>`;
    }).join("")||'<div class="cs-hint" style="padding:20px">还没有消息，来说第一句吧～</div>';
    list.scrollTop=list.scrollHeight;
  }
}
/* ---------- 世界频道公告 ---------- */
async function loadAnnouncements(){
  const{data}=await cloud.database.from("announcements").select("*").order("created_at",{ascending:false});
  S.announcements=data||[];
}
// 公告投放位置：world=世界频道公告条（默认，兼容旧数据）/ group=指定群聊 / dm=指定用户私聊
function annPlacement(a){return a.placement||"world";}
function annGroups(a){try{return JSON.parse(a.target_groups||"[]").map(String);}catch(e){return [];}}
function annUsers(a){try{return JSON.parse(a.target_users||"[]").map(x=>String(x).toLocaleLowerCase());}catch(e){return [];}}
// 我是某个目标群的成员吗
function inTargetGroup(gid,me){
  const g=(S.groups||[]).find(x=>String(x.id)===String(gid));if(!g)return false;
  if(String(g.owner||"").toLocaleLowerCase()===me)return true;
  let members=[];try{members=JSON.parse(g.members||"[]");}catch(e){}
  return members.some(m=>String(m).toLocaleLowerCase()===me);
}
// 定向公告：判断当前用户是否属于这条公告的目标人群（发布者/管理员始终可见）
function canSeeAnnouncement(a){
  const place=annPlacement(a);
  // 发布者与管理员始终可见，便于管理与核对
  if(S.user&&(S.user.role==="admin"||(a.author&&String(S.user.username).toLocaleLowerCase()===String(a.author).toLocaleLowerCase())))return true;
  // 群聊投放：需要登录且是目标群成员
  if(place==="group"){
    if(!S.user)return false;
    const me=String(S.user.username||"").toLocaleLowerCase();
    return annGroups(a).some(gid=>inTargetGroup(gid,me));
  }
  // 私聊投放：接收者本人可见；正在与该接收者私聊的会话也可见（便于核对）
  if(place==="dm"){
    if(!S.user)return false;
    const me=String(S.user.username||"").toLocaleLowerCase();
    const targets=annUsers(a);
    if(targets.includes(me))return true;
    if(S.chatTab==="dm"){
      const peer=String(S.chatPeer||"").toLocaleLowerCase();
      if(targets.includes(peer))return true;
    }
    return false;
  }
  // world：全员公告对所有人（含未登录）可见；指定人群需要登录判断
  const scope=a.audience||"all";
  if(scope==="all")return true;
  if(!S.user)return false;
  const me=String(S.user.username||"").toLocaleLowerCase();
  if(scope==="named")return annUsersFromAudience(a).some(n=>String(n).toLocaleLowerCase()===me);
  if(scope==="friends_of"){
    const target=a.target_user;
    if(!target)return false;
    if(me===String(target).toLocaleLowerCase())return true; // 被调整者本人
    return (S.friends||[]).some(f=>f.status==="active"&&String(f.friend||"").toLocaleLowerCase()===String(target).toLocaleLowerCase());
  }
  return true;
}
function annUsersFromAudience(a){try{return JSON.parse(a.audience_names||"[]");}catch(e){return [];}}
// 当前时间处于生效区间、未撤回、且对当前用户可见的公告
function activeAnnouncements(){
  const now=Date.now();
  return (S.announcements||[]).filter(a=>{
    if(a.active===false)return false;
    if(!canSeeAnnouncement(a))return false;
    const s=a.start_at?new Date(a.start_at).getTime():-Infinity;
    const e=a.end_at?new Date(a.end_at).getTime():Infinity;
    return now>=s&&now<=e;
  });
}
function annStatus(a){
  const now=Date.now();
  if(a.active===false)return {t:"已撤回",c:"rejected"};
  const s=a.start_at?new Date(a.start_at).getTime():-Infinity;
  const e=a.end_at?new Date(a.end_at).getTime():Infinity;
  if(now<s)return {t:"未开始",c:"pending"};
  if(now>e)return {t:"已结束",c:"rejected"};
  return {t:"生效中",c:"active"};
}
function fmtAnnTime(iso){
  if(!iso)return"—";
  const d=new Date(iso);
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")+" "+String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0");
}
// datetime-local 需要本地时间字符串
function toLocalInput(iso){
  if(!iso)return"";
  const d=new Date(iso),p=n=>String(n).padStart(2,"0");
  return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate())+"T"+p(d.getHours())+":"+p(d.getMinutes());
}
// 当前聊天界面应显示的公告：按投放位置 + 当前场景过滤
function announcementsForCurrentChat(){
  const list=activeAnnouncements(); // 已含：生效时间 + 撤回 + 目标人群过滤
  return list.filter(a=>{
    const place=annPlacement(a);
    if(S.chatTab==="world"||!S.chatTab)return place==="world";
    if(S.chatTab==="group"){
      if(place!=="group")return false;
      return annGroups(a).some(gid=>String(gid)===String(S.chatGroupId));
    }
    if(S.chatTab==="dm"){
      // canSeeAnnouncement 已判断：接收者本人或当前私聊对象在名单中
      return place==="dm";
    }
    return false;
  });
}
function renderAnnounceBar(){
  const bar=$("#announceBar");if(!bar)return;
  const list=announcementsForCurrentChat();
  if(!S.user||!list.length){bar.innerHTML="";bar.style.display="none";return;}
  bar.style.display="block";
  bar.innerHTML=`<div class="announce-bar">${list.map(a=>`<div class="announce-row"><span class="announce-ico">📢</span>
    <div class="announce-body"><div class="announce-text">${esc(a.content)}</div>
    <div class="announce-range">生效时间 ${fmtAnnTime(a.start_at)} → ${fmtAnnTime(a.end_at)}</div></div></div>`).join("")}</div>`;
}
function showAnnounceManager(){
  modal(`<div class="modal-head"><button class="modal-close">✕</button><h2>📢 公告管理</h2><p>可投放到世界频道公告条、指定群聊或指定用户的聊天界面</p></div>
    <div class="modal-body"><div style="display:flex;justify-content:flex-end;margin-bottom:10px"><button class="btn sm primary" id="annNew">＋ 发布新公告</button></div>
    <div id="annManageList"></div></div>`,true);
  $(".modal-close").onclick=closeModal;
  $("#annNew").onclick=()=>showAnnounceForm(null);
  renderAnnounceManageList();
}
function renderAnnounceManageList(){
  const box=$("#annManageList");if(!box)return;
  const list=S.announcements||[];
  if(!list.length){box.innerHTML='<div class="cs-hint" style="padding:16px">还没有公告，点右上角发布。</div>';return;}
  const placeLabel=p=>({world:"🌐 世界频道",group:"👥 群聊",dm:"💬 私聊"})[p||"world"]||p;
  box.innerHTML=list.map(a=>{
    const st=annStatus(a);
    const p=annPlacement(a);
    let target="";
    if(p==="group"){const gids=annGroups(a);target=gids.map(id=>{const g=(S.groups||[]).find(x=>String(x.id)===String(id));return g?g.name:"群"+id;}).join("、");}
    else if(p==="dm"){target=annUsers(a).map(u=>nickOf(u)).join("、");}
    else if((a.audience||"all")!=="all"){target=a.audience==="named"?annUsersFromAudience(a).map(u=>nickOf(u)).join("、"):"指定人群";}
    return `<div class="announce-manage-item"><div class="ami-top"><span class="status-pill ${st.c}">${st.t}</span>
      <span class="ami-place">${placeLabel(p)}</span>
      <span class="ami-time">${fmtAnnTime(a.start_at)} → ${fmtAnnTime(a.end_at)}</span></div>
      <div class="ami-content">${esc(a.content)}</div>
      ${target?`<div class="ami-target">投放至：${esc(target)}</div>`:''}
      ${a.active===false?`<div class="ami-target">🕒 撤回时间 ${fmtAnnTime(a.recalled_at)}${a.recalled_by?' · 操作人 '+esc(a.recalled_by):''}</div>`:''}
      <div class="row-actions" style="margin-top:8px"><button class="btn sm" data-ann-edit="${a.id}">编辑</button>
      ${a.active===false?'<span class="cs-hint" style="font-size:11px">已撤回</span>':`<button class="btn sm danger" data-ann-del="${a.id}">撤回</button>`}</div></div>`;
  }).join("");
  $$("[data-ann-edit]").forEach(b=>b.onclick=()=>showAnnounceForm(S.announcements.find(x=>x.id===+b.dataset.annEdit)));
  $$("[data-ann-del]").forEach(b=>b.onclick=async()=>{
    const a=S.announcements.find(x=>x.id===+b.dataset.annDel);
    if(!a||a.active===false)return;
    // 软删除：记录撤回时间而不物理删除，便于留痕与核对
    const{error}=await cloud.database.from("announcements")
      .update({active:false,recalled_at:new Date().toISOString(),recalled_by:S.user&&S.user.username||""}).eq("id",a.id);
    if(error){toast("撤回失败："+error.message,true);return;}
    await loadAnnouncements();renderAnnounceBar();renderAnnounceManageList();toast("公告已撤回");
  });
}
function showAnnounceForm(a){
  if(a)closeModal(); // 从管理列表进入编辑：先关再开会重置，但需保留管理列表刷新
  const isEdit=!!a;
  const now=new Date(),end=new Date(now.getTime()+7*86400000);
  const place=a?annPlacement(a):"world";
  const selGroups=a?annGroups(a):[];
  const selUsers=a?annUsersFromAudience(a):[]; // 私聊目标用户名（编辑回显）
  const editUsers=(a&&place==="dm")?annUsers(a):selUsers;
  const def={content:a?a.content:"",start:a?toLocalInput(a.start_at):toLocalInput(now.toISOString()),end:a?toLocalInput(a.end_at):toLocalInput(end.toISOString())};
  const groupOpts=(S.groups||[]).map(g=>`<label class="ann-check"><input type="checkbox" class="ann-g" value="${esc(g.id)}" ${selGroups.map(String).includes(String(g.id))?'checked':''}> ${esc(g.name)}</label>`).join("");
  modal(`<div class="modal-head"><button class="modal-close">✕</button><h2>${isEdit?"编辑公告":"发布新公告"}</h2><p>设定时间范围与投放位置，公告会在对应界面持续显示</p></div>
    <div class="modal-body">
    <div class="field"><label>公告内容</label><textarea id="annContent" rows="4" maxlength="500" placeholder="例如：本周六 20:00 全服 Boss 战，欢迎组队！">${esc(def.content)}</textarea></div>
    <div class="field"><label>投放位置</label>
      <select id="annPlace">
        <option value="world" ${place==="world"?'selected':''}>🌐 世界频道公告条（全员或指定人群可见）</option>
        <option value="group" ${place==="group"?'selected':''}>👥 指定群聊（只在这些群聊界面显示）</option>
        <option value="dm" ${place==="dm"?'selected':''}>💬 指定用户私聊（只在这些用户的聊天界面显示）</option>
      </select></div>
    <div id="annPlaceWorld" class="ann-place-box" style="display:${place==="world"?'':'none'}">
      <div class="notice info">世界频道公告条。可只让指定人群看到（发布者始终可见）。</div>
      <div class="field"><label>可见范围</label>
        <select id="annAudience">
          <option value="all" ${(a&&(a.audience||'all')==='all')?'selected':''}>全部成员</option>
          <option value="named" ${(a&&a.audience==='named')?'selected':''}>指定名单</option>
        </select></div>
      <div class="field" id="annAudNamesWrap" style="display:${(a&&a.audience==='named')?'':'none'}"><label>可见账号（一行一个）</label><textarea id="annAudNames" rows="3">${esc((a&&a.audience==='named')?selUsers.join('\n'):'')}</textarea></div>
    </div>
    <div id="annPlaceGroup" class="ann-place-box" style="display:${place==="group"?'':'none'}">
      <div class="notice info">公告只在所选群聊的聊天界面顶部显示，群成员可见。可多选。</div>
      <div class="ann-group-list">${groupOpts||'<span class="hint">暂无群聊</span>'}</div>
    </div>
    <div id="annPlaceDm" class="ann-place-box" style="display:${place==="dm"?'':'none'}">
      <div class="notice info">公告只在所选用户的私聊聊天界面顶部显示。一行一个账号。</div>
      <div class="field"><label>接收账号</label><textarea id="annDmNames" rows="4" placeholder="例如：Alice\nBob">${esc(place==="dm"?editUsers.join('\n'):'')}</textarea></div>
    </div>
    <div class="form-grid" style="grid-template-columns:1fr 1fr">
      <div class="field"><label>开始时间</label><input type="datetime-local" id="annStart" value="${def.start}"></div>
      <div class="field"><label>结束时间</label><input type="datetime-local" id="annEnd" value="${def.end}"></div></div>
    <div class="modal-actions"><button class="btn primary" id="annSave">${isEdit?"保存修改":"发布公告"}</button>
      <button class="btn ghost" id="annCancel">取消</button></div></div>`,true);
  $(".modal-close").onclick=()=>showAnnounceManager();
  $("#annCancel").onclick=()=>showAnnounceManager();
  const syncPlace=()=>{const p=$("#annPlace").value;
    $("#annPlaceWorld").style.display=p==="world"?"":"none";
    $("#annPlaceGroup").style.display=p==="group"?"":"none";
    $("#annPlaceDm").style.display=p==="dm"?"":"none";};
  $("#annPlace").onchange=syncPlace;
  $("#annAudience").onchange=e=>{$("#annAudNamesWrap").style.display=e.target.value==="named"?"":"none";};
  $("#annSave").onclick=async()=>{
    const content=$("#annContent").value.trim();
    const start=$("#annStart").value,end=$("#annEnd").value;
    if(!content){toast("请输入公告内容",true);return;}
    if(!start||!end){toast("请选择开始和结束时间",true);return;}
    const startISO=new Date(start).toISOString(),endISO=new Date(end).toISOString();
    if(new Date(endISO)<=new Date(startISO)){toast("结束时间必须晚于开始时间",true);return;}
    const place=$("#annPlace").value;
    const row={content,start_at:startISO,end_at:endISO,active:true,placement:place};
    const splitNames=txt=>txt.split(/[\n,，;；\s]+/).filter(Boolean);
    if(place==="world"){
      const aud=$("#annAudience").value;
      row.audience=aud;
      if(aud==="named"){
        const names=splitNames($("#annAudNames").value);
        if(!names.length){toast("请填写至少一个可见账号",true);return;}
        row.audience_names=JSON.stringify(names);
      }else row.audience_names=null;
      row.target_groups=null;row.target_users=null;row.target_user=null;
    }else if(place==="group"){
      const gids=$$(".ann-g:checked").map(c=>c.value);
      if(!gids.length){toast("请至少选择一个群聊",true);return;}
      row.target_groups=JSON.stringify(gids);row.target_users=null;row.audience="all";row.audience_names=null;row.target_user=null;
    }else{
      const names=splitNames($("#annDmNames").value);
      if(!names.length){toast("请填写至少一个接收账号",true);return;}
      row.target_users=JSON.stringify(names);row.target_groups=null;row.audience="all";row.audience_names=null;row.target_user=null;
    }
    let error;
    if(isEdit){({error}=await cloud.database.from("announcements").update(row).eq("id",a.id));}
    else{row.author=S.user.username;row.created_at=new Date().toISOString();({error}=await cloud.database.from("announcements").insert(row));}
    if(error){toast("保存失败："+error.message,true);return;}
    await loadAnnouncements();renderAnnounceBar();showAnnounceManager();toast(isEdit?"公告已更新":"公告已发布");
  };
}
function showAdminDM(){
  if(!(S.user&&S.user.role==="admin")){toast("仅管理员可发起非好友私聊",true);return;}
  const cand=(S.users||[]).filter(u=>u.status==="active"&&u.username!==S.user.username);
  modal(`<div class="modal-head"><button class="modal-close">✕</button><h2>发起私聊</h2><p>管理员可直接与任意成员聊天，无需先加好友（昵称唯一）</p></div>
    <div class="modal-body"><div class="field"><input id="dmFind" placeholder="搜索昵称"></div>
      <div id="dmCand" class="invite-list"></div></div>`,true);
  $(".modal-close").onclick=closeModal;
  const paint=()=>{
    const q=($("#dmFind").value||"").trim().toLocaleLowerCase();
    const list=cand.filter(u=>(String(u.username)+" "+String(u.nickname||"")).toLocaleLowerCase().includes(q));
    $("#dmCand").innerHTML=list.map(u=>`<div class="invite-opt dm-opt"><span>💬 ${esc(u.nickname||u.username)}</span><small>@${esc(u.username)}</small><button class="btn sm primary" data-dmstart="${esc(u.username)}">私聊</button></div>`).join("")||'<div class="cs-hint">没有匹配的成员</div>';
    $$("[data-dmstart]").forEach(b=>b.onclick=()=>{const to=b.dataset.dmstart;closeModal();startAdminDM(to);});
  };
  $("#dmFind").oninput=paint;paint();
}
async function startAdminDM(to){
  if(!to||to===S.user.username)return;
  const known=(S.friends||[]).some(f=>f.status==="active"&&f.friend===to)||(S.dmPeers||[]).includes(to);
  if(!known){
    const{error}=await cloud.database.from("invitations").insert({inviter:S.user.username,invitee:to,type:"dm",ref:S.user.username,content:"管理员邀请你私聊，可直接回复"});
    if(error){toast("私聊邀请发送失败："+error.message,true);return;}
  }
  openDM(to);
  toast("已打开与 "+nickOf(to)+" 的私聊");
}
function showAddFriend(){
  modal(`<div class="modal-head"><button class="modal-close">✕</button><h2>添加好友</h2><p>输入对方账号，发送好友申请</p></div>
    <div class="modal-body"><div class="field"><label>对方账号</label><input id="fTarget" placeholder="例如 Paralir"></div>
    <div class="modal-actions"><button class="btn primary" id="doAddF">发送申请</button></div></div>`,true);
  $(".modal-close").onclick=closeModal;
  $("#doAddF").onclick=async()=>{
    const t=$("#fTarget").value.trim();
    if(!t){toast("请输入账号",true);return;}
    if(t===S.user.username){toast("不能加自己",true);return;}
    if(!S.users.find(u=>u.username===t)){toast("账号不存在或未激活",true);return;}
    const dup=S.friends.find(f=>f.friend===t);
    if(dup){toast(dup.status==="active"?"已是好友":"申请已发送",true);return;}
    const{error}=await cloud.database.from("friends").insert({owner:S.user.username,friend:t,status:"pending"});
    if(error){toast("发送失败",true);return;}
    await cloud.database.from("invitations").insert({inviter:S.user.username,invitee:t,type:"friend",content:"想加你为好友"});
    closeModal();toast("好友申请已发送");
  };
}
function showCreateGroup(){
  modal(`<div class="modal-head"><button class="modal-close">✕</button><h2>创建群聊</h2></div>
    <div class="modal-body"><div class="field"><label>群名称</label><input id="gName" placeholder="给群聊起个名字"></div>
    <div class="modal-actions"><button class="btn primary" id="doCreateG">创建</button></div></div>`,true);
  $(".modal-close").onclick=closeModal;
  $("#doCreateG").onclick=async()=>{
    const name=$("#gName").value.trim();if(!name){toast("请输入群名",true);return;}
    const{error}=await cloud.database.from("chat_groups").insert({name,owner:S.user.username,members:JSON.stringify([S.user.username])});
    if(error){toast("创建失败",true);return;}
    closeModal();await loadGroups();renderSide("channels");toast("群聊已创建");
  };
}
function showInvite(type,ref,content,exclude){
  const cand=S.users.filter(u=>u.username!==S.user.username&&u.username!==exclude);
  modal(`<div class="modal-head"><button class="modal-close">✕</button><h2>${inviteLabel(type)}</h2><p>选择要邀请的成员</p></div>
    <div class="modal-body"><div class="invite-list">${cand.map(u=>`<label class="invite-opt"><input type="checkbox" value="${esc(u.username)}"><span>${esc(u.nickname||u.username)}</span><small>@${esc(u.username)}</small></label>`).join("")||'<div class="cs-hint">暂无可邀请成员</div>'}</div>
    <div class="modal-actions"><button class="btn primary" id="doInvite">发送邀请</button></div></div>`);
  $(".modal-close").onclick=closeModal;
  $("#doInvite").onclick=async()=>{
    const sel=$$(".invite-opt input:checked").map(x=>x.value);
    if(!sel.length){toast("请选择成员",true);return;}
    for(const to of sel){await cloud.database.from("invitations").insert({inviter:S.user.username,invitee:to,type,ref,content});}
    closeModal();toast("邀请已发送给 "+sel.length+" 人");
  };
}
async function acceptInvite(id,type,ref,from){
  await cloud.database.from("invitations").update({status:"accepted"}).eq("id",id);
  if(type==="friend"){
    await establishFriendship(S.user.username,from);
    toast("已成为好友");
  }else if(type==="dm"){
    rememberDmPeer(from);
    toast("已打开私聊，可以直接回复");
    openDM(from);
    loadInvites().then(()=>{renderSide("invites");updateInviteBadge();});
    return;
  }else if(type==="group"){
    const{data:g}=await cloud.database.from("chat_groups").select("*").eq("id",+ref).maybeSingle();
    if(g){let m=[];try{m=JSON.parse(g.members||"[]");}catch(e){}if(!m.includes(S.user.username))m.push(S.user.username);
      await cloud.database.from("chat_groups").update({members:JSON.stringify(m)}).eq("id",g.id);}
    toast("已加入群聊");
  }else if(type==="team"||type==="word"){
    await joinTeam(+ref,from);toast("已加入队伍");
  }else toast("已接受邀请");
  loadInvites().then(()=>{loadFriends();loadGroups();renderSide("channels");updateInviteBadge();});
}

/* ============================================================
   术语检索系统
   ============================================================ */
function renderLexicon(main){
  const cats=Object.entries(CATS);
  main.innerHTML=`
    <div class="lex-head"><div><h1>术语检索系统</h1><p>网络安全术语 + 四级 / 六级 / 考研 · ${window.TERMS.terms.length} 条词条 · 九大分类 · 英美音标注</p></div>
      <div class="hint">数据来自 CTF 五大讲义 · 支持中英文 / 缩写 / 定义检索</div></div>
    <div class="searchbar"><span class="si">⌕</span><input id="lexQ" placeholder="搜索英文术语、缩写、中文名称或定义…（输入即时筛选）" value="${esc(S.lexQ)}" autocomplete="off"><button class="lex-clear" id="lexClear" title="清除搜索" style="display:${S.lexQ?'block':'none'}">✕</button><span class="lex-live" id="lexLive"></span></div>
    <div class="filters" id="lexFilters"></div>
    <div class="resultinfo hint" style="margin:0 0 12px">找到 <b id="lexCount" style="color:var(--accent)">0</b> 条术语${S.lexQ?` · 关键词「<b style="color:var(--green)">${esc(S.lexQ)}</b>」`:''}</div>
    <div class="terms-grid" id="termsGrid"></div>`;
  const filters=$("#lexFilters");
  filters.innerHTML=`<div class="chip ${S.lexCat===''?'active':''}" data-c="" style="--c:#2dd4bf"><span class="dot"></span>全部</div>`+
    cats.map(([k,v])=>`<div class="chip ${S.lexCat===k?'active':''}" data-c="${k}" style="--c:${v.color}"><span class="dot"></span>${v.zh}<span style="color:var(--dim);font-family:var(--mono)">${window.TERMS.terms.filter(t=>t.cat===k).length}</span></div>`).join("")+
    `<button class="chip" id="favFilter" style="--c:#fbbf24">${S.lexFavOnly?'★ 已收藏':'☆ 收藏'}</button>`;
  filters.querySelectorAll(".chip[data-c]").forEach(c=>c.onclick=()=>{S.lexCat=c.dataset.c;S.lexLimit=120;renderLexicon(main);});
  $("#favFilter").onclick=()=>{S.lexFavOnly=!S.lexFavOnly;S.lexLimit=120;renderLexicon(main);};
  const lexInput=$("#lexQ"), lexClear=$("#lexClear"), lexLive=$("#lexLive");
  let composing=false, searchTimer=null;
  function applySearch(){
    S.lexQ=lexInput.value.trim();S.lexLimit=120;
    lexClear.style.display=S.lexQ?"block":"none";
    drawTerms();
    lexLive.textContent=S.lexQ?`筛选中：${$("#lexCount").textContent} 条`:"";
  }
  lexInput.addEventListener("compositionstart",()=>{composing=true;});
  lexInput.addEventListener("compositionend",()=>{composing=false;clearTimeout(searchTimer);applySearch();});
  lexInput.addEventListener("input",()=>{
    if(composing) return;                       // 中文输入法拼音拼写中不搜索，避免卡顿/光标乱跳
    clearTimeout(searchTimer);
    searchTimer=setTimeout(applySearch,120);    // 防抖，输入跟手
  });
  lexInput.addEventListener("keydown",e=>{if(e.key==="Enter"){clearTimeout(searchTimer);applySearch();lexInput.blur();}});
  lexClear.onclick=()=>{lexInput.value="";clearTimeout(searchTimer);applySearch();lexInput.focus();};
  drawTerms();
  function drawTerms(){
    const q=S.lexQ.toLowerCase();
    let list=window.TERMS.terms.filter(t=>{
      if(S.lexCat&&t.cat!==S.lexCat)return false;
      if(S.lexFavOnly&&!S.favs.has(t.id))return false;
      if(q){const hay=[t.k,t.f,t.z,t.d,t.dz,t.n].join(" ").toLowerCase();if(!hay.includes(q))return false;}
      return true;
    });
    // 有搜索词时按相关性排序：词名精确 > 词名前缀 > 词名包含 > 中文名/定义命中；无搜索词时按字母序
    if(q){
      const rank=t=>{
        const k=(t.k||"").toLowerCase(), f=(t.f||"").toLowerCase();
        const z=(t.z||""), d=(t.d||"").toLowerCase(), dz=(t.dz||"");
        if(k===q) return 0;
        if(k.startsWith(q)) return 1;
        if(f===q) return 2;
        if(f.startsWith(q)) return 3;
        if(k.includes(q)) return 4;
        if(f.includes(q)) return 5;
        if(z.includes(q)||dz.includes(q)) return 6;
        if(d.includes(q)) return 7;
        return 8;
      };
      list.sort((a,b)=>rank(a)-rank(b)||String(a.k).localeCompare(String(b.k)));
      // 同名词条去重：原生术语优先于词库词条，其余按 CET4→CET6→考研 顺序保留一条
      const catPri={cet4:0,cet6:1,kaoyan:2};
      const best=new Map();
      for(const t of list){
        const key=String(t.k).toLowerCase();
        const pri=(t.vocab?10:0)+(catPri[t.cat]!=null?catPri[t.cat]:0);
        if(!best.has(key)||pri<best.get(key).pri) best.set(key,{t,pri});
      }
      list=[...best.values()].map(x=>x.t).sort((a,b)=>rank(a)-rank(b)||String(a.k).localeCompare(String(b.k)));
    }else{
      list.sort((a,b)=>String(a.k).localeCompare(String(b.k)));
    }
    $("#lexCount").textContent=list.length;
    const shown=list.slice(0,S.lexLimit||120);
    $("#termsGrid").innerHTML=shown.map(t=>{
      const c=CATS[t.cat].color;
      return `<div class="term-card" data-id="${t.id}" style="--c:${c}">
        <div class="tc-top"><div><div class="tc-term">${hl(t.k,q)}</div>${ipaBlock(t.k)}${t.f&&t.f.toLowerCase()!==t.k.toLowerCase()?`<div class="tc-full">${hl(t.f,q)}</div>`:""}</div><span class="tag">L${t.lv}</span></div>
        <div class="tc-zh">${hl(t.z,q)}</div><div class="tc-desc">${hl((t.vocab?t.dz:t.d).slice(0,150),q)}</div>
        <div class="tc-foot"><span>${esc(CATS[t.cat].en)}</span><span class="favbtn" data-fav="${t.id}" style="cursor:pointer;color:${S.favs.has(t.id)?'#fbbf24':'var(--dim)'}">${S.favs.has(t.id)?'★':'☆'}</span></div></div>`;
    }).join("")||'<div class="empty" style="grid-column:1/-1">没有匹配的术语</div>';
    if(list.length>shown.length){
      $("#termsGrid").insertAdjacentHTML("beforeend",`<button class="btn" id="lexMore" style="grid-column:1/-1">加载更多（还有 ${list.length-shown.length} 条）</button>`);
      $("#lexMore").onclick=()=>{S.lexLimit=(S.lexLimit||120)+240;drawTerms();};
    }
    $$("#termsGrid .term-card").forEach(el=>el.onclick=e=>{if(e.target.classList.contains("favbtn"))return;openTerm(window.TERMS.terms.find(t=>t.id===+el.dataset.id));});
    $$("#termsGrid .favbtn").forEach(b=>b.onclick=e=>{e.stopPropagation();const id=+b.dataset.fav;S.favs.has(id)?S.favs.delete(id):S.favs.add(id);localStorage.setItem("ps_favs",JSON.stringify([...S.favs]));drawTerms();});
  }
}
function hl(text,q){if(!q)return esc(text);try{return esc(text).replace(new RegExp("("+q.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+")","ig"),"<mark>$1</mark>");}catch(e){return esc(text);}}
function openTerm(t){
  const c=CATS[t.cat].color;
  modal(`<div class="modal-head" style="border-left:3px solid ${c}"><button class="modal-close">✕</button>
      <h2 style="font-family:var(--mono)">${esc(t.k)}</h2><p>${esc(t.f)} · <span style="color:${c}">${esc(CATS[t.cat].zh)}</span> · Level ${t.lv}</p></div>
    <div class="modal-body"><div class="section-h">发音 · Pronunciation</div>${ipaBlock(t.k)||'<div class="hint">该术语暂无标准音标</div>'}
      <div class="section-h">中文名称</div><p style="font-size:17px;color:#fff;margin:6px 0">${esc(t.z)}</p>
      <div class="section-h">English definition</div><p class="muted" style="margin:6px 0">${t.vocab?'基础词汇 · 英美音标与释义见本页':esc(t.d)}</p>
      <div class="section-h">中文释义</div><p class="muted" style="margin:6px 0">${esc(t.dz)}</p>
      ${t.n?`<div class="section-h">要点 / 示例</div><div class="sfx-note">${esc(t.n)}</div>`:""}
      <div class="modal-actions"><button class="btn" id="copyTerm">⧉ 复制术语</button><button class="btn" id="copyAll">⧉ 复制完整词条</button></div></div>`);
  $(".modal-close").onclick=closeModal;
  $("#copyTerm").onclick=()=>{copy(t.k);toast("已复制");};
  $("#copyAll").onclick=()=>{copy(`${t.k} (${t.f})\n${t.z}\n\nEN: ${t.d}\n中文: ${t.dz}${t.n?"\n要点: "+t.n:""}`);toast("已复制完整词条");};
}

/* ============================================================
   关卡通用机制：学习倒计时 / 挑战限时 / 再看一遍 / 评分
   ============================================================ */
const MIN_STUDY_SEC = 300;                 // 看知识点最少 5 分钟
const REPLAY_5 = 300, REPLAY_10 = 600;     // 再看一遍可选 5 / 10 分钟
const STUDY_POOL_SIZE = 30;                // 每关从词库搜集约 30 词作为学习池，题目全部出自该池
/* 世界观内的“情报误差”告示：用设定解释词库/考题中的零星对不上，避免逐条硬改数据 */
const INTEL_NOTICE = `<div class="notice intel">
  <b>安全屋情报告示 · 群众之中有坏人</b><br>
  情报网里混进了说谎的人，词条与地方志难免有误差。若你发现释义与考题对不上——别怀疑自己，是有人动了手脚。以本关词条清单与现场判定为准，错的记在 Pary 账上。
  <span class="intel-sign">—— Pary · 安全屋情报局</span></div>`;
let levelTimer = null;
/* 战斗代次：离开/重开关卡时递增，使旧的延迟推进回调自动失效，避免把地图拉回战斗 */
let battleEpoch = 0;
/* 管理员页渲染序号：切走页面后作废旧请求，避免慢加载覆盖当前页面 */
let adminRenderSeq = 0;
/* 积分写串行锁：同一浏览器内的读-改-写排队执行，避免并发互相覆盖 */
let pointsQueue = Promise.resolve();
function withPointsLock(fn){
  const result = pointsQueue.then(fn, fn);
  pointsQueue = result.catch(()=>{});
  return result;
}

function stopLevelTimer(){ if(levelTimer){ clearInterval(levelTimer); levelTimer=null; } }
function fmtDur(sec){
  sec=Math.max(0,Math.ceil(Number(sec)||0));
  return String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0');
}
// 依据知识点真实体量决定学习时长：至少 5 分钟，条目越多、字数越长越久（上限 15 分钟）
function calcStudySec(knowledge){
  const items=knowledge||[];
  const chars=items.reduce((n,k)=>n+String(k&&k[0]||'').length+String(k&&k[1]||'').length,0);
  return Math.min(900, MIN_STUDY_SEC + Math.max(0,items.length-2)*45 + Math.ceil(chars/180)*30);
}
function calcBattleSec(level){
  const qn=(level.monsters?level.monsters.length:4)+(level.boss?level.boss.length:3);
  return 240 + qn*20;
}
function runTimer(getLeft,setLeft,onTick,onExpire){
  stopLevelTimer();
  levelTimer=setInterval(()=>{
    const left=Math.max(0,getLeft()-1);   // 真正每秒递减
    setLeft(left);
    onTick(left);
    if(left<=0){ stopLevelTimer(); onExpire(); return; }
  },1000);
}
function startStudyClock(b,render){
  b.studySpan=b.studyLeft;
  b.studyReady=false;
  b.studyStart=b.studyStart||Date.now();
  runTimer(()=>b.studyLeft,v=>b.studyLeft=v,left=>{
    const el=document.getElementById("studyClock");
    if(el){el.textContent=fmtDur(left);el.classList.toggle("urgent",left<=30);}
    const bar=document.getElementById("studyBar");
    if(bar)bar.style.width=Math.max(0,Math.min(100,left/b.studySpan*100))+"%";
  },()=>{
    b.studyEnd=b.studyEnd||Date.now();
    if(!b.reviewed){
      failLevel("学习倒计时已结束，但你还没有出发挑战，也没有点「再看一遍」继续研读，系统判定你未认真准备，挑战提前失败。",b);
      return;
    }
    b.studyReady=true;SFX.play("ding");render();
  });
}
function reviewAgain(b,sec,render){
  b.reviewed=true;
  b.studyLeft=sec;
  SFX.play("cute");
  toast("已切换为 "+fmtDur(sec)+" 的「再看一遍」，学习倒计时重新开始");
  startStudyClock(b,render);
  render();
}
function startBattleClock(b,render,resume){
  if(!resume){b.battleStart=Date.now();b.battleLeft=b.battleLimit;}
  runTimer(()=>b.battleLeft,v=>b.battleLeft=v,left=>{
    const el=document.getElementById("battleClock");
    if(el){el.textContent=fmtDur(left);el.classList.toggle("urgent",left<=60);}
  },()=>failLevel("挑战时间耗尽，Pary 趁机溜走了。再接再厉！",b,true));
}
/* ---- 错题收尾：本关所有错题在关卡最后集中重做一遍（只重做一轮，答错就继续往后走） ---- */
function recordWrong(b,q,phase){
  if(!b.wrongAll)b.wrongAll=[];
  if(!b.wrongAll.some(x=>x.q===q.q)) b.wrongAll.push(q);
}
function showReturnLine(b,isStory,round){
  const n=(b.retryQueue||[]).length;
  const lines="“哼，别以为打倒我就结束了——我又回来了！你答错的题会在本关最后排队找你算账。”";
  stopLevelTimer();
  S.returnModalOpen=true;
  modal(`<div class="modal-head"><button class="modal-close">✕</button><h2 style="color:var(--purple)">👑 Pary：我又回来了</h2></div>
    <div class="modal-body"><div class="return-line">${esc(lines)}</div>
      <div class="notice info">本关错题 <b>${n}</b> 道，现在是错题收尾阶段：重新做一遍即可结算通关。挑战倒计时继续计算。</div>
      <div class="modal-actions"><button class="btn primary" id="returnGo">来吧，重做错题 →</button></div></div>`,true);
  const go=()=>{S.returnModalOpen=false;closeModal();startBattleClock(b,()=>{},true);};
  $("#returnGo").onclick=go;
  $(".modal-close").onclick=go;
}
function enterRetryOrWin(b,isStory,onWin,render){
  if(b.wrongAll&&b.wrongAll.length){
    b.retryQueue=shuffleQuestionSet(b.wrongAll.slice());
    b.retryIdx=0;b.phase="retry";b.answered=false;
    SFX.play("boss");AUDIO.playBoss();
    render();
    showReturnLine(b,isStory,1);
    return true;
  }
  onWin();return false;
}
function advanceRetry(b,isStory,onWin,render){
  b.retryIdx++;
  if(b.retryIdx<b.retryQueue.length){render();return;}
  // 错题只在最后统一重做一轮；重做时再错也不再加轮次，直接结算（分数按失误计算）
  onWin();
}
function failLevel(reason,b){
  stopLevelTimer();
  AUDIO.stopAll();
  SFX.play("hurt");
  const isStory=!!b.chapter;
  const back=()=>isStory?openStoryDirection(S.storyDir):openWordDirection(S.gameDir);
  modal(`<div class="modal-head"><button class="modal-close">✕</button><h2 style="color:var(--red)">💀 挑战失败</h2><p>${esc(reason)}</p></div>
    <div class="modal-body"><div class="notice">本关学习用时 ${fmtDur(((b.studyEnd||Date.now())-b.studyStart)/1000)} · 闯关用时 ${fmtDur(((b.battleEnd||Date.now())-(b.battleStart||Date.now()))/1000)} · 失误 ${b.mistakes||0} 次。<br>规则：倒计时内可随时提前开战或点「再看一遍」延长学习；若倒计时归零仍未开战、也没点「再看一遍」，则判负。挑战必须在限时内完成。</div>
      <div class="modal-actions"><button class="btn primary" id="lvRetry">重新挑战本关 →</button><button class="btn" id="lvBack">返回关卡地图</button></div></div>`,true);
  $(".modal-close").onclick=()=>{closeModal();back();};
  $("#lvBack").onclick=()=>{closeModal();back();};
  $("#lvRetry").onclick=()=>{closeModal();if(isStory)startStoryBattle(b.level);else startWordBattle(b.level);};
}
function pointsForScore(score){
  if(score>=96)return 20;
  if(score>=80)return 15;
  if(score>=60)return 8;
  return 0;
}
function pointsRuleText(score){
  if(score>=96)return "96 分及以上 → +20 积分";
  if(score>=80)return "80 分及以上 → +15 积分";
  if(score>=60)return "60 分及以上 → +8 积分";
  return "低于 60 分 → 不计分、不能通关";
}
async function awardPoints(delta){
  if(!S.user||!Number(delta))return 0;
  const uid=S.user.id;
  return withPointsLock(async()=>{
    for(let attempt=0;attempt<3;attempt++){
      try{
        // 先读云端最新值再累加，避免旧缓存覆盖已有积分
        const fresh=await cloud.database.from("app_users").select("id,points").eq("id",uid).maybeSingle();
        if(fresh.error) throw new Error(fresh.error.message||"读取积分失败");
        const base=Math.max(0,Number(fresh.data&&fresh.data.points)||0);
        const next=Math.max(0,base+Number(delta));
        const {error}=await cloud.database.from("app_users").update({points:next}).eq("id",uid);
        if(error) throw new Error(error.message||"保存积分失败");
        S.user.points=next;
        localStorage.setItem("ps_user",JSON.stringify(S.user));
        const cached=(S.users||[]).find(u=>u.username===S.user.username);
        if(cached)cached.points=next;
        renderUserBox();
        renderLeaderboard();
        return Number(delta);
      }catch(e){
        if(attempt===2){toast("积分保存失败："+(e.message||"未知错误")+"。请刷新页面后重试，本关积分未记录。",true);return 0;}
      }
    }
    return 0;
  });
}
function calcScore(b){
  const studyNeed=b.studyRequired||MIN_STUDY_SEC;
  const studyDone=Math.max(0,Math.round(((b.studyEnd||Date.now())-b.studyStart)/1000));
  const battleLimit=b.battleLimit||380;
  const battleDone=Math.max(0,Math.round(((b.battleEnd||Date.now())-b.battleStart)/1000));
  const mistakes=Math.max(0,b.mistakes||0);
  // 正确率占大头（60 分），学习时长与速度各 20 分：错误率高低必须直接反映到分数
  const studyPts=Math.min(20,Math.round(20*studyDone/studyNeed));
  const speedPts=Math.max(0,Math.round(20*(1-battleDone/battleLimit)));
  const accPts=Math.max(0,Math.round(60*(1-mistakes/8)));
  const raw=Math.max(0,Math.min(100,studyPts+speedPts+accPts));
  const accuracy=Math.max(0,Math.round(100*(1-mistakes/8)));
  const detail=`学习 ${fmtDur(studyDone)} / 要求 ${fmtDur(studyNeed)} → +${studyPts} 分<br>闯关 ${fmtDur(battleDone)} / 限时 ${fmtDur(battleLimit)} → +${speedPts} 分<br>正确率 ${accuracy}%（失误 ${mistakes} 次） → +${accPts} 分`;
  const isAdmin=S.user&&S.user.role==="admin";
  if(isAdmin){
    // 管理员仍有宽容保底（60 分起），但按 0.4 倍线性映射，错误率不同分数一定不同
    const score=Math.min(100,Math.round(68+raw*0.38));
    const grade=score>=90?"S":score>=80?"A":score>=70?"B":score>=60?"C":"D";
    return {score,grade,detail,comment:"管理员评分有保底加成，但正确率仍会真实影响分数与积分；本关正确率 "+accuracy+"%。"};
  }
  const grade=raw>=90?"S":raw>=80?"A":raw>=70?"B":raw>=60?"C":"D";
  const comment=grade==="S"?"教科书级别的操作，学习扎实、出手迅速。":grade==="A"?"表现优秀，继续保持认真研读的习惯。":grade==="B"?"基础不错，但学习时长或答题速度还有提升空间。":grade==="C"?"学习不够扎实，建议多用「再看一遍」并加快闯关节奏。":"知识点掌握不牢，请重新认真学习后再来挑战。";
  return {score:raw,grade,detail,comment};
}

/* ============================================================
   Paralir 的升级之路（故事剧情版）
   ============================================================ */
function renderStoryHome(main){
  let total=0,cleared=0,correct=0;
  STORY_DIRS.forEach(d=>{const p=S.storyProgress[d.key];if(p){cleared+=p.cleared;correct+=p.total_correct;}total+=d.levels.length;});
  main.innerHTML=`<div class="game-hero story-hero">
      <div style="display:flex;align-items:center;gap:16px">
        <div style="width:64px;height:64px;flex-shrink:0">${PARY_SVG}</div>
        <div><h1>Paralir 的升级之路</h1>
        <p>病毒 Pary 带着小弟「小 Rarys」侵占了讲义世界。被困的 Papa 居民把讲义知识点编成故事讲给你听——听完故事、答对问题，击败小 Rarys，最后挑战 Pary！</p></div></div>
      <div class="gh-stats"><div class="gh-stat"><b>${cleared}</b><span>已通关</span></div>
        <div class="gh-stat"><b>${total}</b><span>总关卡</span></div><div class="gh-stat"><b>${correct}</b><span>累计答对</span></div><div class="gh-stat"><b style="color:var(--amber)">${Number(S.user&&S.user.points)||0}</b><span>我的积分</span></div></div></div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">
      <div class="sec-title">选择讲义世界</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn sm" id="musicToggleS">🎵 音乐：${AUDIO.isMusicEnabled()?'开':'关'}</button>
        <button class="btn sm" id="sfxToggleS">🔊 音效：${SFX.enabled?'开':'关'}</button>
      </div></div>
    <div class="dir-grid" id="storyDirGrid"></div>
    <div class="sfx-note">📖 每关先研读 Papa 居民的知识故事（建议至少 5 分钟，按内容体量延长），倒计时只是建议时长，随时可点「出发」提前开战；也可点「再看一遍」延长学习。挑战限时，超时判负。学习区无背景音，仅按键有可爱音效。背景音乐（歌单/小怪/Boss/结算）和按键音效均可一键关闭，互不影响。累计答对 20 题点亮方向成就；答错不卡关，错题会在本关最后统一重做一遍。</div>`;
  $("#musicToggleS").onclick=()=>{AUDIO.toggleMusic();renderStoryHome(main);};
  $("#sfxToggleS").onclick=()=>{SFX.toggle();renderStoryHome(main);};
  $("#storyDirGrid").innerHTML=STORY_DIRS.map(d=>{
    const p=S.storyProgress[d.key]||{level:1,cleared:0,total_correct:0};
    const pct=Math.round(p.cleared/d.levels.length*100);
    return `<div class="dir-card" data-dir="${d.key}" style="--c:${d.color}"><div class="dc-icon">${d.icon}</div>
      <h3>${d.name}</h3><div class="dc-en">${d.en}</div><div class="dc-prog"><i style="width:${pct}%"></i></div>
      <div class="dc-meta"><span>已通关 ${p.cleared}/${d.levels.length}</span><span>答对 ${p.total_correct}</span></div></div>`;
  }).join("");
  $$("#storyDirGrid .dir-card").forEach(el=>el.onclick=()=>openStoryDirection(el.dataset.dir));
}
function openStoryDirection(key){
  S.storyDir=key;
  const d=STORY_DIRS.find(x=>x.key===key);
  const p=S.storyProgress[key]||{level:1,cleared:0,total_correct:0};
  const main=$("#main");
  main.innerHTML=`<div class="battle-top"><div class="crumb"><b style="cursor:pointer" id="sbBack">升级之路</b> / ${d.name}</div>
      <button class="btn sm" id="sfxToggleS2">🔊 音效${SFX.enabled?'开':'关'}</button></div>
    <div class="hero" style="background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px;margin-bottom:18px;border-left:3px solid ${d.color}">
      <div style="font-size:20px;font-weight:700">${d.name} · 故事关卡地图</div>
      <div class="hint" style="margin-top:5px">共 ${d.levels.length} 关 · 已通关 ${p.cleared} 关 · 累计答对 ${p.total_correct} 题（≥20 点亮通关成就）</div>
      <div class="notice info" style="margin-bottom:0">玩法：每关先静读 Papa 居民的知识故事（有建议倒计时，可随时提前开战或点「再看一遍」延长），再回答 4 只「小 Rarys」的问题，最后挑战 Boss Pary（答对 3 题击杀）。答错会继续下一题，错题统一留到本关最后重做一遍。</div></div>
    <div class="level-list" id="storyLevelList"></div>`;
  $("#sbBack").onclick=()=>renderStoryHome(main);
  $("#sfxToggleS2").onclick=()=>{SFX.toggle();openStoryDirection(key);};
  const ll=$("#storyLevelList");
  ll.innerHTML=d.levels.map(l=>{
    const isCleared=l.n<=p.cleared, isOpen=l.n===p.cleared+1, locked=l.n>p.cleared+1;
    const chips=lectureChipsHTML(l.lecture);
    return `<div class="level-node ${isCleared?'cleared':''} ${locked?'locked':''}" data-n="${l.n}" style="--c:${d.color}">
      ${isCleared?'<span class="ln-check">✓</span>':''}<div class="ln-num">LEVEL ${String(l.n).padStart(2,'0')}</div>
      <div class="ln-theme">${esc(l.theme)}</div>
      ${chips?`<div class="ln-lecture">${chips}</div>`:''}
      <div class="ln-status ${isCleared?'cleared':locked?'locked':'open'}">${isCleared?'已通关':locked?'未解锁':'可挑战 ▶'}</div></div>`;
  }).join("");
  bindLectureChips(ll);
  $$("#storyLevelList .level-node:not(.locked)").forEach(el=>el.onclick=()=>startStoryBattle(+el.dataset.n));
}
function startStoryBattle(n,keepMusic){
  stopLevelTimer();
  const d=STORY_DIRS.find(x=>x.key===S.storyDir);const lv=d.levels[n-1];
  const qs=prepareLevelQuestions(lv.monsters,lv.boss,true);
  battleEpoch++;
  S.storyBattle={level:n,phase:"story",idx:0,monsters:qs.monsters,boss:qs.boss,
    bossIdx:0,bossHp:3,mistakes:0,wrongMonsters:[],wrongAll:[],retryQueue:[],retryIdx:0,correctThisLevel:0,answered:false,
    theme:lv.theme,story:lv.story,npc:lv.npc,avatar:lv.avatar,knowledge:lv.knowledge,chapter:lv.chapter,lecture:lv.lecture,
    studyRequired:calcStudySec(lv.knowledge),studyLeft:0,studySpan:0,studyStart:null,studyEnd:null,
    studyReady:false,reviewed:false,battleLimit:calcBattleSec(lv),battleStart:null,battleEnd:null,battleLeft:0};
  S.storyBattle.studyLeft=S.storyBattle.studyRequired;
  if(keepMusic) AUDIO.resumeBgm(); else AUDIO.stopAll();   // 结算后切下一关保留音乐；正常进关学习区静音
  SFX.play("enter");drawStoryBattle();
  startStudyClock(S.storyBattle,()=>drawStoryBattle());
}
function drawStoryBattle(){
  const b=S.storyBattle,d=STORY_DIRS.find(x=>x.key===S.storyDir),main=$("#main");
  if(b.phase==="story"){ drawStoryIntro(b,d,main); return; }
  const isRetry=b.phase==="retry", isBoss=b.phase==="boss"||isRetry;
  const q=isRetry?b.retryQueue[b.retryIdx]:(isBoss?b.boss[b.bossIdx]:b.monsters[b.idx]);
  const totalM=b.monsters.length, totalR=(b.retryQueue||[]).length;
  const npcLine=isRetry?`“我又回来了！这次是你答错的题，别再让我失望。”`:isBoss?`“${esc(PARY_LINES[b.level%PARY_LINES.length])}”`:`“${esc(b.npc)}：${esc(q.q.split('』')[0].replace(/^[^：]*[：:]/,'').slice(0,60))}...”`;
  const phaseLabel=isRetry?`错题收尾 · 第 ${b.retryIdx+1} / ${totalR} 道`:isBoss?'BOSS 战 · 答对一题对 Pary 造成 1 点伤害':'故事问答 · 答对即可击败小 Rary';
  const hpLabel=isRetry?`↩️ 错题重做 ${Math.min(b.retryIdx+1,totalR)} / ${totalR}`:isBoss?'👑 Pary 病毒 BOSS':'👾 小 Rary '+Math.min(b.idx+1,totalM)+' / '+totalM;
  const hpText=isRetry?`错题进度 ${Math.min(b.retryIdx+1,totalR)} / ${totalR}`:isBoss?'PARY HP '+b.bossHp+' / 3':'剩余小 Rary '+(totalM-b.idx)+' / '+totalM;
  const hpWidth=isRetry?((totalR-b.retryIdx)/totalR*100):isBoss?(b.bossHp/3*100):((totalM-b.idx)/totalM*100);
  main.innerHTML=`<div class="battle-wrap">
    <div class="battle-top"><div class="crumb"><b id="sbBackLv">关卡地图</b> / ${d.name} / 第 ${b.level} 关</div>
      <div class="mistakes">失误 <span id="sMistDots"></span> <span style="font-family:var(--mono)">${b.mistakes}</span>
        <span class="battle-timer" title="挑战限时，超时判定失败">⏱ <b id="battleClock">${fmtDur(b.battleLeft||b.battleLimit)}</b></span></div></div>
    <div class="story-npc-bar">
      <div class="snpc-avatar">${isBoss?PARY_SVG:esc(b.avatar)}</div>
      <div class="snpc-text"><div class="snpc-name" style="color:${isBoss?'var(--purple)':'var(--accent)'}">${isRetry?'👑 Pary · 我又回来了':isBoss?'👑 Pary · 病毒 Boss':esc(b.npc)+' · Papa 居民'}</div>
        <div class="hint" style="margin-top:3px">${esc(npcLine)}</div></div></div>
    <div class="hp-panel"><div class="hp-row"><span>${hpLabel}</span><span class="dim" style="font-family:var(--mono)">${esc(b.theme)}</span></div>
      <div class="hp-bar"><div class="hp-fill ${isBoss?'boss':''}" style="width:${hpWidth}%"></div>
        <div class="hp-text">${hpText}</div></div></div>
    <div class="q-card"><div class="q-phase ${isBoss?'boss':''}">${phaseLabel}</div>
      <div class="q-text">${esc(q.q)}${qIpa(q.q)}</div><div class="opts" id="sOpts"></div><div class="feedback" id="sFb"></div>
      <div class="battle-foot"><span class="hint">知识点来源 · ${esc(q.src)}</span><button class="btn sm" id="sfxToggleS3">🔊 ${SFX.enabled?'开':'关'}</button></div></div></div>`;
  $("#sbBackLv").onclick=()=>{battleEpoch++;stopLevelTimer();openStoryDirection(S.storyDir);};
  $("#sfxToggleS3").onclick=()=>{SFX.toggle();drawStoryBattle();};
  $("#sMistDots").innerHTML=Array.from({length:5},(_,i)=>`<span class="mist-dot ${i<b.mistakes?'on':''}"></span>`).join("");
  const opts=$("#sOpts");
  q.options.forEach((o,i)=>{const btn=document.createElement("button");btn.className="opt";btn.innerHTML=`<span class="k">${"ABCD"[i]}</span><span>${esc(o)}</span>`;btn.onclick=()=>storyAnswer(i,q,btn);opts.appendChild(btn);});
}
function studyPanelHTML(b){
  return `<div class="study-clock ${b.studyReady?'ready':''}">
      <div class="sc-left"><span class="sc-label">📖 学习倒计时</span><b id="studyClock">${fmtDur(b.studyLeft)}</b>
        <span class="sc-sub">建议研读时长 · 随时可点「开始挑战」提前开战</span></div>
      <div class="sc-bar"><i id="studyBar" style="width:${b.studySpan?Math.max(0,b.studyLeft/b.studySpan*100):100}%"></i></div></div>`;
}
function drawStoryIntro(b,d,main){
  main.innerHTML=`<div class="battle-wrap"><div class="battle-top"><div class="crumb"><b id="sbIntroBack">关卡地图</b> / ${d.name} / 第 ${b.level} 关</div>
      <button class="btn sm" id="sfxToggleSI">🔊 ${SFX.enabled?'开':'关'}</button></div>
    <div class="story-intro">
      <div class="si-chapter">${esc(b.chapter)} · LEVEL ${String(b.level).padStart(2,'0')}</div>
      <div class="si-lecture">对应讲义章节：${lectureChipsHTML(b.lecture)}</div>
      <div class="si-head"><div class="snpc-avatar lg">${esc(b.avatar)}</div>
        <div><div class="snpc-name" style="color:var(--accent)">${esc(b.npc)} 的故事时间</div>
        <div class="si-theme">${esc(b.theme)}</div></div></div>
      <div class="si-story">${esc(b.story)}</div>
      <div class="si-know-title">📚 本关知识点精华</div>
      <div class="si-know">${b.knowledge.map(k=>`<div class="ki"><b>${esc(k[0])}</b>${ipaInline(k[0])}<span>${esc(k[1])}</span></div>`).join("")}</div>
      ${studyPanelHTML(b)}
      <div class="notice info">知识点无配音，请静心阅读。学习倒计时按知识点体量设定（至少 5 分钟），只是建议时长——你可以随时点「出发」提前开战；想多研读一会儿可点「再看一遍」重置 5/10 分钟倒计时。但若倒计时归零仍未开战、也没点「再看一遍」，则判定未认真准备、挑战失败。学习区不播放背景音，按键可爱音效可在右上角关闭。</div>
      <div class="modal-actions review-actions">
        <button class="btn primary" id="siGo">出发打小 Rary →（可提前）</button>
        <button class="btn" id="siReplay5">再看一遍（5 分钟）</button>
        <button class="btn" id="siReplay10">再看一遍（10 分钟）</button></div></div></div>`;
  $("#sbIntroBack").onclick=()=>{stopLevelTimer();openStoryDirection(S.storyDir);};
  bindLectureChips(main);
  $("#sfxToggleSI").onclick=()=>{SFX.toggle();const t=$("#sfxToggleSI");if(t)t.textContent="🔊 "+(SFX.enabled?'开':'关');};
  $("#siReplay5").onclick=()=>reviewAgain(b,REPLAY_5,()=>drawStoryBattle());
  $("#siReplay10").onclick=()=>reviewAgain(b,REPLAY_10,()=>drawStoryBattle());
  $("#siGo").onclick=()=>{
    if(!b.studyEnd)b.studyEnd=Date.now();   // 提前开战也记录实际学习用时，供评分参考
    stopLevelTimer();b.phase="monster";SFX.play("enter");AUDIO.playMonster();drawStoryBattle();
    startBattleClock(b,()=>drawStoryBattle());
  };
}
function storyAnswer(i,q,btn){
  const b=S.storyBattle;if(b.answered)return;b.answered=true;
  const correct=i===q.answer,fb=$("#sFb");
  $$("#sOpts .opt").forEach((el,idx)=>{el.disabled=true;if(idx===q.answer)el.classList.add("correct");});
  if(correct){
    btn.classList.add("correct");SFX.play("hit");fb.className="feedback ok show";
    fb.innerHTML=(b.phase==="retry"?"✓ 错题攻克！Pary 的算盘落空了。":"✓ 答对了！小 Rary 被击退。")+(q.explain?`<br><span style="opacity:.8">${esc(q.explain)}</span>`:"");
    b.correctThisLevel++;const ep=battleEpoch;setTimeout(()=>{if(battleEpoch===ep)storyNext(true);},1000);
  }else{
    btn.classList.add("wrong");SFX.play("hurt");b.mistakes++;fb.className="feedback no show";
    fb.innerHTML="✗ 答错了。正确答案是 "+("ABCD"[q.answer])+"。"+(q.explain?`<br><span style="opacity:.8">${esc(q.explain)}</span>`:"")+"<br><span style='opacity:.7'>这道题留到本关最后统一重做一次，先继续下一题。</span>";
    recordWrong(b,q,b.phase);
    if(b.phase==="monster"&&!b.wrongMonsters.includes(q))b.wrongMonsters.push(q);
    // 答错不卡在原地进行：直接进入下一题，错题统一留到关卡最后处理
    const ep=battleEpoch;setTimeout(()=>{if(battleEpoch===ep)storyNext(false);},1400);
  }
}
function storyNext(correct){
  const b=S.storyBattle;b.answered=false;
  if(b.phase==="retry"){advanceRetry(b,true,()=>storyWinLevel(),()=>drawStoryBattle());return;}
  if(b.phase==="monster"){b.idx++;if(b.idx>=b.monsters.length){b.phase="boss";SFX.play("boss");AUDIO.playBoss();}drawStoryBattle();}
  else{
    b.bossIdx++;
    if(correct) b.bossHp--;                     // 只有答对才扣 Boss 血量
    if(b.bossHp<=0){enterRetryOrWin(b,true,()=>storyWinLevel(),()=>drawStoryBattle());return;}
    if(b.bossIdx>=b.boss.length) b.bossIdx=0;   // Boss 题用完仍未击杀：循环出题，直到答对 3 题或超时
    drawStoryBattle();
  }
}
async function storyWinLevel(){
  stopLevelTimer();
  const b=S.storyBattle,d=STORY_DIRS.find(x=>x.key===S.storyDir);
  b.battleEnd=Date.now();
  const sc=calcScore(b);
  if(sc.score<60){failLevel(`本次得分 ${sc.score} 分，低于 60 分不能通关，也不获得积分。请重新挑战。`,b);return;}
  SFX.play("levelup");AUDIO.settleThenResume();
  const gained=await awardPoints(pointsForScore(sc.score));
  const p=S.storyProgress[S.storyDir]||{level:1,cleared:0,total_correct:0};
  p.cleared=Math.max(p.cleared,b.level);p.level=Math.min(b.level+1,d.levels.length);p.total_correct+=b.correctThisLevel;
  p.best_score=Math.max(p.best_score||0,sc.score);
  S.storyProgress[S.storyDir]=p;await saveProgress("story",S.storyDir);
  const achieved=p.total_correct>=20;
  modal(`<div class="modal-head"><button class="modal-close">✕</button><h2 style="color:var(--green)">🎉 击败 Pary！关卡 ${b.level} 通关</h2><p>${esc(b.theme)}</p></div>
    <div class="modal-body">
      <div class="score-box"><div class="score-grade grade-${sc.grade}">${sc.grade}</div><div class="score-num"><b>${sc.score}</b><span>分</span></div>
        <div class="score-detail">${sc.detail}</div></div>
      <div class="notice">${esc(sc.comment)}</div>
      <div class="notice" style="border-left-color:#fbbf24;color:#fde68a;background:rgba(251,191,36,.08)">🏅 升级之路积分：本次 <b>+${gained}</b> · 当前总积分 <b>${Number(S.user.points)||0}</b><br><span style="opacity:.8;font-size:12px">积分规则：${pointsRuleText(sc.score)}</span></div>
      ${gained>0?'': '<div class="notice" style="border-left-color:var(--red);color:#fca5a5;background:rgba(248,113,113,.08)">⚠ 本次积分未能写入云端，请刷新页面查看；若仍为 0 请联系管理员。</div>'}
      <div class="notice info">本关答对 ${b.correctThisLevel} 题 · 方向累计答对 ${p.total_correct} 题 · 已通关 ${p.cleared}/${d.levels.length} 关</div>
      ${achieved?'<div class="notice" style="border-left-color:var(--green);color:#bbf7d0;background:rgba(74,222,128,.08)">🏆 你已累计答对超过 20 题，达成 <b>'+d.name+'</b> 方向通关成就！</div>':`<div class="hint">再答对 ${20-p.total_correct} 题即可点亮本方向通关成就。</div>`}
      <div class="modal-actions"><button class="btn primary" id="swNext">${b.level<d.levels.length?'挑战下一关 →':'返回地图'}</button><button class="btn" id="swMap">返回关卡地图</button></div></div>`);
  $(".modal-close").onclick=()=>{closeModal();openStoryDirection(S.storyDir);};
  $("#swMap").onclick=()=>{closeModal();openStoryDirection(S.storyDir);};
  $("#swNext").onclick=()=>{closeModal();if(b.level<d.levels.length)startStoryBattle(b.level+1,true);else {AUDIO.resumeBgm();openStoryDirection(S.storyDir);}};
}

/* ============================================================
   我是单词（原单词题 + 组队模式）
   ============================================================ */
function renderWordHome(main){
  let total=0,cleared=0,correct=0;
  WORD_DIRS.forEach(d=>{const p=S.progress[d.key];if(p){cleared+=p.cleared;correct+=p.total_correct;}total+=d.levels.length;});
  const teamHtml=S.team?`<div class="team-panel"><div class="tp-head"><span>🛡️ 当前队伍：${esc(S.team.name)}</span><button class="btn sm" id="leaveTeam">离队</button></div>
      <div class="tp-members">${(()=>{let m=[];try{m=JSON.parse(S.team.members||"[]");}catch(e){}return m.map(u=>`<span class="tp-member">${esc(nickOf(u))}${u===S.team.leader?' 👑':''}</span>`).join("");})()}</div>
      <div class="tp-invite"><button class="btn sm" id="teamInvite">＋ 邀请好友组队</button><span class="hint">队伍上限 ${S.team.max_size} 人（管理员可配置）</span></div></div>`:
    `<div class="team-panel empty-team"><div>🛡️ 还没有队伍——组队闯关更有趣！组队人数由管理员后台控制。</div>
      <div class="modal-actions" style="margin-top:10px"><button class="btn primary" id="createTeam">创建队伍</button><button class="btn" id="joinTeamBtn">加入队伍</button></div></div>`;
  main.innerHTML=`<div class="game-hero word-hero"><div class="gh-icon">🔤</div>
      <div><h1>我是单词</h1><p>围绕讲义英文术语的挑战题 · 支持组队模式，和伙伴一起闯关刷分。</p></div>
      <div class="gh-stats"><div class="gh-stat"><b>${cleared}</b><span>已通关</span></div>
        <div class="gh-stat"><b>${total}</b><span>总关卡</span></div><div class="gh-stat"><b>${correct}</b><span>累计答对</span></div><div class="gh-stat"><b style="color:var(--amber)">${Number(S.user&&S.user.points)||0}</b><span>我的积分</span></div></div></div>
    ${S.user?teamHtml:'<div class="notice info">登录后可使用组队模式。</div>'}
    <div style="display:flex;justify-content:space-between;align-items:center;margin:18px 0 14px;flex-wrap:wrap;gap:10px">
      <div class="sec-title" style="margin:0">选择训练方向</div>
      <button class="btn sm" id="musicToggleW">🎵 音乐：${AUDIO.isMusicEnabled()?'开':'关'}</button></div>
    <div class="dir-grid" id="wordDirGrid"></div>
    <div class="sfx-note">📖 四级 ${VOCAB.cet4.length} 词 / 六级 ${VOCAB.cet6.length} 词 / 考研网安 ${VOCAB.kaoyan.length} 词，全部带英美音标、无需声音。考试方向每次挑战随机抽题，重复挑战可覆盖全部词汇。每关先预习核心词条（建议至少 5 分钟），倒计时只是建议时长、随时可提前开始挑战，也可点「再看一遍」延长；挑战限时，超时判负。学习区无背景音，仅按键有可爱音效。背景音乐和按键音效均可一键关闭，互不影响。累计答对 20 题点亮方向成就；答错不卡关，错题会在本关最后统一重做一遍。</div>`;
  const _mtw=$("#musicToggleW"); if(_mtw) _mtw.onclick=()=>{AUDIO.toggleMusic();renderWordHome(main);};
  if(S.user){
    if(S.team){
      $("#leaveTeam").onclick=leaveTeam;
      $("#teamInvite").onclick=()=>showInvite("word",String(S.team.id),"邀请你加入单词队伍「"+S.team.name+"」",null);
    }else{$("#createTeam").onclick=showCreateTeam;$("#joinTeamBtn").onclick=showJoinTeam;}
  }
  $("#wordDirGrid").innerHTML=WORD_DIRS.map(d=>{
    const p=S.progress[d.key]||{level:1,cleared:0,total_correct:0};const pct=Math.round(p.cleared/d.levels.length*100);
    return `<div class="dir-card" data-dir="${d.key}" style="--c:${d.color}"><div class="dc-icon">${d.icon}</div>
      <h3>${d.name}</h3><div class="dc-en">${d.en}</div><div class="dc-prog"><i style="width:${pct}%"></i></div>
      <div class="dc-meta"><span>${d.wordTotal?`词库 ${d.wordTotal} 词`:`已通关 ${p.cleared}/${d.levels.length}`}</span><span>答对 ${p.total_correct}</span></div></div>`;
  }).join("");
  $$("#wordDirGrid .dir-card").forEach(el=>el.onclick=()=>openWordDirection(el.dataset.dir));
}
async function loadMyTeam(){const{data}=await cloud.database.from("teams").select("*").eq("status","open");const t=(data||[]).find(x=>{try{return JSON.parse(x.members||"[]").includes(S.user.username);}catch(e){return false;}});S.team=t||null;}
function showCreateTeam(){
  modal(`<div class="modal-head"><button class="modal-close">✕</button><h2>创建队伍</h2><p>上限 ${S.teamMax} 人</p></div>
    <div class="modal-body"><div class="field"><label>队伍名称</label><input id="tName" placeholder="给队伍起个名字"></div>
    <div class="modal-actions"><button class="btn primary" id="doCreateT">创建</button></div></div>`,true);
  $(".modal-close").onclick=closeModal;
  $("#doCreateT").onclick=async()=>{
    const name=$("#tName").value.trim();if(!name){toast("请输入队名",true);return;}
    const{error}=await cloud.database.from("teams").insert({name,leader:S.user.username,game:"word",members:JSON.stringify([S.user.username]),max_size:S.teamMax,status:"open"});
    if(error){toast("创建失败",true);return;}
    closeModal();await loadMyTeam();renderWordHome($("#main"));toast("队伍已创建");
  };
}
async function showJoinTeam(){
  const{data}=await cloud.database.from("teams").select("*").eq("status","open").eq("game","word");
  const list=(data||[]).filter(t=>{let m=[];try{m=JSON.parse(t.members||"[]");}catch(e){}return m.length<t.max_size&&!m.includes(S.user.username);});
  modal(`<div class="modal-head"><button class="modal-close">✕</button><h2>加入队伍</h2></div>
    <div class="modal-body"><div class="invite-list">${list.map(t=>`<div class="team-opt"><div><b>${esc(t.name)}</b> <span class="hint">队长 ${esc(nickOf(t.leader))}</span></div>
      <button class="btn sm primary" data-jt="${t.id}">加入</button></div>`).join("")||'<div class="cs-hint">暂无可加入的队伍</div>'}</div></div>`);
  $(".modal-close").onclick=closeModal;
  $$("[data-jt]").forEach(b=>b.onclick=()=>{closeModal();joinTeam(+b.dataset.jt);});
}
async function joinTeam(id,fromLeader){
  const{data:t}=await cloud.database.from("teams").select("*").eq("id",id).maybeSingle();if(!t){toast("队伍不存在",true);return;}
  let m=[];try{m=JSON.parse(t.members||"[]");}catch(e){}
  if(m.includes(S.user.username)){toast("你已在队伍中");return;}
  if(m.length>=t.max_size){toast("队伍已满",true);return;}
  m.push(S.user.username);
  await cloud.database.from("teams").update({members:JSON.stringify(m)}).eq("id",id);
  if(fromLeader) await cloud.database.from("invitations").update({status:"accepted"}).eq("invitee",S.user.username).eq("inviter",fromLeader).eq("type","word").catch(()=>{});
  await loadMyTeam();if(S.page==="game")renderWordHome($("#main"));toast("已加入队伍");
}
async function leaveTeam(){
  if(!S.team)return;let m=[];try{m=JSON.parse(S.team.members||"[]");}catch(e){}
  m=m.filter(u=>u!==S.user.username);
  if(m.length===0){await cloud.database.from("teams").update({status:"closed"}).eq("id",S.team.id);}
  else await cloud.database.from("teams").update({members:JSON.stringify(m),leader:m[0]}).eq("id",S.team.id);
  S.team=null;renderWordHome($("#main"));toast("已离队");
}
function openWordDirection(key){
  S.gameDir=key;const d=WORD_DIRS.find(x=>x.key===key);const p=S.progress[key]||{level:1,cleared:0,total_correct:0};const main=$("#main");
  main.innerHTML=`<div class="battle-top"><div class="crumb"><b id="wbBack">我是单词</b> / ${d.name}</div><button class="btn sm" id="sfxToggleW">🔊 音效${SFX.enabled?'开':'关'}</button></div>
    <div class="hero" style="background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px;margin-bottom:18px;border-left:3px solid ${d.color}">
      <div style="font-size:20px;font-weight:700">${d.name} · 关卡地图</div>
      <div class="hint" style="margin-top:5px">共 ${d.levels.length} 关${d.wordTotal?` · 词库 ${d.wordTotal} 词`:''} · 已通关 ${p.cleared} 关 · 累计答对 ${p.total_correct} 题</div>
      <div class="notice info" style="margin-bottom:0">每关先预习核心词条（有建议倒计时，可随时提前开始挑战或点「再看一遍」延长），再答 4 道知识点题，最后挑战 Boss（答对 3 题）。${d.wordTotal?'考试方向每次挑战从本关词库随机抽题，重复挑战可覆盖全部词汇。':''}答错会继续下一题，错题统一留到本关最后重做一遍。</div></div>
    <div class="level-list" id="wordLevelList"></div>`;
  $("#wbBack").onclick=()=>renderWordHome(main);$("#sfxToggleW").onclick=()=>{SFX.toggle();openWordDirection(key);};
  const ll=$("#wordLevelList");
  ll.innerHTML=d.levels.map(l=>{const isCleared=l.n<=p.cleared,isOpen=l.n===p.cleared+1,locked=l.n>p.cleared+1;
    return `<div class="level-node ${isCleared?'cleared':''} ${locked?'locked':''}" data-n="${l.n}" style="--c:${d.color}">
      ${isCleared?'<span class="ln-check">✓</span>':''}<div class="ln-num">LEVEL ${String(l.n).padStart(2,'0')}</div>
      <div class="ln-theme">${esc(l.theme)}</div>
      ${l.pool?`<div class="ln-words">📖 ${l.pool.length} 词 · 每次随机抽题</div>`:''}
      <div class="ln-status ${isCleared?'cleared':locked?'locked':'open'}">${isCleared?'已通关':locked?'未解锁':'可挑战 ▶'}</div></div>`;}).join("");
  $$("#wordLevelList .level-node:not(.locked)").forEach(el=>el.onclick=()=>startWordBattle(+el.dataset.n));
}
function startWordBattle(n,keepMusic){
  stopLevelTimer();
  const d=WORD_DIRS.find(x=>x.key===S.gameDir),lv=d.levels[n-1];
  let monsters, boss, knowledge;
  S.studyTestedWords=new Set();
  if(lv.pool&&lv.pool.length>=7){
    // 先搜集约 30 词作为学习池，题目与干扰项全部出自该池，保证预习与考题完全一致、词性与标题一致
    const studyPool=buildStudyPool(lv,lv.theme);
    const gen=poolQuestions(studyPool,d.name,lv.theme);
    const qs=prepareLevelQuestions(gen.monsters,gen.boss,false);monsters=qs.monsters;boss=qs.boss;
    knowledge=gen.study;
    S.studyTestedWords=gen.tested;
  }else{
    const qs=prepareLevelQuestions(lv.monsters,lv.boss,false);monsters=qs.monsters;boss=qs.boss;
    const seenK=new Set();
    knowledge=(lv.monsters||[]).concat(lv.boss||[]).map(m=>{
      const k=m.src||d.name;if(seenK.has(k))return null;seenK.add(k);
      return [k,m.explain||m.q];
    }).filter(Boolean);
  }
  battleEpoch++;
  S.battle={level:n,phase:"study",idx:0,monsters,boss,bossIdx:0,bossHp:3,
    mistakes:0,wrongMonsters:[],wrongAll:[],retryQueue:[],retryIdx:0,correctThisLevel:0,answered:false,theme:lv.theme,knowledge,dirName:d.name,
    studyRequired:calcStudySec(knowledge),studyLeft:0,studySpan:0,studyStart:null,studyEnd:null,
    studyReady:false,reviewed:false,battleLimit:calcBattleSec(lv),battleStart:null,battleEnd:null,battleLeft:0};
  S.battle.studyLeft=S.battle.studyRequired;
  if(keepMusic) AUDIO.resumeBgm(); else AUDIO.stopAll();   // 结算后切下一关保留音乐；正常进关学习区静音
  SFX.play("enter");drawWordBattle();
  startStudyClock(S.battle,()=>drawWordBattle());
}
function drawWordStudy(b){
  const main=$("#main");
  main.innerHTML=`<div class="battle-wrap"><div class="battle-top"><div class="crumb"><b id="wbIntroBack">关卡地图</b> / ${esc(b.dirName)} / 第 ${b.level} 关</div>
      <button class="btn sm" id="sfxToggleWS">🔊 ${SFX.enabled?'开':'关'}</button></div>
    <div class="story-intro">
      <div class="si-chapter">${esc(b.dirName)} · LEVEL ${String(b.level).padStart(2,'0')}</div>
      <div class="si-head"><div class="snpc-avatar lg">🔤</div>
        <div><div class="snpc-name" style="color:var(--accent)">本关词汇预习</div><div class="si-theme">${esc(b.theme)}</div></div></div>
      <div class="si-story">在进入挑战前，请认真研读本关的核心术语与释义。学习时间按词条内容体量设定，至少 5 分钟。</div>
      ${INTEL_NOTICE}
      <div class="si-know-title">📚 本关核心词条（从本关词库搜集约 ${b.knowledge.length} 个${S.studyTestedWords.size?`，其中 <b style="color:var(--amber)">★</b> 标记的 ${S.studyTestedWords.size} 个是本次考题词`:""}，小怪与 Boss 题目全部出自本清单）</div>
      <div class="si-know">${b.knowledge.map(k=>`<div class="ki${S.studyTestedWords.has(k[0])?' tested':''}">${S.studyTestedWords.has(k[0])?'<span class="ki-star">★</span>':''}<b>${esc(k[0])}</b>${ipaInline(k[0])}<span>${esc(k[1])}</span></div>`).join("")}</div>
      ${studyPanelHTML(b)}
      <div class="notice info">学习倒计时（至少 5 分钟）只是建议时长——你可以随时点「开始挑战」提前开战；想多研读一会儿可点「再看一遍」重置 5/10 分钟倒计时。但若倒计时归零仍未开战、也没点「再看一遍」，则判定未认真准备、挑战失败。学习区不播放背景音，按键可爱音效可在右上角关闭。</div>
      <div class="modal-actions review-actions">
        <button class="btn primary" id="wiGo">开始挑战 →（可提前）</button>
        <button class="btn" id="wiReplay5">再看一遍（5 分钟）</button>
        <button class="btn" id="wiReplay10">再看一遍（10 分钟）</button></div></div></div>`;
  $("#wbIntroBack").onclick=()=>{stopLevelTimer();openWordDirection(S.gameDir);};
  $("#sfxToggleWS").onclick=()=>{SFX.toggle();const t=$("#sfxToggleWS");if(t)t.textContent="🔊 "+(SFX.enabled?'开':'关');};
  $("#wiReplay5").onclick=()=>reviewAgain(b,REPLAY_5,()=>drawWordBattle());
  $("#wiReplay10").onclick=()=>reviewAgain(b,REPLAY_10,()=>drawWordBattle());
  $("#wiGo").onclick=()=>{
    if(!b.studyEnd)b.studyEnd=Date.now();   // 提前开战也记录实际学习用时，供评分参考
    stopLevelTimer();b.phase="monster";SFX.play("enter");AUDIO.playMonster();drawWordBattle();
    startBattleClock(b,()=>drawWordBattle());
  };
}
function drawWordBattle(){
  const b=S.battle,d=WORD_DIRS.find(x=>x.key===S.gameDir),main=$("#main");
  if(b.phase==="study"){drawWordStudy(b);return;}
  const isRetry=b.phase==="retry", isBoss=b.phase==="boss"||isRetry;
  const q=isRetry?b.retryQueue[b.retryIdx]:(isBoss?b.boss[b.bossIdx]:b.monsters[b.idx]);
  const totalM=b.monsters.length, totalR=(b.retryQueue||[]).length;
  const line=isRetry?"我又回来了！这些是你错过的题，再答一次。":PARY_LINES[b.level%PARY_LINES.length];
  const hpLabel=isRetry?`↩️ 错题重做 ${Math.min(b.retryIdx+1,totalR)} / ${totalR}`:isBoss?'👑 Pary 病毒 BOSS':'📝 知识点小怪 '+Math.min(b.idx+1,totalM)+' / '+totalM;
  const hpText=isRetry?`错题进度 ${b.retryIdx} / ${totalR}`:isBoss?'PARY HP '+b.bossHp+' / 3':'剩余小怪 '+(totalM-b.idx)+' / '+totalM;
  const hpWidth=isRetry?((totalR-b.retryIdx)/totalR*100):isBoss?(b.bossHp/3*100):((totalM-b.idx)/totalM*100);
  const phaseLabel=isRetry?`错题收尾 · 第 ${b.retryIdx+1} / ${totalR} 道`:isBoss?'BOSS 战 · 答对一题造成 1 点伤害':'小怪战 · 答对即可通过';
  main.innerHTML=`<div class="battle-wrap"><div class="battle-top"><div class="crumb"><b id="wbBackLv">关卡地图</b> / ${d.name} / 第 ${b.level} 关</div>
      <div class="mistakes">失误 <span id="wMistDots"></span> <span style="font-family:var(--mono)">${b.mistakes}</span>
        <span class="battle-timer" title="挑战限时，超时判定失败">⏱ <b id="battleClock">${fmtDur(b.battleLeft||b.battleLimit)}</b></span></div></div>
    ${isBoss?`<div style="display:flex;align-items:center;gap:16px;background:linear-gradient(100deg,rgba(110,231,183,.12),transparent);border:1px solid var(--line);border-radius:14px;padding:14px 18px;margin-bottom:16px">
      <div style="width:72px;height:72px;flex-shrink:0">${PARY_SVG}</div><div><div style="font-size:18px;font-weight:700;color:var(--purple)">${isRetry?'👑 Pary · 我又回来了':'👑 Pary · 病毒 Boss'}</div>
      <div class="hint" style="margin-top:4px">“${esc(line)}”</div></div></div>`:''}
    <div class="hp-panel"><div class="hp-row"><span>${hpLabel}</span><span class="dim" style="font-family:var(--mono)">${esc(b.theme)}</span></div>
      <div class="hp-bar"><div class="hp-fill ${isBoss?'boss':''}" style="width:${hpWidth}%"></div>
        <div class="hp-text">${hpText}</div></div></div>
    <div class="q-card"><div class="q-phase ${isBoss?'boss':''}">${phaseLabel}</div>
      <div class="q-text">${esc(q.q)}${qIpa(q.q)}</div><div class="opts" id="wOpts"></div><div class="feedback" id="wFb"></div>
      <div class="battle-foot"><span class="hint">题目来源讲义 · ${esc(q.src)}</span><button class="btn sm" id="sfxToggleW3">🔊 ${SFX.enabled?'开':'关'}</button></div>
      <span class="intel-inline">群众之中有坏人，释义与考题若有出入，以现场判定为准（错的记在 Pary 账上）。</span></div></div>`;
  $("#wbBackLv").onclick=()=>{battleEpoch++;stopLevelTimer();openWordDirection(S.gameDir);};$("#sfxToggleW3").onclick=()=>{SFX.toggle();drawWordBattle();};
  $("#wMistDots").innerHTML=Array.from({length:5},(_,i)=>`<span class="mist-dot ${i<b.mistakes?'on':''}"></span>`).join("");
  const opts=$("#wOpts");q.options.forEach((o,i)=>{const btn=document.createElement("button");btn.className="opt";btn.innerHTML=`<span class="k">${"ABCD"[i]}</span><span>${esc(o)}</span>`;btn.onclick=()=>wordAnswer(i,q,btn);opts.appendChild(btn);});
}
function wordAnswer(i,q,btn){
  const b=S.battle;if(b.answered)return;b.answered=true;const correct=i===q.answer,fb=$("#wFb");
  $$("#wOpts .opt").forEach((el,idx)=>{el.disabled=true;if(idx===q.answer)el.classList.add("correct");});
  if(correct){btn.classList.add("correct");SFX.play("hit");fb.className="feedback ok show";fb.innerHTML=(b.phase==="retry"?"✓ 错题攻克！Pary 又被击退一次。":"✓ 回答正确！")+(q.explain?`<br><span style="opacity:.8">${esc(q.explain)}</span>`:"");b.correctThisLevel++;const ep=battleEpoch;setTimeout(()=>{if(battleEpoch===ep)wordNext(true);},1000);}
  else{btn.classList.add("wrong");SFX.play("hurt");b.mistakes++;fb.className="feedback no show";fb.innerHTML="✗ 回答错误。正确答案 "+("ABCD"[q.answer])+"。"+(q.explain?`<br><span style="opacity:.8">${esc(q.explain)}</span>`:"")+"<br><span style='opacity:.7'>这道题留到本关最后统一重做一次，先继续下一题。</span>";
    recordWrong(b,q,b.phase);
    if(b.phase==="monster"&&!b.wrongMonsters.includes(q))b.wrongMonsters.push(q);
    // 答错不卡在原地进行：直接进入下一题，错题统一留到关卡最后处理
    const ep=battleEpoch;setTimeout(()=>{if(battleEpoch===ep)wordNext(false);},1400);
  }
}
function wordNext(correct){const b=S.battle;b.answered=false;
  if(b.phase==="retry"){advanceRetry(b,false,()=>wordWinLevel(),()=>drawWordBattle());return;}
  if(b.phase==="monster"){b.idx++;if(b.idx>=b.monsters.length){b.phase="boss";SFX.play("boss");AUDIO.playBoss();}drawWordBattle();}
  else{
    b.bossIdx++;
    if(correct) b.bossHp--;                     // 只有答对才扣 Boss 血量
    if(b.bossHp<=0){enterRetryOrWin(b,false,()=>wordWinLevel(),()=>drawWordBattle());return;}
    if(b.bossIdx>=b.boss.length) b.bossIdx=0;   // Boss 题用完仍未击杀：循环出题
    drawWordBattle();
  }}
async function wordWinLevel(){
  stopLevelTimer();
  const b=S.battle,d=WORD_DIRS.find(x=>x.key===S.gameDir);b.battleEnd=Date.now();
  const sc=calcScore(b);
  if(sc.score<60){failLevel(`本次得分 ${sc.score} 分，低于 60 分不能通关，也不获得积分。请重新挑战。`,b);return;}
  SFX.play("levelup");AUDIO.settleThenResume();
  const gained=await awardPoints(pointsForScore(sc.score));
  const p=S.progress[S.gameDir]||{level:1,cleared:0,total_correct:0};
  p.cleared=Math.max(p.cleared,b.level);p.level=Math.min(b.level+1,d.levels.length);p.total_correct+=b.correctThisLevel;
  p.best_score=Math.max(p.best_score||0,sc.score);
  S.progress[S.gameDir]=p;await saveProgress("word",S.gameDir);
  const achieved=p.total_correct>=20;
  modal(`<div class="modal-head"><button class="modal-close">✕</button><h2 style="color:var(--green)">🎉 关卡 ${b.level} 通关！</h2><p>${esc(b.theme)}</p></div>
    <div class="modal-body">
      <div class="score-box"><div class="score-grade grade-${sc.grade}">${sc.grade}</div><div class="score-num"><b>${sc.score}</b><span>分</span></div>
        <div class="score-detail">${sc.detail}</div></div>
      <div class="notice">${esc(sc.comment)}</div>
      <div class="notice" style="border-left-color:#fbbf24;color:#fde68a;background:rgba(251,191,36,.08)">🏅 我是单词积分：本次 <b>+${gained}</b> · 当前总积分 <b>${Number(S.user.points)||0}</b><br><span style="opacity:.8;font-size:12px">积分规则：${pointsRuleText(sc.score)}</span></div>
      ${gained>0?'': '<div class="notice" style="border-left-color:var(--red);color:#fca5a5;background:rgba(248,113,113,.08)">⚠ 本次积分未能写入云端，请刷新页面查看；若仍为 0 请联系管理员。</div>'}
      <div class="notice info">本关答对 ${b.correctThisLevel} 题 · 方向累计 ${p.total_correct} 题 · 已通关 ${p.cleared}/${d.levels.length} 关</div>
      ${achieved?'<div class="notice" style="border-left-color:var(--green);color:#bbf7d0">🏆 达成 <b>'+d.name+'</b> 方向通关成就！</div>':`<div class="hint">再答对 ${20-p.total_correct} 题点亮成就。</div>`}
      <div class="modal-actions"><button class="btn primary" id="wwNext">${b.level<d.levels.length?'挑战下一关 →':'返回地图'}</button><button class="btn" id="wwMap">返回关卡地图</button></div></div>`);
  $(".modal-close").onclick=()=>{closeModal();openWordDirection(S.gameDir);};
  $("#wwMap").onclick=()=>{closeModal();openWordDirection(S.gameDir);};
  $("#wwNext").onclick=()=>{closeModal();if(b.level<d.levels.length)startWordBattle(b.level+1,true);else {AUDIO.resumeBgm();openWordDirection(S.gameDir);}};
}

/* ============================================================
   个人中心（含生日 50 年一改）
   ============================================================ */
const BIRTHDAY_YEARS = 50;
function birthdayStatus(u){
  if(!u.birthday) return {can:true,reason:"首次设置生日"};
  const anchor = u.birthday_changed_at || u.created_at;
  if(!anchor) return {can:true,reason:"可设置"};
  const next = new Date(anchor); next.setFullYear(next.getFullYear()+BIRTHDAY_YEARS);
  const can = Date.now() >= next.getTime();
  return {can,next,reason:can?"可以修改":"生日每 "+BIRTHDAY_YEARS+" 年仅可修改一次"};
}
// 年月日三个下拉框：绕开部分国产浏览器 input[type=date] 点不动/日历不弹的兼容问题
const BDAY_Y0=1930;
function bdayParts(val){
  const m=String(val||"").match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return m?{y:+m[1],m:+m[2],d:+m[3]}:{y:0,m:0,d:0};
}
function bdaySelects(idPrefix,val,disabled){
  const p=bdayParts(val),now=new Date(),Y0=BDAY_Y0,Y1=now.getFullYear(),dis=disabled?"disabled":"";
  let ys='<option value="0">年</option>';for(let y=Y1;y>=Y0;y--)ys+=`<option value="${y}" ${p.y===y?'selected':''}>${y}</option>`;
  let ms='<option value="0">月</option>';for(let m=1;m<=12;m++)ms+=`<option value="${m}" ${p.m===m?'selected':''}>${m}</option>`;
  let ds='<option value="0">日</option>';
  const maxD=(p.y&&p.m)?new Date(p.y,p.m,0).getDate():31;
  for(let d=1;d<=maxD;d++)ds+=`<option value="${d}" ${p.d===d?'selected':''}>${d}</option>`;
  return `<div class="bday-selects" id="${idPrefix}">
    <select id="${idPrefix}-y" ${dis} aria-label="年">${ys}</select>
    <select id="${idPrefix}-m" ${dis} aria-label="月">${ms}</select>
    <select id="${idPrefix}-d" ${dis} aria-label="日">${ds}</select></div>`;
}
function readBdaySelects(idPrefix){
  const y=+($("#"+idPrefix+"-y")?.value||0),m=+($("#"+idPrefix+"-m")?.value||0),d=+($("#"+idPrefix+"-d")?.value||0);
  if(!y&&!m&&!d)return""; // 三者都未选=清空
  if(!y||!m||!d)return null; // 部分选择=无效
  const maxD=new Date(y,m,0).getDate();
  if(m<1||m>12||d<1||d>maxD)return null;
  return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
}
function bindBdayDays(idPrefix){
  const ySel=$("#"+idPrefix+"-y"),mSel=$("#"+idPrefix+"-m"),dSel=$("#"+idPrefix+"-d");
  if(!ySel||!mSel||!dSel)return;
  const rebuild=()=>{
    const y=+ySel.value||0,m=+mSel.value||0,old=+dSel.value||0;
    const maxD=(y&&m)?new Date(y,m,0).getDate():31;
    let html='<option value="0">日</option>';
    for(let d=1;d<=maxD;d++)html+=`<option value="${d}" ${old===d?'selected':''}>${d}</option>`;
    dSel.innerHTML=html;
    if(old>maxD)dSel.value="0";
  };
  ySel.onchange=rebuild;mSel.onchange=rebuild;
}
function renderProfile(main){
  if(!S.user){main.innerHTML='<div class="card empty">请先登录后查看个人中心。<br><br><button class="btn primary" id="pl">登录 / 注册</button></div>';$("#pl").onclick=showLogin;return;}
  const u=S.user,av=u.avatar_url||window.AVATAR,bs=birthdayStatus(u);
  const isAdmin=!!(u&&u.role==="admin"); // 管理员本人不受 50 年锁限制
  const bdayLocked=bs.can||isAdmin?false:true;
  main.innerHTML=`<div class="sec-title" style="margin-bottom:16px">个人中心</div>
    <div class="uc-grid"><div class="card profile-card"><img class="profile-avatar" src="${av}" id="pAvatar" title="点击更换头像">
      <div class="profile-name">${esc(u.nickname||u.username)}</div><div class="hint" style="margin-top:4px">@${esc(u.username)}</div>
      <span class="badge-role ${u.role==='admin'?'admin':''}" style="display:inline-block;margin-top:10px">${u.role==='admin'?'管理员':'普通用户'}</span>
      <div style="margin-top:18px;text-align:left"><div class="section-h">游戏总览</div>
        <div class="section-h" style="margin-top:10px;color:var(--accent)">📖 升级之路</div>
        ${STORY_DIRS.map(d=>{const p=S.storyProgress[d.key]||{cleared:0,total_correct:0};return `<div style="display:flex;justify-content:space-between;font-size:12.5px;padding:6px 0;border-bottom:1px solid var(--line2)"><span>${d.name}</span><span class="muted">${p.cleared}关 · ${p.total_correct}题</span></div>`;}).join("")}
        <div class="section-h" style="margin-top:10px;color:var(--accent)">🔤 我是单词</div>
        ${WORD_DIRS.map(d=>{const p=S.progress[d.key]||{cleared:0,total_correct:0};return `<div style="display:flex;justify-content:space-between;font-size:12.5px;padding:6px 0;border-bottom:1px solid var(--line2)"><span>${d.name}</span><span class="muted">${p.cleared}关 · ${p.total_correct}题</span></div>`;}).join("")}
      </div></div>
      <div class="card"><div class="section-h">个人资料</div>
        <div class="form-grid">
          <div class="field"><label>登录账号（不可修改）</label><input value="${esc(u.username)}" readonly></div>
          <div class="field"><label>昵称</label><input id="fNickname" value="${esc(u.nickname||'')}"></div>
          <div class="field"><label>生日 ${bdayLocked?'🔒':''}</label>${bdaySelects("fBirthday",u.birthday,bdayLocked)}
            <div class="hint" style="margin-top:4px">${isAdmin?'管理员可随时修改生日':bdayLocked?`生日每 ${BIRTHDAY_YEARS} 年仅可修改一次，如需修改请联系管理员`:'依次选择年、月、日；三项都选「年 / 月 / 日」可不填'}</div></div>
          <div class="field"><label>性别</label><select id="fGender"><option value="">请选择</option>${GENDERS.map(g=>`<option ${u.gender===g?'selected':''}>${g}</option>`).join("")}</select></div>
          <div class="field"><label>邮箱</label><input type="email" id="fEmail" value="${esc(u.email||'')}"></div>
          <div class="field"><label>电话号码</label><input id="fPhone" value="${esc(u.phone||'')}"></div>
        </div>
        <div class="notice info">资料不提供验证服务；账号丢失由管理员后台协助找回。生日每 ${BIRTHDAY_YEARS} 年仅可修改一次（首次设置不限）。</div>
        <div class="modal-actions"><button class="btn primary" id="saveProfile">保存资料</button><button class="btn" id="changePwd">修改密码</button></div></div></div>`;
  $("#pAvatar").onclick=()=>changeAvatar();
  // 生日年月日联动：改变年/月时重建"日"下拉，避免 2 月出现 31 日
  bindBdayDays("fBirthday");
  $("#saveProfile").onclick=async()=>{
    const newNick=$("#fNickname").value.trim();
    if(nicknameTaken(newNick,S.user.username)){toast("该昵称已被使用",true);return;}
    const patch={nickname:newNick,gender:$("#fGender").value||null,email:$("#fEmail").value.trim()||null,phone:$("#fPhone").value.trim()||null};
    const newBday=readBdaySelects("fBirthday");
    if(newBday===null){toast("生日请选择完整的年、月、日，或全部留空",true);return;}
    const bdayChanged=(newBday||"")!==(u.birthday||"");
    if(newBday){
      if(!isAdmin&&!birthdayStatus(u).can){toast("生日每 "+BIRTHDAY_YEARS+" 年仅可修改一次",true);return;}
      if(new Date(newBday)>new Date()){toast("生日不能是未来日期",true);return;}
      if(bdayChanged){patch.birthday=newBday;patch.birthday_changed_at=new Date().toISOString();}
    }else if(u.birthday){ /* 清空生日 */
      if(!isAdmin&&!birthdayStatus(u).can){toast("生日每 "+BIRTHDAY_YEARS+" 年仅可修改一次",true);return;}
      patch.birthday=null;patch.birthday_changed_at=new Date().toISOString();
    }
    const{data,error}=await cloud.database.from("app_users").update(patch).eq("id",S.user.id).select();
    if(error||!data||!data.length){toast(/nickname_unique|duplicate key/i.test(String((error||{}).message||""))?"该昵称已被使用":"保存失败",true);return;}
    setUser(data[0]);toast("资料已保存");renderProfile(main);
  };
  $("#changePwd").onclick=showChangePwd;
}
async function changeAvatar(){
  const inp=document.createElement("input");inp.type="file";inp.accept="image/*";
  inp.onchange=async()=>{const f=inp.files[0];if(!f)return;if(f.size>3*1024*1024){toast("图片请小于 3MB",true);return;}
    const reader=new FileReader();reader.onload=async()=>{
      const{data,error}=await cloud.database.from("app_users").update({avatar_url:reader.result}).eq("id",S.user.id).select();
      if(error||!data||!data.length){toast("上传失败",true);return;}
      setUser(data[0]);toast("头像已更新");renderProfile($("#main"));};reader.readAsDataURL(f);};
  inp.click();
}
function showChangePwd(){
  modal(`<div class="modal-head"><button class="modal-close">✕</button><h2>修改密码</h2></div>
    <div class="modal-body"><div class="form-grid" style="grid-template-columns:1fr">
      <div class="field"><label>当前密码</label><input type="password" id="oldPwd"></div>
      <div class="field"><label>新密码</label><input type="password" id="newPwd"></div>
    </div><div class="modal-actions"><button class="btn primary" id="doPwd">确认修改</button></div></div>`,true);
  $(".modal-close").onclick=closeModal;
  $("#doPwd").onclick=async()=>{try{
    const h=await passHash(S.user.username,$("#oldPwd").value);if(h!==S.user.pass_hash)throw new Error("当前密码错误");
    const nh=await passHash(S.user.username,$("#newPwd").value);
    const{error}=await cloud.database.from("app_users").update({pass_hash:nh}).eq("id",S.user.id);if(error)throw new Error(error.message);
    setUser(Object.assign({},S.user,{pass_hash:nh}));closeModal();toast("密码已修改");}catch(e){toast(e.message,true);}};
}

/* ============================================================
   管理员权限
   ============================================================ */
async function renderAdmin(main){
  const seq=++adminRenderSeq;
  main.innerHTML='<div class="card"><div class="empty">正在加载用户数据…</div></div>';
  // 只取管理面板需要的字段：不再把 pass_hash 拉进前端内存
  const{data:users,error}=await cloud.database.from("app_users")
    .select("id,username,nickname,role,status,muted,points,birthday,birthday_changed_at,created_at,email,phone,gender")
    .order("created_at",{ascending:false});
  if(seq!==adminRenderSeq||S.page!=="admin")return;  // 已切走则放弃渲染
  if(error){main.innerHTML='<div class="card empty">加载失败：'+esc(error.message)+'</div>';return;}
  const{data:settings}=await cloud.database.from("app_settings").select("*");
  if(seq!==adminRenderSeq||S.page!=="admin")return;  // 已切走则放弃渲染
  const tm=(settings||[]).find(s=>s.key==="team_max_size");if(tm)S.teamMax=parseInt(tm.value)||4;
  const pending=(users||[]).filter(u=>u.status==="pending"),active=(users||[]).filter(u=>u.status==="active");
  main.innerHTML=`<div class="sec-title" style="margin-bottom:16px">管理员权限</div>
    <div class="notice" style="border-left-color:var(--amber)">审核注册 · 管理账号 · 重置密码 · 授予管理员 · 禁言管理 · 手动增减用户积分 · 组队人数配置 · 直接修改任意用户生日 · 定向公告（世界/群聊/私聊）</div>
    <div class="admin-stats"><div class="astat"><b>${users.length}</b><span>全部账号</span></div>
      <div class="astat"><b style="color:var(--amber)">${pending.length}</b><span>待审核</span></div>
      <div class="astat"><b style="color:var(--green)">${active.length}</b><span>已通过</span></div>
      <div class="astat"><b style="color:var(--purple)">${(users||[]).filter(u=>u.role==='admin').length}</b><span>管理员</span></div></div>
    <div class="admin-section"><h3>🛡️ 组队人数配置</h3>
      <p class="hint">设置「我是单词」组队模式每队人数上限（1-20）</p>
      <div class="form-grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
        <div class="field"><label>每队最多人数</label><input type="number" id="teamSize" min="1" max="20" value="${S.teamMax}"></div></div>
      <div class="modal-actions"><button class="btn primary" id="saveTeamSize">保存配置</button></div></div>
    <div class="admin-section"><h3>⏳ 待审核注册（${pending.length}）</h3>${pendingTable(pending)}</div>
    <div class="admin-section"><h3>👥 所有账号（含禁言管理）</h3>${allTable(users||[])}</div>
    <div class="admin-section"><h3>🔑 找回账号 / 重置密码</h3>
      <p class="hint">用户忘记密码时，由你在此为其设置新密码。</p>
      <div class="form-grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
        <div class="field"><label>用户账号</label><input id="resetUser" placeholder="输入用户名"></div>
        <div class="field"><label>新密码</label><input id="resetPwd" placeholder="输入新密码"></div></div>
      <div class="modal-actions"><button class="btn primary" id="doReset">重置密码</button></div></div>`;
  bindAdmin(main,users);
  function pendingTable(list){
    if(!list.length)return '<div class="hint">暂无待审核用户</div>';
    return `<table class="user-table"><thead><tr><th>账号</th><th>昵称</th><th>邮箱</th><th>电话</th><th>生日</th><th>性别</th><th>操作</th></tr></thead><tbody>
      ${list.map(u=>`<tr><td>${esc(u.username)}</td><td>${esc(u.nickname||'-')}</td><td>${esc(u.email||'-')}</td><td>${esc(u.phone||'-')}</td>
      <td>${esc(u.birthday||'-')}</td><td>${esc(u.gender||'-')}</td>
      <td><div class="row-actions"><button class="btn sm primary" data-approve="${u.id}">通过</button><button class="btn sm danger" data-reject="${u.id}">拒绝</button></div></td></tr>`).join("")}</tbody></table>`;
  }
  function allTable(list){
    return `<table class="user-table"><thead><tr><th>账号</th><th>昵称</th><th>角色</th><th>状态</th><th>积分</th><th>生日</th><th>聊天</th><th>操作</th></tr></thead><tbody>
      ${list.map(u=>{
        const isOwner=isSafehouseOwner(u);
        const bdayCell=`<div style="font-size:12px">${u.birthday?esc(u.birthday):'<span class="hint" style="font-size:11px">未设置</span>'}</div>
          <button class="btn sm" style="margin-top:4px" data-edit-bday="${u.id}" data-bday="${esc(u.birthday||'')}" data-uname="${esc(u.username)}" title="管理员可直接设置或清空生日，不受50年限制">改生日</button>`;
        const ptsCell=`<div style="font-size:13px"><b style="color:var(--amber)">${Number(u.points)||0}</b> 分</div>
          <button class="btn sm" style="margin-top:4px" data-adj-points="${u.id}" data-uname="${esc(u.username)}" data-pts="${Number(u.points)||0}" title="管理员手动增加或扣除积分">调整积分</button>`;
        const roleCell=isOwner
          ? `<span class="badge-role admin">管理员</span> <span class="owner-lock" title="屋主的管理员权限永久保留，任何管理员都无法取消">🔒 屋主 · 不可修改</span>`
          : (u.role==='admin'?'管理员':'用户');
        const roleBtn=isOwner?'':`<button class="btn sm" data-role="${u.id}" data-r="${u.role}">${u.role==='admin'?'取消管理员':'设为管理员'}</button>`;
        const muteBtn=(!isOwner&&u.username!==S.user.username)?`<button class="btn sm ${u.muted?'':'danger'}" data-mute="${u.id}" data-m="${u.muted?'0':'1'}">${u.muted?'解除禁言':'禁言'}</button>`:'';
        const actions=roleBtn||muteBtn?`<div class="row-actions">${roleBtn}${muteBtn}</div>`:'<span class="hint" style="font-size:11px">受保护</span>';
        return `<tr><td>${esc(u.username)}</td><td>${esc(u.nickname||'-')}</td><td>${roleCell}</td>
      <td><span class="status-pill ${u.status}">${u.status==='active'?'已通过':u.status==='pending'?'待审核':'已拒绝'}</span></td>
      <td>${ptsCell}</td>
      <td>${bdayCell}</td>
      <td>${u.muted?'<span class="status-pill rejected">已禁言</span>':'<span class="status-pill active">正常</span>'}</td>
      <td>${actions}</td></tr>`;}).join("")}</tbody></table>`;
  }
}
function bindAdmin(main,users){
  $$("[data-approve]").forEach(b=>b.onclick=async()=>{await setStatus(+b.dataset.approve,"active");toast("已通过审核");renderAdmin(main);});
  $$("[data-reject]").forEach(b=>b.onclick=async()=>{await setStatus(+b.dataset.reject,"rejected");toast("已拒绝");renderAdmin(main);});
  $$("[data-role]").forEach(b=>b.onclick=async()=>{const id=+b.dataset.role,nr=b.dataset.r==="admin"?"user":"admin";
    const target=(users||[]).find(u=>u.id===id);
    if(target&&isSafehouseOwner(target)){toast("屋主的管理员权限不可修改",true);return;}
    await cloud.database.from("app_users").update({role:nr}).eq("id",id);toast(nr==="admin"?"已授予管理员权限":"已取消管理员权限");renderAdmin(main);});
  $$("[data-adj-points]").forEach(b=>b.onclick=()=>openPointsAdjuster(+b.dataset.adjPoints,b.dataset.uname,Number(b.dataset.pts)||0,main));
  $$("[data-mute]").forEach(b=>b.onclick=async()=>{const id=+b.dataset.mute,m=b.dataset.m==="1";
    await cloud.database.from("app_users").update({muted:m}).eq("id",id);
    await cloud.database.from("chat_messages").insert({channel:"system",room:"",sender:"admin",content:m?'系统公告：某成员已被禁言':'系统公告：某成员已被解除禁言',kind:"system"}).catch(()=>{});
    toast(m?"已禁言":"已解除禁言");renderAdmin(main);});
  $$("[data-edit-bday]").forEach(b=>b.onclick=()=>{
    const id=+b.dataset.editBday,uname=b.dataset.uname,cur=b.dataset.bday;
    modal(`<div class="modal-head"><button class="modal-close">✕</button><h2>修改生日</h2><p>为「${esc(uname)}」设置生日（管理员专用，不受 50 年限制）</p></div>
      <div class="modal-body"><div class="field"><label>生日（三项都选「年 / 月 / 日」即清空）</label>${bdaySelects("admBirth",cur,false)}</div>
      <div class="modal-actions"><button class="btn primary" id="admBdaySave">保存生日</button><button class="btn ghost" id="admBdayClear">清空生日</button></div></div>`,true);
    $(".modal-close").onclick=closeModal;
    bindBdayDays("admBirth");
    $("#admBdayClear").onclick=()=>{["y","m","d"].forEach(k=>{const el=$("#admBirth-"+k);if(el)el.value="0";});};
    $("#admBdaySave").onclick=async()=>{
      const val=readBdaySelects("admBirth");
      if(val===null){toast("请选择完整的年、月、日，或点「清空生日」",true);return;}
      if(val&&new Date(val)>new Date()){toast("生日不能是未来日期",true);return;}
      const{error}=await cloud.database.from("app_users").update({birthday:val||null,birthday_changed_at:val?new Date().toISOString():null}).eq("id",id);
      if(error){toast("保存失败："+error.message,true);return;}
      // 若改的是当前登录用户，同步本地登录态
      if(S.user&&S.user.id===id){const{data}=await cloud.database.from("app_users").select("*").eq("id",id).maybeSingle();if(data)setUser(data);}
      closeModal();toast(val?"已修改「"+uname+"」的生日":"已清空「"+uname+"」的生日");renderAdmin(main);
    };
  });
  $("#saveTeamSize").onclick=async()=>{const v=parseInt($("#teamSize").value);if(!v||v<1||v>20){toast("请输入 1-20",true);return;}
    await cloud.database.from("app_settings").update({value:String(v),updated_at:new Date().toISOString()}).eq("key","team_max_size");
    S.teamMax=v;toast("组队人数已保存为 "+v+" 人");};
  $("#doReset").onclick=async()=>{try{const un=$("#resetUser").value.trim(),pw=$("#resetPwd").value;
    if(!un||!pw)throw new Error("请填写账号和新密码");
    const{data:u}=await cloud.database.from("app_users").select("id").eq("username",un).maybeSingle();if(!u)throw new Error("账号不存在");
    const h=await passHash(un,pw);await cloud.database.from("app_users").update({pass_hash:h,status:"active"}).eq("id",u.id);
    toast("已为 "+un+" 重置密码");$("#resetPwd").value="";}catch(e){toast(e.message,true);}};
}
async function setStatus(id,status){await cloud.database.from("app_users").update({status}).eq("id",id);}

/* 管理员手动增减指定用户积分（可加可减，结果不低于 0），可定向发布告知公告 */
function openPointsAdjuster(id,uname,cur,main){
  modal(`<div class="modal-head"><button class="modal-close">✕</button><h2>调整积分</h2><p>为「${esc(uname)}」增加或扣除积分</p></div>
    <div class="modal-body">
      <div class="notice info">当前积分：<b style="color:var(--amber)">${cur}</b> 分。填写正数表示增加，负数表示扣除；调整后不会低于 0 分。</div>
      <div class="field"><label>积分变动（例：20 或 -15）</label><input type="number" id="ptsDelta" value="0" step="1"></div>
      <div class="announce-opt">
        <label class="switch-line"><input type="checkbox" id="ptsAnnounce"><span>发布积分变动告知公告</span></label>
        <div class="announce-opt-body" id="ptsAnnounceBody" style="display:none">
          <div class="notice info">公告将以公告条挂在世界频道顶部，仅下面选定的人群能看到。</div>
          <div class="field"><label>告知范围</label>
            <select id="ptsAnnScope">
              <option value="friends_of">${esc(uname)} 的好友（及本人）</option>
              <option value="named">指定名单</option>
            </select></div>
          <div class="field" id="ptsAnnNamesWrap" style="display:none"><label>可见账号（一行一个，或逗号分隔）</label><textarea id="ptsAnnNames" rows="4" placeholder="例如：Alice\nBob"></textarea></div>
          <div class="field"><label>公告持续天数</label><input type="number" id="ptsAnnDays" value="7" min="1" max="90"></div>
        </div>
      </div>
      <div class="modal-actions"><button class="btn primary" id="ptsApply">确认调整</button><button class="btn ghost" id="ptsCancel">取消</button></div>
    </div>`,true);
  $(".modal-close").onclick=closeModal;
  $("#ptsCancel").onclick=closeModal;
  $("#ptsAnnounce").onchange=e=>{ $("#ptsAnnounceBody").style.display=e.target.checked?"":"none"; };
  $("#ptsAnnScope").onchange=e=>{ $("#ptsAnnNamesWrap").style.display=e.target.value==="named"?"":"none"; };
  $("#ptsApply").onclick=async()=>{
    const delta=parseInt($("#ptsDelta").value,10);
    if(!Number.isFinite(delta)||delta===0){toast("请输入非零整数",true);return;}
    // 串行锁内重读最新积分再累加，避免覆盖用户刚获得的积分
    const result=await withPointsLock(async()=>{
      try{
        const fresh=await cloud.database.from("app_users").select("points").eq("id",id).maybeSingle();
        if(fresh.error) throw new Error(fresh.error.message||"读取积分失败");
        const base=Math.max(0,Number(fresh.data&&fresh.data.points)||0);
        const next=Math.max(0,base+delta);
        const {error}=await cloud.database.from("app_users").update({points:next}).eq("id",id);
        if(error) throw new Error(error.message||"保存积分失败");
        return {ok:true,next};
      }catch(e){ return {ok:false,err:e.message||"未知错误"}; }
    });
    if(!result.ok){toast("调整失败："+(result.err||"未知错误"),true);return;}
    const next=result.next;
    const cached=(S.users||[]).find(u=>u.id===id);if(cached)cached.points=next;
    if(S.user&&S.user.id===id){S.user.points=next;localStorage.setItem("ps_user",JSON.stringify(S.user));renderUserBox();}
    // 定向告知公告
    if($("#ptsAnnounce").checked){
      const scope=$("#ptsAnnScope").value;
      const days=Math.max(1,Math.min(90,parseInt($("#ptsAnnDays").value,10)||7));
      const now=new Date(),end=new Date(now.getTime()+days*86400000);
      let names=[];
      if(scope==="named"){
        names=$("#ptsAnnNames").value.split(/[\n,，;；\s]+/).filter(Boolean);
        if(!names.length){toast("请填写至少一个可见账号",true);return;}
      }
      const content=`📊 积分变动公告：管理员将「${uname}」的积分${delta>0?'增加':'扣除'} ${Math.abs(delta)} 分，当前 ${next} 分。`;
      const row={content,start_at:now.toISOString(),end_at:end.toISOString(),active:true,
        author:S.user.username,audience:scope,
        target_user:scope==="friends_of"?uname:null,
        audience_names:scope==="named"?JSON.stringify(names):null,
        created_at:now.toISOString()};
      const{error:annErr}=await cloud.database.from("announcements").insert(row);
      if(annErr){toast("积分已调整，但公告发布失败："+annErr.message,true);}
      else await loadAnnouncements();
    }
    closeModal();toast(`已为「${uname}」${delta>0?'增加':'扣除'} ${Math.abs(delta)} 积分，当前 ${next} 分`);
    renderLeaderboard();renderAnnounceBar();renderAdmin(main);
  };
}

/* 屋主专用：讲义中心可见名单（与管理员角色完全独立） */
function showLectureAccessManager(){
  if(!isSafehouseOwner()){ toast("无权访问",true); return; }
  const current=(S.lectureAccessList||[OWNER_USERNAME]).join("\n");
  modal(`<div class="modal-head"><button class="modal-close">✕</button><h2>讲义中心可见名单</h2><p>只有 Paralir 能修改；Paralir 始终保留</p></div>
    <div class="modal-body">
      <div class="notice info">一行一个账号。保存后，对方刷新页面即可看到「CTF 讲义中心」入口。此名单与管理员权限无关。</div>
      <div class="field"><label>可见账号</label><textarea id="lectureAccessNames" rows="8">${esc(current)}</textarea></div>
      <div class="modal-actions"><button class="btn primary" id="saveLectureAccessBtn">保存名单</button><button class="btn ghost" id="cancelLectureAccess">取消</button></div>
    </div>`,true);
  $(".modal-close").onclick=closeModal;
  $("#cancelLectureAccess").onclick=closeModal;
  $("#saveLectureAccessBtn").onclick=async()=>{
    try{
      const names=$("#lectureAccessNames").value.split(/[\n,，;；\s]+/).filter(Boolean);
      await saveLectureAccess(names);
      closeModal();toast("讲义中心可见名单已保存");
    }catch(e){toast("保存失败："+e.message,true);}
  };
}

/* ============================================================
   登录 / 注册
   ============================================================ */
function showLogin(){
  modal(`<div class="modal-head"><button class="modal-close">✕</button><h2>登录安全屋</h2><p>使用你的账号和密码</p></div>
    <div class="modal-body"><div class="form-grid" style="grid-template-columns:1fr">
      <div class="field"><label>账号</label><input id="lgUser" autocomplete="username"></div>
      <div class="field"><label>密码</label><input type="password" id="lgPwd" autocomplete="current-password"></div>
    </div><div class="modal-actions"><button class="btn primary" id="doLogin">登录</button><button class="btn ghost" id="toReg">没有账号？注册</button></div></div>`,true);
  $(".modal-close").onclick=closeModal;$("#toReg").onclick=showRegister;
  const doIt=async()=>{try{await login($("#lgUser").value.trim(),$("#lgPwd").value);closeModal();await loadProgress();await loadMyTeam();
    AUDIO.mountDock(document.body);AUDIO.showDock();AUDIO.startAll();
    go("home");}catch(e){toast(e.message,true);}};
  $("#doLogin").onclick=doIt;$("#lgPwd").onkeydown=e=>{if(e.key==="Enter")doIt();};
}
let regGateSeen = false;
function showRegister(){
  // 世界观开场只给「需要注册的新人」看；已有账号直接登录不播放
  if(!regGateSeen){
    closeModal();
    $("#app").style.display="none";
    AUDIO.hideDock();
    window.SafehouseGate.show(()=>{
      regGateSeen=true;
      $("#app").style.display="block";
      showRegisterForm();
    });
    return;
  }
  showRegisterForm();
}
function showRegisterForm(){
  modal(`<div class="modal-head"><button class="modal-close">✕</button><h2>注册账号</h2><p>注册后需管理员审核通过方可登录</p></div>
    <div class="modal-body"><div class="notice info">只收集基础资料，不提供验证服务。账号丢失由管理员后台协助找回。生日每 ${BIRTHDAY_YEARS} 年仅可修改一次。</div>
    <div class="form-grid">
      <div class="field"><label>* 账号（3-20位字母数字下划线）</label><input id="rgUser"></div>
      <div class="field"><label>* 密码</label><input type="password" id="rgPwd"></div>
      <div class="field"><label>昵称</label><input id="rgNick"></div>
      <div class="field"><label>生日（选填）</label>${bdaySelects("rgBirth","",false)}</div>
      <div class="field"><label>性别</label><select id="rgGender"><option value="">请选择</option>${GENDERS.map(g=>`<option>${g}</option>`).join("")}</select></div>
      <div class="field"><label>邮箱</label><input type="email" id="rgEmail"></div>
      <div class="field"><label>电话号码</label><input id="rgPhone"></div>
    </div><div class="modal-actions"><button class="btn primary" id="doReg">提交注册</button><button class="btn ghost" id="toLogin">已有账号？登录</button></div></div>`);
  $(".modal-close").onclick=closeModal;$("#toLogin").onclick=showLogin;
  bindBdayDays("rgBirth");
  $("#doReg").onclick=async()=>{try{
    const bday=readBdaySelects("rgBirth");
    if(bday===null)throw new Error("生日请选择完整的年、月、日，或全部留空");
    await register({username:$("#rgUser").value.trim(),password:$("#rgPwd").value,nickname:$("#rgNick").value.trim(),birthday:bday,gender:$("#rgGender").value,email:$("#rgEmail").value.trim(),phone:$("#rgPhone").value.trim()});
    closeModal();showLogin();}catch(e){toast(e.message,true);}};
}

/* ============================================================
   Init
   ============================================================ */
function setLogo(){$("#brandLogo").src=window.AVATAR;$("#bootLogo").src=window.AVATAR;$("#gateLogo").src=window.AVATAR;}
async function init(){
  setLogo();
  // 可爱的按键音效（仅按钮 / 卡片等控件点击时播放；可一键关闭）
  document.addEventListener("click",e=>{
    const t=e.target&&e.target.closest?e.target.closest("button.btn,button.tab,.level-node,.dir-card,.chip"):null;
    if(!t) return;
    if((t.id||"").indexOf("sfxToggle")===0) return;
    SFX.play("cute");
  });
  $("#topnav").addEventListener("click",e=>{
    const t=e.target&&e.target.closest?e.target.closest(".tab"):null;
    if(!t) return;
    if(t.dataset.page==="owner-lectures"){ openOwnerLectures(); return; }
    go(t.dataset.page);
  });
  $("#navHome").onclick=()=>go("home");
  $("#bootMsg").textContent="正在连接云端服务…";
  let user=null;
  try{
    user=await withTimeout(loadUser());
    if(user===undefined){ user=null; setUser(null,{keepSession:true}); }  // 云端暂时不可用：保留登录态待下次重试
    else setUser(user);
    await withTimeout(loadLectureAccess());
    await withTimeout(loadSettings());
    if(user){await withTimeout(loadProgress());await withTimeout(loadMyTeam());}
  }catch(err){
    // 云端故障或数据异常时不要卡死：以未登录状态继续，保证遮罩一定消失
    try{console.warn("init 加载异常，将以离线状态继续：",err);}catch(_){}
    user=null;
    try{setUser(null,{keepSession:true});}catch(_){}
  }finally{
    $("#boot").style.display="none";$("#app").style.display="block";
  }
  AUDIO.mountDock(document.body);

  if(user){
    // 已登录：直接进入，启动音乐
    AUDIO.showDock();AUDIO.startAll();
    go("home");
  }else{
    // 未登录：直接进入登录界面；世界观开场只在点击「注册」时播放
    AUDIO.hideDock();
    go("home");              // 未登录 -> 渲染锁定引导页
    setTimeout(showLogin, 250);
  }
}
window.addEventListener("DOMContentLoaded",init);
})();
