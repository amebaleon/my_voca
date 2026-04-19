/**
 * store.js — Data layer
 * LocalStorage access, deck CRUD helpers, streak tracking, utility functions.
 * No DOM manipulation here (except the esc() helper which uses a temp element).
 */

/* ══════════════════════════════════════════
   CONSTANTS
   ══════════════════════════════════════════ */
const STORAGE_KEY = 'vocaflash_decks';
const THEME_KEY   = 'vocaflash_theme';
const SORT_KEY    = 'vocaflash_sort';
const STREAK_KEY  = 'vocaflash_streak';
const TAB_KEY     = 'vocaflash_tab';
const TTS_KEY     = 'vocaflash_tts';

/* ══════════════════════════════════════════
   PERSISTENT STATE
   ══════════════════════════════════════════ */
/** @type {Array<Object>} All deck objects */
let decks = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');

// Migration: ensure 'type' and 'timeLimit' fields exist on legacy decks
decks.forEach(d => {
  if (!d.type)        d.type      = d.sentences ? 'sentence' : 'word';
  if (d.timeLimit == null) d.timeLimit = 0;
});

/** @type {'recent'|'created'|'name'} */
let currentSort = localStorage.getItem(SORT_KEY) || 'recent';

/** @type {'word'|'sentence'} */
let currentTab  = localStorage.getItem(TAB_KEY)  || 'word';

/** @type {boolean} */
let ttsEnabled  = localStorage.getItem(TTS_KEY)  !== 'off';

/* ══════════════════════════════════════════
   DECK TYPE HELPERS
   ══════════════════════════════════════════ */

/**
 * Return the type of a deck.
 * @param {Object} d  Deck object
 * @returns {'word'|'sentence'}
 */
function deckType(d) {
  return d.type || (d.sentences ? 'sentence' : 'word');
}

/**
 * Return the items array of a deck (words or sentences).
 * @param {Object} d  Deck object
 * @returns {Array<Object>}
 */
function deckItems(d) {
  return deckType(d) === 'sentence' ? (d.sentences || []) : (d.words || []);
}

/**
 * Return the primary display label for an item.
 * @param {Object} d     Deck object
 * @param {Object} item  Item object
 * @returns {string}
 */
function deckItemLabel(d, item) {
  return deckType(d) === 'sentence' ? item.sentence : item.word;
}

/**
 * Replace the items array of a deck, keyed by type.
 * @param {Object} d    Deck object (mutated)
 * @param {Array}  arr  New items array
 */
function setDeckItems(d, arr) {
  if (deckType(d) === 'sentence') { d.sentences = arr; delete d.words;     }
  else                            { d.words     = arr; delete d.sentences; }
}

/* ══════════════════════════════════════════
   PERSISTENCE
   ══════════════════════════════════════════ */

/** Persist the decks array to localStorage */
function saveDecks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(decks));
}

/* ══════════════════════════════════════════
   SORT
   ══════════════════════════════════════════ */

/**
 * Return decks filtered by currentTab and sorted by currentSort.
 * Each element: { d: Object, origIdx: number }
 * @returns {Array<{d: Object, origIdx: number}>}
 */
function getSortedDecks() {
  const arr = decks
    .map((d, i) => ({ d, origIdx: i }))
    .filter(x => deckType(x.d) === currentTab);

  if (currentSort === 'name') {
    arr.sort((a, b) => a.d.name.localeCompare(b.d.name, 'ko'));
  } else if (currentSort === 'recent') {
    arr.sort((a, b) => (b.d.lastStudiedAt || 0) - (a.d.lastStudiedAt || 0));
  } else { // 'created'
    arr.sort((a, b) => (b.d.createdAt || 0) - (a.d.createdAt || 0));
  }
  return arr;
}

/* ══════════════════════════════════════════
   STREAK / DAILY COUNT
   ══════════════════════════════════════════ */

/**
 * Return a 'YYYY-M-D' key for today (local time).
 * @returns {string}
 */
function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * Load streak data from localStorage.
 * @returns {{today: number, streak: number, lastDate: string, total: number}}
 */
function loadStreak() {
  const raw = localStorage.getItem(STREAK_KEY);
  if (!raw) return { today: 0, streak: 0, lastDate: '', total: 0 };
  return JSON.parse(raw);
}

/**
 * Persist streak data to localStorage.
 * @param {{today: number, streak: number, lastDate: string, total: number}} s
 */
function saveStreak(s) {
  localStorage.setItem(STREAK_KEY, JSON.stringify(s));
}

/**
 * Call once per question answered to increment today's count and update streaks.
 */
function recordSolved() {
  const today = getTodayKey();
  const s     = loadStreak();

  if (s.lastDate !== today) {
    // New day — check if yesterday was the last study day
    if (s.lastDate) {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      const yKey = `${y.getFullYear()}-${y.getMonth() + 1}-${y.getDate()}`;
      s.streak = (s.lastDate === yKey) ? (s.streak || 1) + 1 : 1;
    } else {
      s.streak = 1;
    }
    s.today    = 0;
    s.lastDate = today;
  }

  s.today = (s.today || 0) + 1;
  s.total = (s.total || 0) + 1;
  saveStreak(s);
}

/* ══════════════════════════════════════════
   UTILITIES
   ══════════════════════════════════════════ */

/**
 * HTML-escape a string for safe insertion into innerHTML.
 * @param {string} s
 * @returns {string}
 */
function esc(s) {
  const el = document.createElement('div');
  el.textContent = s;
  return el.innerHTML;
}

/**
 * Fisher-Yates shuffle — returns a new shuffled array.
 * @template T
 * @param {T[]} arr
 * @returns {T[]}
 */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
