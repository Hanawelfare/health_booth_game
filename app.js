// app.js - Health Booth Game Logic & Sync Engine
// Supports Dual Sync: Native BroadcastChannel/localStorage + Server API

const AVATARS = ['🍎', '🥑', '🏃', '💧', '🥦', '🚴', '🥗', '🧘', '🍓', '🍊', '🎽', '💖'];

// Application State
const state = {
  isAdmin: false,
  role: 'player', // 'player' | 'admin'
  myPlayer: null, // { empId, name, avatar, score, rank, prizeClaimed }
  room: {
    status: 'lobby', // 'lobby' | 'countdown' | 'playing' | 'finished'
    selectedGame: 'quiz', // 'quiz' | 'tap' | 'catch' | 'swipe'
    players: [],
    questions: [],
    countdown: 3,
    startedAt: null
  },
  questionsBank: [],
  history: [],
  currentGameInstance: null,
  employeesList: [],
  sheetsUrl: ''
};

// BroadcastChannel for instant Tab-to-Tab sync
const syncChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('health_booth_bus') : null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initQuestions();
  initHistory();
  initEmployees();
  initSound();
  checkRoleFromURL();
  renderAvatarGrid();
  setupEventListeners();
  setupSyncListeners();
  loadSharedRoomState();
  startHeartbeat();
});

// Sound Init on first user touch/click
function initSound() {
  document.addEventListener('click', () => soundFX.init(), { once: true });
  document.addEventListener('touchstart', () => soundFX.init(), { once: true });
}

// 1. QUESTION BANK INITIALIZATION & CRUD
function initQuestions() {
  const saved = localStorage.getItem('health_quiz_bank');
  if (saved) {
    try {
      state.questionsBank = JSON.parse(saved);
    } catch (e) {
      state.questionsBank = DEFAULT_HEALTH_QUESTIONS;
    }
  } else {
    state.questionsBank = [...DEFAULT_HEALTH_QUESTIONS];
    saveQuestions();
  }
}

function saveQuestions() {
  localStorage.setItem('health_quiz_bank', JSON.stringify(state.questionsBank));
  broadcastState();
}

function resetDefaultQuestions() {
  if (confirm('คุณต้องการรีเซ็ตคลังคำถามกลับเป็นค่าเริ่มต้น 30 ข้อใช่หรือไม่?')) {
    state.questionsBank = [...DEFAULT_HEALTH_QUESTIONS];
    saveQuestions();
    renderAdminQuestions();
    alert('รีเซ็ตคำถามเรียบร้อยแล้ว!');
  }
}

function addOrUpdateQuestion(qData) {
  if (qData.id) {
    const idx = state.questionsBank.findIndex(q => q.id === qData.id);
    if (idx !== -1) {
      state.questionsBank[idx] = qData;
    }
  } else {
    qData.id = 'q_' + Date.now();
    state.questionsBank.unshift(qData);
  }
  saveQuestions();
  renderAdminQuestions();
}

function deleteQuestion(id) {
  if (confirm('ต้องการลบคำถามข้อนี้ใช่หรือไม่?')) {
    state.questionsBank = state.questionsBank.filter(q => q.id !== id);
    saveQuestions();
    renderAdminQuestions();
  }
}

// 2. HISTORY & LOCAL EXPORT
function initHistory() {
  const saved = localStorage.getItem('health_booth_history');
  if (saved) {
    try { state.history = JSON.parse(saved); } catch (e) { state.history = []; }
  }
}

function saveHistory() {
  localStorage.setItem('health_booth_history', JSON.stringify(state.history));
}

