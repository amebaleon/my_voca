/**
 * app.js — Application logic & event flow
 * Test flow, user actions, event listeners, and page initialisation.
 * Reads data via store.js globals, triggers rendering via ui.js globals.
 */

/* ══════════════════════════════════════════
   TEST STATE
   ══════════════════════════════════════════ */
/** @type {'choice'|'typing'|'order'} */
let testMode       = 'choice';
/** @type {'normal'|'reverse'} */
let testDirection  = 'normal';
/** @type {number[]} shuffled indices into currentDeck items */
let testQueue      = [];
let testIdx        = 0;
/** @type {string[]} current multiple-choice options */
let testChoices    = [];
/** @type {Object[]} items the user got wrong during this run */
let reviewList     = [];
/** @type {Object|null} active deck */
let currentDeck    = null;
let currentDeckIdx = -1;
/** Prevents double-firing while feedback animation is in progress */
let feedbackLocked = false;

/* ── Timer ── */
let timerInterval  = null;
let timerRemaining = 0;
let timerActive    = false;

/* ── Combo ── */
let comboCount = 0;

/* ── Edit screen ── */
let editDeckIdx = -1;
/** @type {Object[]} working copy of items being edited */
let editItems   = [];

/* ── Upload pending ── */
let pendingDeckIdx    = -1;
let pendingUploadType = 'word';

/* ── Sentence test ── */
/** @type {string[]} correct token sequence */
let sTokens   = [];
/** @type {Array<{id:number, token:string, placed:boolean}>} */
let sBank     = [];
/** @type {number[]} bank ids in the user-chosen order */
let sSelected = [];

/* ══════════════════════════════════════════
   UPLOAD TYPE MODAL
   ══════════════════════════════════════════ */
function openUploadTypeModal() {
  document.getElementById('uploadTypeModal').classList.add('active');
}
function closeUploadTypeModal() {
  document.getElementById('uploadTypeModal').classList.remove('active');
}

/**
 * Store the chosen upload type and open the file picker.
 * @param {'word'|'sentence'} type
 */
function pickUploadType(type) {
  pendingUploadType = type;
  closeUploadTypeModal();
  document.getElementById('fileInput').click();
}

/**
 * Parse an uploaded .xlsx file and create a new deck.
 * @param {Event} e  File input change event
 */
function handleFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const type = pendingUploadType || 'word';

  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const data  = new Uint8Array(evt.target.result);
      const wb    = XLSX.read(data, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows  = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

      const items = [];
      for (let i = 0; i < rows.length; i++) {
        const a = String(rows[i][0] || '').trim();
        const b = String(rows[i][1] || '').trim();
        if (!a || !b) continue;
        // Skip optional header row
        if (i === 0 && ['word', 'sentence'].includes(a.toLowerCase())) continue;
        items.push(type === 'sentence' ? { sentence: a, meaning: b } : { word: a, meaning: b });
      }

      if (items.length === 0) {
        alert('유효한 항목이 없습니다.\n1열: ' + (type === 'sentence' ? '문장' : '단어') + ', 2열: 뜻');
        return;
      }

      const name = file.name.replace(/\.xlsx?$/i, '');
      const deck = { id: Date.now(), type, name, createdAt: Date.now(), lastStudiedAt: 0, timeLimit: 0 };
      if (type === 'sentence') deck.sentences = items;
      else                    deck.words     = items;

      decks.push(deck);
      saveDecks();
      currentTab = type;
      localStorage.setItem(TAB_KEY, currentTab);
      renderDecks();
    } catch (err) {
      alert('파일 읽기 오류: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
  e.target.value = '';
}

/* ══════════════════════════════════════════
   SHARE / IMPORT DECK (URL)
   ══════════════════════════════════════════ */

/**
 * Generate a base64-encoded shareable URL for a deck and copy it to clipboard.
 * @param {number} idx  Index into decks[]
 */
function shareDeck(idx) {
  const d = decks[idx];
  const payload = { n: d.name, t: deckType(d), i: deckItems(d), tl: d.timeLimit || 0 };
  let encoded;
  try {
    encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  } catch(e) { alert('공유 링크 생성 실패'); return; }

  const url = `${location.origin}${location.pathname}?deck=${encoded}`;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url)
      .then(() => alert('📋 링크가 복사됐습니다!\n친구에게 공유하면 바로 단어장을 가져올 수 있어요.'))
      .catch(() => prompt('이 링크를 복사해서 공유하세요:', url));
  } else {
    prompt('이 링크를 복사해서 공유하세요:', url);
  }
}

/**
 * Parse the ?deck= query parameter on page load and offer to import the shared deck.
 * Called once during init.
 */
