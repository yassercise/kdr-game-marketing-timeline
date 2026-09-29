import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, doc, getDoc, setDoc, collection, getDocs, addDoc, deleteDoc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyA0QDm49wVArv6oJA4YNGdRCXDe9OEtkI0",
  authDomain: "ekk-hub.firebaseapp.com",
  projectId: "ekk-hub",
  storageBucket: "ekk-hub.firebasestorage.app",
  messagingSenderId: "68211752660",
  appId: "1:68211752660:web:1098c3baed22cae8b7c541"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const UID = 'yasser-tracked';

// ── CONSTANTS ──────────────────────────────────────────────────────────────
const CATS = ['breakfast','lunch','dinner','snacks','drinks'];
const CAT_LABELS = {breakfast:'Breakfast',lunch:'Lunch',dinner:'Dinner',snacks:'Snacks',drinks:'Drinks'};
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

// ── AUDIO ENGINE ───────────────────────────────────────────────────────────
let audioCtx = null;
function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
function playTone(freq, duration, type = 'sine', gain = 0.15) {
  try {
    const ctx = getAudio();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.connect(g); g.connect(ctx.destination);
    osc.type = type; osc.frequency.value = freq;
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(gain, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start(); osc.stop(ctx.currentTime + duration);
  } catch(e) {}
}
function soundLog() { playTone(440, 0.12); setTimeout(() => playTone(554, 0.12), 80); }
function soundGoal() { [523,659,784,1047].forEach((f,i) => setTimeout(() => playTone(f, 0.18, 'sine', 0.12), i*80)); }
function soundWater() { playTone(660, 0.1, 'sine', 0.1); }
function soundDelete() { playTone(220, 0.15, 'sine', 0.08); }
function haptic(ms = 10) { try { navigator.vibrate(ms); } catch(e) {} }

// ── HELPERS ────────────────────────────────────────────────────────────────
function dateStr(d) { return d.toISOString().split('T')[0]; }
function today() { return dateStr(new Date()); }
function offsetDate(n) { const d = new Date(); d.setDate(d.getDate() + n); return d; }
function dayRef(key) { return doc(db, 'tracked', UID, 'days', key); }
function settingsRef() { return doc(db, 'tracked', UID, 'meta', 'settings'); }
function recentRef() { return doc(db, 'tracked', UID, 'meta', 'recent'); }
function foodsCol() { return collection(db, 'tracked', UID, 'foods'); }

// ── STATE ──────────────────────────────────────────────────────────────────
let T = {cal:2865,prot:183,carb:300,fat:80,water:8,carryover:false};
let dayCache = {}; // key -> dayData
let currentDayOffset = 0;
let allFoods = [];
let recentFoods = [];
let monthHistory = {}; // key -> {cal,prot}
let currentFoodDetail = null;
let editingMealIdx = null;

// ── INIT ───────────────────────────────────────────────────────────────────
// ── TOAST ──────────────────────────────────────────────────────────────────
function showToast(msg) {
  // Remove any existing toast
  const existing = document.getElementById('appToast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'appToast';
  toast.textContent = msg;
  toast.style.cssText = `
    position:fixed;bottom:calc(var(--tab-h) + var(--safe-bottom) + 16px);left:50%;
    transform:translateX(-50%) translateY(10px);
    background:rgba(18,20,26,0.92);color:#fff;
    padding:10px 18px;border-radius:20px;
    font-family:'Manrope',sans-serif;font-size:13px;font-weight:600;
    white-space:nowrap;z-index:500;
    backdrop-filter:blur(12px);
    border:1px solid rgba(255,255,255,0.1);
    box-shadow:0 4px 20px rgba(0,0,0,0.3);
    opacity:0;transition:opacity 220ms ease,transform 220ms ease;
  `;
  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  });
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(8px)';
    setTimeout(() => toast.remove(), 250);
  }, 2000);
}

function setLoadingProgress(pct, label) {
  const bar = document.getElementById('loadingBar');
  const lbl = document.getElementById('loadingLabel');
  if (bar) bar.style.width = pct + '%';
  if (lbl) lbl.textContent = label;
}

function hideLoadingScreen() {
  const screen = document.getElementById('loadingScreen');
  if (!screen) return;
  screen.style.opacity = '0';
  screen.style.transform = 'scale(1.04)';
  setTimeout(() => screen.remove(), 520);
}

async function init() {
  setLoadingProgress(15, 'LOADING SETTINGS');
  await loadSettings();

  setLoadingProgress(35, 'LOADING TODAY');
  await loadDay(today());

  setLoadingProgress(60, 'RENDERING');
  renderHome();
  renderWater();
  drawBody();
  updateTabPill(document.querySelector('.tab-btn.active'));

  setLoadingProgress(80, 'SYNCING DATA');
  await loadFoods();
  await loadRecent();

  setLoadingProgress(100, 'READY');

  // Event listeners
  document.getElementById('logModalSearch').addEventListener('keydown', e => { if (e.key === 'Enter') window.doModalSearch(); });
  document.querySelectorAll('.modal-overlay').forEach(o => {
    o.addEventListener('click', e => { if (e.target === o) closeModalSwipe(o.id); });
  });
  setupModalSwipe();

  // Hide loading screen then lazy load history
  setTimeout(() => {
    hideLoadingScreen();
    loadMonthHistory().then(() => renderMonthStrip());
  }, 500);
}

// ── LOAD / SAVE ────────────────────────────────────────────────────────────
async function loadSettings() {
  try { const s = await getDoc(settingsRef()); if (s.exists()) T = {...T,...s.data()}; } catch(e){}
  applySettingsToUI();
}

async function loadDay(key, forceRefresh=false) {
  if (dayCache[key] && !forceRefresh) return dayCache[key];
  try {
    const s = await getDoc(dayRef(key));
    dayCache[key] = s.exists() ? s.data() : {meals:[],water:0,date:key};
  } catch(e) { if(!dayCache[key]) dayCache[key] = {meals:[],water:0,date:key}; }
  if (!dayCache[key].meals) dayCache[key].meals = [];
  return dayCache[key];
}

async function saveDay(key) {
  try { await setDoc(dayRef(key), dayCache[key]); } catch(e){}
}