function exportHistoryCSV() {
  if (!state.history.length) {
    alert('ยังไม่มีประวัติการเล่นเกมในระบบค่ะ');
    return;
  }
  let csvContent = '\uFEFF'; // UTF-8 BOM for Excel Thai language support
  csvContent += 'วันเวลา,รหัสพนักงาน,ชื่อพนักงาน,เกมที่เล่น,คะแนน,อันดับ,จำนวนผู้เล่นในรอบ,ได้รับรางวัล\n';

  state.history.forEach(round => {
    round.players.forEach(p => {
      const isWinner = (round.players.length <= 3 && p.rank === 1) || (round.players.length >= 4 && p.rank <= 3);
      const cleanEmpId = String(p.empId || '').trim();
      csvContent += `"${round.playedAt}","\t${cleanEmpId}","${p.name}","${round.gameName}","${p.score}","${p.rank}","${round.totalPlayers}","${prizeText}"\n`;
    });
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `health_booth_players_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// 2.1 GOOGLE SHEETS & EMPLOYEES AUTO-FILL MANAGEMENT
const DEMO_EMPLOYEES = [
  { empId: "650001", fullName: "สมชาย สุขภาพดี", department: "ฝ่ายผลิต (Production)" },
  { empId: "650002", fullName: "วรรณา รักษ์สุขภาพ", department: "การเงินและบัญชี (Finance)" },
  { empId: "650003", fullName: "กิตติศักดิ์ แข็งแรง", department: "เทคโนโลยีสารสนเทศ (IT)" },
  { empId: "650004", fullName: "สุดารัตน์ ยิ้มสดใส", department: "ทรัพยากรบุคคล (HR)" },
  { empId: "650005", fullName: "นพดล คล่องแคล่ว", department: "คลังสินค้าและโลจิสติกส์" },
  { empId: "650006", fullName: "ศิริพร หวานน้อย", department: "จัดซื้อ (Procurement)" },
  { empId: "650007", fullName: "ธีรภัทร วิ่งเร็ว", department: "วิศวกรรม (Engineering)" },
  { empId: "650008", fullName: "อัญชลี นอนพอดี", department: "ความปลอดภัย (Safety)" },
  { empId: "650009", fullName: "ชัยวัฒน์ ดื่มน้ำเยอะ", department: "ซ่อมบำรุง (Maintenance)" },
  { empId: "650010", fullName: "ปรียานุช ผักผลไม้", department: "ควบคุมคุณภาพ (QC)" }
];

const DEFAULT_SHEETS_URL = 'https://script.google.com/macros/s/AKfycbwS_D5RJtw8kL3ILJ5uVWfW3Fj0TKNARdD5aC-cP3Vzyi66axJRRi50Y6cGhTQVXUv1/exec';

function initEmployees() {
  state.sheetsUrl = localStorage.getItem('health_sheets_url') || DEFAULT_SHEETS_URL;
  localStorage.setItem('health_sheets_url', state.sheetsUrl);

  const saved = localStorage.getItem('health_employees_list');
  if (saved) {
    try { 
      state.employeesList = JSON.parse(saved); 
    } catch(e) { 
      state.employeesList = []; 
    }
  }

  // If list is empty or only demo, auto-sync from Google Sheets
  if (!state.employeesList || state.employeesList.length <= 10) {
    syncEmployeesFromGoogleSheets(state.sheetsUrl, false);
  }

  updateEmpCacheCount();
  setupEmpLookupListener();
}

function updateEmpCacheCount() {
  const el = document.getElementById('admin-emp-cache-count');
  if (el) el.textContent = `พนักงานในระบบ: ${state.employeesList.length} คน`;
  const urlInput = document.getElementById('admin-sheets-url');
  if (urlInput && state.sheetsUrl) urlInput.value = state.sheetsUrl;
}

function loadDemoEmployees() {
  state.employeesList = [...DEMO_EMPLOYEES];
  localStorage.setItem('health_employees_list', JSON.stringify(state.employeesList));
  updateEmpCacheCount();
  alert(`โหลดข้อมูลพนักงานตัวอย่าง ${DEMO_EMPLOYEES.length} คนเรียบร้อยแล้วค่ะ! ทดลองพิมพ์รหัส 650001 - 650010 ได้เลยค่ะ`);
}

function saveSheetsUrlAndSync() {
  const urlInput = document.getElementById('admin-sheets-url');
  const url = urlInput ? urlInput.value.trim() : '';
  if (!url) {
    alert('กรุณากรอก Google Apps Script Web App URL ค่ะ');
    return;
  }
  state.sheetsUrl = url;
  localStorage.setItem('health_sheets_url', url);
  syncEmployeesFromGoogleSheets(url);
}

async function syncEmployeesFromGoogleSheets(url, showAlert = true) {
  const statusEl = document.getElementById('sheets-sync-status');
  if (statusEl) {
    statusEl.textContent = '⏳ กำลังเชื่อมต่อและดึงข้อมูลจาก Google Sheet...';
    statusEl.style.color = '#d97706';
  }

  try {
    const fetchUrl = url + (url.includes('?') ? '&' : '?') + 'action=getEmployees';
    const res = await fetch(fetchUrl);
    if (!res.ok) throw new Error('Network error ' + res.status);
    const data = await res.json();

    if (data.status === 'success' && Array.isArray(data.employees)) {
      state.employeesList = data.employees;
      localStorage.setItem('health_employees_list', JSON.stringify(data.employees));
      updateEmpCacheCount();
      if (statusEl) {
        statusEl.textContent = `✅ สำเร็จ! ซิงค์พนักงานทั้งหมด ${data.employees.length} คนเรียบร้อยแล้ว`;
        statusEl.style.color = '#059669';
      }
      if (showAlert) {
        alert(`ดึงข้อมูลพนักงานจาก Google Sheet สำเร็จแล้ว ${data.employees.length} คนค่ะ!`);
      }
    } else {
      throw new Error(data.message || 'รูปแบบข้อมูลไม่ถูกต้อง');
    }
  } catch(err) {
    if (statusEl) {
      statusEl.textContent = `❌ เกิดข้อผิดพลาด: ${err.message}`;
      statusEl.style.color = '#dc2626';
    }
    if (showAlert) {
      alert(`ไม่สามารถเชื่อมต่อ Google Sheet ได้: ${err.message}\n(กรุณาตรวจสอบว่า Deploy Web App เป็น Anyone เรียบร้อยแล้ว)`);
    }
  }
}

function setupEmpLookupListener() {
  const empInput = document.getElementById('emp-id-input');
  if (!empInput) return;

  empInput.addEventListener('input', () => {
    const rawVal = empInput.value.trim();
    const statusEl = document.getElementById('emp-lookup-status');
    const nameInput = document.getElementById('emp-name-input');
    const deptInput = document.getElementById('emp-dept-input');

    if (!rawVal) {
      if (statusEl) statusEl.style.display = 'none';
      return;
    }

    // Try format 6 digits
    let padded = rawVal;
    if (/^\d+$/.test(rawVal) && rawVal.length < 6) {
      padded = ("000000" + rawVal).slice(-6);
    }

    // Lookup in state.employeesList
    const matched = state.employeesList.find(e => 
      e.empId === rawVal || e.empId === padded || (e.rawId && e.rawId === rawVal)
    );

    if (matched) {
      if (nameInput) nameInput.value = matched.fullName || matched.name || '';
      if (deptInput) deptInput.value = matched.department || '';
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.color = '#059669';
        statusEl.innerHTML = `✅ พบข้อมูล: <b>${matched.fullName}</b> (${matched.department || 'ไม่ระบุแผนก'})`;
      }
    } else {
      if (statusEl) {
        if (rawVal.length >= 3) {
          statusEl.style.display = 'block';
          statusEl.style.color = '#64748b';
          statusEl.innerHTML = `ℹ️ ไม่พบในระบบ (คุณสามารถพิมพ์ชื่อ-แผนกเองได้เลยค่ะ)`;
        } else {
          statusEl.style.display = 'none';
        }
      }
    }
  });
}

// Send Result Row to Google Sheet
function sendResultToGoogleSheets(playerData) {
  const url = state.sheetsUrl || localStorage.getItem('health_sheets_url');
  if (!url) return; // Google Sheet not configured, silent fallback

  try {
    fetch(url, {
      method: 'POST',
      mode: 'no-cors', // standard Google Apps Script Web App mode
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(playerData)
    }).catch(err => console.log('Google Sheets sync notice:', err));
  } catch(e) {}
}

// 3. ROLE & URL DETECTION
function checkRoleFromURL() {
  const urlParams = new URLSearchParams(window.location.search);
  const isPageAdmin = window.location.pathname.includes('admin') || urlParams.get('view') === 'admin' || urlParams.get('role') === 'admin';
  if (isPageAdmin) {
    switchToAdmin();
  } else {
    switchToPlayer();
  }
}

function switchToAdmin() {
  state.isAdmin = true;
  state.role = 'admin';
  document.body.classList.add('admin-mode');
  showView('admin-view');
  renderAdminPanel();
  renderAdminQuestions();
  renderAdminHistory();
}

function switchToPlayer() {
  state.isAdmin = false;
  state.role = 'player';
  document.body.classList.remove('admin-mode');
  // Check if player already registered in sessionStorage
  const savedPlayer = sessionStorage.getItem('health_my_player');
  if (savedPlayer) {
    try {
      state.myPlayer = JSON.parse(savedPlayer);
      showView('lobby-view');
      renderLobby();
    } catch(e) {
      showView('join-view');
    }
  } else {
    showView('join-view');
  }
}

// 4. SYNC & BROADCAST ENGINE
function setupSyncListeners() {
  if (syncChannel) {
    syncChannel.onmessage = (event) => {
      const data = event.data;
      if (data && data.type) {
        handleSyncMessage(data);
      }
    };
  }

  // Also listen for storage event as secondary fallback
  window.addEventListener('storage', (e) => {
    if (e.key === 'health_shared_room') {
      loadSharedRoomState();
    }
  });
}

function broadcastState(messageType = 'ROOM_UPDATE') {
  localStorage.setItem('health_shared_room', JSON.stringify(state.room));
  if (syncChannel) {
    syncChannel.postMessage({ type: messageType, room: state.room });
  }
}

function loadSharedRoomState() {
  const saved = localStorage.getItem('health_shared_room');
  if (saved) {
    try {
      const loadedRoom = JSON.parse(saved);
      applyRoomUpdate(loadedRoom);
    } catch(e) {}
  }
}

function handleSyncMessage(data) {
  if (data.type === 'ROOM_UPDATE' || data.type === 'START_GAME' || data.type === 'RESET_ROUND') {
    applyRoomUpdate(data.room);
  }
}

function applyRoomUpdate(newRoom) {
  if (!newRoom) return;
  const prevStatus = state.room.status;
  state.room = newRoom;

  // Refresh myPlayer rank & score from synced room
  if (state.myPlayer) {
    const updated = state.room.players.find(p => p.empId === state.myPlayer.empId);
    if (updated) {
      state.myPlayer = updated;
      sessionStorage.setItem('health_my_player', JSON.stringify(updated));
    }
  }

  // Check state transitions for Player
  if (state.role === 'player') {
    if (state.room.status === 'lobby' && prevStatus !== 'lobby') {
      showView('lobby-view');
      renderLobby();
    } else if (state.room.status === 'countdown' && prevStatus !== 'countdown') {
      triggerCountdownAndStart();
    } else if (state.room.status === 'playing' && prevStatus === 'lobby') {
      launchSelectedGame();
    } else if (state.room.status === 'finished' && prevStatus !== 'finished') {
      showResultsView();
    } else if (state.room.status === 'lobby') {
      renderLobby();
    }
  }

  // If Admin, re-render monitoring
  if (state.role === 'admin') {
    renderAdminLobby();
  }
}

// Heartbeat to poll server if running on server.ps1
function startHeartbeat() {
  setInterval(async () => {
    try {
      const res = await fetch('/api/state', { cache: 'no-store' });
      if (res.ok) {
        const srvRoom = await res.json();
        if (srvRoom && srvRoom.status) {
          applyRoomUpdate(srvRoom);
        }
      }
    } catch (e) {
      // Offline / standalone browser mode, relies on BroadcastChannel & localStorage
    }
  }, 1200);
}

// 5. VIEW SWITCHER
function showView(viewId) {
  const views = ['join-view', 'lobby-view', 'game-view', 'results-view', 'admin-view'];
  views.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = (id === viewId) ? 'block' : 'none';
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// 6. AVATAR PICKER
function renderAvatarGrid() {
  const grid = document.getElementById('avatar-grid');
  if (!grid) return;
  grid.innerHTML = '';
  AVATARS.forEach((av, i) => {
    const item = document.createElement('div');
    item.className = 'avatar-item' + (i === 0 ? ' active' : '');
    item.textContent = av;
    item.dataset.avatar = av;
    item.onclick = () => {
      soundFX.playClick();
      document.querySelectorAll('.avatar-item').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
    };
    grid.appendChild(item);
  });
}

function getSelectedAvatar() {
  const active = document.querySelector('.avatar-item.active');
  return active ? active.dataset.avatar : AVATARS[0];
}

// 7. PLAYER JOIN
function joinRoom() {
  const empIdInput = document.getElementById('emp-id-input');
  const nameInput = document.getElementById('emp-name-input');
  const deptInput = document.getElementById('emp-dept-input');
  const empId = empIdInput ? empIdInput.value.trim() : '';
  const name = nameInput ? nameInput.value.trim() : '';
  const department = deptInput ? deptInput.value.trim() : '';

  if (!empId) {
    alert('กรุณากรอกรหัสพนักงานค่ะ');
    if (empIdInput) empIdInput.focus();
    return;
  }
  if (!name) {
    alert('กรุณากรอกชื่อหรือชื่อเล่นค่ะ');
    if (nameInput) nameInput.focus();
    return;
  }

  const avatar = getSelectedAvatar();
  soundFX.playClick();

  // Check if room is full (max 10)
  if (state.room.players.length >= 10 && !state.room.players.some(p => p.empId === empId)) {
    alert('ขออภัยค่ะ รอบนี้มีผู้เล่นครบ 10 คนแล้ว กรุณารอรอบถัดไปนะคะ');
    return;
  }

  // Create or update player
  let player = state.room.players.find(p => p.empId === empId);
  if (!player) {
    player = {
      empId,
      name,
      department,
      avatar,
      score: 0,
      finished: false,
      rank: 0,
      prizeClaimed: false
    };
    state.room.players.push(player);
  } else {
    player.name = name;
    player.department = department;
    player.avatar = avatar;
  }

  state.myPlayer = player;
  sessionStorage.setItem('health_my_player', JSON.stringify(player));

  // Sync to server or local broadcast
  try {
    fetch('/api/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(player)
    }).catch(() => {});
  } catch(e) {}

  broadcastState();
  showView('lobby-view');
  renderLobby();
}

// 8. LOBBY RENDERING
function renderLobby() {
  const countEl = document.getElementById('lobby-player-count');
  const listEl = document.getElementById('lobby-players-list');
  const gameNameEl = document.getElementById('lobby-selected-game-name');
  const prizeMsgEl = document.getElementById('lobby-prize-message');

  const count = state.room.players.length;
  if (countEl) countEl.textContent = `${count} / 10 คน`;

  // Game Name Display
  const gameNames = {
    quiz: '🧠 Speed Health Quiz (ตอบคำถามสุขภาพ 10 ข้อ)',
    tap: '🔥 Calorie Burner Tap (แตะรัวเบิร์นแคลอรี่ 30 วิ)',
    catch: '🧺 Healthy Catch (เก็บผลไม้ หลบของทอด 30 วิ)',
    swipe: '👆 Healthy Swipe (การ์ดสุขภาพปัดซ้าย-ขวา 30 วิ)'
  };
  if (gameNameEl) gameNameEl.textContent = gameNames[state.room.selectedGame] || gameNames.quiz;

  // Dynamic Prize Rule Message
  if (prizeMsgEl) {
    if (count <= 3) {
      prizeMsgEl.innerHTML = `🎁 <b>กติการอบนี้ (${count} คน):</b> ชิงรางวัลเฉพาะ <b>อันดับ 1</b> 🥇`;
    } else {
      prizeMsgEl.innerHTML = `🎁 <b>กติการอบนี้ (${count} คน):</b> ชิงรางวัล <b>อันดับ 1, 2 และ 3!</b> 🥇🥈🥉`;
    }
  }

  // Player Chips
  if (listEl) {
    listEl.innerHTML = '';
    state.room.players.forEach(p => {
      const chip = document.createElement('div');
      const isMe = state.myPlayer && state.myPlayer.empId === p.empId;
      chip.className = 'player-card-chip' + (isMe ? ' is-me' : '');
      chip.innerHTML = `
        <div class="player-chip-avatar">${p.avatar}</div>
        <div class="player-chip-info">
          <div class="player-chip-name">${p.name} ${isMe ? '(คุณ)' : ''}</div>
          <div class="player-chip-id">ID: ${p.empId}</div>
        </div>
      `;
      listEl.appendChild(chip);
    });
  }
}

// 9. COUNTDOWN OVERLAY & GAME LAUNCH
function triggerCountdownAndStart() {
  soundFX.playCountdownTick();
  const overlay = document.getElementById('countdown-overlay');
  const numEl = document.getElementById('countdown-num');
  if (overlay) overlay.style.display = 'flex';

  let count = 3;
  if (numEl) numEl.textContent = count;

  const timer = setInterval(() => {
    count--;
    if (count > 0) {
      soundFX.playCountdownTick();
      if (numEl) numEl.textContent = count;
    } else if (count === 0) {
      soundFX.playGo();
      if (numEl) numEl.textContent = 'GO!';
    } else {
      clearInterval(timer);
      if (overlay) overlay.style.display = 'none';
      launchSelectedGame();
    }
  }, 1000);
}

function launchSelectedGame() {
  showView('game-view');
  const gameArea = document.getElementById('game-area');
  if (!gameArea) return;
  gameArea.innerHTML = '';

  const game = state.room.selectedGame || 'quiz';
  if (game === 'quiz') {
    startQuizGame(gameArea);
  } else if (game === 'tap') {
    startTapGame(gameArea);
  } else if (game === 'catch') {
    startCatchGame(gameArea);
  } else if (game === 'swipe') {
    startSwipeGame(gameArea);
  }
}

// ==========================================
// GAME 1: SPEED HEALTH QUIZ (10 QUESTIONS)
// ==========================================
function startQuizGame(container) {
  // If questions not synced from room, pick 10 random questions
  let roundQuestions = state.room.questions;
  if (!roundQuestions || roundQuestions.length === 0) {
    roundQuestions = getRandomQuestions(10);
    state.room.questions = roundQuestions;
    broadcastState();
  }

  let currentIdx = 0;
  let score = 0;
  let timerInterval = null;
  const timeLimit = 15; // 15 seconds per question
  let timeLeft = timeLimit;

  function renderQuestion() {
    if (currentIdx >= roundQuestions.length) {
      finishGame(score);
      return;
    }

    const q = roundQuestions[currentIdx];
    // Shuffle choices while keeping track of correct answer
    const choicesWithMeta = q.choices.map((text, idx) => ({
      text,
      isCorrect: idx === q.correct
    }));
    shuffleArray(choicesWithMeta);

    timeLeft = timeLimit;
    container.innerHTML = `
      <div class="card">
        <div class="quiz-header">
          <div class="quiz-progress-text">ข้อที่ ${currentIdx + 1} / ${roundQuestions.length}</div>
          <div class="quiz-timer-pill" id="quiz-timer">⏱️ <span id="time-left-num">${timeLeft}</span>s</div>
        </div>
        <div class="timer-bar-wrapper">
          <div class="timer-bar-fill" id="timer-bar" style="width: 100%;"></div>
        </div>
        <div class="quiz-question-box">
          <span class="quiz-category-tag">${q.category || 'สุขภาพ'}</span>
          <div class="quiz-question-text">${q.question}</div>
        </div>
        <div class="choices-grid" id="choices-grid"></div>
        <div id="quiz-feedback" style="display:none;"></div>
      </div>
    `;

    const grid = document.getElementById('choices-grid');
    const letters = ['A', 'B', 'C', 'D'];

    choicesWithMeta.forEach((ch, idx) => {
      const btn = document.createElement('button');
      btn.className = 'choice-btn';
      btn.innerHTML = `
        <span class="choice-letter">${letters[idx]}</span>
        <span>${ch.text}</span>
      `;
      btn.onclick = () => handleChoice(ch, btn, choicesWithMeta, q.explanation);
      grid.appendChild(btn);
    });

    startTimer();
  }

  function startTimer() {
    clearInterval(timerInterval);
    const bar = document.getElementById('timer-bar');
    const num = document.getElementById('time-left-num');

    timerInterval = setInterval(() => {
      timeLeft -= 0.1;
      if (bar) bar.style.width = `${Math.max(0, (timeLeft / timeLimit) * 100)}%`;
      if (num) num.textContent = Math.ceil(timeLeft);

      if (timeLeft <= 0) {
        clearInterval(timerInterval);
        handleTimeout();
      }
    }, 100);
  }

  function handleChoice(chosen, chosenBtn, allChoices, explanation) {
    clearInterval(timerInterval);
    const allBtns = document.querySelectorAll('.choice-btn');
    allBtns.forEach(b => b.disabled = true);

    const feedback = document.getElementById('quiz-feedback');

    if (chosen.isCorrect) {
      soundFX.playCorrect();
      chosenBtn.classList.add('correct');
      // Scoring formula: 500 base + remaining time * 40
      const earned = Math.round(500 + (timeLeft * 40));
      score += earned;
      if (feedback) {
        feedback.className = 'quiz-feedback-box';
        feedback.style.display = 'block';
        feedback.innerHTML = `✨ <b>ถูกต้อง! (+${earned} คะแนน)</b><br>${explanation || ''}`;
      }
    } else {
      soundFX.playWrong();
      chosenBtn.classList.add('wrong');
      // Highlight the correct one
      allBtns.forEach((b, idx) => {
        if (allChoices[idx].isCorrect) b.classList.add('correct');
      });
      if (feedback) {
        feedback.className = 'quiz-feedback-box';
        feedback.style.borderColor = '#fca5a5';
        feedback.style.background = '#fef2f2';
        feedback.style.color = '#991b1b';
        feedback.style.display = 'block';
        feedback.innerHTML = `❌ <b>ยังไม่ถูกต้องค่ะ</b><br>${explanation || ''}`;
      }
    }

    setTimeout(() => {
      currentIdx++;
      renderQuestion();
    }, 2000);
  }

  function handleTimeout() {
    soundFX.playWrong();
    const allBtns = document.querySelectorAll('.choice-btn');
    allBtns.forEach(b => b.disabled = true);
    const feedback = document.getElementById('quiz-feedback');
    if (feedback) {
      feedback.className = 'quiz-feedback-box';
      feedback.style.display = 'block';
      feedback.innerHTML = `⏰ <b>หมดเวลาค่ะ!</b>`;
    }
    setTimeout(() => {
      currentIdx++;
      renderQuestion();
    }, 1500);
  }

  renderQuestion();
}

// ==========================================
// GAME 2: CALORIE BURNER TAP (30 SECONDS)
// ==========================================
function startTapGame(container) {
  let taps = 0;
  let duration = 30; // 30 seconds
  let timeLeft = duration;
  let caloriesBurned = 0;
  let recentTaps = [];

  container.innerHTML = `
    <div class="card">
      <div class="tap-game-container">
        <div class="tap-scoreboard">
          <div class="tap-stat-item">
            <div class="tap-stat-value" id="tap-time" style="color:#ef4444;">${duration}s</div>
            <div class="tap-stat-label">เวลาที่เหลือ</div>
          </div>
          <div class="tap-stat-item">
            <div class="tap-stat-value" id="tap-count" style="color:#10b981;">0</div>
            <div class="tap-stat-label">จำนวนแตะ (Taps)</div>
          </div>
          <div class="tap-stat-item">
            <div class="tap-stat-value" id="tap-cal" style="color:#f59e0b;">0.0</div>
            <div class="tap-stat-label">แคลอรี่ที่เบิร์น (kcal)</div>
          </div>
        </div>

        <div class="tap-button-wrapper">
          <button class="tap-main-button" id="tap-btn">
            <div class="tap-button-icon">🔥</div>
            <div class="tap-button-text">แตะรัวๆ!</div>
          </button>
        </div>

        <div class="tap-cps-badge" id="tap-cps">⚡ 0.0 แตะ/วินาที</div>
      </div>
    </div>
  `;

  const tapBtn = document.getElementById('tap-btn');
  const countEl = document.getElementById('tap-count');
  const timeEl = document.getElementById('tap-time');
  const calEl = document.getElementById('tap-cal');
  const cpsEl = document.getElementById('tap-cps');

  // Tap action
  function handleTap(e) {
    if (e) e.preventDefault();
    if (timeLeft <= 0) return;

    taps++;
    const now = Date.now();
    recentTaps.push(now);

    // Filter taps in last 1 second for CPS
    recentTaps = recentTaps.filter(t => now - t <= 1000);
    const cps = recentTaps.length;

    soundFX.playTap(Math.min(cps, 15));

    // Fever mode when CPS >= 7
    if (cps >= 7) {
      tapBtn.classList.add('fever');
    } else {
      tapBtn.classList.remove('fever');
    }

    caloriesBurned = (taps * 0.08).toFixed(1);
    if (countEl) countEl.textContent = taps;
    if (calEl) calEl.textContent = caloriesBurned;
    if (cpsEl) cpsEl.textContent = `⚡ ${cps.toFixed(1)} แตะ/วินาที ${cps >= 8 ? '🔥 FEVER!' : ''}`;
  }

  tapBtn.addEventListener('touchstart', handleTap, { passive: false });
  tapBtn.addEventListener('mousedown', handleTap);

  const countdown = setInterval(() => {
    timeLeft--;
    if (timeEl) timeEl.textContent = `${timeLeft}s`;

    if (timeLeft <= 5 && timeLeft > 0) {
      soundFX.playCountdownTick();
    }

    if (timeLeft <= 0) {
      clearInterval(countdown);
      soundFX.playGo();
      // Final score formula: taps * 20
      finishGame(taps * 20);
    }
  }, 1000);
}

// ==========================================
// GAME 3: HEALTHY CATCH (30 SECONDS BONUS)
// ==========================================
function startCatchGame(container) {
  let score = 0;
  let timeLeft = 30;
  container.innerHTML = `
    <div class="card" style="text-align:center;">
      <div class="quiz-header">
        <div class="quiz-progress-text">🧺 Healthy Catch</div>
        <div class="quiz-timer-pill">⏱️ <span id="catch-time">${timeLeft}</span>s</div>
      </div>
      <div style="font-size:24px; font-weight:800; color:#10b981; margin:8px 0;" id="catch-score">แต้ม: 0</div>
      <canvas id="catch-canvas" width="340" height="380" style="background:#f1f5f9; border-radius:12px; touch-action:none;"></canvas>
      <div style="font-size:12px; color:#64748b; margin-top:8px;">ลากตะกร้าเก็บ 🍎 🥑 💧 หลบ 🍟 🧋 🚬</div>
    </div>
  `;

  const canvas = document.getElementById('catch-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let basketX = 170;
  const basketW = 60;
  const items = [];
  const goodIcons = ['🍎', '🥑', '💧', '🥦', '🍓'];
  const badIcons = ['🍟', '🧋', '🚬', '🍩'];

  // Touch & Mouse Drag
  function updateBasket(x) {
    const rect = canvas.getBoundingClientRect();
    basketX = Math.max(basketW / 2, Math.min(canvas.width - basketW / 2, x - rect.left));
  }
  canvas.addEventListener('touchmove', e => { e.preventDefault(); updateBasket(e.touches[0].clientX); }, { passive: false });
  canvas.addEventListener('mousemove', e => updateBasket(e.clientX));

  let spawnTimer = 0;
  let animationId = null;

  function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Spawn items
    spawnTimer++;
    if (spawnTimer % 24 === 0) {
      const isGood = Math.random() > 0.35;
      items.push({
        x: Math.random() * (canvas.width - 40) + 20,
        y: -20,
        speed: 3 + Math.random() * 3,
        icon: isGood ? goodIcons[Math.floor(Math.random() * goodIcons.length)] : badIcons[Math.floor(Math.random() * badIcons.length)],
        isGood
      });
    }

    // Update & draw items
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      it.y += it.speed;

      ctx.font = '26px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(it.icon, it.x, it.y);

      // Collision with basket
      if (it.y >= canvas.height - 35 && it.y <= canvas.height - 10 && Math.abs(it.x - basketX) < basketW / 2 + 10) {
        if (it.isGood) {
          soundFX.playClick();
          score += 150;
        } else {
          soundFX.playWrong();
          score = Math.max(0, score - 100);
        }
        document.getElementById('catch-score').textContent = `แต้ม: ${score}`;
        items.splice(i, 1);
        continue;
      }

      if (it.y > canvas.height + 20) {
        items.splice(i, 1);
      }
    }

    // Draw basket
    ctx.fillStyle = '#10b981';
    ctx.beginPath();
    ctx.roundRect(basketX - basketW / 2, canvas.height - 25, basketW, 16, 8);
    ctx.fill();
    ctx.font = '16px Prompt';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('🧺', basketX, canvas.height - 12);

    animationId = requestAnimationFrame(gameLoop);
  }
  animationId = requestAnimationFrame(gameLoop);

  const timer = setInterval(() => {
    timeLeft--;
    const tEl = document.getElementById('catch-time');
    if (tEl) tEl.textContent = timeLeft;
    if (timeLeft <= 0) {
      clearInterval(timer);
      cancelAnimationFrame(animationId);
      finishGame(score);
    }
  }, 1000);
}

// ==========================================
// GAME 4: HEALTHY SWIPE (30 SECONDS BONUS)
// ==========================================
function startSwipeGame(container) {
  const cards = [
    { text: "ดื่มน้ำเปล่า 1 แก้วหลังตื่นนอน", isHealthy: true },
    { text: "ดื่มชานมไข่มุกหวาน 100% วันละ 2 แก้ว", isHealthy: false },
    { text: "ยืดเหยียดกล้ามเนื้อทุก 1 ชั่วโมง", isHealthy: true },
    { text: "นั่งทำงานต่อเนื่อง 5 ชั่วโมงไม่ลุกเลย", isHealthy: false },
    { text: "นอนหลับพักผ่อน 7-8 ชั่วโมง", isHealthy: true },
    { text: "ทานของทอดน้ำมันซ้ำเป็นประจำ", isHealthy: false },
    { text: "เดินขึ้นบันไดแทนการใช้ลิฟต์ 1 ชั้น", isHealthy: true },
    { text: "เล่นมือถือบนเตียงในที่มืดจนดึก", isHealthy: false },
    { text: "ทานผักผลไม้ครึ่งหนึ่งของมื้ออาหาร", isHealthy: true },
    { text: "สูบบุหรี่คลายเครียดระหว่างวัน", isHealthy: false }
  ];
  shuffleArray(cards);

  let score = 0;
  let cardIdx = 0;
  let timeLeft = 30;

  function renderCard() {
    if (cardIdx >= cards.length || timeLeft <= 0) {
      finishGame(score);
      return;
    }
    const c = cards[cardIdx];
    container.innerHTML = `
      <div class="card" style="text-align:center;">
        <div class="quiz-header">
          <div class="quiz-progress-text">👆 Healthy Swipe</div>
          <div class="quiz-timer-pill">⏱️ <span id="swipe-time">${timeLeft}</span>s</div>
        </div>
        <div style="font-size:24px; font-weight:800; color:#10b981; margin:8px 0;" id="swipe-score">แต้ม: ${score}</div>
        <div style="background:#f8fafc; border:2px dashed #cbd5e1; border-radius:16px; padding:32px 16px; margin:20px 0; min-height:160px; display:flex; align-items:center; justify-content:center; font-size:18px; font-weight:600;">
          ${c.text}
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <button class="btn btn-danger" id="swipe-bad-btn">👈 ไม่เฮลท์ตี้</button>
          <button class="btn btn-primary" id="swipe-good-btn">👉 เฮลท์ตี้</button>
        </div>
      </div>
    `;

    document.getElementById('swipe-bad-btn').onclick = () => answerSwipe(false);
    document.getElementById('swipe-good-btn').onclick = () => answerSwipe(true);
  }

  function answerSwipe(chosenHealthy) {
    const c = cards[cardIdx];
    if (chosenHealthy === c.isHealthy) {
      soundFX.playCorrect();
      score += 200;
    } else {
      soundFX.playWrong();
    }
    cardIdx++;
    renderCard();
  }

  const timer = setInterval(() => {
    timeLeft--;
    const tEl = document.getElementById('swipe-time');
    if (tEl) tEl.textContent = timeLeft;
    if (timeLeft <= 0) {
      clearInterval(timer);
      finishGame(score);
    }
  }, 1000);

  renderCard();
}

// 10. GAME COMPLETION & SCORING
function finishGame(finalScore) {
  if (state.myPlayer) {
    state.myPlayer.score = finalScore;
    state.myPlayer.finished = true;

    // Send score to server if online
    try {
      fetch('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empId: state.myPlayer.empId, score: finalScore })
      }).catch(() => {});
    } catch(e) {}

    // Update in local room
    const p = state.room.players.find(x => x.empId === state.myPlayer.empId);
    if (p) {
      p.score = finalScore;
      p.finished = true;
    }

    // Rank players
    sortAndRankPlayers();

    // Check if all finished
    const allDone = state.room.players.every(x => x.finished);
    if (allDone && state.room.players.length > 0) {
      state.room.status = 'finished';
      archiveRoundToHistory();

      // Send to Google Sheets if configured
      state.room.players.forEach(p => {
        const isWinner = (state.room.players.length <= 3 && p.rank === 1) || (state.room.players.length >= 4 && p.rank <= 3);
        sendResultToGoogleSheets({
          empId: p.empId,
          fullName: p.name,
          department: p.department || '',
          gameName: state.room.selectedGame,
          score: p.score,
          rank: p.rank,
          totalPlayers: state.room.players.length,
          isWinner: isWinner
        });
      });
    }

    broadcastState('ROOM_UPDATE');
  }

  showResultsView();
}

function sortAndRankPlayers() {
  state.room.players.sort((a, b) => b.score - a.score);
  state.room.players.forEach((p, idx) => {
    p.rank = idx + 1;
  });
  if (state.myPlayer) {
    const me = state.room.players.find(p => p.empId === state.myPlayer.empId);
    if (me) state.myPlayer.rank = me.rank;
  }
}

function archiveRoundToHistory() {
  const roundRecord = {
    roundId: 'R_' + Date.now(),
    gameName: state.room.selectedGame,
    playedAt: new Date().toLocaleString('th-TH'),
    totalPlayers: state.room.players.length,
    players: JSON.parse(JSON.stringify(state.room.players))
  };
  state.history.unshift(roundRecord);
  saveHistory();
}

// 11. RESULTS VIEW & PRIZE CLAIM NOTIFICATION
function showResultsView() {
  showView('results-view');
  sortAndRankPlayers();

  const rankBadgeEl = document.getElementById('my-rank-badge');
  const scoreTextEl = document.getElementById('my-score-text');
  const claimBoxEl = document.getElementById('claim-prize-box');
  const lbContainer = document.getElementById('round-leaderboard-list');

  const myRank = state.myPlayer ? state.myPlayer.rank : 1;
  const myScore = state.myPlayer ? state.myPlayer.score : 0;
  const totalPlayers = state.room.players.length;

  // Determine Prize Eligibility:
  // 1-3 players: 1st place only gets prize
  // 4-10 players: 1st, 2nd, 3rd get prizes
  const isWinner = (totalPlayers <= 3 && myRank === 1) || (totalPlayers >= 4 && myRank <= 3);

  if (rankBadgeEl) {
    rankBadgeEl.className = 'my-rank-badge';
    if (myRank === 1) {
      rankBadgeEl.classList.add('rank-gold');
      rankBadgeEl.innerHTML = `🥇 อันดับที่ 1 (แชมป์รอบนี้!)`;
    } else if (myRank === 2) {
      rankBadgeEl.classList.add('rank-silver');
      rankBadgeEl.innerHTML = `🥈 อันดับที่ 2`;
    } else if (myRank === 3) {
      rankBadgeEl.classList.add('rank-bronze');
      rankBadgeEl.innerHTML = `🥉 อันดับที่ 3`;
    } else {
      rankBadgeEl.classList.add('rank-normal');
      rankBadgeEl.innerHTML = `อันดับที่ ${myRank}`;
    }
  }

  if (scoreTextEl) scoreTextEl.textContent = `${myScore} คะแนน`;

  // Claim Prize Box
  if (claimBoxEl) {
    if (isWinner) {
      soundFX.playFanfare();
      triggerConfetti();
      claimBoxEl.style.display = 'block';
      claimBoxEl.innerHTML = `
        <div class="claim-prize-title">🎉 ยินดีด้วยค่ะ! คุณได้รับรางวัล</div>
        <div class="claim-prize-desc">กรุณานำหน้าจอมือถือนี้แสดงต่อเจ้าหน้าที่บูธเพื่อรับของรางวัลได้ทันที!</div>
        <div style="font-size:12px; margin-top:8px; opacity:0.8;">รหัสพนักงาน: <b>${state.myPlayer.empId}</b> (${state.myPlayer.name})</div>
      `;
    } else {
      claimBoxEl.style.display = 'block';
      claimBoxEl.style.background = '#f1f5f9';
      claimBoxEl.style.borderColor = '#cbd5e1';
      claimBoxEl.innerHTML = `
        <div style="font-size:15px; font-weight:700; color:#475569;">เก่งมากเลยค่ะ! สุขภาพดีเริ่มต้นที่ตัวเรา</div>
        <div style="font-size:13px; color:#64748b; margin-top:4px;">คุณสามารถกลับมาเล่นซ้ำเพื่อชิงรางวัลในรอบถัดไปได้นะคะ 💪</div>
      `;
    }
  }

  // Render Leaderboard
  if (lbContainer) {
    lbContainer.innerHTML = '';
    state.room.players.forEach(p => {
      const isMe = state.myPlayer && state.myPlayer.empId === p.empId;
      const row = document.createElement('div');
      row.className = 'lb-row' + (isMe ? ' is-me' : '');
      row.innerHTML = `
        <div class="lb-left">
          <div class="lb-rank-num">${p.rank}</div>
          <div>
            <div style="font-size:14px; font-weight:600;">${p.avatar} ${p.name} ${isMe ? '(คุณ)' : ''}</div>
            <div style="font-size:11px; color:#6b7280;">ID: ${p.empId}</div>
          </div>
        </div>
        <div class="lb-score">${p.score} คะแนน</div>
      `;
      lbContainer.appendChild(row);
    });
  }
}

// 12. ADMIN CONSOLE MANAGEMENT
function renderAdminPanel() {
  renderAdminLobby();
  renderQRAtAdmin();
}

function renderQRAtAdmin() {
  const qrBox = document.getElementById('admin-qr-container');
  if (qrBox && typeof renderQRCode === 'function') {
    // Current URL without admin params for players
    const playerURL = window.location.origin + window.location.pathname.replace('admin.html', 'index.html');
    renderQRCode(qrBox, playerURL, 180);
    const urlText = document.getElementById('admin-url-text');
    if (urlText) urlText.textContent = playerURL;
  }
}

function renderAdminLobby() {
  const countEl = document.getElementById('admin-player-count');
  const listEl = document.getElementById('admin-players-list');
  const count = state.room.players.length;

  if (countEl) countEl.textContent = `${count} / 10 คน`;

  // Dynamic Rule Notice for Admin
  const ruleEl = document.getElementById('admin-rule-notice');
  if (ruleEl) {
    if (count <= 3) {
      ruleEl.textContent = `⚡ กติกาอัตโนมัติ: มีผู้เล่น ${count} คน -> แจกเฉพาะอันดับ 1`;
    } else {
      ruleEl.textContent = `⚡ กติกาอัตโนมัติ: มีผู้เล่น ${count} คน -> แจกอันดับ 1, 2, 3`;
    }
  }

  if (listEl) {
    listEl.innerHTML = '';
    if (count === 0) {
      listEl.innerHTML = '<div style="color:#94a3b8; font-size:13px; text-align:center; padding:12px;">ยังไม่มีผู้เล่นสแกนเข้ามา</div>';
      return;
    }
    state.room.players.forEach(p => {
      const chip = document.createElement('div');
      chip.className = 'player-card-chip';
      chip.innerHTML = `
        <div class="player-chip-avatar">${p.avatar}</div>
        <div class="player-chip-info" style="flex:1;">
          <div class="player-chip-name">${p.name}</div>
          <div class="player-chip-id">ID: ${p.empId} ${p.score ? `(${p.score} แต้ม)` : ''}</div>
        </div>
        <button class="btn-icon" onclick="kickPlayer('${p.empId}')" title="เตะออก">❌</button>
      `;
      listEl.appendChild(chip);
    });
  }
}

function selectAdminGame(gameType) {
  soundFX.playClick();
  state.room.selectedGame = gameType;
  document.querySelectorAll('.game-card-select').forEach(el => {
    el.classList.toggle('selected', el.dataset.game === gameType);
  });
  broadcastState('ROOM_UPDATE');
}

function kickPlayer(empId) {
  state.room.players = state.room.players.filter(p => p.empId !== empId);
  broadcastState('ROOM_UPDATE');
  renderAdminLobby();
}

function adminStartGame() {
  if (state.room.players.length === 0) {
    alert('ยังไม่มีผู้เล่นในห้องค่ะ กรุณาให้พนักงานสแกน QR Code เพื่อเข้าร่วมก่อนนะคะ');
    return;
  }
  soundFX.playClick();

  // If Quiz selected, pick 10 random questions from bank for this round
  if (state.room.selectedGame === 'quiz') {
    state.room.questions = getRandomQuestions(10);
  }

  state.room.status = 'countdown';
  broadcastState('START_GAME');

  // Trigger countdown locally on admin view
  triggerCountdownAndStart();
}

function adminResetRound() {
  if (confirm('ต้องการล้างห้องและเริ่มรอบใหม่ใช่หรือไม่?')) {
    soundFX.playClick();
    state.room.status = 'lobby';
    state.room.players = [];
    state.room.questions = [];
    broadcastState('RESET_ROUND');
    renderAdminLobby();
  }
}

// 13. ADMIN QUESTION BANK VIEW & CRUD
function renderAdminQuestions() {
  const container = document.getElementById('admin-questions-list');
  const countBadge = document.getElementById('admin-q-total-count');
  if (countBadge) countBadge.textContent = `${state.questionsBank.length} ข้อ`;

  if (!container) return;
  container.innerHTML = '';

  state.questionsBank.forEach((q, idx) => {
    const card = document.createElement('div');
    card.className = 'q-admin-card';
    card.innerHTML = `
      <div class="q-admin-top">
        <span class="q-badge">${idx + 1}. ${q.category || 'สุขภาพ'}</span>
        <div class="q-action-btns">
          <button class="btn-icon" onclick="openEditQuestionModal('${q.id}')">✏️ แก้ไข</button>
          <button class="btn-icon" style="color:#ef4444;" onclick="deleteQuestion('${q.id}')">🗑️ ลบ</button>
        </div>
      </div>
      <div style="font-weight:600; font-size:14px; margin-bottom:8px;">${q.question}</div>
      <div style="font-size:12px; color:#4b5563; line-height:1.4;">
        <b>คำตอบที่ถูกต้อง:</b> ${q.choices[q.correct]}
      </div>
    `;
    container.appendChild(card);
  });
}

function openAddQuestionModal() {
  soundFX.playClick();
  document.getElementById('q-modal-title').textContent = '➕ เพิ่มคำถามสุขภาพใหม่';
  document.getElementById('q-modal-id').value = '';
  document.getElementById('q-modal-category').value = 'Office Syndrome';
  document.getElementById('q-modal-text').value = '';
  document.getElementById('q-modal-c0').value = '';
  document.getElementById('q-modal-c1').value = '';
  document.getElementById('q-modal-c2').value = '';
  document.getElementById('q-modal-c3').value = '';
  document.getElementById('q-modal-correct').value = '0';
  document.getElementById('q-modal-exp').value = '';
  document.getElementById('question-modal').style.display = 'flex';
}

function openEditQuestionModal(id) {
  soundFX.playClick();
  const q = state.questionsBank.find(x => x.id === id);
  if (!q) return;

  document.getElementById('q-modal-title').textContent = '✏️ แก้ไขคำถามสุขภาพ';
  document.getElementById('q-modal-id').value = q.id;
  document.getElementById('q-modal-category').value = q.category || 'สุขภาพ';
  document.getElementById('q-modal-text').value = q.question;
  document.getElementById('q-modal-c0').value = q.choices[0] || '';
  document.getElementById('q-modal-c1').value = q.choices[1] || '';
  document.getElementById('q-modal-c2').value = q.choices[2] || '';
  document.getElementById('q-modal-c3').value = q.choices[3] || '';
  document.getElementById('q-modal-correct').value = q.correct.toString();
  document.getElementById('q-modal-exp').value = q.explanation || '';
  document.getElementById('question-modal').style.display = 'flex';
}

function closeQuestionModal() {
  document.getElementById('question-modal').style.display = 'none';
}

function saveQuestionModal() {
  const id = document.getElementById('q-modal-id').value;
  const category = document.getElementById('q-modal-category').value.trim();
  const text = document.getElementById('q-modal-text').value.trim();
  const c0 = document.getElementById('q-modal-c0').value.trim();
  const c1 = document.getElementById('q-modal-c1').value.trim();
  const c2 = document.getElementById('q-modal-c2').value.trim();
  const c3 = document.getElementById('q-modal-c3').value.trim();
  const correct = parseInt(document.getElementById('q-modal-correct').value, 10);
  const explanation = document.getElementById('q-modal-exp').value.trim();

  if (!text || !c0 || !c1 || !c2 || !c3) {
    alert('กรุณากรอกโจทย์คำถามและตัวเลือกทั้ง 4 ข้อให้ครบถ้วนค่ะ');
    return;
  }

  addOrUpdateQuestion({
    id: id || undefined,
    category: category || 'สุขภาพ',
    question: text,
    choices: [c0, c1, c2, c3],
    correct,
    explanation
  });

  closeQuestionModal();
}

// 14. ADMIN HISTORY VIEW
function renderAdminHistory() {
  const container = document.getElementById('admin-history-table');
  if (!container) return;
  container.innerHTML = '';

  if (state.history.length === 0) {
    container.innerHTML = '<div style="color:#94a3b8; text-align:center; padding:16px;">ยังไม่มีประวัติการเล่นเกม</div>';
    return;
  }

  state.history.forEach(h => {
    const card = document.createElement('div');
    card.className = 'q-admin-card';
    card.style.marginBottom = '10px';

    let playersHTML = '';
    h.players.forEach(p => {
      const isWinner = (h.players.length <= 3 && p.rank === 1) || (h.players.length >= 4 && p.rank <= 3);
      playersHTML += `
        <div style="display:flex; justify-content:space-between; font-size:12px; padding:3px 0; border-bottom:1px dashed #e2e8f0;">
          <span>${p.rank}. ${p.avatar} ${p.name} (${p.empId})</span>
          <span><b>${p.score} แต้ม</b> ${isWinner ? '🎁 ได้รางวัล' : ''}</span>
        </div>
      `;
    });

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; font-size:12px; color:#64748b; margin-bottom:6px;">
        <span>🎮 ${h.gameName} (${h.totalPlayers} คน)</span>
        <span>🕒 ${h.playedAt}</span>
      </div>
      <div>${playersHTML}</div>
    `;
    container.appendChild(card);
  });
}