function checkImportFromUrl() {
  const params  = new URLSearchParams(location.search);
  const encoded = params.get('deck');
  if (!encoded) return;
  try {
    const p = JSON.parse(decodeURIComponent(escape(atob(encoded))));
    if (!p.n || !Array.isArray(p.i) || p.i.length === 0) return;
    history.replaceState({}, '', location.pathname);

    const type  = p.t === 'sentence' ? 'sentence' : 'word';
    const items = p.i.map(it =>
      type === 'sentence'
        ? { sentence: String(it.sentence || ''), meaning: String(it.meaning || '') }
        : { word:     String(it.word     || ''), meaning: String(it.meaning || '') }
    ).filter(it => (it.sentence || it.word) && it.meaning);
    if (items.length === 0) return;

    if (!confirm(`"${p.n}" 단어장을 가져올까요?\n(${items.length}개 항목)`)) return;

    const deck = { id: Date.now(), type, name: p.n, createdAt: Date.now(), lastStudiedAt: 0, timeLimit: p.tl || 0 };
    if (type === 'sentence') deck.sentences = items;
    else                    deck.words     = items;
    decks.push(deck);
    saveDecks();
    currentTab = type;
    localStorage.setItem(TAB_KEY, currentTab);
    renderDecks();
    alert(`"${p.n}" 단어장이 추가됐습니다!`);
  } catch(e) { /* ignore malformed payloads */ }
}

/* ══════════════════════════════════════════
   TAB & SORT
   ══════════════════════════════════════════ */

/** @param {'word'|'sentence'} tab */
function setTab(tab) {
  currentTab = tab;
  localStorage.setItem(TAB_KEY, tab);
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab));
  renderDecks();
}

/** @param {'recent'|'created'|'name'} mode */
function setSort(mode) {
  currentSort = mode;
  localStorage.setItem(SORT_KEY, mode);
  renderDecks();
}

/* ══════════════════════════════════════════
   DECK OPERATIONS
   ══════════════════════════════════════════ */

/** @param {number} idx */
function deleteDeck(idx) {
  if (!confirm(`"${decks[idx].name}" 단어장을 삭제할까요?`)) return;
  decks.splice(idx, 1);
  saveDecks();
  renderDecks();
}

/**
 * Merge items from another deck into the deck at idx (de-duplicated by label).
 * @param {number} idx
 */
function mergeDeck(idx) {
  const target = decks[idx];
  const type   = deckType(target);
  const others = decks.map((d, i) => ({ d, i })).filter(x => x.i !== idx && deckType(x.d) === type);

  if (others.length === 0) { alert('합칠 동일 종류의 단어장이 없습니다.'); return; }

  const options = others.map((x, n) => `${n + 1}. ${x.d.name} (${deckItems(x.d).length}개)`).join('\n');
  const input   = prompt(`"${target.name}"에 합칠 번호를 선택하세요:\n\n${options}`);
  if (input === null) return;
  const num = parseInt(input, 10);
  if (num < 1 || num > others.length) { alert('올바른 번호를 입력해 주세요.'); return; }

  const source    = others[num - 1].d;
  const sourceIdx = others[num - 1].i;
  const tItems    = deckItems(target);
  const sItems    = deckItems(source);
  const keyOf     = x => deckItemLabel(target, x).toLowerCase();
  const existing  = new Set(tItems.map(keyOf));

  let added = 0;
  sItems.forEach(it => {
    if (!existing.has(deckItemLabel(source, it).toLowerCase())) {
      tItems.push({ ...it });
      existing.add(deckItemLabel(source, it).toLowerCase());
      added++;
    }
  });
  setDeckItems(target, tItems);

  const skipped   = sItems.length - added;
  const delSource = confirm(
    `${added}개 추가 완료!${skipped > 0 ? ` (중복 ${skipped}개 제외)` : ''}\n\n"${source.name}" 원본을 삭제할까요?`
  );
  if (delSource) decks.splice(sourceIdx, 1);
  saveDecks();
  renderDecks();
}

/* ══════════════════════════════════════════
   MODE MODAL
   ══════════════════════════════════════════ */

/** @param {number} deckIdx */
function openModeModal(deckIdx) {
  const deck  = decks[deckIdx];
  if (!deck) return;
  const type  = deckType(deck);
  const items = deckItems(deck);
  if (type === 'word'     && items.length < 4) { alert('최소 4개 이상의 단어가 필요합니다.'); return; }
  if (type === 'sentence' && items.length < 1) { alert('문장이 비어있습니다.'); return; }

  pendingDeckIdx = deckIdx;
  const count = Math.min(500, items.length);
  const unit  = type === 'sentence' ? '문장' : '문제';
  document.getElementById('modeSub').textContent = `${deck.name} · ${count}${unit}`;

  document.getElementById('modeWordOptions').style.display     = type === 'word'     ? '' : 'none';
  document.getElementById('modeSentenceOptions').style.display = type === 'sentence' ? '' : 'none';

  // Sync direction toggle
  document.getElementById('dirNormal').classList.toggle('active',  testDirection === 'normal');
  document.getElementById('dirReverse').classList.toggle('active', testDirection === 'reverse');

  document.getElementById('modeModal').classList.add('active');
}

function closeModeModal() {
  document.getElementById('modeModal').classList.remove('active');
  pendingDeckIdx = -1;
}