async function loadFoods() {
  try { const s = await getDocs(foodsCol()); allFoods = s.docs.map(d=>({id:d.id,...d.data()})); } catch(e){}
}

async function loadRecent() {
  try { const s = await getDoc(recentRef()); if (s.exists()) recentFoods = s.data().items||[]; } catch(e){}
}

async function saveRecent() {
  try { await setDoc(recentRef(), {items:recentFoods.slice(0,50)}); } catch(e){}
}

async function addToRecent(meal) {
  // Always store BASE macros (1 serving), not the scaled amount
  const entry = {
    name: meal.name,
    cal: meal.baseCal || meal.cal,
    prot: meal.baseProt || meal.prot,
    carb: meal.baseCarb || meal.carb,
    fat: meal.baseFat || meal.fat,
    ts: Date.now()
  };
  recentFoods = [entry,...recentFoods.filter(r=>r.name!==meal.name)].slice(0,50);
  await saveRecent();
}

async function loadMonthHistory() {
  // Load last 60 days in parallel batches of 10
  const keys = [];
  for (let i=1;i<=60;i++) keys.push(dateStr(offsetDate(-i)));
  const batches = [];
  for (let i=0;i<keys.length;i+=10) batches.push(keys.slice(i,i+10));
  for (const batch of batches) {
    await Promise.all(batch.map(async key => {
      if (dayCache[key]) { summarizeDay(key); return; }
      try {
        const s = await getDoc(dayRef(key));
        if (s.exists()) { dayCache[key] = s.data(); summarizeDay(key); }
      } catch(e){}
    }));
  }
}

function summarizeDay(key) {
  const d = dayCache[key];
  if (!d) return;
  const meals = d.meals||[];
  const cal = meals.reduce((a,m)=>a+(m.cal||0),0);
  const prot = meals.reduce((a,m)=>a+(m.prot||0),0);
  monthHistory[key] = {cal,prot};
}

// ── TOTALS ─────────────────────────────────────────────────────────────────
function getTotals(key) {
  const d = dayCache[key]||{meals:[]};
  return (d.meals||[]).reduce((acc,m)=>({cal:acc.cal+(m.cal||0),prot:acc.prot+(m.prot||0),carb:acc.carb+(m.carb||0),fat:acc.fat+(m.fat||0)}),{cal:0,prot:0,carb:0,fat:0});
}

// ── RENDER HOME ────────────────────────────────────────────────────────────
function renderHome() {
  const key = dateStr(offsetDate(currentDayOffset));
  const d = dayCache[key]||{meals:[],water:0};
  const t = getTotals(key);
  const targetCal = T.cal + (d._carryover||0);
  const isToday = currentDayOffset === 0;

  // Day nav
  document.getElementById('dayNavLabel').textContent = isToday ? 'Today' : currentDayOffset === -1 ? 'Yesterday' : offsetDate(currentDayOffset).toLocaleDateString('en-GB',{weekday:'long'});
  document.getElementById('dayNavSub').textContent = offsetDate(currentDayOffset).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
  document.getElementById('dayNavNext').style.opacity = isToday ? '0.3' : '1';
  document.getElementById('dayNavNext').style.pointerEvents = isToday ? 'none' : 'auto';

  // Macros
  document.getElementById('mCal').textContent = t.cal.toLocaleString();
  document.getElementById('mProt').innerHTML = t.prot+'<span>g</span>';
  document.getElementById('mCarb').innerHTML = t.carb+'<span>g</span>';
  document.getElementById('mFat').innerHTML = t.fat+'<span>g</span>';
  document.getElementById('mCalTarget').textContent = '/ '+targetCal.toLocaleString();
  document.getElementById('mProtTarget').textContent = '/ '+T.prot+'g';
  document.getElementById('mCarbTarget').textContent = '/ '+T.carb+'g';
  document.getElementById('mFatTarget').textContent = '/ '+T.fat+'g';
  document.getElementById('mCalBar').style.width = Math.min(100,Math.round(t.cal/targetCal*100))+'%';
  document.getElementById('mProtBar').style.width = Math.min(100,Math.round(t.prot/T.prot*100))+'%';
  document.getElementById('mCarbBar').style.width = Math.min(100,Math.round(t.carb/T.carb*100))+'%';
  document.getElementById('mFatBar').style.width = Math.min(100,Math.round(t.fat/T.fat*100))+'%';
  document.getElementById('heroCalLabel').textContent = t.cal.toLocaleString()+' / '+targetCal.toLocaleString()+' kcal';

  // Goal hit banner
  const banner = document.getElementById('goalBanner');
  if (t.cal >= targetCal * 0.98 && t.prot >= T.prot * 0.95 && isToday) {
    banner.style.display = 'flex';
  } else { banner.style.display = 'none'; }

  renderMeals(key);
  drawBody();
}

function renderWater() {
  const key = dateStr(offsetDate(currentDayOffset));
  const d = dayCache[key]||{water:0};
  const goal = T.water||8, current = d.water||0;
  document.getElementById('waterVal').textContent = (current*300)+'ml / '+(goal*300)+'ml';
  const con = document.getElementById('waterDots'); con.innerHTML='';
  for (let i=0;i<goal;i++) {
    const btn = document.createElement('button');
    btn.className = 'water-dot'+(i<current?' filled':'');
    btn.textContent = i<current ? '◉' : '○';
    btn.onclick = () => window.toggleWater(i);
    con.appendChild(btn);
  }
}

function renderMeals(key) {
  const d = dayCache[key]||{meals:[]};
  const con = document.getElementById('mealsContainer'); con.innerHTML='';
  CATS.forEach(cat => {
    const meals = (d.meals||[]).filter(m=>m.cat===cat);
    const sec = document.createElement('div'); sec.className='meal-group';
    const head = document.createElement('div'); head.className='meal-group-head';
    head.innerHTML=`<div class="meal-group-label">${CAT_LABELS[cat]}</div><button class="meal-group-add" onclick="window.openAddForCat('${cat}')">+</button>`;
    sec.appendChild(head);
    if (!meals.length) {
      const e = document.createElement('div'); e.className='meal-group-empty'; e.textContent='Nothing logged yet'; sec.appendChild(e);
    } else {
      meals.forEach((meal,idx) => {
        const gi = (d.meals||[]).indexOf(meal);
        const el = document.createElement('div'); el.className='meal-item';
        el.innerHTML=`<div class="meal-info" onclick="window.openEditMeal(${gi})"><div class="meal-name">${meal.name}</div><div class="meal-macros">${meal.cal} kcal · P:${meal.prot}g · C:${meal.carb}g · F:${meal.fat}g</div></div><button class="meal-del-btn" onclick="window.removeMeal(${gi})">×</button>`;
        sec.appendChild(el);
      });
    }
    con.appendChild(sec);
  });
}