// 15. HELPER UTILITIES
function getRandomQuestions(num) {
  const pool = [...state.questionsBank];
  shuffleArray(pool);
  return pool.slice(0, Math.min(num, pool.length));
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Simple Confetti effect
function triggerConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const particles = [];
  const colors = ['#10b981', '#f59e0b', '#6366f1', '#ef4444', '#ec4899', '#3b82f6'];

  for (let i = 0; i < 90; i++) {
    particles.push({
      x: canvas.width / 2,
      y: canvas.height / 2,
      vx: (Math.random() - 0.5) * 16,
      vy: (Math.random() - 0.7) * 18,
      size: Math.random() * 8 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      alpha: 1
    });
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let active = false;
    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.4; // gravity
      p.alpha -= 0.012;
      if (p.alpha > 0) {
        active = true;
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.alpha;
        ctx.fillRect(p.x, p.y, p.size, p.size);
      }
    });
    if (active) requestAnimationFrame(render);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  render();
}

// 16. EVENT LISTENERS
function setupEventListeners() {
  // Join Button
  const joinBtn = document.getElementById('join-btn');
  if (joinBtn) joinBtn.onclick = joinRoom;

  // Leave / Reset from player side
  const leaveBtn = document.getElementById('play-again-btn');
  if (leaveBtn) {
    leaveBtn.onclick = () => {
      soundFX.playClick();
      showView('lobby-view');
      renderLobby();
    };
  }

  // Admin Switch Tab
  document.querySelectorAll('.admin-tab-btn').forEach(btn => {
    btn.onclick = () => {
      soundFX.playClick();
      document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      document.querySelectorAll('.admin-tab-content').forEach(c => c.style.display = 'none');
      const target = document.getElementById('admin-tab-' + tab);
      if (target) target.style.display = 'block';
    };
  });
}