/** @param {'normal'|'reverse'} dir */
function setDirection(dir) {
  testDirection = dir;
  document.getElementById('dirNormal').classList.toggle('active',  dir === 'normal');
  document.getElementById('dirReverse').classList.toggle('active', dir === 'reverse');
}

/** @param {'choice'|'typing'|'order'} mode */
function confirmMode(mode) {
  const deckIdx = pendingDeckIdx;
  closeModeModal();
  testMode = mode;
  if (mode === 'order') startSentenceTest(deckIdx);
  else                  startTest(deckIdx);
}

/* ══════════════════════════════════════════
   START TEST (word mode)
   ══════════════════════════════════════════ */

/** @param {number} deckIdx */
function startTest(deckIdx) {
  currentDeck    = decks[deckIdx];
  currentDeckIdx = deckIdx;
  if (!currentDeck || (currentDeck.words || []).length < 4) {
    alert('최소 4개 이상의 단어가 필요합니다.'); return;
  }

  const indices = shuffle(Array.from({ length: currentDeck.words.length }, (_, i) => i));
  testQueue      = indices.slice(0, Math.min(500, indices.length));
  testIdx        = 0;
  reviewList     = [];
  feedbackLocked = false;
  comboCount     = 0;
  hideCombo();

  document.getElementById('wordArea').style.display    = '';
  document.getElementById('sentenceArea').classList.remove('active');
  document.getElementById('choicesGrid').style.display = testMode === 'choice' ? 'grid' : 'none';
  document.getElementById('typingArea').classList.toggle('active', testMode === 'typing');
  document.getElementById('ttsToggle').textContent     = ttsEnabled ? '🔊' : '🔇';

  showScreen('test');
  renderQuestion();
}

/** Quit the current test and return to home screen */
function quitTest() {
  if (testIdx > 0 && !confirm('테스트를 종료할까요?\n진행 상황이 사라집니다.')) return;
  stopTimer();
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  hideCombo();
  showScreen('home');
}

/* ══════════════════════════════════════════
   COMBO BADGE
   ══════════════════════════════════════════ */

/** Hide the combo badge (top-right fixed overlay) */
function hideCombo() {
  document.getElementById('comboBadge').classList.remove('show', 'pop');
}

/**
 * Update the combo counter and badge display.
 * @param {boolean} isCorrect
 */
function updateCombo(isCorrect) {
  const badge = document.getElementById('comboBadge');
  const numEl = document.getElementById('comboNum');
  if (!isCorrect) { comboCount = 0; hideCombo(); return; }
  comboCount++;
  if (comboCount >= 5) {
    numEl.textContent = comboCount;
    badge.classList.add('show');
    badge.classList.remove('pop');
    void badge.offsetWidth; // force reflow so the animation restarts
    badge.classList.add('pop');
  }
}

/* ══════════════════════════════════════════
   TTS (Text-To-Speech)
   ══════════════════════════════════════════ */

/**
 * Speak text via the Web Speech API.
 * @param {string}           text
 * @param {'en-US'|'ko-KR'} [lang='en-US']
 */
function speakWord(text, lang) {
  if (!ttsEnabled || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
    const u  = new SpeechSynthesisUtterance(String(text));
    u.lang   = lang || 'en-US';
    u.rate   = 0.95;
    window.speechSynthesis.speak(u);
  } catch(e) {}
}

/** Toggle TTS on/off and persist the preference */
function toggleTts() {
  ttsEnabled = !ttsEnabled;
  localStorage.setItem(TTS_KEY, ttsEnabled ? 'on' : 'off');
  document.getElementById('ttsToggle').textContent = ttsEnabled ? '🔊' : '🔇';
  if (!ttsEnabled && window.speechSynthesis) window.speechSynthesis.cancel();
}

/** Re-speak the current question text (triggered by tapping the word area) */
function replaySpeak() {
  if (!currentDeck) return;
  const idx  = testQueue[testIdx];
  if (idx == null) return;
  const items = currentDeck.words || currentDeck.sentences || [];
  const item  = items[idx];
  if (!item) return;
  const isReverse = testDirection === 'reverse';
  const txt  = deckType(currentDeck) === 'sentence'
    ? item.sentence
    : (isReverse ? item.meaning : item.word);
  const lang = (deckType(currentDeck) === 'sentence' || !isReverse) ? 'en-US' : 'ko-KR';
  speakWord(txt, lang);
}

/* ══════════════════════════════════════════
   TIMER
   ══════════════════════════════════════════ */

/** Stop and hide the countdown timer */
function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  timerActive = false;
  const el = document.getElementById('timer');
  el.style.display = 'none';
  el.classList.remove('warn');
}

/** Start the per-question countdown timer (uses currentDeck.timeLimit) */
function startTimer() {
  stopTimer();
  const tl = (currentDeck && currentDeck.timeLimit) || 0;
  if (tl <= 0) return;

  timerRemaining = tl;
  timerActive    = true;
  const el = document.getElementById('timer');
  el.style.display = '';
  el.textContent   = `⏱ ${timerRemaining}s`;
  el.classList.toggle('warn', timerRemaining <= 3);

  timerInterval = setInterval(() => {
    if (feedbackLocked) return; // pause during feedback animations
    timerRemaining--;
    el.textContent = `⏱ ${timerRemaining}s`;
    el.classList.toggle('warn', timerRemaining <= 3);
    if (timerRemaining <= 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      timerActive   = false;
      handleTimeout();
    }
  }, 1000);
}

