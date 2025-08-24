
const el = (id) => document.getElementById(id);

// Player/profile
let profile = {
  name: localStorage.getItem('qr_player_name') || '',
  avatar: localStorage.getItem('qr_player_avatar') || '🦜'
};

// Run/session state (resets on Reset Run)
let run = {
  score: 0,
  questionCount: 0,
  maxQuestions: 10,
  streak: 0,
  bestStreak: 0,
  hintsUsed: 0,
  usedHintTypes: { fifty:false, clue:false, first:false },
  timer: null,
  timeLeft: 0,
  retryMode: false,
  lastStartTime: 0,
  achievements: { fastSolver:false, noHintMaster:false, treasureKing:false }
};

// Current question loaded from QR
let currentQ = null;
let scanning = false;
let codeReader = null;

// Simple sound effects using WebAudio
const audioCtx = (window.AudioContext) ? new AudioContext() : null;
const beep = (freq=700, dur=0.08) => {
  if(!audioCtx) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.connect(g); g.connect(audioCtx.destination);
  o.type = 'sine'; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.2, audioCtx.currentTime + 0.01);
  o.start();
  o.stop(audioCtx.currentTime + dur);
};

// UI helpers
const toast = (msg) => {
  const t = el('toast'); t.textContent = msg; t.style.display='block';
  setTimeout(()=> t.style.display='none', 1800);
};
const setProgress = () => {
  el('posNow').textContent = Math.min(run.questionCount, run.maxQuestions);
  el('posMax').textContent = run.maxQuestions;
  const pct = Math.min(100, (run.questionCount/run.maxQuestions)*100);
  el('progressFill').style.width = pct + '%';
  el('scoreNow').textContent = run.score;
  el('streakNow').textContent = run.streak;
  el('timeLeft').textContent = (run.timeLeft>0) ? (run.timeLeft+'s') : '—';
  el('hintsUsed').textContent = run.hintsUsed;
};
const showQuestionCard = (show=true) => { el('qCard').style.display = show ? 'block' : 'none'; };
const resetHintButtons = () => {
  run.hintsUsed = 0;
  run.usedHintTypes = { fifty:false, clue:false, first:false };
  ['hint5050','hintClue','hintFirst'].forEach(id=>{
    const b = el(id); b.disabled = false;
    b.classList.remove('mint');
  });
};

// Profile & avatars
const avatarChoices = ['🦜','🏴‍☠️','🧭','🗺️','🪙','🏺','🧿','🧙‍♂️'];
const renderAvatars = () => {
  const box = el('avatars'); box.innerHTML='';
  avatarChoices.forEach(a=>{
    const d = document.createElement('div');
    d.className='avatar' + (a===profile.avatar?' selected':'');
    d.textContent=a;
    d.onclick=()=>{ profile.avatar=a; renderAvatars(); };
    box.appendChild(d);
  });
  el('playerName').value = profile.name;
};
const saveProfile = () => {
  profile.name = el('playerName').value.trim() || 'Player';
  localStorage.setItem('qr_player_name', profile.name);
  localStorage.setItem('qr_player_avatar', profile.avatar);
  toast('Profile saved!');
};

// Timer & round
const startRound = () => {
  run.timeLeft = 60;
  run.lastStartTime = performance.now();
  clearInterval(run.timer);
  run.timer = setInterval(()=>{
    run.timeLeft--;
    setProgress();
    if(run.timeLeft<=0){
      clearInterval(run.timer);
      onAnswer(false, 'Time up');
    }
  }, 1000);
  setProgress();
};
const endRound = () => { clearInterval(run.timer); run.timeLeft = 0; setProgress(); };