// ── MONTH STRIP ────────────────────────────────────────────────────────────
function renderMonthStrip() {
  const strip = document.getElementById('monthStrip'); strip.innerHTML='';
  const todayKey = today();
  // Show last 14 days + today
  for (let i=-13;i<=0;i++) {
    const d = offsetDate(i), key = dateStr(d);
    const h = monthHistory[key]||{cal:0,prot:0};
    const hit = h.cal>=T.cal*0.9&&h.prot>=T.prot*0.9;
    const partial = !hit&&(h.cal>=T.cal*0.5||h.prot>=T.prot*0.5)&&h.cal>0;
    const miss = !hit&&!partial&&h.cal>0;
    const isActive = i===currentDayOffset;
    const cell = document.createElement('div');
    cell.className = 'month-day'+(key===todayKey?' today':'')+(isActive?' active':'');
    const dotColor = hit?'var(--green)':partial?'var(--amber)':miss?'var(--red)':'var(--card-border)';
    cell.innerHTML=`<div class="month-day-label">${DAYS[d.getDay()].slice(0,2)}</div><div class="month-day-num">${d.getDate()}</div><div class="month-day-dot" style="background:${dotColor}"></div>`;
    cell.onclick = () => { currentDayOffset=i; renderMonthStrip(); loadDay(dateStr(offsetDate(i))).then(()=>{renderHome();renderWater();}); };
    strip.appendChild(cell);
  }
  // Scroll to end
  setTimeout(()=>{ strip.scrollLeft=strip.scrollWidth; }, 50);
}

// ── DAY NAV ────────────────────────────────────────────────────────────────
window.changeDay = async function(dir) {
  if (currentDayOffset + dir > 0) return;
  haptic(8);
  currentDayOffset += dir;
  const key = dateStr(offsetDate(currentDayOffset));
  await loadDay(key);
  renderHome();
  renderWater();
  renderMonthStrip();
};

window.openAddForCat = function(cat) {
  document.getElementById('logCat').value = cat;
  window.showTab('log', document.querySelector('[data-tab="log"]'));
};

// ── EDIT MEAL ──────────────────────────────────────────────────────────────
window.openEditMeal = function(idx) {
  const key = dateStr(offsetDate(currentDayOffset));
  const meal = (dayCache[key]?.meals||[])[idx];
  if (!meal) return;
  editingMealIdx = idx;
  document.getElementById('editMealName').textContent = meal.name;
  document.getElementById('editMealMacros').textContent = meal.cal+' kcal · P:'+meal.prot+'g · C:'+meal.carb+'g · F:'+meal.fat+'g';
  document.getElementById('editMealCat').value = meal.cat;
  document.getElementById('editMealServing').value = meal.servings||1;
  const bdEl = document.getElementById('editMealBreakdown');
  if (bdEl) {
    if (meal.breakdown && meal.breakdown.length > 0) {
      bdEl.style.display = 'block';
      bdEl.innerHTML = '<div style="font-size:10px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;">AI Breakdown</div>' +
        meal.breakdown.map(function(item){return '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--card-border);font-size:11.5px;"><div><span style="font-weight:700;">'+item.item+'</span><span style="color:var(--text-dim);margin-left:5px;">'+item.weight+'</span></div><div style="color:var(--text-dim);">'+item.cal+' kcal · P:'+item.prot+'g · C:'+item.carb+'g · F:'+item.fat+'g</div></div>';}).join('');
    } else { bdEl.style.display = 'none'; }
  }
  document.getElementById('editMealModal').classList.add('open');
  window.updateEditMacros();
};

window.updateEditMacros = function() {
  const key = dateStr(offsetDate(currentDayOffset));
  const meal = (dayCache[key]?.meals||[])[editingMealIdx];
  if (!meal) return;
  const mult = parseFloat(document.getElementById('editMealServing').value)||1;
  const cal=Math.round((meal.baseCal||meal.cal)*mult),prot=Math.round((meal.baseProt||meal.prot)*mult),carb=Math.round((meal.baseCarb||meal.carb)*mult),fat=Math.round((meal.baseFat||meal.fat)*mult);
  document.getElementById('editMealPreview').textContent=`${cal} kcal · P:${prot}g · C:${carb}g · F:${fat}g`;
};

window.saveEditMeal = async function() {
  const key = dateStr(offsetDate(currentDayOffset));
  const meal = (dayCache[key]?.meals||[])[editingMealIdx];
  if (!meal) return;
  const mult = parseFloat(document.getElementById('editMealServing').value)||1;
  if (!meal.baseCal) { meal.baseCal=meal.cal; meal.baseProt=meal.prot; meal.baseCarb=meal.carb; meal.baseFat=meal.fat; }
  meal.cal=Math.round(meal.baseCal*mult); meal.prot=Math.round(meal.baseProt*mult); meal.carb=Math.round(meal.baseCarb*mult); meal.fat=Math.round(meal.baseFat*mult);
  meal.servings=mult; meal.cat=document.getElementById('editMealCat').value;
  renderHome(); window.closeModal('editMealModal'); haptic(10);
  saveDay(key);
};

window.removeMeal = async function(idx) {
  haptic(15); soundDelete();
  const key = dateStr(offsetDate(currentDayOffset));
  const meals = dayCache[key]?.meals||[];
  if (idx >= meals.length) return;
  meals.splice(idx,1);
  // Instant UI update
  renderHome(); summarizeDay(key); renderMonthStrip();
  // Save in background
  saveDay(key);
};

// ── WATER ──────────────────────────────────────────────────────────────────
window.toggleWater = function(idx) {
  haptic(8); soundWater();
  const key = dateStr(offsetDate(currentDayOffset));
  if (!dayCache[key]) dayCache[key]={meals:[],water:0,date:key};
  dayCache[key].water = idx < (dayCache[key].water||0) ? idx : idx+1;
  renderWater(); // instant UI update
  saveDay(key); // fire and forget
};

