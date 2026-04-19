/**
 * ui.js — Rendering layer
 * Pure DOM manipulation and template rendering.
 * Reads globals from store.js (constants, state, helpers) and app.js (test state).
 * Does NOT write to localStorage or mutate application state directly.
 */

/* ══════════════════════════════════════════
   THEME
   ══════════════════════════════════════════ */

/**
 * Apply a visual theme to the page.
 * @param {'dark'|'light'} theme
 */
function applyTheme(theme) {
  const isLight = theme === 'light';
  document.body.classList.toggle('light', isLight);
  document.getElementById('themeToggle').textContent = isLight ? '☀️' : '🌙';
  document.getElementById('themeColorMeta').setAttribute('content', isLight ? '#f6f7f9' : '#0a0a0a');
}

/** Toggle between dark and light theme, persist the choice */
function toggleTheme() {
  const cur  = localStorage.getItem(THEME_KEY) || 'dark';
  const next = cur === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}

// Apply saved theme immediately on load
applyTheme(localStorage.getItem(THEME_KEY) || 'dark');

/* ══════════════════════════════════════════
   SCREEN NAVIGATION
   ══════════════════════════════════════════ */

/**
 * Show one top-level screen, hide all others.
 * @param {'home'|'test'|'edit'|'review'} id
 */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if (id === 'home') {
    renderDecks();
    renderStreak();
  }
}

/* ══════════════════════════════════════════
   HOME — STREAK BAR
   ══════════════════════════════════════════ */

/** Render today's solved count and consecutive streak days */
function renderStreak() {
  const s          = loadStreak();
  const today      = getTodayKey();
  const todayCount = s.lastDate === today ? (s.today  || 0) : 0;
  const streakDays = s.lastDate === today ? (s.streak || 0) : 0;

  document.getElementById('streakBar').innerHTML = `
    <div class="streak-chip">
      <span class="s-icon">📘</span>
      <span class="s-num">${todayCount}</span>
      <span class="s-label">오늘 푼 문제</span>
    </div>
    <div class="streak-chip">
      <span class="s-icon">🔥</span>
      <span class="s-num">${streakDays}</span>
      <span class="s-label">일 연속</span>
    </div>
  `;
}

/* ══════════════════════════════════════════
   HOME — DECK LIST
   ══════════════════════════════════════════ */

/**
 * Format a Unix-ms timestamp as a human-readable relative string.
 * @param {number} ts
 * @returns {string}
 */
function formatAgo(ts) {
  const diff = Date.now() - ts;
  const m = 60 * 1000, h = 60 * m, d = 24 * h;
  if (diff < h)     return '방금 전';
  if (diff < d)     return `${Math.floor(diff / h)}시간 전`;
  if (diff < 7 * d) return `${Math.floor(diff / d)}일 전`;
  return new Date(ts).toLocaleDateString('ko-KR');
}