// Scoring
function computeScore({ correct, usedHints, retryMode, hiddenTreasure, timeMs }){
  let pts = 0;
  if(correct){
    pts = 4;
    pts -= Math.min(usedHints, 3);
    if(usedHints===0) pts += 1;
    if(!retryMode){
      const secs = timeMs/1000;
      if(secs <= 30) pts += 1;
    } else { pts -= 1; }
    pts = Math.max(0, pts);
    if(hiddenTreasure) pts *= 2;
  } else { pts = 0; }
  return pts;
}
function onAnswer(correct, reason=''){
  endRound();
  const timeMs = performance.now() - run.lastStartTime;
  const pts = computeScore({
    correct,
    usedHints: run.hintsUsed,
    retryMode: run.retryMode,
    hiddenTreasure: currentQ?.hiddenTreasure || false,
    timeMs
  });

  if(correct){
    run.streak += 1;
    run.bestStreak = Math.max(run.bestStreak, run.streak);
    if(run.streak>0 && run.streak % 3 === 0){
      run.score += 2; toast('🔥 Streak +2!'); beep(900, 0.06);
    }
  } else { run.streak = 0; }

  run.score += pts;

  if(correct && timeMs/1000 <= 30) run.achievements.fastSolver = true;
  if(correct && run.hintsUsed===0) run.achievements.noHintMaster = true;

  if(correct){ beep(880, 0.08); beep(1200, 0.06); } else { beep(220, 0.12); }

  run.questionCount += 1;
  setProgress();
  toast((correct?'Correct! ':'Wrong! ') + (pts?`+${pts}`:'') + (reason?` • ${reason}`:''));
  run.retryMode = !correct;

  if(currentQ?.nextRiddle){
    el('riddleNext').style.display='inline-block';
    el('riddleNext').textContent = '🕵️ Next Clue: ' + currentQ.nextRiddle;
  } else { el('riddleNext').style.display='none'; }

  if(run.questionCount >= run.maxQuestions){ finalizeRun(); }
}
function doSkip(){
  endRound();
  run.score -= 2; run.streak = 0; run.questionCount += 1;
  toast('Skipped: -2'); setProgress();
  if(run.questionCount >= run.maxQuestions){ finalizeRun(); }
}
function doRetry(){ run.retryMode = true; toast('Retry enabled (reduced marks)'); startRound(); }

// Answer checking
function checkMCQ(optionText){
  if(!currentQ || !currentQ.answer){
    toast('No correct answer in QR. Recorded as attempted.');
    onAnswer(false, 'No answer provided');
    return;
  }
  const correct = optionText.trim().toLowerCase() === String(currentQ.answer).trim().toLowerCase();
  onAnswer(correct, correct?'':'Try again');
}
function checkTyped(){
  const input = el('typedAnswer').value.trim();
  if(!input){ toast('Type something first'); return; }
  if(!currentQ || !currentQ.answer){
    onAnswer(false, 'Organizer didn’t include an answer in QR');
  } else {
    const correct = input.toLowerCase() === String(currentQ.answer).trim().toLowerCase();
    onAnswer(correct, correct?'':'Incorrect');
  }
  el('typedAnswer').value='';
}

// Hints
function useHint(type){
  if(run.hintsUsed>=3){ toast('Max 3 hints reached'); return; }
  if(run.usedHintTypes[type]){ toast('Hint already used'); return; }

  run.hintsUsed += 1;
  run.usedHintTypes[type] = true;

  if(type==='fifty'){
    if(currentQ?.hints?.fiftyFifty && currentQ?.type==='mcq'){
      renderMCQ(currentQ.hints.fiftyFifty);
    } else { toast('50:50 not available for this question'); }
  }
  if(type==='clue'){
    const clue = currentQ?.hints?.clue || 'Think carefully…';
    toast('Clue: ' + clue);
    if(currentQ?.hints?.clueImage){
      const img = el('clueImage');
      img.src = currentQ.hints.clueImage;
      img.style.display='block';
    }
  }
  if(type==='first'){
    const letter = currentQ?.hints?.firstLetter;
    if(letter){ toast('First letter: ' + letter); }
    else if (currentQ?.answer){ toast('First letter: ' + String(currentQ.answer).charAt(0)); }
    else { toast('First letter unavailable'); }
  }
  beep(500,0.06);
  setProgress();
}