// ── BODY CANVAS ────────────────────────────────────────────────────────────
function drawBody() {
  const canvas = document.getElementById('bodyCanvas');
  const ctx = canvas.getContext('2d');
  const W=canvas.width,H=canvas.height;
  ctx.clearRect(0,0,W,H);
  const key = dateStr(offsetDate(currentDayOffset));
  const t = getTotals(key);
  const targetCal=T.cal+((dayCache[key]||{})._carryover||0);
  const calPct=Math.min(1,t.cal/targetCal),protPct=Math.min(1,t.prot/T.prot);
  const physique=calPct<0.3?0:calPct<0.6?1:protPct>0.7?(protPct>0.9?3:2):1;
  document.getElementById('bodyStatusTag').textContent=['DEPLETED','LEAN','ATHLETIC','JACKED'][physique];
  const fillY=H-(H*calPct*0.85);
  ctx.save(); buildBody(ctx,W,H,physique); ctx.clip();
  ctx.fillStyle='rgba(18,20,26,0.06)'; ctx.fillRect(0,0,W,H);
  const grad=ctx.createLinearGradient(0,H,0,0);
  if (physique>=2){grad.addColorStop(0,'rgba(22,168,99,0.9)');grad.addColorStop(0.5,'rgba(22,168,99,0.7)');grad.addColorStop(1,'rgba(22,168,99,0.4)');}
  else{grad.addColorStop(0,'rgba(18,20,26,0.7)');grad.addColorStop(1,'rgba(18,20,26,0.3)');}
  ctx.fillStyle=grad; ctx.fillRect(0,fillY,W,H-fillY); ctx.restore();
  ctx.save(); buildBody(ctx,W,H,physique);
  ctx.strokeStyle=physique>=2?'rgba(22,168,99,0.6)':'rgba(18,20,26,0.15)'; ctx.lineWidth=1.5; ctx.stroke(); ctx.restore();
  if (physique===3){ctx.save();buildBody(ctx,W,H,physique);ctx.shadowColor='rgba(22,168,99,0.5)';ctx.shadowBlur=20;ctx.strokeStyle='rgba(22,168,99,0.4)';ctx.lineWidth=3;ctx.stroke();ctx.restore();}
}

function buildBody(ctx,W,H,physique) {
  const sc=[0.72,0.82,0.92,1.0][physique],cx=W/2;
  const sw=68*sc,ww=34*sc,hw=44*sc,nw=12,hr=22;
  const hy=28,nt=hy+hr*0.6,nb=nt+16,sy=nb+8,cy=sy+30*sc,wy=sy+70,hipY=wy+22,ty=hipY+50*sc,ky=ty+30,bot=ky+50*sc;
  ctx.beginPath();ctx.arc(cx,hy,hr,0,Math.PI*2);ctx.closePath();
  ctx.moveTo(cx-nw,nt);ctx.lineTo(cx-nw,nb);ctx.lineTo(cx-sw,sy);ctx.lineTo(cx-sw-14*sc,cy+10);ctx.lineTo(cx-ww-8,wy);ctx.lineTo(cx-ww,wy);ctx.lineTo(cx-hw,hipY);ctx.lineTo(cx-hw+6,ty);ctx.lineTo(cx-18,ky);ctx.lineTo(cx-16,bot);ctx.lineTo(cx+16,bot);ctx.lineTo(cx+18,ky);ctx.lineTo(cx+hw-6,ty);ctx.lineTo(cx+hw,hipY);ctx.lineTo(cx+ww,wy);ctx.lineTo(cx+ww+8,wy);ctx.lineTo(cx+sw+14*sc,cy+10);ctx.lineTo(cx+sw,sy);ctx.lineTo(cx+nw,nb);ctx.lineTo(cx+nw,nt);ctx.closePath();
}

// ── NAVIGATION ─────────────────────────────────────────────────────────────
window.showTab = function(tab, btn) {
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.tab-btn,.sidebar-item').forEach(b=>b.classList.remove('active'));
  document.getElementById('screen-'+tab).classList.add('active');
  document.querySelectorAll('[data-tab="'+tab+'"]').forEach(el=>el.classList.add('active'));
  if (btn?.classList.contains('tab-btn')) updateTabPill(btn);
  if (tab==='log') {
    // Scroll to top
    const main = document.getElementById('mainScroll');
    if (main) main.scrollTop = 0;
    // Always reload recent from Firebase when opening log tab
    loadRecent().then(() => renderRecent());
    renderMyFoods();
  }
  if (tab==='trends') renderTrends();
  if (tab==='settings') applySettingsToUI();
  haptic(6);
};

function updateTabPill(btn) {
  const bar=document.querySelector('.tab-bar'),pill=document.getElementById('tabPill');
  if (!bar||!pill||!btn) return;
  const rect=btn.getBoundingClientRect(),barRect=bar.getBoundingClientRect();
  pill.style.left=(rect.left-barRect.left+4)+'px';
  pill.style.width=(rect.width-8)+'px';
}