/** Called when the timer runs out — delegates to the appropriate skip handler */
function handleTimeout() {
  if (testMode === 'order') sHandleSkip(true);
  else                      handleSkip(true);
}

/* ══════════════════════════════════════════
   RENDER QUESTION (word mode)
   ══════════════════════════════════════════ */

/** Render the current word-mode question (choice or typing) */
function renderQuestion() {
  const total     = testQueue.length;
  const progress  = testIdx + 1;
  const wordObj   = currentDeck.words[testQueue[testIdx]];
  const isReverse = testDirection === 'reverse';

  document.getElementById('progressTxt').textContent  = `${progress} / ${total}`;
  document.getElementById('progressFill').style.width = `${(progress / total) * 100}%`;
  document.getElementById('wordDisplay').textContent  = isReverse ? wordObj.meaning : wordObj.word;
  document.getElementById('wordHint').textContent     = isReverse ? '단어를 맞히세요' : '뜻을 맞히세요';

  speakWord(isReverse ? wordObj.meaning : wordObj.word, isReverse ? 'ko-KR' : 'en-US');

  if (testMode === 'choice') {
    const correctAnswer = isReverse ? wordObj.word : wordObj.meaning;
    const wrongPool = [];
    for (let i = 0; i < currentDeck.words.length; i++) {
      if (i !== testQueue[testIdx])
        wrongPool.push(isReverse ? currentDeck.words[i].word : currentDeck.words[i].meaning);
    }
    testChoices = shuffle([correctAnswer, ...shuffle(wrongPool).slice(0, 3)]);

    document.getElementById('choicesGrid').innerHTML = testChoices.map((c, i) =>
      `<button class="choice-btn" onclick="handleChoice(${i})">${esc(c)}</button>`
    ).join('');
  } else {
    const input = document.getElementById('typingInput');
    input.value = '';
    input.classList.remove('correct', 'wrong');
    input.disabled    = false;
    input.placeholder = isReverse ? '단어를 입력하세요' : '뜻을 입력하세요';
    document.getElementById('typingAnswer').textContent  = '';
    document.getElementById('typingSubmit').disabled     = false;
    setTimeout(() => input.focus(), 50);
  }

  startTimer();
}

/* ══════════════════════════════════════════
   HANDLE CHOICE
   ══════════════════════════════════════════ */

/**
 * Process a multiple-choice selection.
 * @param {number} idx  Index into testChoices[]
 */
function handleChoice(idx) {
  if (feedbackLocked) return;
  const wordObj       = currentDeck.words[testQueue[testIdx]];
  const selected      = testChoices[idx];
  const correctAnswer = testDirection === 'reverse' ? wordObj.word : wordObj.meaning;
  const isCorrect     = selected === correctAnswer;

  recordSolved();
  updateCombo(isCorrect);

  if (isCorrect) {
    stopTimer();
    goNext();
  } else {
    feedbackLocked = true;
    stopTimer();
    reviewList.push(wordObj);
    const btns = document.querySelectorAll('.choice-btn');
    btns.forEach((btn, i) => {
      btn.classList.add('disabled');
      if (i === idx)                        btn.classList.add('wrong');
      if (testChoices[i] === correctAnswer) btn.classList.add('correct');
    });
    setTimeout(() => { feedbackLocked = false; goNext(); }, 500);
  }
}

/* ══════════════════════════════════════════
   LENIENT TYPING MATCH
   ══════════════════════════════════════════ */

/** Two-character Korean particles to strip from token tails */
const KOR_PARTICLES_2 = ['에서','으로','로서','로써','부터','까지','에게','한테','께서','보다','처럼','같이','마다','조차','마저','이나','이라','라고'];
/** Single-character Korean particles to strip from token tails */
const KOR_PARTICLES_1 = ['을','를','이','가','은','는','의','에','도','만','와','과','로','나','뿐','며','고','면','서'];

/**
 * Iteratively strip trailing Korean particles from a token.
 * @param {string} t
 * @returns {string}
 */
function stripKorTail(t) {
  let changed = true;
  while (changed && t.length > 1) {
    changed = false;
    for (const p of KOR_PARTICLES_2) {
      if (t.endsWith(p) && t.length > p.length + 1) {
        t = t.slice(0, -p.length); changed = true; break;
      }
    }
    if (changed) continue;
    if (t.length > 1 && KOR_PARTICLES_1.includes(t.slice(-1))) {
      t = t.slice(0, -1); changed = true;
    }
  }
  return t;
}

/**
 * Split a string on comma / semicolon / middle-dot / newline.
 * @param {string} s
 * @returns {string[]}
 */