// Renderers
function renderQuestion(){
  if(!currentQ) return;
  showQuestionCard(true);
  resetHintButtons();

  el('qText').textContent = currentQ.question || '[QR contains no question text]';
  el('hiddenBadge').style.display = currentQ.hiddenTreasure ? 'inline-block' : 'none';

  const img = el('clueImage'); img.style.display='none'; img.src='';

  el('mcqWrap').style.display = 'none'; el('mcqWrap').innerHTML='';
  el('typedWrap').style.display = 'none';

  if(currentQ.type === 'mcq' && Array.isArray(currentQ.options) && currentQ.options.length){
    renderMCQ(currentQ.options.slice());
  } else { el('typedWrap').style.display='block'; }

  startRound();
}
function renderMCQ(opts){
  const wrap = el('mcqWrap'); wrap.style.display='grid'; wrap.innerHTML='';
  for(let i=opts.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [opts[i],opts[j]]=[opts[j],opts[i]];
  }
  opts.forEach(o=>{
    const d = document.createElement('div');
    d.className='opt'; d.textContent = o; d.onclick = ()=> checkMCQ(o);
    wrap.appendChild(d);
  });
}

// QR parser
function parseQrPayload(rawText){
  try{
    const obj = JSON.parse(rawText);
    const q = {
      id: obj.id || 'Q?' + Math.floor(Math.random()*10000),
      type: (obj.type==='mcq'?'mcq':'text'),
      question: obj.question || '[No question]',
      options: Array.isArray(obj.options) ? obj.options.slice() : [],
      answer: obj.answer ?? null,
      hints: obj.hints || {},
      hiddenTreasure: !!obj.hiddenTreasure,
      nextRiddle: obj.nextRiddle || ''
    };
    return q;
  }catch(e){
    return {
      id: 'TXT-' + Math.floor(Math.random()*100000),
      type:'text',
      question: rawText,
      options: [],
      answer: null,
      hints:{},
      hiddenTreasure:false,
      nextRiddle:''
    };
  }
}

// Camera + scanner
async function startScanner(){
  try{
    if(!codeReader){ codeReader = new ZXingBrowser.BrowserMultiFormatReader(); }
    const videoEl = el('preview');

    const devices = await ZXingBrowser.BrowserCodeReader.listVideoInputDevices();
    let deviceId = devices?.[0]?.deviceId || undefined;
    const envDevice = devices.find(d=>/back|rear|environment/i.test(d.label));
    if(envDevice) deviceId = envDevice.deviceId;

    scanning = true;
    el('scanHint').textContent = 'Scanning… keep QR steady';
    await codeReader.decodeFromVideoDevice(deviceId, videoEl, (result, err, controls)=>{
      if(result){
        controls.stop(); scanning = false;
        const text = result.getText(); beep(700,0.06);
        currentQ = parseQrPayload(text);
        renderQuestion();
      }
      if(err && !(err instanceof ZXingBrowser.NotFoundException)){
        console.warn(err);
      }
    });
  }catch(e){
    console.error(e);
    toast('Camera failed. Use HTTPS or grant permission.');
  }
}
function stopScanner(){
  if(codeReader){ try{ codeReader.reset(); }catch{} }
  scanning = false; el('scanHint').textContent = 'Scanner stopped';
}