window.switchLogTab = function(tab) {
  document.querySelectorAll('.log-tab').forEach((t,i)=>t.classList.toggle('active',['recent','myfoods','manual','scan'][i]===tab));
  ['logTabRecent','logTabMyfoods','logTabManual','logTabScan'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
  const map={recent:'logTabRecent',myfoods:'logTabMyfoods',manual:'logTabManual',scan:'logTabScan'};
  const el=document.getElementById(map[tab]);if(el)el.style.display='block';
  haptic(6);
};

// ── SWIPE DOWN MODAL ───────────────────────────────────────────────────────
function setupModalSwipe() {
  document.querySelectorAll('.modal').forEach(modal => {
    let startY=0,isDragging=false;
    modal.addEventListener('touchstart',e=>{startY=e.touches[0].clientY;isDragging=true;},{passive:true});
    modal.addEventListener('touchmove',e=>{
      if(!isDragging)return;
      const dy=e.touches[0].clientY-startY;
      if(dy>0)modal.style.transform=`translateY(${dy}px)`;
    },{passive:true});
    modal.addEventListener('touchend',e=>{
      const dy=e.changedTouches[0].clientY-startY;
      modal.style.transform='';
      if(dy>80){const overlay=modal.closest('.modal-overlay');if(overlay)closeModalSwipe(overlay.id);}
      isDragging=false;
    },{passive:true});
  });
}

function closeModalSwipe(id) {
  const el=document.getElementById(id);
  if(!el)return;
  el.classList.remove('open');
}
window.closeModal=closeModalSwipe;

// ── FOOD SEARCH ────────────────────────────────────────────────────────────
// External food search removed - using local search over recent/saved foods

window.searchLocalFoods = function(q) {
  const results = document.getElementById('searchResults');
  if (!q || q.trim().length < 1) { results.innerHTML = ''; return; }
  const term = q.toLowerCase().trim();
  // Search across recent foods + saved foods
  const recentMatches = recentFoods.filter(f => f.name.toLowerCase().includes(term));
  const savedMatches = allFoods.filter(f => f.name.toLowerCase().includes(term));
  // Deduplicate by name (prefer recent entry)
  const seen = new Set();
  const combined = [...recentMatches, ...savedMatches].filter(f => {
    if (seen.has(f.name)) return false;
    seen.add(f.name); return true;
  });
  results.innerHTML = '';
  if (!combined.length) {
    results.innerHTML = '<div class="search-empty">No matching foods found.</div>';
    return;
  }
  combined.slice(0, 20).forEach(food => {
    const enc = encodeURIComponent(JSON.stringify(food));
    const div = document.createElement('div'); div.className = 'search-result-item';
    div.innerHTML = `<div class="search-result-name">${food.name}</div><div class="search-result-meta">${food.cal} kcal · P:${food.prot}g · C:${food.carb}g · F:${food.fat}g</div>`;
    // Tap to open detail, + to quick add
    div.style.display = 'flex'; div.style.alignItems = 'center'; div.style.gap = '10px';
    const info = document.createElement('div'); info.style.flex = '1';
    info.innerHTML = `<div class="search-result-name">${food.name}</div><div class="search-result-meta">${food.cal} kcal · P:${food.prot}g · C:${food.carb}g · F:${food.fat}g</div>`;
    info.onclick = () => openFoodDetail({...food, serving: food.serving||100, per100:{cal:food.cal,prot:food.prot,carb:food.carb,fat:food.fat}});
    const btn = document.createElement('button');
    btn.className = 'food-item-add'; btn.textContent = '+';
    btn.onclick = (e) => { e.stopPropagation(); window.quickAddRecent(enc); document.getElementById('searchInput').value=''; document.getElementById('searchResults').innerHTML=''; };
    div.innerHTML = ''; div.appendChild(info); div.appendChild(btn);
    results.appendChild(div);
  });
};

// ── FOOD DETAIL ────────────────────────────────────────────────────────────
function openFoodDetail(food) {
  currentFoodDetail={...food};
  document.getElementById('fdName').textContent=food.name;
  const multEl=document.getElementById('fdMultiplier');if(multEl)multEl.value=1;
  document.getElementById('fdCat').value=document.getElementById('logCat').value||'breakfast';
  updateFoodDetailMacros();
  document.getElementById('foodDetailModal').classList.add('open');
}

window.updateFoodDetail=function(){updateFoodDetailMacros();};

function updateFoodDetailMacros() {
  if(!currentFoodDetail)return;
  const mult=parseFloat(document.getElementById('fdMultiplier').value)||1;
  const cal=Math.round(currentFoodDetail.cal*mult),prot=Math.round(currentFoodDetail.prot*mult),carb=Math.round(currentFoodDetail.carb*mult),fat=Math.round(currentFoodDetail.fat*mult);
  document.getElementById('fdMacros').innerHTML=`<div class="fd-macro"><div class="fd-macro-val">${cal}</div><div class="fd-macro-label">kcal</div></div><div class="fd-macro"><div class="fd-macro-val">${prot}g</div><div class="fd-macro-label">Protein</div></div><div class="fd-macro"><div class="fd-macro-val">${carb}g</div><div class="fd-macro-label">Carbs</div></div><div class="fd-macro"><div class="fd-macro-val">${fat}g</div><div class="fd-macro-label">Fats</div></div>`;
  currentFoodDetail._scaled={cal,prot,carb,fat,servings:mult};
}

window.addFoodFromDetail=function(){
  if(!currentFoodDetail?._scaled)return;
  const s=currentFoodDetail._scaled,cat=document.getElementById('fdCat').value;
  const meal={
    cat, name:currentFoodDetail.name,
    cal:s.cal, prot:s.prot, carb:s.carb, fat:s.fat,
    servings: s.servings||1,
    baseCal:currentFoodDetail.cal, baseProt:currentFoodDetail.prot,
    baseCarb:currentFoodDetail.carb, baseFat:currentFoodDetail.fat,
    baseServing:1, ts:Date.now()
  };
  closeModalSwipe('foodDetailModal');
  addMealToDay(meal);
  showToast(currentFoodDetail.name+' added to '+cat);
};

async function addMealToDay(meal) {
  const key=dateStr(offsetDate(currentDayOffset));
  if(!dayCache[key])dayCache[key]={meals:[],water:0,date:key};
  if(!dayCache[key].meals)dayCache[key].meals=[];
  dayCache[key].meals.push(meal);
  // Instant UI - no waiting
  summarizeDay(key);renderHome();renderMonthStrip();soundLog();haptic(10);
  const t=getTotals(key);
  if(t.cal>=T.cal*0.98&&t.prot>=T.prot*0.95){soundGoal();haptic(50);}
  // Save in background - merge with latest to avoid cross-device conflicts
  mergeAndSave(key, meal, 'add');
  addToRecent(meal);
}

async function mergeAndSave(key, meal, op) {
  try {
    const snap = await getDoc(dayRef(key));
    if (snap.exists()) {
      const serverData = snap.data();
      const serverMeals = serverData.meals || [];
      if (op === 'add') {
        // Add meal if not already there (avoid duplicates)
        const isDupe = serverMeals.some(m => m.ts === meal.ts);
        if (!isDupe) serverMeals.push(meal);
        dayCache[key] = {...serverData, meals: serverMeals};
      }
      await setDoc(dayRef(key), dayCache[key]);
    } else {
      await setDoc(dayRef(key), dayCache[key]);
    }
  } catch(e) {
    // Fallback direct save
    try { await setDoc(dayRef(key), dayCache[key]); } catch(e2){}
  }
}

// ── RECENT ─────────────────────────────────────────────────────────────────
function renderRecent() {
  const list=document.getElementById('recentList');
  if(!recentFoods.length){list.innerHTML='<div class="search-empty">No recent foods yet.</div>';return;}
  list.innerHTML='';
  recentFoods.forEach(food=>{
    const enc=encodeURIComponent(JSON.stringify(food));
    const div=document.createElement('div');div.className='food-item';
    div.innerHTML=`<div class="food-item-info" onclick="window.openFoodDetailFromRecent('${enc}')"><div class="food-item-name">${food.name}</div><div class="food-item-meta">${food.cal} kcal · P:${food.prot}g · C:${food.carb}g · F:${food.fat}g</div></div><button class="food-item-add" onclick="window.quickAddRecent('${enc}')">+</button>`;
    list.appendChild(div);
  });
}

window.openFoodDetailFromRecent=function(encoded){
  const food=JSON.parse(decodeURIComponent(encoded));
  openFoodDetail({...food,serving:100,per100:{cal:food.cal,prot:food.prot,carb:food.carb,fat:food.fat}});
};

window.quickAddRecent=function(encoded){
  const food=JSON.parse(decodeURIComponent(encoded));
  const cat=document.getElementById('logCat').value||'breakfast';
  const meal={cat,name:food.name,cal:food.cal,prot:food.prot,carb:food.carb,fat:food.fat,baseServing:1,baseCal:food.cal,baseProt:food.prot,baseCarb:food.carb,baseFat:food.fat,ts:Date.now()};
  addMealToDay(meal);
  // Show a brief toast confirmation instead of redirecting
  showToast(food.name+' added to '+cat);
};

// ── MY FOODS ───────────────────────────────────────────────────────────────
function renderMyFoods() {
  const list=document.getElementById('myFoodsList');
  if(!allFoods.length){list.innerHTML='<div class="search-empty">No saved foods yet.</div>';return;}
  list.innerHTML='';
  allFoods.forEach(food=>{
    const div=document.createElement('div');div.className='food-item';
    div.innerHTML=`<div class="food-item-info" onclick="window.openFoodDetailFromSaved('${food.id}')"><div class="food-item-name">${food.name}</div><div class="food-item-meta">${food.cal} kcal · P:${food.prot}g · C:${food.carb}g · F:${food.fat}g · ${food.serving}g</div></div><button class="food-item-edit" onclick="window.openEditFood('${food.id}')">✎</button><button class="food-item-del" onclick="window.deleteSavedFood('${food.id}')">×</button>`;
    list.appendChild(div);
  });
}

window.openFoodDetailFromSaved=function(id){
  const food=allFoods.find(f=>f.id===id);if(!food)return;openFoodDetail(food);
};

window.deleteSavedFood=async function(id){
  if(!confirm('Delete this food?'))return;
  try{await deleteDoc(doc(db,'tracked',UID,'foods',id));allFoods=allFoods.filter(f=>f.id!==id);renderMyFoods();haptic(15);}catch(e){}
};

window.saveCustomFood=async function(){
  const name=document.getElementById('cfName').value.trim();if(!name)return;
  const source=document.getElementById('cfSource')?.value.trim()||'';
  const fullName=source?name+' ('+source+')':name;
  const food={name:fullName,serving:parseInt(document.getElementById('cfServing').value)||100,cal:parseInt(document.getElementById('cfCal').value)||0,prot:parseInt(document.getElementById('cfProt').value)||0,carb:parseInt(document.getElementById('cfCarb').value)||0,fat:parseInt(document.getElementById('cfFat').value)||0};
  const editId=document.getElementById('createFoodModal').dataset.editId;
  try{
    if(editId){
      // Edit existing
      await setDoc(doc(db,'tracked',UID,'foods',editId),food);
      const idx=allFoods.findIndex(f=>f.id===editId);
      if(idx>-1)allFoods[idx]={id:editId,...food};
    } else {
      // Create new
      const ref=await addDoc(foodsCol(),food);
      allFoods.push({id:ref.id,...food});
    }
    renderMyFoods();closeModalSwipe('createFoodModal');haptic(10);
    document.getElementById('createFoodModal').dataset.editId='';
    document.getElementById('createFoodModalTitle').textContent='Create Food';
  }catch(e){}
};

// ── MANUAL MEAL ────────────────────────────────────────────────────────────
window.saveManualMeal=async function(){
  const name=document.getElementById('manualName').value.trim();if(!name)return;
  const source=document.getElementById('manualSource')?.value.trim()||'';
  const fullName=source?name+' ('+source+')':name;
  const meal={cat:document.getElementById('manualCat').value,name:fullName,cal:parseInt(document.getElementById('manualCal').value)||0,prot:parseInt(document.getElementById('manualProt').value)||0,carb:parseInt(document.getElementById('manualCarb').value)||0,fat:parseInt(document.getElementById('manualFat').value)||0,serving:100,baseServing:100,ts:Date.now()};
  meal.baseCal=meal.cal;meal.baseProt=meal.prot;meal.baseCarb=meal.carb;meal.baseFat=meal.fat;
  addMealToDay(meal);
  ['manualName','manualSource','manualCal','manualProt','manualCarb','manualFat'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  showToast(fullName+' added to '+meal.cat);
};

// ── MODAL SEARCH ───────────────────────────────────────────────────────────
window.doModalSearch=function(){
  const q=document.getElementById('logModalSearch').value.trim();
  if(!q)return;
  const results=document.getElementById('logModalResults');
  const term=q.toLowerCase();
  const combined=[...recentFoods,...allFoods].filter((f,i,arr)=>
    f.name.toLowerCase().includes(term) && arr.findIndex(x=>x.name===f.name)===i
  ).slice(0,8);
  results.innerHTML='';
  if(!combined.length){results.innerHTML='<div style="text-align:center;padding:12px;color:var(--text-faint);font-size:13px;">No results</div>';return;}
  combined.forEach(food=>{
    const div=document.createElement('div');div.className='search-result-item';div.style.marginBottom='4px';
    div.innerHTML=`<div class="search-result-name">${food.name}</div><div class="search-result-meta">${food.cal} kcal · P:${food.prot}g · C:${food.carb}g · F:${food.fat}g</div>`;
    div.onclick=()=>{closeModalSwipe('logModal');openFoodDetail({...food,serving:food.serving||100,per100:{cal:food.cal,prot:food.prot,carb:food.carb,fat:food.fat}});};
    results.appendChild(div);
  });
};

window.openLogModal=function(){
  document.getElementById('logModalSearch').value='';document.getElementById('logModalResults').innerHTML='';
  document.getElementById('logModal').classList.add('open');
};

// ── TRENDS ─────────────────────────────────────────────────────────────────
async function renderTrends() {
  const days=[];
  for(let i=6;i>=0;i--){
    const key=dateStr(offsetDate(-i)),d=offsetDate(-i);
    const label=d.toLocaleDateString('en-GB',{weekday:'short'}).slice(0,2);
    if(dayCache[key]){const meals=dayCache[key].meals||[];days.push({label,cal:meals.reduce((a,m)=>a+(m.cal||0),0),prot:meals.reduce((a,m)=>a+(m.prot||0),0),water:dayCache[key].water||0});}
    else{try{const s=await getDoc(dayRef(key));if(s.exists()){dayCache[key]=s.data();const meals=dayCache[key].meals||[];days.push({label,cal:meals.reduce((a,m)=>a+(m.cal||0),0),prot:meals.reduce((a,m)=>a+(m.prot||0),0),water:dayCache[key].water||0});}else days.push({label,cal:0,prot:0,water:0});}catch(e){days.push({label,cal:0,prot:0,water:0});}}
  }
  renderBarChart('calChart',days,'cal',T.cal,'#12141A');
  renderBarChart('protChart',days,'prot',T.prot,'#378ADD');
  renderBarChart('waterChart',days,'water',T.water,'#378ADD');
}

function renderBarChart(id,days,key,target,color) {
  const el=document.getElementById(id);el.innerHTML='';
  const max=Math.max(target*1.1,...days.map(d=>d[key]),1);
  days.forEach(d=>{
    const pct=Math.round(d[key]/max*100),hit=d[key]>=target*0.9;
    const col=document.createElement('div');col.className='bar-col';
    col.innerHTML=`<div class="bar-val">${d[key]}</div><div class="bar" style="height:${pct}%;background:${hit?'rgba(22,168,99,0.85)':color};opacity:0.8;"></div><div class="bar-label">${d.label}</div>`;
    el.appendChild(col);
  });
}

// ── SETTINGS ───────────────────────────────────────────────────────────────
function applySettingsToUI() {
  document.getElementById('setCal').value=T.cal;document.getElementById('setProt').value=T.prot;
  document.getElementById('setCarb').value=T.carb;document.getElementById('setFat').value=T.fat;
  document.getElementById('setWater').value=T.water||8;document.getElementById('setCarryover').checked=T.carryover||false;
}

window.saveSettings=async function(){
  T={cal:parseInt(document.getElementById('setCal').value)||2865,prot:parseInt(document.getElementById('setProt').value)||183,carb:parseInt(document.getElementById('setCarb').value)||300,fat:parseInt(document.getElementById('setFat').value)||80,water:parseInt(document.getElementById('setWater').value)||8,carryover:document.getElementById('setCarryover').checked};
  try{await setDoc(settingsRef(),T);}catch(e){}
  applySettingsToUI();renderHome();renderWater();drawBody();soundLog();haptic(20);
  alert('Settings saved');
};

// ── AI SCAN ────────────────────────────────────────────────────────────────
window._scanImages=[];

function compressImage(file,maxW,q) {
  return new Promise(resolve=>{
    const reader=new FileReader();
    reader.onload=e=>{
      const img=new Image();
      img.onload=()=>{
        const canvas=document.createElement('canvas');
        let w=img.width,h=img.height;
        if(w>maxW){h=Math.round(h*maxW/w);w=maxW;}
        canvas.width=w;canvas.height=h;
        canvas.getContext('2d').drawImage(img,0,0,w,h);
        const compressed=canvas.toDataURL('image/jpeg',q);
        resolve({data:compressed.split(',')[1],mediaType:'image/jpeg',preview:compressed});
      };
      img.src=e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

window.handleScanImages=async function(input){
  const files=Array.from(input.files).slice(0,4);
  const thumbs=document.getElementById('scanThumbnails');thumbs.innerHTML='';window._scanImages=[];
  for(let i=0;i<files.length;i++){
    const c=await compressImage(files[i],800,0.7);
    window._scanImages.push({data:c.data,mediaType:c.mediaType});
    const wrap=document.createElement('div');wrap.style.cssText='position:relative;width:72px;height:72px;flex-shrink:0;';
    const img=document.createElement('img');img.src=c.preview;
    img.style.cssText='width:72px;height:72px;object-fit:cover;border-radius:12px;border:1px solid var(--card-border);';
    const xBtn=document.createElement('button');
    xBtn.style.cssText='position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;background:#12141A;color:white;border:none;font-size:12px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-weight:700;line-height:1;';
    xBtn.textContent='×';
    const idx=i;
    xBtn.onclick=()=>{window._scanImages.splice(idx,1);wrap.remove();};
    wrap.appendChild(img);wrap.appendChild(xBtn);thumbs.appendChild(wrap);
  }
};

window.reanalyzeMeal=async function(){
  const feedback=document.getElementById('scanFeedback').value.trim();
  if(!feedback){alert('Please write your feedback first.');return;}
  const currentName=document.getElementById('scanEditName').value;
  const currentCal=document.getElementById('scanEditCal').value;
  const currentProt=document.getElementById('scanEditProt').value;
  const status=document.getElementById('scanStatusLog');
  status.textContent='Re-analyzing with your feedback...';
  try{
    const response=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({images:window._scanImages,description:`Previous estimate: ${currentName}, ${currentCal} kcal, ${currentProt}g protein. User feedback: ${feedback}. Please re-estimate based on this correction.`})});
    if(!response.ok)throw new Error('Server error');
    const result=await response.json();if(result.error)throw new Error(result.error);
    status.textContent='';
    document.getElementById('scanEditName').value=result.name;
    document.getElementById('scanEditCal').value=result.cal;
    document.getElementById('scanEditProt').value=result.prot;
    document.getElementById('scanEditCarb').value=result.carb;
    document.getElementById('scanEditFat').value=result.fat;
    document.getElementById('scanResultNotesLog').textContent=result.notes||'';
    document.getElementById('scanFeedback').value='';
    soundLog();haptic(15);
  }catch(e){status.textContent='Re-analysis failed: '+e.message;}
};

window.analyzeMealLog=async function(){
  const desc=document.getElementById('scanDescLog').value.trim();
  const status=document.getElementById('scanStatusLog');
  if(!window._scanImages.length&&!desc){status.textContent='Please add a photo or description.';return;}
  status.textContent='Analyzing with AI...';document.getElementById('scanResultLog').style.display='none';
  try{
    const response=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({images:window._scanImages,description:desc})});
    if(!response.ok)throw new Error('Server error: '+response.status);
    const result=await response.json();if(result.error)throw new Error(result.error);
    status.textContent='';document.getElementById('scanResultLog').style.display='block';
    document.getElementById('scanEditName').value=result.name;document.getElementById('scanEditCal').value=result.cal;
    document.getElementById('scanEditProt').value=result.prot;document.getElementById('scanEditCarb').value=result.carb;
    document.getElementById('scanEditFat').value=result.fat;document.getElementById('scanResultNotesLog').textContent=result.notes||'';
    const bdWrap=document.getElementById('scanBreakdownLog');
    const bdItems=document.getElementById('scanBreakdownItems');
    window._lastScanBreakdown = result.breakdown||[];
    if(bdWrap&&bdItems&&result.breakdown&&result.breakdown.length>0){
      bdWrap.style.display='block';
      bdItems.innerHTML=result.breakdown.map(item=>
        `<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--card-border);font-size:12px;">
          <div><span style="font-weight:700;">${item.item}</span><span style="color:var(--text-dim);margin-left:6px;">${item.weight}</span></div>
          <div style="color:var(--text-dim);text-align:right;">${item.cal} kcal · P:${item.prot}g · C:${item.carb}g · F:${item.fat}g</div>
        </div>`
      ).join('');
    } else if(bdWrap){bdWrap.style.display='none';}
    soundLog();haptic(15);
  }catch(e){status.textContent='Analysis failed: '+e.message;}
};

window.addScannedMealLog=async function(){
  const source=document.getElementById('scanEditSource')?.value.trim()||'';
  const name=document.getElementById('scanEditName').value||'Scanned meal';
  // Collect breakdown items
  const bdItems=document.getElementById('scanBreakdownItems');
  let breakdown=[];
  if(bdItems&&window._lastScanBreakdown){breakdown=window._lastScanBreakdown;}
  const meal={
    cat:document.getElementById('scanCatLog').value,
    name:source?name+' ('+source+')':name,
    cal:parseInt(document.getElementById('scanEditCal').value)||0,
    prot:parseInt(document.getElementById('scanEditProt').value)||0,
    carb:parseInt(document.getElementById('scanEditCarb').value)||0,
    fat:parseInt(document.getElementById('scanEditFat').value)||0,
    baseServing:1,ts:Date.now(),
    breakdown:breakdown
  };
  meal.baseCal=meal.cal;meal.baseProt=meal.prot;meal.baseCarb=meal.carb;meal.baseFat=meal.fat;
  await addMealToDay(meal);
  window.showTab('home',document.querySelector('[data-tab="home"]'));
};

window.resetScan=function(){
  window._scanImages=[];
  document.getElementById('scanThumbnails').innerHTML='';
  document.getElementById('scanDescLog').value='';
  document.getElementById('scanStatusLog').textContent='';
  document.getElementById('scanResultLog').style.display='none';
  document.getElementById('scanBreakdownLog') && (document.getElementById('scanBreakdownLog').style.display='none');
  document.getElementById('scanFeedback') && (document.getElementById('scanFeedback').value='');
  document.getElementById('scanImageInputLog').value='';
  haptic(8);
};

window.resetManual=function(){
  ['manualName','manualSource','manualCal','manualProt','manualCarb','manualFat'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.value='';
  });
  haptic(8);
};

window.openEditFood=function(id){
  const food=allFoods.find(f=>f.id===id);if(!food)return;
  document.getElementById('cfName').value=food.name||'';
  document.getElementById('cfSource').value='';
  document.getElementById('cfServing').value=food.serving||100;
  document.getElementById('cfCal').value=food.cal||0;
  document.getElementById('cfProt').value=food.prot||0;
  document.getElementById('cfCarb').value=food.carb||0;
  document.getElementById('cfFat').value=food.fat||0;
  document.getElementById('createFoodModal').dataset.editId=id;
  document.getElementById('createFoodModalTitle').textContent='Edit Food';
  document.getElementById('createFoodModal').classList.add('open');
};

window.openCreateFoodModal=function(){
  ['cfName','cfSource','cfServing','cfCal','cfProt','cfCarb','cfFat'].forEach(i=>{const el=document.getElementById(i);if(el)el.value='';});
  document.getElementById('createFoodModal').dataset.editId='';
  document.getElementById('createFoodModalTitle').textContent='Create Food';
  document.getElementById('createFoodModal').classList.add('open');
};
window.addPendingMeal=async function(){if(!window._pendingMeal)return;await addMealToDay(window._pendingMeal);window._pendingMeal=null;window.showTab('home',document.querySelector('[data-tab="home"]'));};

init().then(() => startTodayListener());

// Real-time listener for today - auto-syncs across devices
let todayListener = null;
function startTodayListener() {
  if (todayListener) todayListener(); // unsubscribe previous
  const key = dateStr(new Date());
  todayListener = onSnapshot(dayRef(key), (snap) => {
    if (snap.exists()) {
      const fresh = snap.data();
      // Only update if data changed and we're viewing today
      if (currentDayOffset === 0) {
        dayCache[key] = fresh;
        renderHome();
        renderWater();
        summarizeDay(key);
        renderMonthStrip();
      } else {
        dayCache[key] = fresh;
      }
    }
  });
}

// Refresh when switching back to the app
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible') {
    const key = dateStr(offsetDate(currentDayOffset));
    await loadDay(key, true);
    renderHome();
    renderWater();
  }
});