function splitParts(s) {
  return String(s).split(/[,，;；·ㆍ\n]+/).map(x => x.trim()).filter(Boolean);
}

/**
 * Remove parenthetical content from a string.
 * @param {string} s
 * @returns {string}
 */
function stripParens(s) {
  return String(s).replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');
}

/**
 * Normalise a Korean phrase for loose comparison:
 * lowercased, particles stripped, punctuation removed, joined.
 * @param {string}  s
 * @param {boolean} dropParens  If true, parenthetical content is removed
 * @returns {string}
 */
function normalizeLoose(s, dropParens) {
  let t = String(s).toLowerCase();
  t = dropParens ? stripParens(t) : t.replace(/[()\[\]]/g, ' ');
  t = t.replace(/[.,;!?~'"`\/]+/g, ' ');
  return t.split(/\s+/).filter(Boolean).map(stripKorTail).join('');
}

/**
 * Build a set of normalised forms for a correct-answer string,
 * covering the whole string and each comma-separated part.
 * @param {string} meaning
 * @returns {Set<string>}
 */
function buildCorrectVariants(meaning) {
  const set = new Set();
  [meaning, ...splitParts(meaning)].forEach(src => {
    const a = normalizeLoose(src, true);
    const b = normalizeLoose(src, false);
    if (a) set.add(a);
    if (b) set.add(b);
  });
  set.delete('');
  return set;
}

/**
 * Normalise an English answer (lowercase, strip punctuation, collapse spaces).
 * @param {string} s
 * @returns {string}
 */
function normalizeEnglish(s) {
  return String(s).toLowerCase().replace(/\s+/g, ' ').trim()
    .replace(/[.,;!?'"`]/g, '').replace(/\s+/g, '');
}

/**
 * Check whether a single user-input part matches any correct variant.
 * @param {string}      part
 * @param {Set<string>} correctSet   Pre-built Korean variants (null for English)
 * @param {boolean}     isEnglish
 * @param {string}      correctAnswer  Raw correct answer string
 * @returns {boolean}
 */
function matchesOne(part, correctSet, isEnglish, correctAnswer) {
  if (isEnglish) {
    return splitParts(correctAnswer).some(cp => normalizeEnglish(part) === normalizeEnglish(cp))
        || normalizeEnglish(part) === normalizeEnglish(correctAnswer);
  }
  const a = normalizeLoose(part, true);
  const b = normalizeLoose(part, false);
  return (a && correctSet.has(a)) || (b && correctSet.has(b));
}

/**
 * Full lenient typing-answer check.
 *  • Single input  → accepted if it matches ANY correct variant
 *  • Multiple inputs (comma-separated) → ALL must match a correct variant
 * @param {string}  userInput
 * @param {string}  correctAnswer
 * @param {boolean} isEnglish  true when the expected answer is in English (reverse mode)
 * @returns {boolean}
 */
function checkTypingAnswer(userInput, correctAnswer, isEnglish) {
  if (!userInput.trim()) return false;
  const correctSet = isEnglish ? null : buildCorrectVariants(correctAnswer);
  const userParts  = splitParts(userInput);
  if (userParts.length <= 1) {
    return matchesOne(userInput.trim(), correctSet, isEnglish, correctAnswer);
  }
  return userParts.every(p => matchesOne(p, correctSet, isEnglish, correctAnswer));
}

/* ══════════════════════════════════════════
   HANDLE TYPING SUBMIT
   ══════════════════════════════════════════ */

/** Process the user's typed answer submission */
function handleTypingSubmit() {
  if (feedbackLocked) return;
  const input      = document.getElementById('typingInput');
  const userAnswer = input.value.trim();
  if (!userAnswer) return;

  const wordObj     = currentDeck.words[testQueue[testIdx]];
  const isReverse   = testDirection === 'reverse';
  const correctText = isReverse ? wordObj.word : wordObj.meaning;
  const isCorrect   = checkTypingAnswer(userAnswer, correctText, isReverse);

  recordSolved();
  updateCombo(isCorrect);
  stopTimer();
  feedbackLocked = true;
  input.disabled = true;
  document.getElementById('typingSubmit').disabled = true;

  if (isCorrect) {
    input.classList.add('correct');
    setTimeout(() => { feedbackLocked = false; goNext(); }, 300);
  } else {
    reviewList.push(wordObj);
    input.classList.add('wrong');
    document.getElementById('typingAnswer').textContent = `✓ ${correctText}`;
    setTimeout(() => { feedbackLocked = false; goNext(); }, 1400);
  }
}

/* ══════════════════════════════════════════
   HANDLE SKIP
   ══════════════════════════════════════════ */

/**
 * Skip the current question (user pressed skip or timer ran out).
 * Routes to sHandleSkip() in sentence-order mode.
 * @param {boolean} [isTimeout=false]
 */
function handleSkip(isTimeout) {
  if (testMode === 'order') { sHandleSkip(isTimeout); return; } // sentence mode
  if (feedbackLocked) return;
  feedbackLocked = true;
  stopTimer();

  const wordObj     = currentDeck.words[testQueue[testIdx]];
  const correctText = testDirection === 'reverse' ? wordObj.word : wordObj.meaning;
  reviewList.push(wordObj);
  recordSolved();
  updateCombo(false);

  if (testMode === 'choice') {
    const btns = document.querySelectorAll('.choice-btn');
    btns.forEach((btn, i) => {
      btn.classList.add('disabled');
      if (testChoices[i] === correctText) btn.classList.add('reveal');
    });
  } else {
    const input = document.getElementById('typingInput');
    input.disabled = true;
    input.classList.add('wrong');
    document.getElementById('typingSubmit').disabled    = true;
    document.getElementById('typingAnswer').textContent = `✓ ${correctText}`;
  }

  setTimeout(() => { feedbackLocked = false; goNext(); }, testMode === 'choice' ? 600 : 1400);
}

/* ══════════════════════════════════════════
   GO NEXT / FINISH
   ══════════════════════════════════════════ */

/** Advance to the next question or show the review screen */
function goNext() {
  testIdx++;
  if (testIdx >= testQueue.length) {
    stopTimer();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (currentDeckIdx >= 0 && decks[currentDeckIdx]) {
      decks[currentDeckIdx].lastStudiedAt = Date.now();
      saveDecks();
    }
    showReview();
    return;
  }
  if (testMode === 'order') sRenderQuestion();
  else                      renderQuestion();
}

/* ══════════════════════════════════════════
   EDIT DECK
   ══════════════════════════════════════════ */

/** @param {number} idx */
function openEdit(idx) {
  editDeckIdx = idx;
  const d = decks[idx];
  editItems = deckItems(d).map(it => ({ ...it }));
  document.getElementById('editTitleInput').value = d.name;
  document.getElementById('editTimeLimit').value  = d.timeLimit || '';
  renderEditList();
  showScreen('edit');
}

/** @param {number} idx  Item index in editItems to remove */
function removeWord(idx) {
  editItems.splice(idx, 1);
  renderEditList();
}

/** Append a blank item to editItems and focus the new row */
function addWord() {
  const type = deckType(decks[editDeckIdx]);
  editItems.push(type === 'sentence' ? { sentence: '', meaning: '' } : { word: '', meaning: '' });
  renderEditList();
  const el = document.getElementById('editList');
  el.scrollTop = el.scrollHeight;
  const inputs = el.querySelectorAll('.edit-row:last-child input');
  if (inputs[0]) inputs[0].focus();
}

/** Validate, save, and return to home */
function saveAndBack() {
  const d    = decks[editDeckIdx];
  const type = deckType(d);

  const newName = document.getElementById('editTitleInput').value.trim();
  if (newName) d.name = newName;

  const tl = parseInt(document.getElementById('editTimeLimit').value, 10);
  d.timeLimit = (isNaN(tl) || tl < 0) ? 0 : Math.min(300, tl);

  const updated = editItems
    .map(it => type === 'sentence'
      ? { sentence: String(it.sentence || '').trim(), meaning: String(it.meaning || '').trim() }
      : { word:     String(it.word     || '').trim(), meaning: String(it.meaning || '').trim() })
    .filter(it => (it.sentence || it.word) && it.meaning);

  setDeckItems(d, updated);
  saveDecks();
  showScreen('home');
}

/* ══════════════════════════════════════════
   SENTENCE TEST (order / word-arrangement mode)
   ══════════════════════════════════════════ */

/**
 * Split a sentence string into an array of word tokens.
 * @param {string} s
 * @returns {string[]}
 */
function tokenizeSentence(s) {
  return String(s).trim().split(/\s+/).filter(Boolean);
}

/** @param {number} deckIdx */
function startSentenceTest(deckIdx) {
  currentDeck    = decks[deckIdx];
  currentDeckIdx = deckIdx;
  const items    = currentDeck.sentences || [];
  if (items.length < 1) { alert('문장이 없습니다.'); return; }

  const indices  = shuffle(Array.from({ length: items.length }, (_, i) => i));
  testQueue      = indices.slice(0, Math.min(500, indices.length));
  testIdx        = 0;
  reviewList     = [];
  feedbackLocked = false;
  comboCount     = 0;
  hideCombo();

  document.getElementById('wordArea').style.display    = 'none';
  document.getElementById('choicesGrid').style.display = 'none';
  document.getElementById('typingArea').classList.remove('active');
  document.getElementById('sentenceArea').classList.add('active');
  document.getElementById('ttsToggle').textContent     = ttsEnabled ? '🔊' : '🔇';

  showScreen('test');
  sRenderQuestion();
}

/** Render the current sentence ordering question */
function sRenderQuestion() {
  const total    = testQueue.length;
  const progress = testIdx + 1;
  const item     = currentDeck.sentences[testQueue[testIdx]];

  document.getElementById('progressTxt').textContent  = `${progress} / ${total}`;
  document.getElementById('progressFill').style.width = `${(progress / total) * 100}%`;
  document.getElementById('sMeaning').textContent     = item.sentence; // A열 = 문제 (한국어)
  document.getElementById('sRevealAns').textContent   = '';
  document.getElementById('sCheckBtn').disabled       = true;

  sTokens   = tokenizeSentence(item.meaning); // B열 = 정답 (영어 문장)
  sBank     = shuffle(sTokens.map((t, i) => ({ id: i, token: t, placed: false })));
  sSelected = [];

  renderSentenceUI();
  speakWord(item.meaning, 'en-US');
  startTimer();
}

/**
 * Move a token from the bank into the slot area.
 * Auto-checks when all tokens are placed.
 * @param {number} id  Token bank id
 */
function sPlace(id) {
  if (feedbackLocked) return;
  const b = sBank.find(x => x.id === id);
  if (!b || b.placed) return;
  b.placed = true;
  sSelected.push(id);
  renderSentenceUI();
  if (sSelected.length === sTokens.length) sCheckAnswer();
}

/**
 * Remove a placed token back to the bank.
 * @param {number} id  Token bank id
 */
function sUnplace(id) {
  if (feedbackLocked) return;
  const b = sBank.find(x => x.id === id);
  if (!b || !b.placed) return;
  b.placed  = false;
  sSelected = sSelected.filter(x => x !== id);
  renderSentenceUI();
}

/** Evaluate the current token arrangement against the correct order */
function sCheckAnswer() {
  if (feedbackLocked || sSelected.length !== sTokens.length) return;
  feedbackLocked = true;
  stopTimer();

  const item      = currentDeck.sentences[testQueue[testIdx]];
  // Correct if token ids are in original order (0, 1, 2, …)
  const isCorrect = sSelected.every((id, i) => id === i);

  recordSolved();
  updateCombo(isCorrect);

  const slots = document.getElementById('sSlots');
  if (isCorrect) {
    slots.classList.add('correct');
    document.getElementById('sRevealAns').textContent = `✓ ${item.meaning}`;
    setTimeout(() => { feedbackLocked = false; goNext(); }, 700);
  } else {
    reviewList.push(item);
    slots.classList.add('wrong');
    document.getElementById('sRevealAns').textContent = `✓ ${item.meaning}`;
    setTimeout(() => { feedbackLocked = false; goNext(); }, 1800);
  }
}

/**
 * Skip the current sentence question.
 * @param {boolean} [isTimeout=false]
 */
function sHandleSkip(isTimeout) {
  if (feedbackLocked) return;
  feedbackLocked = true;
  stopTimer();
  const item = currentDeck.sentences[testQueue[testIdx]];
  reviewList.push(item);
  recordSolved();
  updateCombo(false);
  document.getElementById('sSlots').classList.add('wrong');
  document.getElementById('sRevealAns').textContent = `✓ ${item.meaning}`;
  setTimeout(() => { feedbackLocked = false; goNext(); }, 1800);
}

/* ══════════════════════════════════════════
   REVIEW SCREEN
   ══════════════════════════════════════════ */

/** Build and display the end-of-test review screen */
function showReview() {
  const total   = testQueue.length;
  const correct = total - reviewList.length;
  const pct     = Math.round((correct / total) * 100);

  document.getElementById('reviewSub').textContent =
    reviewList.length === 0 ? '모두 정답! 🎉' : `오답 ${reviewList.length}개`;

  document.getElementById('statsBar').innerHTML = `
    <div class="stat"><div class="num">${total}</div><div class="label">전체</div></div>
    <div class="stat"><div class="num" style="color:var(--green)">${correct}</div><div class="label">정답</div></div>
    <div class="stat"><div class="num" style="color:var(--red)">${reviewList.length}</div><div class="label">오답</div></div>
    <div class="stat"><div class="num" style="color:var(--blue)">${pct}%</div><div class="label">정답률</div></div>
  `;

  const listEl    = document.getElementById('reviewListEl');
  const actionsEl = document.getElementById('reviewActions');

  if (reviewList.length === 0) {
    listEl.innerHTML    = '<div class="review-perfect"><span>🏆</span><p>틀린 항목이 없습니다!<br>다른 단어장도 도전해 보세요.</p></div>';
    actionsEl.innerHTML = '';
  } else {
    const isSentence = deckType(currentDeck) === 'sentence';
    listEl.innerHTML = reviewList.map(w => {
      const primary = isSentence ? w.sentence : w.word;
      return `
        <div class="review-row">
          <div class="review-word"${isSentence ? ' style="width:48%"' : ''}>${esc(primary)}</div>
          <div class="review-meaning"${isSentence ? ' style="width:52%"' : ''}>${esc(w.meaning)}</div>
        </div>`;
    }).join('');

    actionsEl.innerHTML = `
      <button onclick="retryWrong()"><span class="act-icon">🔄</span>오답만 다시</button>
      <button onclick="downloadReviewXlsx()"><span class="act-icon">↓</span>엑셀 저장</button>
      <button onclick="addReviewToDeck()"><span class="act-icon">+</span>단어장 추가</button>
    `;
  }

  showScreen('review');
}

/* ══════════════════════════════════════════
   REVIEW: RETRY WRONG ITEMS ONLY
   ══════════════════════════════════════════ */

/**
 * Re-start a test using only the items the user got wrong.
 * For word decks with < 4 wrong items, falls back to typing mode.
 */
function retryWrong() {
  if (!reviewList.length) return;
  const isSentence = deckType(currentDeck) === 'sentence';
  const items      = reviewList.map(w => ({ ...w }));

  // Rebuild a temporary deck with only the wrong items
  currentDeck = { ...currentDeck };
  if (isSentence) {
    currentDeck.sentences = items;
    testMode = 'order';
  } else {
    currentDeck.words = items;
    // Fall back to typing if too few items for 4-option choice
    if (testMode === 'choice' && items.length < 4) testMode = 'typing';
  }

  const indices = shuffle(Array.from({ length: items.length }, (_, i) => i));
  testQueue      = indices.slice(0, Math.min(500, indices.length));
  testIdx        = 0;
  reviewList     = [];
  feedbackLocked = false;
  comboCount     = 0;
  hideCombo();

  if (isSentence) {
    document.getElementById('wordArea').style.display    = 'none';
    document.getElementById('choicesGrid').style.display = 'none';
    document.getElementById('typingArea').classList.remove('active');
    document.getElementById('sentenceArea').classList.add('active');
    document.getElementById('ttsToggle').textContent     = ttsEnabled ? '🔊' : '🔇';
    showScreen('test');
    sRenderQuestion();
  } else {
    document.getElementById('wordArea').style.display    = '';
    document.getElementById('sentenceArea').classList.remove('active');
    document.getElementById('choicesGrid').style.display = testMode === 'choice' ? 'grid' : 'none';
    document.getElementById('typingArea').classList.toggle('active', testMode === 'typing');
    document.getElementById('ttsToggle').textContent     = ttsEnabled ? '🔊' : '🔇';
    showScreen('test');
    renderQuestion();
  }
}

/* ══════════════════════════════════════════
   REVIEW: DOWNLOAD XLSX
   ══════════════════════════════════════════ */

/** Export wrong items to an .xlsx file */
function downloadReviewXlsx() {
  const isSentence = deckType(currentDeck) === 'sentence';
  const header     = isSentence ? ['Sentence', 'Meaning'] : ['Word', 'Meaning'];
  const data       = [header];
  reviewList.forEach(w => data.push([isSentence ? w.sentence : w.word, w.meaning]));

  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Wrong');
  ws['!cols'] = [{ wch: isSentence ? 40 : 20 }, { wch: 40 }];

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob  = new Blob([wbout], { type: 'application/octet-stream' });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement('a');
  a.href      = url;
  a.download  = `오답노트_${new Date().toLocaleDateString('ko-KR').replace(/\. /g, '-').replace('.', '')}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ══════════════════════════════════════════
   REVIEW: SAVE WRONG ITEMS AS NEW DECK
   ══════════════════════════════════════════ */

/** Create a new deck from the wrong items of the last test run */
function addReviewToDeck() {
  const today   = new Date().toLocaleDateString('ko-KR').replace(/\. /g, '.').replace(/\.$/, '');
  const type    = deckType(currentDeck);
  const newDeck = {
    id: Date.now(), type,
    name: `${currentDeck ? currentDeck.name : ''} 오답 ${today}`,
    createdAt: Date.now(), lastStudiedAt: 0, timeLimit: 0
  };
  if (type === 'sentence') newDeck.sentences = reviewList.map(w => ({ ...w }));
  else                    newDeck.words     = reviewList.map(w => ({ ...w }));
  decks.push(newDeck);
  saveDecks();
  alert(`"${newDeck.name}" 단어장 생성! (${reviewList.length}개)`);
}

/* ══════════════════════════════════════════
   EVENT LISTENERS
   ══════════════════════════════════════════ */

// Enter key in typing input → submit answer
document.getElementById('typingInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); handleTypingSubmit(); }
});

// Global keyboard shortcuts (desktop)
document.addEventListener('keydown', e => {
  // Don't fire when focus is inside an input / textarea
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  // Only fire on the test screen
  if (!document.getElementById('test').classList.contains('active')) return;
  if (feedbackLocked) return;

  if (testMode === 'choice') {
    // 1–4: select choice button
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 4) {
      e.preventDefault();
      const btn = document.querySelectorAll('.choice-btn')[n - 1];
      if (btn) btn.click();
    }
  }

  // Space: skip current question
  if (e.key === ' ') {
    e.preventDefault();
    handleSkip();
  }
});

/* ══════════════════════════════════════════
   PWA — SERVICE WORKER
   ══════════════════════════════════════════ */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

/* ══════════════════════════════════════════
   INIT
   ══════════════════════════════════════════ */

// Sync tab button active states to persisted tab
document.querySelectorAll('.tab-btn').forEach(b =>
  b.classList.toggle('active', b.dataset.tab === currentTab));

checkImportFromUrl();
renderDecks();
renderStreak();