// Leaderboard
function finalizeRun(){
  const lb = loadLB();
  const topScore = lb.length ? Math.max(...lb.map(x=>x.score)) : 0;
  if(run.score >= topScore) run.achievements.treasureKing = true;

  const entry = {
    name: profile.name || 'Player',
    avatar: profile.avatar,
    score: run.score,
    bestStreak: run.bestStreak,
    achievements: Object.assign({}, run.achievements),
    when: new Date().toLocaleString()
  };
  lb.push(entry);
  lb.sort((a,b)=> b.score - a.score);
  if(lb.length>20) lb.length=20;
  saveLB(lb); renderLB();
  toast('Run finished! Score saved to leaderboard.');
}
const LB_KEY = 'qr_lb_v1';
const loadLB = ()=> JSON.parse(localStorage.getItem(LB_KEY) || '[]');
const saveLB = (data)=> localStorage.setItem(LB_KEY, JSON.stringify(data));
function renderLB(){
  const tb = el('lbBody');
  const data = loadLB();
  tb.innerHTML='';
  data.forEach((r, idx)=>{
    const tr = document.createElement('tr');
    const ach = [];
    if(r.achievements?.fastSolver) ach.push('<span class="badge fast">Fast Solver</span>');
    if(r.achievements?.noHintMaster) ach.push('<span class="badge nohint">No Hint Master</span>');
    if(r.achievements?.treasureKing) ach.push('<span class="badge gold">Treasure King</span>');
    tr.innerHTML = `
      <td>${idx+1}</td>
      <td>${r.avatar} ${r.name}</td>
      <td><b>${r.score}</b></td>
      <td>${r.bestStreak||0}</td>
      <td style="display:flex; gap:6px; flex-wrap:wrap">${ach.join(' ')}</td>
      <td class="tiny">${r.when}</td>
    `;
    tb.appendChild(tr);
  });
}

// Ask a friend (Web Share / Clipboard)
async function askFriend(){
  if(!currentQ){ toast('Scan a QR first'); return; }
  const text = `Help me solve this treasure hunt question:\n\n${currentQ.question}\n\n(Any idea?)`;
  if(navigator.share){
    try{ await navigator.share({ title:'QR Treasure Hunt', text }); }catch{}
  }else{
    await navigator.clipboard.writeText(text);
    toast('Question copied! Share it with your teammate.');
  }
}

// Reset run
function resetRun(){
  run = {
    score: 0, questionCount: 0, maxQuestions: 10, streak: 0, bestStreak: 0,
    hintsUsed: 0, usedHintTypes:{fifty:false,clue:false,first:false},
    timer:null, timeLeft:0, retryMode:false, lastStartTime:0,
    achievements:{ fastSolver:false, noHintMaster:false, treasureKing:false }
  };
  setProgress(); showQuestionCard(false); toast('Run reset');
}

// Events
function wireEvents(){
  el('scanBtn').onclick = startScanner;
  el('stopBtn').onclick = stopScanner;
  el('shareBtn').onclick = askFriend;
  el('saveProfile').onclick = saveProfile;
  el('resetRun').onclick = resetRun;

  el('hint5050').onclick = ()=> useHint('fifty');
  el('hintClue').onclick = ()=> useHint('clue');
  el('hintFirst').onclick = ()=> useHint('first');

  el('skipBtn').onclick = doSkip;
  el('retryBtn').onclick = doRetry;

  el('submitTyped').onclick = checkTyped;
  el('typedAnswer').addEventListener('keydown', (e)=>{ if(e.key==='Enter') checkTyped(); });
}

// Init
function init(){
  renderAvatars(); renderLB(); setProgress(); wireEvents();
  el('playerName').value = profile.name;
}
document.addEventListener('DOMContentLoaded', init);

/*******************************************************************
 * OPTIONAL: DEMO MODE (no QR needed)
 * In DevTools console, paste:
 * currentQ = parseQrPayload(JSON.stringify({
 *   type:"mcq", question:"Capital of Japan?",
 *   options:["Tokyo","Osaka","Kyoto","Nagoya"], answer:"Tokyo",
 *   hints:{ clue:"Sushi…", firstLetter:"T", fiftyFifty:["Tokyo","Kyoto"] },
 *   hiddenTreasure:true, nextRiddle:"Find the tallest tower!"
 * })); renderQuestion();
 *******************************************************************/