/** Render the full deck list for the active tab (currentTab from store.js) */
function renderDecks() {
  // Sync active states on sort tabs and tab buttons
  document.querySelectorAll('.sort-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.sort === currentSort));
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === currentTab));

  const el      = document.getElementById('deckList');
  const sortRow = document.getElementById('sortRow');
  const sorted  = getSortedDecks();

  if (sorted.length === 0) {
    const msg  = currentTab === 'sentence'
      ? '문장 암기장이 없습니다<br>엑셀 업로드 → 문장 암기 선택'
      : '단어장이 없습니다<br>엑셀 파일을 업로드해 주세요';
    const icon = currentTab === 'sentence' ? '📝' : '📚';
    el.innerHTML = `<div class="empty"><span class="empty-icon">${icon}</span><p>${msg}</p></div>`;
    sortRow.style.display = 'none';
    return;
  }

  sortRow.style.display = sorted.length >= 2 ? 'flex' : 'none';

  const unit = currentTab === 'sentence' ? '문장' : '단어';
  el.innerHTML = sorted.map(({ d, origIdx }) => {
    const cnt = deckItems(d).length;
    const tl  = d.timeLimit ? ` · ⏱${d.timeLimit}초` : '';
    return `
    <div class="deck-card">
      <div class="deck-body" onclick="openModeModal(${origIdx})">
        <div class="deck-name">${esc(d.name)}</div>
        <div class="deck-count">${cnt}개 ${unit}${tl}${d.lastStudiedAt ? ` · ${formatAgo(d.lastStudiedAt)}` : ''}</div>
      </div>
      <div class="deck-actions">
        <button class="deck-btn share" onclick="shareDeck(${origIdx})" title="링크 공유">🔗</button>
        <button class="deck-btn merge" onclick="mergeDeck(${origIdx})">⊕</button>
        <button class="deck-btn edit"  onclick="openEdit(${origIdx})">✎</button>
        <button class="deck-btn del"   onclick="deleteDeck(${origIdx})">✕</button>
      </div>
    </div>`;
  }).join('');
}

/* ══════════════════════════════════════════
   EDIT SCREEN
   ══════════════════════════════════════════ */

/**
 * Re-render the edit-screen item list from editItems (declared in app.js).
 * Wires live input→editItems sync handlers after rendering.
 */
function renderEditList() {
  const d            = decks[editDeckIdx];        // editDeckIdx from app.js
  const type         = deckType(d);
  const primaryField = type === 'sentence' ? 'sentence' : 'word';
  const primaryPh    = type === 'sentence' ? '영어 문장' : '영단어';

  document.getElementById('editCount').textContent = `${editItems.length}개`;

  const el = document.getElementById('editList');
  el.innerHTML = editItems.map((it, i) => `
    <div class="edit-row">
      <div class="edit-word">
        <input type="text" value="${esc(it[primaryField] || '')}" data-field="primary" data-idx="${i}" placeholder="${primaryPh}">
      </div>
      <div class="edit-meaning">
        <input type="text" value="${esc(it.meaning || '')}" data-field="meaning" data-idx="${i}" placeholder="뜻">
      </div>
      <button class="edit-del" onclick="removeWord(${i})">✕</button>
    </div>
  `).join('');

  // Wire live-edit: keep editItems in sync as the user types
  el.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', e => {
      const idx   = parseInt(e.target.dataset.idx, 10);
      const field = e.target.dataset.field === 'primary' ? primaryField : 'meaning';
      editItems[idx][field] = e.target.value;   // editItems from app.js
    });
  });
}

/* ══════════════════════════════════════════
   SENTENCE TEST UI
   ══════════════════════════════════════════ */

/**
 * Render the token-slot area and word bank for the current sentence question.
 * State variables (sSelected, sBank, sTokens, feedbackLocked) are in app.js.
 */
function renderSentenceUI() {
  const slots = document.getElementById('sSlots');
  const bank  = document.getElementById('sBank');

  // Slot area — shows tokens in the order the user placed them
  slots.innerHTML = sSelected.length === 0
    ? '<span style="color:var(--sub);font-size:13px;padding:8px">여기에 단어를 순서대로 놓으세요</span>'
    : sSelected.map(bid => {
        const b = sBank.find(x => x.id === bid);
        return `<button class="tok-btn placed" onclick="sUnplace(${bid})">${esc(b.token)}</button>`;
      }).join('');

  // Word bank — placed tokens become invisible placeholders to preserve layout
  bank.innerHTML = sBank.map(b =>
    b.placed
      ? `<button class="tok-btn hidden-slot">${esc(b.token)}</button>`
      : `<button class="tok-btn" onclick="sPlace(${b.id})">${esc(b.token)}</button>`
  ).join('');

  document.getElementById('sCheckBtn').disabled =
    sSelected.length !== sTokens.length || feedbackLocked;
  slots.classList.remove('correct', 'wrong');
}
