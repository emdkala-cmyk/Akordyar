console.log("!!! APP_JS_LOADED_FROM_DISK !!!");
// ==========================================
// PART 1: Initialization & Electron Setup
// ==========================================
// ─── تشخیص صحیح محیط الکترون ───
// قبلاً از process.versions.electron استفاده می‌شد که با contextIsolation:true
// در دسترس نیست. حالا از window.electronAPI (که preload.js ست می‌کنه) استفاده می‌کنیم.
const isElectron = !!(typeof window !== 'undefined' && window.electronAPI && window.electronAPI.isElectron) ||
                   (typeof process !== 'undefined' && process.versions && !!process.versions.electron);
// fs و path در renderer با contextIsolation:true در دسترس نیستن.
// به‌جاش از window.electronAPI استفاده می‌کنیم که IPC handlers رو فراهم می‌کنه.
const fs = null; // استفاده نمی‌شه — به‌جاش از window.electronAPI.checkFileExists و readAudioFile استفاده می‌کنیم
const path = null; // استفاده نمی‌شه — به‌جاش از window.electronAPI.resolvePath و getProjectDir استفاده می‌کنیم

if (isElectron) {
  console.log('[App] Electron mode detected. electronAPI available:', !!window.electronAPI);
} else {
  console.log('[App] Browser mode detected.');
}

// ==========================================
// PART 2: Audio Import & Hard Drive Auto-Load (GLOBAL FUNCTIONS)
// ==========================================
// این توابع در global scope تعریف می‌شن تا از هر جایی قابل دسترسی باشن.
// قبلاً اشتباهاً داخل یک template literal بودن که باعث می‌شد تعریف نشن.

/**
 * خواندن مستقیم فایل صوتی از روی هارد بدون پنجره انتخاب فایل (مخصوص نسخه نصبی)
 *
 * این تابع از window.electronAPI.readAudioFile استفاده می‌کنه که از طریق IPC
 * به main process وصل می‌شه. قبلاً از fs.readFileSync استفاده می‌شد که با
 * contextIsolation:true در دسترس نیست.
 */
async function loadAudioFromHardDrive(filePath) {
  if (!isElectron || !window.electronAPI) {
    throw new Error("این قابلیت فقط در نسخه نصبی دسکتاپ فعال است.");
  }
  if (!window.electronAPI.checkFileExists) {
    throw new Error("electronAPI.checkFileExists موجود نیست — preload.js رو بررسی کنید");
  }

  // بررسی وجود فایل از طریق IPC
  let exists = false;
  try {
    exists = await window.electronAPI.checkFileExists(filePath);
  } catch (checkError) {
    console.warn('[Audio Load] Error checking file existence:', checkError.message);
    exists = false;
  }

  if (!exists) {
    // اگر فایل در مسیر مطلق پیدا نشد، خطای ملایم بده
    throw new Error("FILE_NOT_FOUND:" + filePath);
  }

  // خواندن فایل از طریق IPC (به‌صورت ArrayBuffer)
  if (!window.electronAPI.readAudioFile) {
    throw new Error("electronAPI.readAudioFile موجود نیست — preload.js رو بررسی کنید");
  }
  
  let arrayBuffer;
  try {
    arrayBuffer = await window.electronAPI.readAudioFile(filePath);
  } catch (readError) {
    console.error('[Audio Load] Error reading file:', readError.message);
    throw new Error("READ_ERROR:" + readError.message);
  }

  // دیکود کردن
  ensureAudioCtx();
  try {
    return await DAW.audioCtx.decodeAudioData(arrayBuffer);
  } catch (decodeError) {
    console.error('[Audio Load] Error decoding audio:', decodeError.message);
    throw new Error("DECODE_ERROR:" + decodeError.message);
  }
}
/**
 * توابع کمکی برای جایگزینی require('path')
 * (چون require در renderer با contextIsolation:true در دسترس نیست)
 */
function pathDirname(filePath) {
  if (!filePath) return null;
  // نرمال‌سازی backslash ویندوز به slash
  const normalized = String(filePath).replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash < 0) return null;
  return normalized.substring(0, lastSlash);
}

function pathJoin(dir, relativePath) {
  if (!dir) return relativePath;
  if (!relativePath) return dir;
  const normalizedDir = String(dir).replace(/[\\/]+$/, '');
  const normalizedRel = String(relativePath).replace(/^[\\/]+/, '');
  return normalizedDir + '/' + normalizedRel;
}

// اطمینان از اینکه توابع در global scope قابل دسترسی هستن
if (typeof window !== 'undefined') {
  window.loadAudioFromHardDrive = loadAudioFromHardDrive;
  window.pathDirname = pathDirname;
  window.pathJoin = pathJoin;
}

/**
 * customPrompt — جایگزین window.prompt که در الکترون پشتیبانی نمی‌شه
 *
 * @param {string} message - پیام به کاربر
 * @param {string} defaultValue - مقدار پیش‌فرض
 * @returns {Promise<string|null>} - مقدار وارد شده یا null اگه کنسل بشه
 */
function customPrompt(message, defaultValue = '') {
  return new Promise((resolve) => {
    const modal = document.getElementById('customPromptModal');
    const titleEl = document.getElementById('customPromptTitle');
    const inputEl = document.getElementById('customPromptInput');
    const okBtn = document.getElementById('customPromptOk');
    const cancelBtn = document.getElementById('customPromptCancel');

    if (!modal || !inputEl || !okBtn || !cancelBtn) {
      // fallback به window.prompt اگه مودال موجود نبود
      resolve(window.prompt(message, defaultValue));
      return;
    }

    if (titleEl) titleEl.textContent = message;
    inputEl.value = defaultValue;

    modal.style.display = 'flex';
    setTimeout(() => { inputEl.focus(); inputEl.select(); }, 50);

    const cleanup = () => {
      modal.style.display = 'none';
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      inputEl.onkeydown = null;
    };

    okBtn.onclick = () => {
      const val = inputEl.value;
      cleanup();
      resolve(val);
    };

    cancelBtn.onclick = () => {
      cleanup();
      resolve(null);
    };

    inputEl.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); okBtn.click(); }
      if (e.key === 'Escape') { e.preventDefault(); cancelBtn.click(); }
    };
  });
}
if (typeof window !== 'undefined') window.customPrompt = customPrompt;

// تشخیص محیط مرورگر/پنجره الکترون
const isBrowser = typeof window !== 'undefined';

// تعریف ایمن DAW جهت جلوگیری از خطای window is not defined
const globalScope = isBrowser ? window : global;

globalScope.DAW = {
  audioContext: isBrowser ? new (window.AudioContext || window.webkitAudioContext)() : null,
  tracks: [],
  projectDuration: 0,
  selectedSectionIds: new Set(),
  player: null
};
    /* ===== I18N ===== */
    let currentLang = localStorage.getItem('appLang') || 'fa';
    const I18N = {
      fa: {
        project: 'پروژه', archive: 'آرشیو آهنگ\u200Cها', newSong: 'ترانه جدید', saveSong: 'ذخیره ترانه', arranger: 'ارنجر ترک', print: 'چاپ',
        brand: 'ترانه آکورد', major: 'ماژور', minor: 'مینور', textLabel: 'متن:', chordLabel: 'آکورد:', seqLabel: 'ترتیبی:',
        settings: 'تنظیمات', artist: 'خواننده', artistPlaceholder: 'نام خواننده', songTitle: 'نام ترانه', songTitlePlaceholder: 'نام ترانه', playTime: 'زمان پخش',
        interactiveSwitches: 'سوئیچ\u200Cهای تعاملی', manualSync: '🔗 سینک دستی (لاین گاید)', midiCtrl: '🎹 میدی کنترلر (MIDI)',
        close: 'بستن', play: 'پخش', tapLine: '👆 ثبت این خط (Ctrl+Space)', deleteTime: '🗑 حذف زمان', reset: '↺ ریست',
        start: 'ابتدا', pause: 'مکث', stop: 'توقف', end: 'انتها', fullscreenPopup: 'پنجره جداگانه تمام صفحه',
        untitled: 'بدون نام', chordEditor: 'ویرایشگر آکورد (Chord Assistant)', cancel: 'انصراف', delete: '🗑 حذف', confirm: 'ثبت',
        manualType: 'تایپ دستی:', placeOnTimeline: 'ثبت روی تایم\u200Cلاین', editSongChord: 'ویرایش آکورد ترانه', confirmBtn: 'تأیید',
        archiveTitle: '📂 آرشیو آهنگ\u200Cها', archiveSearch: 'جستجوی خواننده یا نام ترانه...', arrangerTitle: '🎼 ارنجر ترک',
        arrangerName: 'نام پلی‌لیست', saveName: 'ذخیره', save: 'ذخیره', export: 'اکسپورت', perform: 'اجرا', closeEditor: 'بستن',
        availableSongs: 'آهنگ\u200Cهای موجود', setlist: 'ست\u200Cلیست (بکش یا ↑↓)', newAudioLine: '＋ خط صوتی جدید', tracks: 'TRACKS',
        zoom: 'Zoom', split: '✂ Split', cut: '✂ Cut', copy: '⧉ Copy', paste: '📋 Paste', delClip: '🗑 Delete',
        noArranger: 'هنوز ارنجری نساخته\u200Cاید.', newArranger: '+ ارنجر جدید', edit: '✏️ ویرایش', load: 'بارگذاری',
        noSongs: 'ترانه\u200Cای ذخیره نشده', allInSetlist: 'همه آهنگ\u200Cها در ست\u200Cلیست\u200Cاند.', addFromLeft: 'از ستون چپ آهنگ اضافه کنید.',
        clickHint: 'کلیک = ویرایشگر | دابل\u200Cکلیک روی آکورد = ویرایش', loadHint: 'کلیک اسم لاین = لود',
        nothingUndo: 'عملی برای Undo وجود ندارد', nothingRedo: 'عملی برای Redo وجود ندارد',
        selectCompleteChord: 'لطفا یک آکورد کامل انتخاب کنید', chordEditedTo: 'آکورد ویرایش شد به', chordPlaced: 'آکورد روی لاین قرار گرفت',
        newTrackAdded: 'لاین جدید اضافه شد', decoding: 'در حال decode صدا...', loadedOk: 'لود OK:', loadFailed: 'لود ناموفق',
        nothingSelected: 'چیزی انتخاب نشده', deleted: 'حذف شد', clipsCopied: 'کلیپ کپی شد', cutDone: 'کات شد',
        clipboardEmpty: 'کلیپ\u200Cبورد خالی است', pastedAtPlayhead: 'پیست روی پلی\u200Cهد', splitDone: 'Split انجام شد',
        noClipToCut: 'در این نقطه کلیپی برای Cut نبود', clipsCut: 'Cut: کلیپ',
        syncFinished: 'سینک به پایان رسید!', selectPointsActive: 'حالت انتخاب نقاط فعال — روی متن کلیک کنید',
        selectPointsFirst: 'اول نقاط را انتخاب کنید', chordingStarted: 'آکوردگذاری شروع شد — با MIDI بزنید',
        emptySetlist: 'ست\u200Cلیست خالی است', arrangerStarted: 'ارنجر شروع شد — هر ترانه بعد از اتمام پخش، بعدی لود میشه',
        arrangerFinished: 'ارنجر تمام شد', focusMode: 'حالت تمرکز — فقط متن ترانه', normalMode: 'حالت عادی',
        popupBlocked: 'پاپ\u200Cآپ بلاک شد — اجازه پاپ\u200Cآپ را فعال کنید', midiConnected: 'MIDI متصل شد. کیبورد را بزنید...',
        midiError: 'خطا در اتصال MIDI', midiNotSupported: 'مرورگر از MIDI پشتیبانی نمی\u200Cکند', midiDisconnected: 'MIDI قطع شد',
        dawReady: 'DAW آماده است! Alt+Scroll = زوم | Shift+Click = Split | L = Loop',
        chordRecOn: 'ضبط آکورد روشن! کیبورد میدی را بزنید', chordRecOff: 'ضبط آکورد خاموش',
        chordDone: 'آکوردگذاری تمام شد', songN: 'ترانه', lineOf: 'خط', linesOf: 'خط از',
        syncExit: '◀ بستن', syncPlay: '▶ پخش', syncPause: '⏸ توقف',
        
      },
      en: {
        project: 'Project', archive: 'Song Archive', newSong: 'New Song', saveSong: 'Save Song', arranger: 'Track Arranger', print: 'Print',
        brand: 'Chord Song', major: 'Major', minor: 'Minor', textLabel: 'Text:', chordLabel: 'Chord:', seqLabel: 'Seq:',
        settings: 'Settings', artist: 'Artist', artistPlaceholder: 'Artist name', songTitle: 'Song Title', songTitlePlaceholder: 'Song name', playTime: 'Play Time',
        interactiveSwitches: 'Interactive Switches', manualSync: '🔗 Manual Sync (Line Guide)', midiCtrl: '🎹 MIDI Controller',
        close: 'Close', play: 'Play', tapLine: '👆 Tap This Line (Ctrl+Space)', deleteTime: '🗑 Delete Time', reset: '↺ Reset',
        start: 'Start', pause: 'Pause', stop: 'Stop', end: 'End', fullscreenPopup: 'Fullscreen Popup Window',
        untitled: 'Untitled', chordEditor: 'Chord Editor (Chord Assistant)', cancel: 'Cancel', delete: '🗑 Delete', confirm: 'Confirm',
        manualType: 'Manual type:', placeOnTimeline: 'Place on Timeline', editSongChord: 'Edit Song Chord', confirmBtn: 'OK',
        archiveTitle: '📂 Song Archive', archiveSearch: 'Search artist or song name...', arrangerTitle: '🎼 Track Arranger',
        arrangerName: 'Playlist name', saveName: 'Save', save: 'Save', export: 'Export', perform: 'Perform', closeEditor: 'Close',
        availableSongs: 'Available Songs', setlist: 'Setlist (drag or ↑↓)', newAudioLine: '＋ New Audio Line', tracks: 'TRACKS',
        zoom: 'Zoom', split: '✂ Split', cut: '✂ Cut', copy: '⧉ Copy', paste: '📋 Paste', delClip: '🗑 Delete',
        noArranger: 'No arranger created yet.', newArranger: '+ New Arranger', edit: '✏️ Edit', load: 'Load',
        noSongs: 'No songs saved', allInSetlist: 'All songs are in the setlist.', addFromLeft: 'Add songs from the left column.',
        clickHint: 'Click = Editor | Double-click chord = Edit', loadHint: 'Click track name = Load',
        nothingUndo: 'Nothing to Undo', nothingRedo: 'Nothing to Redo',
        selectCompleteChord: 'Please select a complete chord', chordEditedTo: 'Chord edited to', chordPlaced: 'Chord placed on line',
        newTrackAdded: 'New track added', decoding: 'Decoding audio...', loadedOk: 'Loaded OK:', loadFailed: 'Load failed',
        nothingSelected: 'Nothing selected', deleted: 'Deleted', clipsCopied: 'clips copied', cutDone: 'Cut',
        clipboardEmpty: 'Clipboard is empty', pastedAtPlayhead: 'Pasted at playhead', splitDone: 'Split done',
        noClipToCut: 'No clip to cut at this point', clipsCut: 'Cut: clips',
        syncFinished: 'Sync finished!', selectPointsActive: 'Point selection active — click on text',
        selectPointsFirst: 'Select points first', chordingStarted: 'Chording started — play MIDI',
        emptySetlist: 'Setlist is empty', arrangerStarted: 'Arranger started — next song loads after current finishes',
        arrangerFinished: 'Arranger finished', focusMode: 'Focus mode — lyrics only', normalMode: 'Normal mode',
        popupBlocked: 'Popup blocked — please allow popups', midiConnected: 'MIDI connected. Play your keyboard...',
        midiError: 'MIDI connection error', midiNotSupported: 'Browser doesn\'t support MIDI', midiDisconnected: 'MIDI disconnected',
        dawReady: 'DAW ready! Alt+Scroll = Zoom | Shift+Click = Split | L = Loop',
        chordRecOn: 'Chord recording ON! Play MIDI keyboard', chordRecOff: 'Chord recording OFF',
        chordDone: 'Chording complete', songN: 'Song', lineOf: 'of', linesOf: 'line of',
        syncExit: '◀ Close', syncPlay: '▶ Play', syncPause: '⏸ Pause',
      }
    };
    function t(key) { return I18N[currentLang]?.[key] || I18N['fa']?.[key] || key; }
    function applyI18n() {
      document.querySelectorAll('[data-i18n]').forEach(el => { const k = el.getAttribute('data-i18n'); if (k) el.textContent = t(k); });
      document.querySelectorAll('[data-i18n-title]').forEach(el => { const k = el.getAttribute('data-i18n-title'); if (k) el.title = t(k); });
      document.querySelectorAll('[data-i18n-placeholder]').forEach(el => { const k = el.getAttribute('data-i18n-placeholder'); if (k) el.placeholder = t(k); });
      document.documentElement.dir = currentLang === 'fa' ? 'rtl' : 'ltr';
      document.documentElement.lang = currentLang;
      // Update dynamic elements
      if ($('edPrintTitle')) $('edPrintTitle').textContent = edCur?.title || t('untitled');
      const syncPlayBtn = $('syncPlayBtn');
      if (syncPlayBtn) syncPlayBtn.textContent = DAW.isPlaying ? t('syncPause') : t('syncPlay');
    }
    // ===== MIDI MONITOR =====
    let midiMonitorAutoScroll = true;
    const midiMsgTypes = {
      0x80: 'Note Off', 0x90: 'Note On', 0xA0: 'Aftertouch',
      0xB0: 'Control', 0xC0: 'Program', 0xD0: 'Channel', 0xE0: 'Pitch',
      0xF0: 'SysEx', 0xF1: 'MTC', 0xF8: 'Clock', 0xFA: 'Start', 0xFC: 'Stop', 0xFB: 'Continue', 0xFE: 'ActiveSense'
    };
    const noteNames = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

    function toggleMidiMonitor() {
      const mon = $('midiMonitor');
      mon.classList.toggle('show');
    }

    function logMidiMsg(dir, msg) {
      const body = $('midiMonitorBody');
      if (!body) return;
      const status = msg[0] & 0xF0;
      const channel = msg[0] & 0x0F;
      const type = midiMsgTypes[status] || midiMsgTypes[msg[0]] || 'Unknown';
      const hex = [...msg].map(b => '0x' + b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

      let detail = '';
      if (status === 0x90 && msg[2] > 0) {
        const noteName = noteNames[msg[1] % 12] + (Math.floor(msg[1] / 12) - 1);
        detail = `${noteName} vel:${msg[2]}`;
      } else if (status === 0x80 || (status === 0x90 && msg[2] === 0)) {
        const noteName = noteNames[msg[1] % 12] + (Math.floor(msg[1] / 12) - 1);
        detail = `${noteName} off`;
      } else if (status === 0xB0) {
        detail = `CC${msg[1]} val:${msg[2]}`;
      } else if (status === 0xC0) {
        detail = `prog:${msg[1]}`;
      } else if (msg[0] === 0xFA) detail = '▶ START';
      else if (msg[0] === 0xFC) detail = '⏹ STOP';
      else if (msg[0] === 0xFB) detail = '⏯ CONTINUE';
      else if (msg[0] === 0xF8) detail = '⏱ CLOCK';

      const now = new Date();
      const time = now.toLocaleTimeString('fa', { hour12: false });

      const div = document.createElement('div');
      div.className = 'midi-msg';
      const dirClass = dir === 'IN' ? 'in' : dir === 'OUT' ? 'out' : 'sys';
      div.innerHTML = `<span class="dir ${dirClass}">${dir}</span><span class="data">${type} ch${channel} ${detail}</span><span class="time">${hex}</span>`;
      body.appendChild(div);

      // Keep max 200 messages
      while (body.children.length > 200) body.removeChild(body.firstChild);
      if (midiMonitorAutoScroll) body.scrollTop = body.scrollHeight;
    }

    function clearMidiLog() { $('midiMonitorBody').innerHTML = ''; }

    function toggleMidiMonitorAutoScroll() {
      midiMonitorAutoScroll = !midiMonitorAutoScroll;
    }

    // Update MIDI monitor on every message
    function updateMidiMonitor(msg) {
      logMidiMsg('IN', msg);
    }

    function updateMidiMonitorOut(msg) {
      logMidiMsg('OUT', msg);
    }

    // Update status dot
    function updateMidiStatusDot() {
      const dot = $('midiStatusDot');
      if (dot) {
        dot.className = 'midi-status-dot ' + (midiAccess ? 'connected' : 'disconnected');
      }
    }

    // Update chord display in monitor
    function updateMidiChordDisplay(name, notes) {
      const info = $('midiChordInfo');
      const nameEl = $('midiChordName');
      const notesEl = $('midiChordNotes');
      if (info && nameEl && name) {
        info.style.display = 'block';
        nameEl.textContent = name;
        notesEl.textContent = notes || '';
      }
    }
    let metroActive = false, metroTimer = null, metroBeat = 0;
    let countInBars = 0; // 0=off, 1=1 bar, 2=2 bars before playback
    // ===== SNAP TO GRID =====
    let snapEnabled = true;
    let snapValue = 0.25; // seconds (default: 1/4 beat)

    function toggleSnap() {
      snapEnabled = !snapEnabled;
      $('snapBtn').classList.toggle('active', snapEnabled);
      toast(snapEnabled ? 'اسنپ فعال شد' : 'اسنپ غیرفعال شد');
    }

    function snapTime(time) {
      if (!snapEnabled) return time;
      const bpm = edCur?.tempo || 120;
      const sig = edCur?.timeSignature || '4/4';
      const beatsPerBar = parseInt(sig.split('/')[0]);
      const beatDur = 60 / bpm;
      // Snap to nearest grid point
      return Math.round(time / snapValue) * snapValue;
    }

    // ===== QUANTIZE =====
    function showQuantizeModal() {
      $('quantizeModal').classList.toggle('show');
    }

    function applyQuantize(preset) {
      const bpm = edCur?.tempo || 120;
      const beatDur = 60 / bpm;

      switch(preset) {
        case '1/1': snapValue = beatDur * 4; break; // 1 bar
        case '1/2': snapValue = beatDur * 2; break; // half bar
        case '1/4': snapValue = beatDur; break;     // 1 beat
        case '1/8': snapValue = beatDur / 2; break; // half beat
        case '1/16': snapValue = beatDur / 4; break; // quarter beat
        case '1/32': snapValue = beatDur / 8; break; // 1/8 beat
        case 'triplet': snapValue = beatDur / 3; break;
        case 'dotted': snapValue = beatDur * 1.5; break;
        default: snapValue = beatDur;
      }

      // Update UI
      document.querySelectorAll('.q-preset').forEach(el => el.classList.remove('active'));
      event.target.closest('.q-preset').classList.add('active');
      snapEnabled = true;
      $('snapBtn').classList.add('active');

      toast(`کوانتایز: ${preset} (${(snapValue * 1000).toFixed(0)}ms)`);
      $('quantizeModal').classList.remove('show');
    }

    // Close quantize modal on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#quantizeModal') && !e.target.closest('[onclick="showQuantizeModal()"]')) {
        $('quantizeModal')?.classList.remove('show');
      }
    });

    /**
     * quantizeSelectedChords — کوانتایز آکوردهای انتخاب‌شده در کورد لاین
     *
     * آکوردهای انتخاب‌شده (DAW.selectedIds) را بر اساس پریست کوانتایز فعلی
     * (snapValue) به نزدیک‌ترین نقطه گرید می‌چسباند.
     *
     * مثال:
     *   - پریست 1/1 (یک میزان): آکوردها به ابتدای میزان می‌چسبند
     *   - پریست 1/2 (نیم میزان): آکوردها به نزدیک‌ترین خط نیم میزان می‌چسبند
     *   - پریست 1/4 (یک ضرب): آکوردها به نزدیک‌ترین ضرب می‌چسبند
     *   - و ...
     */
    function quantizeSelectedChords() {
      // فقط کلیپ‌های آکورد (chord) را انتخاب کن
      const selectedChordClips = DAW.clips.filter(c => c.type === 'chord' && DAW.selectedIds.has(c.id));
      if (selectedChordClips.length === 0) {
        toast('آکوردی در کورد لاین انتخاب نشده است');
        return;
      }

      const bpm = edCur?.tempo || 120;
      const sig = edCur?.timeSignature || '4/4';
      const beatsPerBar = parseInt(sig.split('/')[0]);
      const beatDur = 60 / bpm;
      const barDur = beatDur * beatsPerBar;

      // محاسبه گام گرید بر اساس پریست فعلی
      // snapValue در applyQuantize تنظیم می‌شود (مثلاً 1/1 = barDur، 1/2 = barDur/2، 1/4 = beatDur)
      let gridStep = snapValue;
      if (!gridStep || gridStep <= 0) gridStep = beatDur;

      // برای هر آکورد انتخاب‌شده، start را به نزدیک‌ترین نقطه گرید بچسبان
      let quantizedCount = 0;
      selectedChordClips.forEach(clip => {
        const origStart = clip.start;
        // گرد کردن به نزدیک‌ترین مضرب gridStep
        const snapped = Math.round(origStart / gridStep) * gridStep;
        // جلوگیری از منفی شدن
        clip.start = roundMs(Math.max(0, snapped));
        if (Math.abs(clip.start - origStart) > 0.001) quantizedCount++;
      });

      if (quantizedCount > 0) {
        saveState();
        renderClips();
        renderRuler();
        toast(`کوانتایز شد: ${quantizedCount} آکورد`);
      } else {
        toast('آکوردها از قبل روی گرید هستند');
      }
    }

    function toggleMetronome() {
      metroActive = !metroActive;
      $('metroToggleBtn').textContent = metroActive ? '🔊' : '🔇';
      if (metroActive && DAW.isPlaying) startMetronome();
      else stopMetronome();
    }
    function startMetronome() {
      stopMetronome();
      // مترونوم با پلی هد سینک میشه - نیازی به setTimeout جداگانه نیست
      // ضرب از حلقه tick اصلی پخش میشه
      metroBeat = Math.floor(DAW.playhead / (60 / (parseInt($('edTempo')?.value) || 120)));
    }
    function stopMetronome() { metroTimer = null; metroBeat = 0; }
    function playClick(isAccent) {
      ensureAudioCtx();
      const osc = DAW.audioCtx.createOscillator();
      const gain = DAW.audioCtx.createGain();
      osc.connect(gain); gain.connect(DAW.audioCtx.destination);
      osc.frequency.value = isAccent ? 1000 : 600;
      osc.type = 'square';
      gain.gain.setValueAtTime(isAccent ? 0.3 : 0.15, DAW.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, DAW.audioCtx.currentTime + 0.05);
      osc.start(); osc.stop(DAW.audioCtx.currentTime + 0.05);
    }

    // تابع کمکی برای چک کردن ضرب در حلقه پخش
    function checkMetronomeTick(playheadTime) {
      if (!metroActive || !DAW.isPlaying) return;
      const bpm = parseInt($('edTempo')?.value) || 120;
      const sig = $('edTimeSig')?.value || '4/4';
      const beatsPerBar = parseInt(sig.split('/')[0]);
      const beatDur = 60 / bpm;
      const currentBeat = Math.floor(playheadTime / beatDur);
      if (currentBeat !== metroBeat) {
        playClick(currentBeat % beatsPerBar === 0);
        metroBeat = currentBeat;
      }
    }

    // ===== TAP TEMPO =====
    let tapTimes = [];
    function tapTempo() {
      const now = performance.now();
      tapTimes.push(now);
      if (tapTimes.length > 8) tapTimes.shift();
      if (tapTimes.length >= 2) {
        let total = 0;
        for (let i = 1; i < tapTimes.length; i++) total += tapTimes[i] - tapTimes[i - 1];
        const avgMs = total / (tapTimes.length - 1);
        const bpm = Math.round(60000 / avgMs);
        if (bpm >= 20 && bpm <= 300) {
          $('edTempo').value = bpm;
          if (edCur) { edCur.tempo = bpm; edSaveSong(); }
          toast(`تمپو: ${bpm} BPM`);
        }
      }
      // Reset if gap > 3 seconds
      if (tapTimes.length >= 2 && (tapTimes[tapTimes.length - 1] - tapTimes[tapTimes.length - 2]) > 3000) {
        tapTimes = [now];
      }
    }

    // ===== TEMPO DETECTION FROM SYNC =====
    function detectTempo() {
      if (!edCur || !edCur.syncTimes || edCur.syncTimes.length < 2) {
        toast('ابتدا سینک دستی را انجام دهید (حداقل ۲ لاین)');
        return;
      }
      const times = edCur.syncTimes.filter(t => t != null && t > 0);
      if (times.length < 2) { toast('زمان‌های سینک کافی نیست'); return; }

      // محاسبه فاصله بین لاین‌ها
      const intervals = [];
      for (let i = 1; i < times.length; i++) {
        const diff = times[i] - times[i - 1];
        if (diff > 0.1 && diff < 10) intervals.push(diff); // فقط فاصله‌های معقول
      }
      if (intervals.length === 0) { toast('فاصله‌های سینک معتبر نیست'); return; }

      // یافتن رایج‌ترین فاصله (mode)
      const sorted = [...intervals].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];

      // تبدیل به BPM (فرض: هر لاین = یک ضرب یا یک بیت)
      const bpm = Math.round(60 / median);

      // همچنین امتحان کن هر ۲ لاین = یک بیت
      const bpmHalf = Math.round(60 / (median * 2));

      // بهترین BPM رو انتخاب کن (بین 60-180)
      let bestBpm = bpm;
      if (bpm < 60) bestBpm = bpm * 2;
      else if (bpm > 180) bestBpm = Math.round(bpm / 2);
      if (bestBpm >= 60 && bestBpm <= 180) bestBpm = bestBpm;

      $('edTempo').value = bestBpm;
      if (edCur) { edCur.tempo = bestBpm; edSaveSong(); }
      toast(`تمپوی تشخیص داده شده: ${bestBpm} BPM (از ${intervals.length} لاین سینک)`);
    }

    // ===== KEY DETECTION FROM CHORDS =====
    function detectKey() {
      if (!edCur || !edCur.chords || edCur.chords.length === 0) {
        toast('آکوردی برای تشخیص گام وجود ندارد');
        return;
      }

      // فراوانی هر روت نت
      const noteFreq = {};
      const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
      edCur.chords.forEach(ch => {
        const root = ch.name.replace(/m|maj|min|dim|aug|sus|add|\/.*/g, '').replace('#', '#');
        // تبدیل به index
        let idx = noteNames.indexOf(root);
        if (idx === -1) {
          // امتحان با b
          const flatMap = { 'Db': 'C#', 'Eb': 'D#', 'Fb': 'E', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#', 'Cb': 'B' };
          const mapped = flatMap[root];
          if (mapped) idx = noteNames.indexOf(mapped);
        }
        if (idx >= 0) noteFreq[idx] = (noteFreq[idx] || 0) + 1;
      });

      if (Object.keys(noteFreq).length === 0) { toast('نت‌های آکورد قابل تشخیص نیست'); return; }

      // کلیدهای ماژور و مینور
      const majorScale = [0, 2, 4, 5, 7, 9, 11];
      const minorScale = [0, 2, 3, 5, 7, 8, 10];

      let bestKey = '', bestMode = 'maj', bestScore = 0;

      for (let root = 0; root < 12; root++) {
        // امتیاز ماژور
        let majorScore = 0;
        majorScale.forEach((interval, i) => {
          const note = (root + interval) % 12;
          const weight = [0, 2, 4, 5, 7, 9, 11][i] === 0 ? 2 : 1; // روت وزن بیشتر
          majorScore += (noteFreq[note] || 0) * weight;
        });
        if (majorScore > bestScore) { bestScore = majorScore; bestKey = noteNames[root]; bestMode = 'maj'; }

        // امتیاز مینور
        let minorScore = 0;
        minorScale.forEach((interval, i) => {
          const note = (root + interval) % 12;
          const weight = i === 0 ? 2 : 1;
          minorScore += (noteFreq[note] || 0) * weight;
        });
        if (minorScore > bestScore) { bestScore = minorScore; bestKey = noteNames[root]; bestMode = 'min'; }
      }

      $('edKey').value = bestKey;
      $('edKeyMode').value = bestMode;
      if (edCur) {
        edCur.key = bestKey;
        edCur.keyMode = bestMode;
        edSaveSong();
        edSyncToolbar();
        edRenderEditor();
      }
      toast(`گام تشخیص داده شده: ${bestKey} ${bestMode === 'maj' ? 'ماژور' : 'مینور'} (امتیاز: ${bestScore})`);
    }

    function togglePanel(panel) {
      const el = panel === 'sidebar' ? document.querySelector('.sidebar') :
                 panel === 'inspector' ? document.querySelector('.inspector') :
                 panel === 'timeline' ? document.querySelector('.timeline') : null;
      if (!el) return;
      const isHidden = el.style.display === 'none';
      el.style.display = isHidden ? '' : 'none';
      // When timeline is hidden, collapse its grid row so workspace fills the space
      if (panel === 'timeline') {
        const app = document.querySelector('.app-container');
        const sep = $('timelineSep');
        if (sep) sep.style.display = el.style.display;
        if (app && !_focusMode) app.style.gridTemplateRows = isHidden ? 'auto 1fr 4px 320px' : 'auto 1fr 0px 0px';
      }
    }

    function toggleLang() {
      currentLang = currentLang === 'fa' ? 'en' : 'fa';
      localStorage.setItem('appLang', currentLang);
      applyI18n();
      toast(currentLang === 'fa' ? 'زبان فارسی' : 'English');
    }

    const COLORS = ['#3FB8AF', '#3182CE', '#D69E2E', '#9F7AEA', '#ED64A6', '#48BB78', '#ED8936', '#00B5D8'];
    
    const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const FLAT_NOTES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
    const ALL_NOTE_NAMES = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B'];
    const ROOT_NOTES = ['None', ...ALL_NOTE_NAMES];
    const BASS_NOTES = ['None', ...ALL_NOTE_NAMES];
    const NOTE_TO_SHARP = { 'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#' };
    const NOTE_SEMITONE = { 'C':0,'C#':1,'Db':1,'D':2,'D#':3,'Eb':3,'E':4,'F':5,'F#':6,'Gb':6,'G':7,'G#':8,'Ab':8,'A':9,'A#':10,'Bb':10,'B':11 };
    const CHORD_TYPES = ['None', 'maj', 'min', 'dim', 'aug', 'sus2', 'sus4'];
    const TENSIONS = ['', '7', 'M7', '9', 'b9', '#9', '11', '#11', '13', '6'];
    function chordTypeDisplay(type) { return type === 'min' ? 'm' : type === 'maj' ? '' : type; }

    const CHORD_INTERVALS = { 'maj': [0, 4, 7], 'min': [0, 3, 7], 'dim': [0, 3, 6], 'aug': [0, 4, 8], 'sus2': [0, 2, 7], 'sus4': [0, 5, 7] };
    const TENSION_INTERVALS = { '7': [10], 'M7': [11], '9': [14, 10], 'b9': [13, 10], '#9': [15, 10], '11': [17, 10], '#11': [18, 10], '13': [21, 10], '6': [9] };

    const CHORD_TEMPLATES = [
      { type: 'maj', tension: '13', req: [0, 4, 7, 10, 21] }, { type: 'maj', tension: '11', req: [0, 4, 7, 10, 17] },
      { type: 'maj', tension: '9', req: [0, 4, 7, 10, 14] }, { type: 'maj', tension: 'b9', req: [0, 4, 7, 10, 13] },
      { type: 'maj', tension: '#9', req: [0, 4, 7, 10, 15] }, { type: 'maj', tension: '#11', req: [0, 4, 7, 10, 18] },
      { type: 'maj', tension: '7', req: [0, 4, 7, 10] }, { type: 'maj', tension: 'M7', req: [0, 4, 7, 11] },
      { type: 'maj', tension: '6', req: [0, 4, 7, 9] }, { type: 'maj', tension: '', req: [0, 4, 7] },

      { type: 'min', tension: '13', req: [0, 3, 7, 10, 21] }, { type: 'min', tension: '11', req: [0, 3, 7, 10, 17] },
      { type: 'min', tension: '9', req: [0, 3, 7, 10, 14] }, { type: 'min', tension: '7', req: [0, 3, 7, 10] },
      { type: 'min', tension: 'M7', req: [0, 3, 7, 11] }, { type: 'min', tension: '6', req: [0, 3, 7, 9] },
      { type: 'min', tension: '', req: [0, 3, 7] },

      { type: 'dim', tension: '7', req: [0, 3, 6, 9] }, { type: 'dim', tension: '', req: [0, 3, 6] },
      { type: 'aug', tension: '7', req: [0, 4, 8, 10] }, { type: 'aug', tension: '', req: [0, 4, 8] },
      { type: 'sus2', tension: '7', req: [0, 2, 7, 10] }, { type: 'sus2', tension: '', req: [0, 2, 7] },
      { type: 'sus4', tension: '7', req: [0, 5, 7, 10] }, { type: 'sus4', tension: '', req: [0, 5, 7] },
    ];
    /* =========================
   PERF / RENDER HELPERS
   ========================= */
const PERF = {
  lastSerializedState: '',
  lastSyncActiveLi: -2,
  lastSyncDoneKey: '',
  lastPopupActiveLi: -2,
  lastPopupDoneKey: '',
  lastEditorScrollTarget: -1,
  lastPopupScrollTarget: -1,
  lastSyncTimelinePct: -1,
  lastSyncTimeText: '',
  syncLinesCache: [],
  syncPanelNodes: [],
  rulerMajor: null,
  rulerTotal: -1,
  rulerWidth: -1,
  clipsVersion: 0,
  tracksVersion: 0,
  pendingRenderAll: false,
  pendingSyncPanelRender: false
};

function rafThrottle(fn) {
  let scheduled = false;
  let lastArgs = null;
  return function (...args) {
    lastArgs = args;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      fn.apply(this, lastArgs);
    });
  };
}

function debounce(fn, delay = 200) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

function arrayShallowEqual(a = [], b = []) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function safeText(v) {
  return v == null ? '' : String(v);
}

function buildDoneKey(times = [], t = 0, activeLi = -1) {
  let key = '';
  for (let i = 0; i < times.length; i++) {
    const ti = times[i];
    if (Number.isFinite(ti) && ti < t && i !== activeLi) key += i + '|';
  }
  return key;
}

function centerScrollIfNeeded(container, targetEl, lastTargetRefName) {
  if (!container || !targetEl) return;
  const idx = +(targetEl.dataset.li ?? -1);
  if (PERF[lastTargetRefName] === idx) return;
  PERF[lastTargetRefName] = idx;
  const top = targetEl.offsetTop - (container.clientHeight / 2) + (targetEl.offsetHeight / 2);
  container.scrollTop = Math.max(0, top);
}

const requestRenderAll = rafThrottle(() => { renderAll(); });
const requestRenderSyncLyrics = debounce(() => { renderSyncLyrics(); }, 120);
/* =========================
   END PERF / RENDER HELPERS
   ========================= */


    const DAW = {
      tracks: [], clips: [], sections: [], selectedIds: new Set(), selectedSectionIds: new Set(), clipboard: [],
      playhead: 0, isPlaying: false, isScrubbing: false,
      timelineDuration: 120, pxPerSecond: 70, laneHeight: 64, loadTrackId: null,
      rafId: null, playOriginPerf: 0, playOriginTime: 0,
      audioCtx: null, masterGain: null, voices: new Map(),
      nextId: 100, bufferCache: new Map(), waveCache: new Map(),
      drag: null, marquee: null, editingChordClipId: null, selectedPlayhead: false,
      loopEnabled: false, loopA: 0, loopB: 10,
      // سیستم جدید Pool برای مدیریت فایل‌های صوتی
      pool: {}, // clipId -> clip metadata
      projectRoot: null,
      isRecording: false, recRafId: null, recAnalyser: null, recStream: null, recMediaRecorder: null,
      recStartTime: 0, recEndTime: 0, recPeaks: [], recLaneId: null
    };

    let undoStack = [], undoIndex = -1, isApplyingHistory = false;
    let activeMidiNotes = new Set(), midiTimeout = null, isRecordingChords = false, currentRecordingClipId = null;
    let currentChord = { root: 'None', type: 'None', tension: '', bass: 'None' };
    let midiAccess = null;
    // Playhead scroll mode: 'page' (scrolls page by page) or 'center' (stationary center)
    DAW.playheadMode = 'page';
    // Selection end point for arranger (independent of loop)
    let selectionEnd = 0;

    const $ = (id) => document.getElementById(id);
    const uid = (p = 'c') => p + (DAW.nextId++);
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const roundMs = (t) => Math.round(t * 1000) / 1000;

    // آپدیت nextId بر اساس بزرگ‌ترین ID موجود (جلوگیری از تداخل آیدی)
    function updateNextIdFromClips() {
      const allIds = [...DAW.clips.map(c => c.id), ...(DAW.sections || []).map(s => s.id)];
      allIds.forEach(id => {
        const num = parseInt(id.replace(/^[a-z]+/, ''), 10);
        if (!isNaN(num) && num >= DAW.nextId) DAW.nextId = num + 1;
      });
    }

    function formatTime(sec, ms = true) {
      sec = Math.max(0, sec || 0); const m = Math.floor(sec / 60); const s = Math.floor(sec % 60);
      const milli = Math.floor((sec % 1) * 1000); const base = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
      return ms ? `${base}.${String(milli).padStart(3,'0')}` : base;
    }

    function toast(msg) {
      const t = $('toast'); t.textContent = msg; t.classList.add('show');
      clearTimeout(toast._tm); toast._tm = setTimeout(() => t.classList.remove('show'), 1700);
    }

    function ensureAudioCtx() {
      if (!DAW.audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        DAW.audioCtx = new Ctx(); DAW.masterGain = DAW.audioCtx.createGain();
        DAW.masterGain.gain.value = 1; DAW.masterGain.connect(DAW.audioCtx.destination);
      }
      if (DAW.audioCtx.state === 'suspended') DAW.audioCtx.resume().catch(() => {});
      return DAW.audioCtx;
    }

    const timeToX = (t) => t * DAW.pxPerSecond;
    const xToTime = (x) => x / DAW.pxPerSecond;

    function getProjectEnd() { let end = 30; for (const c of DAW.clips) end = Math.max(end, c.start + c.duration); for (const s of (DAW.sections || [])) end = Math.max(end, s.start + s.duration); return Math.max(DAW.timelineDuration, end + 8); }
    function getClip(id) { return DAW.clips.find(c => c.id === id); }
    function selectedClips() { return DAW.clips.filter(c => DAW.selectedIds.has(c.id)); }
    function ensureTimelineFits(needed) { if (needed > DAW.timelineDuration) DAW.timelineDuration = needed; }

   function serializeState() {
  const tracks = DAW.tracks.map(t => {
    const copy = { ...t };
    delete copy._pannerNode;
    delete copy._gainNode;
    return copy;
  });

  const clips = DAW.clips.map(c => {
    const copy = { ...c };
    delete copy._peaks;
    delete copy.waveUrl;
    delete copy.buffer; // حذف buffer از ذخیره‌سازی
    delete copy.audioBuffer; // حذف audioBuffer
    delete copy._fileHandle; // حذف file handle
    // فقط مسیر نسبی و نام فایل باقی بماند
    return copy;
  });

  const sections = (DAW.sections || []).map(s => ({ ...s }));
  
  // پاک‌سازی pool از داده‌های runtime قبل از ذخیره
  const cleanPool = {};
  for (const [clipId, clip] of Object.entries(DAW.pool)) {
    const cleanClip = { ...clip };
    delete cleanClip.runtime;
    delete cleanClip._peaks;
    delete cleanClip.waveUrl;
    delete cleanClip.audioBuffer;
    delete cleanClip.buffer;
    cleanPool[clipId] = cleanClip;
  }

  return JSON.stringify({
    schema: 'akordyar-project',
    version: 2,
    project: {
      id: DAW.project?.id || '',
      name: DAW.project?.name || '',
      projectRoot: undefined // مسیر پروژه ذخیره نمی‌شود (نسبی کار می‌کند)
    },
    pool: cleanPool,
    tracks,
    clips,
    sections,
    edCur: edCur ? JSON.parse(JSON.stringify(edCur)) : null,
    edSeqPoints: Array.isArray(edSeqPoints)
      ? JSON.parse(JSON.stringify(edSeqPoints))
      : []
  });
}


let _autoSaveTimer = null;

function saveState() {
  if (isApplyingHistory) return;

  const state = serializeState();

  if (state === PERF.lastSerializedState) {
    clearTimeout(_autoSaveTimer);
    _autoSaveTimer = setTimeout(() => edSaveSong(), 700);
    return;
  }

  undoStack = undoStack.slice(0, undoIndex + 1);
  undoStack.push(state);

  if (undoStack.length > 100) {
    undoStack.shift();
  }

  undoIndex = undoStack.length - 1;
  PERF.lastSerializedState = state;

  clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(() => edSaveSong(), 700);
}


function applyState(stateStr) {
  if (!stateStr) return;

  isApplyingHistory = true;

  clearTimeout(_autoSaveTimer);
  clearTimeout(edCommitTimer);
  clearTimeout(edInputRenderTimer);
  clearTimeout(edSaveTimer);

  try {
    const state = JSON.parse(stateStr);

    DAW.tracks = state.tracks || [];
    DAW.clips = state.clips || [];
    DAW.sections = state.sections || [];
    DAW.selectedSectionIds = new Set();
    updateNextIdFromClips();

    if (state.edCur) {
      const keepId = edCur?.id;
      edCur = state.edCur;
      if (keepId != null) edCur.id = keepId;
    } else {
      edCur = null;
    }

    edSeqPoints = Array.isArray(state.edSeqPoints)
      ? state.edSeqPoints
      : (edCur?.seqPoints || []);

    if (edCur) {
      edCur.seqPoints = edSeqPoints;
      edSyncToolbar();
      function edGetSelectionState() {
  const editor = $('editor');
  const sel = document.getSelection();
  if (!editor || !sel || sel.rangeCount === 0) return null;

  const range = sel.getRangeAt(0);
  if (!editor.contains(range.startContainer)) return null;

  return {
    start: getOffsetWithinEditor(editor, range.startContainer, range.startOffset),
    end: getOffsetWithinEditor(editor, range.endContainer, range.endOffset),
    isCollapsed: range.collapsed
  };
}

      edRenderEditor(true);
    }

    ensureAudioCtx();

    DAW.tracks.forEach(t => {
      if (t.type === 'audio') {
        t._pannerNode = DAW.audioCtx.createStereoPanner();
        t._gainNode = DAW.audioCtx.createGain();
        t._pannerNode.connect(t._gainNode);
        t._gainNode.connect(DAW.masterGain);
        updateTrackMix(t.id);
      }
    });

    DAW.selectedIds.clear();
    
    // Rebuild waveforms for audio clips after undo/redo
    DAW.clips.forEach(clip => {
      if (clip.type === 'audio' && clip.bufferKey && DAW.bufferCache.has(clip.bufferKey)) {
        const buffer = DAW.bufferCache.get(clip.bufferKey);
        clip.sourceDuration = buffer.duration;
        clip._peaks = peaksFromBuffer(buffer, 2000);
        refreshClipWaveImage(clip);
      }
    });
    
    PERF.tracksVersion++;
    PERF.clipsVersion++;
    renderAll();

    if (DAW.isPlaying) {
      scheduleAllFromPlayhead();
    }

    PERF.lastSerializedState = stateStr;
  } finally {
    isApplyingHistory = false;
  }
}


    function edFlushPendingCommit() {
  if (!edCommitTimer) return;
  clearTimeout(edCommitTimer);
  edCommitTimer = null;
  edCommit();
}

function undo() {
  if (edCur && edCommitTimer) {
    edFlushPendingCommit();
  }

  if (undoIndex <= 0) {
    toast(t('nothingUndo'));
    return;
  }

  undoIndex--;
  applyState(undoStack[undoIndex]);
  toast('Undo');
}

    function redo() {
  if (undoIndex >= undoStack.length - 1) {
    toast(t('nothingRedo'));
    return;
  }

  undoIndex++;
  applyState(undoStack[undoIndex]);
  toast('Redo');
}


    async function decodeFileToBuffer(file) { ensureAudioCtx(); const ab = await file.arrayBuffer(); const copy = ab.slice(0); const buffer = await DAW.audioCtx.decodeAudioData(copy); return { buffer, arrayBuffer: ab }; }

    function peaksFromBuffer(buffer, buckets = 2000) {
      const ch = buffer.getChannelData(0); const block = Math.max(1, Math.floor(ch.length / buckets));
      const peaks = new Float32Array(buckets);
      for (let i = 0; i < buckets; i++) {
        const start = i * block; let max = 0; const end = Math.min(ch.length, start + block);
        for (let j = start; j < end; j++) { const v = Math.abs(ch[j]); if (v > max) max = v; }
        peaks[i] = max;
      }
      return peaks;
    }
    function drawWaveToCanvas(peaks, w, h) {
      const canvas = document.createElement('canvas'); canvas.width = Math.max(2, Math.floor(w)); canvas.height = Math.max(2, Math.floor(h));
      const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height); const mid = canvas.height / 2; const n = peaks.length;
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < canvas.width; i++) {
        const idx = Math.min(n - 1, Math.floor((i / canvas.width) * n)); const amp = peaks[idx] || 0;
        const hh = Math.max(1, amp * (canvas.height * 0.86)); ctx.globalAlpha = 0.55; ctx.fillRect(i, mid - hh / 2, 1, hh);
      }
      return canvas.toDataURL('image/png');
    }
    function refreshClipWaveImage(clip) {
      if (clip.type === 'chord' || !clip._peaks) return;
      const full = clip._peaks; const a = clip.offset / Math.max(1e-6, clip.sourceDuration);
      const b = (clip.offset + clip.duration) / Math.max(1e-6, clip.sourceDuration);
      const i0 = Math.floor(clamp(a, 0, 1) * (full.length - 1)); const i1 = Math.max(i0 + 1, Math.floor(clamp(b, 0, 1) * (full.length - 1)));
      const slice = full.slice(i0, i1 + 1); const w = Math.max(8, timeToX(clip.duration)); const key = `${clip.id}:${i0}:${i1}:${Math.round(w)}`;
      if (DAW.waveCache.has(key)) clip.waveUrl = DAW.waveCache.get(key); else { clip.waveUrl = drawWaveToCanvas(slice, w, 52); DAW.waveCache.set(key, clip.waveUrl); }
    }

    function updateTrackMix(trackId) {
      const tr = DAW.tracks.find(t => t.id === trackId); if (!tr || !tr._gainNode) return;
      const anySolo = DAW.tracks.some(t => t.solo); let gain = 0;
      if (anySolo) gain = tr.solo && !tr.muted ? tr.vol : 0; else gain = tr.muted ? 0 : tr.vol;
      tr._gainNode.gain.value = gain; tr._pannerNode.pan.value = tr.pan;
    }

    function stopAllVoices() {
      for (const [id, v] of DAW.voices) { try { v.source.onended = null; v.source.stop(0); } catch (_) {} try { v.source.disconnect(); } catch (_) {} try { v.gain.disconnect(); } catch (_) {} }
      DAW.voices.clear();
    }

    function scheduleAllFromPlayhead() {
      const ctx = ensureAudioCtx(); stopAllVoices();
      if (!DAW.isPlaying || DAW.isScrubbing) return;
      const nowT = DAW.playhead; const ctxNow = ctx.currentTime;
      DAW.clips.forEach(clip => {
        if (clip.type === 'chord') return;
        const tr = DAW.tracks.find(t => t.id === clip.trackId);
        if (tr && (tr.muted || (DAW.tracks.some(t => t.solo) && !tr.solo))) return;
        const buffer = DAW.bufferCache.get(clip.bufferKey); if (!buffer) return;
        const local = nowT - clip.start; if (local >= clip.duration) return;
        let when = ctxNow, mediaOffset = clip.offset, playDur = clip.duration;
        if (local < 0) when = ctxNow + (-local); else { mediaOffset = clip.offset + local; playDur = clip.duration - local; }
        if (mediaOffset >= buffer.duration - 0.0005) return; playDur = Math.min(playDur, buffer.duration - mediaOffset); if (playDur <= 0.005) return;
        const gain = ctx.createGain(); gain.gain.value = 1; gain.connect(tr._pannerNode);
        const source = ctx.createBufferSource(); source.buffer = buffer; source.connect(gain);
        // Apply transpose via playbackRate
        const semitones = tr.transpose || 0;
        if (semitones !== 0) source.playbackRate.value = Math.pow(2, semitones / 12);
        try { source.start(when, mediaOffset, playDur); } catch (err) { return; }
        source.onended = () => { if (DAW.voices.get(clip.id)?.source === source) DAW.voices.delete(clip.id); };
        DAW.voices.set(clip.id, { source, gain });
      });
    }

    function renderAll() {
  renderTracks(); renderRuler(); renderClips(); renderLoopRegion(); updatePlayheadUI(); updateHud();
  edRenderClMarkers();
}


    function renderTracks() {
      const names = $('track-names-container'); const lanes = $('lanes-container'); names.innerHTML = ''; lanes.innerHTML = '';
      DAW.tracks.forEach((tr) => {
        const h = document.createElement('div'); h.className = 'track-name' + (DAW.loadTrackId === tr.id ? ' active-load' : ''); h.dataset.trackId = tr.id;
        if (tr.muted) h.classList.add('muted-track');
        if (DAW.tracks.some(t => t.solo) && !tr.solo && tr.type !== 'chord') h.classList.add('solo-dim-track');
        if (tr.type === 'chord') {
  const chordTarget =
    edCur && typeof edCur === 'object'
      ? edCur
      : tr;

  if (!Array.isArray(chordTarget.chordVersions)) {
    chordTarget.chordVersions = [];
  }

  const verCount = chordTarget.chordVersions.length;

  const curVer = Number.isInteger(chordTarget.activeChordVersion)
    ? chordTarget.activeChordVersion
    : 0;

  h.innerHTML = `
    <span
      class="t-icon"
      data-icon-pick="${tr.id}"
      title="تغییر آیکون"
    >${getIconSvg(tr.icon)}</span>

    <span class="t-label">${tr.name}</span>

    <div style="display:flex;gap:2px;align-items:center;">
      <button
        class="t-btn"
        data-chord-ver-prev=""
        title="ورژن قبلی"
        style="font-size:0.55rem;"
      >◀</button>

      <span
        style="font-size:0.55rem;color:var(--accent-cyan-glow);min-width:46px;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;font-family:'JetBrains Mono';cursor:pointer;"
        data-chord-ver-label=""
        title="دوبار کلیک برای تغییر نام ورژن"
      >${chordTarget.chordVersions[curVer] && chordTarget.chordVersions[curVer].name ? chordTarget.chordVersions[curVer].name : 'V' + (curVer + 1)}</span>

      <button
        class="t-btn"
        data-chord-ver-next=""
        title="ورژن بعدی"
        style="font-size:0.55rem;"
      >▶</button>

      <button
        class="t-btn"
        data-chord-ver-add=""
        title="ورژن جدید"
        style="font-size:0.55rem;"
      >+</button>
    </div>

    <button
      class="t-btn ${tr.locked ? 'on-lock' : ''}"
      data-lock="${tr.id}"
      title="قفل"
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2">
        <rect x="3" y="11" width="18" height="11" rx="2"/>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
    </button>

    <button
      class="t-btn ${isRecordingChords ? 'on-rec' : ''}"
      data-rec="chord"
      title="ضبط آکورد"
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="12" cy="12" r="8"/>
      </svg>
    </button>
  `;

  // ── اتصال ابزارهای کورد لاین ──
  h.querySelector('[data-rec]').addEventListener('click', (e) => {
    e.stopPropagation();
    isRecordingChords = !isRecordingChords;
    renderAll();
    toast(isRecordingChords ? t('chordRecOn') : t('chordRecOff'));
  });
  h.querySelector('[data-lock]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    tr.locked = !tr.locked;
    saveState();
    renderTracks();
    renderClips();
    toast(tr.locked ? '🔒 آکوردهای کورد لاین قفل شد' : '🔓 آکوردهای کورد لاین باز شد');
  });
  h.querySelector('[data-chord-ver-prev]')?.addEventListener('click', (e) => { e.stopPropagation(); switchChordVersion(-1); });
  h.querySelector('[data-chord-ver-next]')?.addEventListener('click', (e) => { e.stopPropagation(); switchChordVersion(1); });
  h.querySelector('[data-chord-ver-add]')?.addEventListener('click', (e) => { e.stopPropagation(); addChordVersion(); });
  const _verLabel = h.querySelector('[data-chord-ver-label]');
  if (_verLabel) _verLabel.addEventListener('dblclick', (e) => { e.stopPropagation(); renameChordVersion(); });
  h.addEventListener('click', (e) => { if(!e.target.closest('button') && !e.target.closest('.t-icon') && !e.target.closest('[data-chord-ver-label]')) openChordEditor(); });

        } else if (tr.type === 'section') {
            h.innerHTML = `<span class="t-icon" data-icon-pick="${tr.id}" title="تغییر آیکون">${getIconSvg(tr.icon)}</span><span class="t-label">${tr.name}</span>`;
            h.querySelector('[data-icon-pick]')?.addEventListener('click', (e) => { e.stopPropagation(); openIconPicker(tr); });
        } else {
          const panPct = ((tr.pan + 1) / 2) * 100;
          const panLeftW = tr.pan < 0 ? Math.abs(tr.pan) * 50 : 0;
          const panRightW = tr.pan > 0 ? tr.pan * 50 : 0;
          const panColor = tr.pan === 0 ? '#E2E8F0' : (tr.pan < 0 ? 'var(--accent-neon-pink)' : 'var(--accent-teal)');
          h.innerHTML = `
            <div class="track-name-top-row">
              <span class="t-icon" data-icon-pick="${tr.id}" title="تغییر آیکون">${getIconSvg(tr.icon)}</span>
              <span class="t-label" contenteditable="true" spellcheck="false" style="cursor:text;min-width:40px;outline:none;">${tr.name}</span>
              <button class="t-btn" data-load="${tr.id}" title="لود آهنگ" style="font-size:0.7rem;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></button>
            </div>
            <div class="track-name-bottom-row">
              <button class="t-btn ${tr.muted ? 'on' : ''}" data-mute="${tr.id}">M</button>
              <button class="t-btn ${tr.solo ? 'on-solo' : ''}" data-solo="${tr.id}">S</button>
              <button class="t-btn ${tr.locked ? 'on-lock' : ''}" data-lock="${tr.id}" title="قفل ترک"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></button>
              <input type="range" class="t-vol" min="0" max="1" step="0.01" value="${tr.vol}" data-vol="${tr.id}">
              <div class="pan-wrap" data-pan-wrap="${tr.id}">
                  <div class="pan-track">
                      <div class="pan-fill-left" style="width:${panLeftW}%;right:50%;"></div>
                      <div class="pan-fill-right" style="width:${panRightW}%;left:50%;"></div>
                  </div>
                  <div class="pan-center"></div>
                  <div class="pan-thumb" style="left:${panPct}%;border-color:${panColor};"></div>
                  <div class="pan-labels"><span>L</span><span>R</span></div>
              </div>
              <input type="range" class="t-pan" min="-1" max="1" step="0.01" value="${tr.pan}" data-pan="${tr.id}">
              <div class="t-transpose">
                <button class="t-trans-btn" data-trans-down="${tr.id}" title="بمل">♭</button>
                <span class="t-trans-val" data-trans-val="${tr.id}">${tr.transpose || 0}</span>
                <button class="t-trans-btn" data-trans-up="${tr.id}" title="دیز">♯</button>
              </div>
            </div>`;
          // Editable track name
          const label = h.querySelector('.t-label');
          label.addEventListener('blur', () => { tr.name = label.textContent.trim() || tr.name; if (typeof renderMixer === 'function' && $('mixerPanel') && $('mixerPanel').classList.contains('show')) renderMixer(); });
          label.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); label.blur(); } });
          label.addEventListener('mousedown', e => e.stopPropagation());
          // Load audio via dedicated button
          h.querySelector('[data-load]')?.addEventListener('click', (e) => { e.stopPropagation(); openFileForTrack(tr.id); });
          // Icon picker
          h.querySelector('[data-icon-pick]')?.addEventListener('click', (e) => { e.stopPropagation(); openIconPicker(tr); });
          h.querySelector('[data-mute]').addEventListener('click', (e) => { e.stopPropagation(); tr.muted = !tr.muted; updateTrackMix(tr.id); renderAll(); if(DAW.isPlaying) scheduleAllFromPlayhead(); });
          h.querySelector('[data-solo]').addEventListener('click', (e) => { e.stopPropagation(); tr.solo = !tr.solo; DAW.tracks.forEach(t => updateTrackMix(t.id)); renderAll(); if(DAW.isPlaying) scheduleAllFromPlayhead(); });
          h.querySelector('[data-lock]')?.addEventListener('click', (e) => { e.stopPropagation(); tr.locked = !tr.locked; saveState(); renderTracks(); renderClips(); toast(tr.locked ? 'ترک قفل شد' : 'ترک باز شد'); });
          // جلوگیری از درگ شدن هدر روی دکمه‌ها و کنترل‌ها
          h.querySelectorAll('button, input, .pan-wrap, .t-transpose').forEach(el => { el.draggable = false; el.addEventListener('mousedown', (e) => e.stopPropagation()); });
          h.querySelector('[data-vol]').addEventListener('input', (e) => { e.stopPropagation(); tr.vol = +e.target.value; updateTrackMix(tr.id); });
          // Pan wrapper interaction
          const panWrap = h.querySelector(`[data-pan-wrap="${tr.id}"]`);
          if (panWrap) {
            const updatePanVisual = () => {
              const panPctV = ((tr.pan + 1) / 2) * 100;
              const pL = tr.pan < 0 ? Math.abs(tr.pan) * 50 : 0;
              const pR = tr.pan > 0 ? tr.pan * 50 : 0;
              const pC = tr.pan === 0 ? '#E2E8F0' : (tr.pan < 0 ? 'var(--accent-neon-pink)' : 'var(--accent-teal)');
              panWrap.querySelector('.pan-fill-left').style.width = pL + '%';
              panWrap.querySelector('.pan-fill-right').style.width = pR + '%';
              panWrap.querySelector('.pan-thumb').style.left = panPctV + '%';
              panWrap.querySelector('.pan-thumb').style.borderColor = pC;
            };
            const onPanDrag = (e) => {
              const rect = panWrap.getBoundingClientRect();
              const x = (e.clientX || e.touches[0].clientX) - rect.left;
              const norm = Math.max(-1, Math.min(1, (x / rect.width) * 2 - 1));
              tr.pan = Math.round(norm * 100) / 100;
              h.querySelector('[data-pan]').value = tr.pan;
              ensureAudioCtx(); updateTrackMix(tr.id); updatePanVisual();
            };
            panWrap.addEventListener('mousedown', (e) => {
              e.stopPropagation(); onPanDrag(e);
              const onMove = (ev) => onPanDrag(ev);
              const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); saveState(); };
              document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
            });
            panWrap.addEventListener('click', (e) => e.stopPropagation());
            panWrap.addEventListener('dblclick', (e) => {
              e.stopPropagation(); e.preventDefault();
              tr.pan = 0;
              h.querySelector('[data-pan]').value = 0;
              ensureAudioCtx(); updateTrackMix(tr.id); updatePanVisual(); saveState();
            });
          }
          h.querySelector('[data-pan]').addEventListener('input', (e) => { e.stopPropagation(); tr.pan = +e.target.value; updateTrackMix(tr.id); });
          // Transpose controls
          const updateTransVal = () => {
            const v = tr.transpose || 0;
            const el = h.querySelector(`[data-trans-val="${tr.id}"]`);
            if (el) el.textContent = (v > 0 ? '+' : '') + v;
          };
          h.querySelector(`[data-trans-down="${tr.id}"]`)?.addEventListener('click', (e) => {
            e.stopPropagation();
            tr.transpose = Math.max(-12, (tr.transpose || 0) - 1);
            updateTransVal();
            if (DAW.isPlaying) scheduleAllFromPlayhead();
            saveState();
          });
          h.querySelector(`[data-trans-up="${tr.id}"]`)?.addEventListener('click', (e) => {
            e.stopPropagation();
            tr.transpose = Math.min(12, (tr.transpose || 0) + 1);
            updateTransVal();
            if (DAW.isPlaying) scheduleAllFromPlayhead();
            saveState();
          });
        }
        names.appendChild(h);

        // Track drag reordering — فقط از نواحی خالی هدر قابل درگ است
        h.addEventListener('mousedown', (e) => {
          // اگر روی دکمه، اسلایدر، لیبل، پن یا ترنپوز کلیک شده، درگ فعال نشود
          if (e.target.closest('button, input, .pan-wrap, .t-label, .t-transpose, .t-btn, .t-icon')) {
            h.draggable = false;
          } else {
            h.draggable = true;
          }
        });
        h.addEventListener('dragstart', (e) => {
          if (!h.draggable) { e.preventDefault(); return; }
          e.dataTransfer.setData('text/plain', tr.id);
          e.dataTransfer.effectAllowed = e.altKey ? 'copy' : 'move';
          h.style.opacity = '0.4';
        });
        h.addEventListener('dragend', () => { h.style.opacity = ''; });
        h.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = e.altKey ? 'copy' : 'move'; h.style.borderTop = '2px solid var(--accent-teal)'; });
        h.addEventListener('dragleave', () => { h.style.borderTop = ''; });
        h.addEventListener('drop', (e) => {
          e.preventDefault(); h.style.borderTop = '';
          const draggedId = e.dataTransfer.getData('text/plain');
          if (!draggedId || draggedId === tr.id) return;
          const fromIdx = DAW.tracks.findIndex(t => t.id === draggedId);
          const toIdx = DAW.tracks.findIndex(t => t.id === tr.id);
          if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
          if (e.altKey) {
            // ALT+drag = copy
            const src = DAW.tracks[fromIdx];
            const copy = JSON.parse(JSON.stringify(src));
            copy.id = uid('t');
            copy.name = src.name + ' (copy)';
            DAW.tracks.splice(toIdx + 1, 0, copy);
          } else {
            // Normal drag = move
            const [moved] = DAW.tracks.splice(fromIdx, 1);
            DAW.tracks.splice(toIdx, 0, moved);
          }
          saveState(); renderAll();
        });

        const lane = document.createElement('div'); lane.className = 'track-lane' + (tr.type === 'chord' ? ' chord-lane' : '') + (tr.type === 'section' ? ' section-lane' : ''); lane.dataset.trackId = tr.id;
        // Apply per-lane height if set
        if (tr.laneHeight) { h.style.setProperty('--lane-h', tr.laneHeight + 'px'); h.style.height = tr.laneHeight + 'px'; lane.style.setProperty('--lane-h', tr.laneHeight + 'px'); lane.style.height = tr.laneHeight + 'px'; }
        // Apply muted/solo/locked visual states to lane
        if (tr.muted) lane.classList.add('muted-lane');
        if (tr.locked) lane.classList.add('locked-lane');
        if (DAW.tracks.some(t => t.solo) && !tr.solo && tr.type !== 'chord') lane.classList.add('solo-dim-lane');
        // Per-lane resize handle (Cubase-style: drag bottom border)
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'lane-resize-handle bottom';
        resizeHandle.addEventListener('mousedown', (e) => {
          e.stopPropagation(); e.preventDefault();
          resizeHandle.classList.add('active');
          const startY = e.clientY; const origH = tr.laneHeight || DAW.laneHeight;
          const onMove = (ev) => { const newH = Math.max(24, Math.min(200, origH + (ev.clientY - startY))); setLaneHeight(tr.id, newH); };
          const onUp = () => { resizeHandle.classList.remove('active'); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); saveState(); };
          document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
        });
        lane.appendChild(resizeHandle);
        lane.addEventListener('mousedown', (e) => {
        clearEditorTextSelection();
        edClearChordSelection();
        if (e.target.closest('.clip') || e.target.closest('.section-tag')) return;
        // Clear section selection on any empty-area click (all lanes)
        if (DAW.selectedSectionIds.size > 0) { DAW.selectedSectionIds.clear(); renderClips(); }
        if (tr.locked) { toast('🔒 ترک قفل است'); return; }

        // Alt+Click on section track: create tag with styled modal
        if (tr.type === 'section' && e.altKey) {
          e.preventDefault(); e.stopPropagation();
          const t = clientToTime(e.clientX);
          // Use customPrompt for a styled modal instead of native prompt
          customPrompt('نام بخش:', 'ورس').then(name => {
            if (name && name.trim()) {
              const sec = { id: uid('c'), trackId: tr.id, label: name.trim(), start: roundMs(t), duration: 4, color: '#3FB8AF' };
              DAW.sections.push(sec);
              ensureTimelineFits(sec.start + sec.duration + 5);
              saveState(); renderClips();
            }
          });
          return;
        }

        // Alt+Click on chord track: open chord editor
        if (tr.type === 'chord' && e.altKey) {
          e.preventDefault(); e.stopPropagation();
          const t = clientToTime(e.clientX);
          // Create a temporary anchor at clicked time and open chord modal
          // IMPORTANT: Don't change edCur (which holds the song), use a local variable
          const chordTrack = DAW.tracks.find(track => track.id === tr.id);
          if (chordTrack) {
            const anchor = { time: t, x: e.clientX, y: e.clientY };
            // Store in a temp variable, don't overwrite edCur
            window._tempChordTrackAnchor = anchor;
            window._tempChordTrack = chordTrack;
            // Open the regular chord editor (not the song chord editor)
            openChordEditor(null);
            renderClips();
          }
          return;
        }

        // Double-click on section track: create tag with styled modal
        if (tr.type === 'section' && e.detail === 2) {
          e.preventDefault(); e.stopPropagation();
          const t = clientToTime(e.clientX);
          // Use customPrompt for a styled modal instead of native prompt
          customPrompt('نام بخش:', 'ورس').then(name => {
            if (name && name.trim()) {
              const sec = { id: uid('c'), trackId: tr.id, label: name.trim(), start: roundMs(t), duration: 4, color: '#3FB8AF' };
              DAW.sections.push(sec);
              ensureTimelineFits(sec.start + sec.duration + 5);
              saveState(); renderClips();
            }
          });
          return;
        }

  const t = clientToTime(e.clientX);


            
            if (e.shiftKey && lane) {
              e.preventDefault();
              cutAtTime(t, lane.dataset.trackId);
              return;
            }

            seekTransport(t, true);
            if (!e.ctrlKey && !e.metaKey) clearSelection();
            const p = clientToInnerPoint(e.clientX, e.clientY); DAW.marquee = { x0: p.x, y0: p.y };
            document.addEventListener('mousemove', onDocMouseMove); document.addEventListener('mouseup', onDocMouseUp);
        });
        const grid = document.createElement('canvas'); grid.className = 'lane-grid'; lane.appendChild(grid);
        if (!DAW.clips.some(c => c.trackId === tr.id) && !(tr.type === 'section' && (DAW.sections || []).some(s => s.trackId === tr.id))) { 
          const hint = document.createElement('div'); 
          hint.className = 'empty-lane-hint' + (tr.type === 'section' ? ' section-hint' : ''); 
          hint.textContent = tr.type === 'chord' ? t('clickHint') : (tr.type === 'section' ? 'دوبار کلیک برای ساخت بخش' : t('loadHint')); 
          if (tr.type === 'section') {
            hint.addEventListener('dblclick', (e) => {
              e.preventDefault(); e.stopPropagation();
              const t = clientToTime(e.clientX);
              customPrompt('نام بخش:', 'ورس').then(name => {
                if (name && name.trim()) {
                  const sec = { id: uid('c'), trackId: tr.id, label: name.trim(), start: roundMs(t), duration: 4, color: '#3FB8AF' };
                  DAW.sections.push(sec);
                  ensureTimelineFits(sec.start + sec.duration + 5);
                  saveState(); renderClips();
                }
              });
            });
          }
          lane.appendChild(hint); 
        }
        lanes.appendChild(lane); drawLaneGrid(grid);
      });
    }

    // ===== Cubase-style Timeline Grid =====
    function timeToBarBeat(seconds) {
      const bpm = edCur?.tempo || 120;
      const sig = edCur?.timeSignature || '4/4';
      const beatsPerBar = parseInt(sig.split('/')[0]);
      const beatDur = 60 / bpm; // seconds per beat
      const barDur = beatDur * beatsPerBar; // seconds per bar
      const totalBeats = Math.floor(seconds / beatDur);
      const bar = Math.floor(totalBeats / beatsPerBar) + 1;
      const beat = (totalBeats % beatsPerBar) + 1;
      return { bar, beat, beatDur, barDur, beatsPerBar };
    }

    function barBeatToTime(bar, beat) {
      const bpm = edCur?.tempo || 120;
      const sig = edCur?.timeSignature || '4/4';
      const beatsPerBar = parseInt(sig.split('/')[0]);
      const beatDur = 60 / bpm;
      return ((bar - 1) * beatsPerBar + (beat - 1)) * beatDur;
    }

    function drawLaneGrid(canvas) {
      const total = getProjectEnd();
      const w = Math.min(Math.ceil(timeToX(total)), 20000); // محدودیت عرض
      // Read height from parent lane's --lane-h (per-lane) or fall back to global
      const parentLane = canvas.closest('.track-lane');
      const h = (parentLane ? parseInt(getComputedStyle(parentLane).getPropertyValue('--lane-h')) : null) || parseInt(getComputedStyle(document.documentElement).getPropertyValue('--lane-h')) || 64;
      canvas.width = w; canvas.height = h; canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, w, h);
      const bpm = edCur?.tempo || 120;
      const sig = edCur?.timeSignature || '4/4';
      const beatsPerBar = parseInt(sig.split('/')[0]);
      const beatDur = 60 / bpm;
      const barDur = beatDur * beatsPerBar;
      const pxPerSec = DAW.pxPerSecond;

      // محدود کردن تعداد خطوط برای جلوگیری از سفید شدن
      const maxLines = 500;

      // Draw bar lines (strong)
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      let barCount = 0;
      for (let bar = 1; bar * barDur <= total && barCount < maxLines; bar++) {
        const x = Math.round(timeToX(bar * barDur)) + 0.5;
        if (x > w) break;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        barCount++;
      }

      // Draw beat lines (thin) - only when zoomed in enough
      if (pxPerSec > 10) {
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 1;
        let beatCount = 0;
        for (let beat = 0; beat * beatDur <= total && beatCount < maxLines; beat++) {
          if (beat % beatsPerBar === 0) continue;
          const x = Math.round(timeToX(beat * beatDur)) + 0.5;
          if (x > w) break;
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
          beatCount++;
        }
      }

      // Draw sub-beat lines only when zoomed in enough
      if (pxPerSec > 40) {
        const subBeatDur = beatDur / 4;
        ctx.strokeStyle = 'rgba(255,255,255,0.02)';
        let subCount = 0;
        for (let sub = 0; sub * subBeatDur <= total && subCount < maxLines; sub++) {
          if (sub % 4 === 0) continue;
          const x = Math.round(timeToX(sub * subBeatDur)) + 0.5;
          if (x > w) break;
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
          subCount++;
        }
      }
    }

    function renderRuler() {
      const total = getProjectEnd();
      DAW.timelineDuration = total;
      const width = Math.ceil(timeToX(total));
      $('tl-inner').style.width = width + 'px';
      $('lanes-container').style.width = width + 'px';
      $('timeline-ruler').style.width = width + 'px';

      // حذف کانواس‌های قبلی
      $('timeline-ruler').querySelectorAll('canvas').forEach(c => c.remove());

      const labels = $('ruler-labels');
      labels.innerHTML = '';

      const bpm = edCur?.tempo || 120;
      const sig = edCur?.timeSignature || '4/4';
      const beatsPerBar = parseInt(sig.split('/')[0]);
      const beatDur = 60 / bpm;
      const barDur = beatDur * beatsPerBar;
      const pxPerSec = DAW.pxPerSecond;

      // محاسبه اینکه هر چند میزان شماره نشون بده (بر اساس زوم)
      const pxPerBar = barDur * pxPerSec;
      let barStep;
      if (pxPerBar > 120) barStep = 1;       // زیاد زوم: هر میزان
      else if (pxPerBar > 60) barStep = 2;    // زوم متوسط: هر ۲ میزان
      else if (pxPerBar > 30) barStep = 4;    // زوم کم: هر ۴ میزان
      else if (pxPerBar > 15) barStep = 8;    // زوم خیلی کم: هر ۸ میزان
      else if (pxPerBar > 8) barStep = 16;    // زوم خیلی خیلی کم: هر ۱۶ میزان
      else barStep = 32;                       // زوم اوت زیاد: هر ۳۲ میزان

      // کانواس tick های رولر
      const rulerCanvas = document.createElement('canvas');
      rulerCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
      $('timeline-ruler').appendChild(rulerCanvas);
      const cappedWidth = Math.min(width, 20000);
      rulerCanvas.width = cappedWidth;
      rulerCanvas.height = 32;
      const rctx = rulerCanvas.getContext('2d');
      rctx.clearRect(0, 0, cappedWidth, 32);

      const showBeats = pxPerSec > 15;
      const showSubBeats = pxPerSec > 50;

      for (let bar = 1; bar * barDur <= total; bar++) {
        const x = timeToX((bar - 1) * barDur);

        // شماره میزان (فقط هر barStep میزان)
        if ((bar - 1) % barStep === 0) {
          const span = document.createElement('span');
          span.className = 'ruler-tick-label major';
          span.style.left = x + 'px';
          span.textContent = bar;
          labels.appendChild(span);
        }

        // خط میزان روی رولر (کم‌رنگ‌تر)
        rctx.strokeStyle = 'rgba(74, 85, 104, 0.4)';
        rctx.lineWidth = 1;
        rctx.beginPath(); rctx.moveTo(x + 0.5, 22); rctx.lineTo(x + 0.5, 32); rctx.stroke();

        // خط میزان روی lanes (خیلی کم‌رنگ)
        // این توسط drawLaneGrid رسم میشه

        // خطوط ضرب
        if (showBeats) {
          for (let beat = 1; beat < beatsPerBar; beat++) {
            const bx = x + beat * beatDur * pxPerSec;
            if (bx > cappedWidth) break;
            rctx.strokeStyle = 'rgba(55, 65, 81, 0.3)';
            rctx.lineWidth = 1;
            rctx.beginPath(); rctx.moveTo(bx + 0.5, 26); rctx.lineTo(bx + 0.5, 32); rctx.stroke();

            // شماره ضرب (فقط وقتی فضا کافی باشه)
            if (pxPerBar > 40 && beatsPerBar <= 8) {
              const bspan = document.createElement('span');
              bspan.className = 'ruler-tick-label';
              bspan.style.left = bx + 'px';
              bspan.style.fontSize = '8px';
              bspan.style.color = '#4B5563';
              bspan.textContent = beat + 1;
              labels.appendChild(bspan);
            }
          }
        }

        // ساب‌بیت (زوم خیلی زیاد)
        if (showSubBeats) {
          for (let sub = 1; sub < 4; sub++) {
            const sx = x + sub * (beatDur / 4) * pxPerSec;
            if (sx > cappedWidth) break;
            rctx.strokeStyle = 'rgba(45, 55, 72, 0.25)';
            rctx.lineWidth = 1;
            rctx.beginPath(); rctx.moveTo(sx + 0.5, 28); rctx.lineTo(sx + 0.5, 32); rctx.stroke();
          }
        }
      }
    }

    function renderClips() {
      document.querySelectorAll('.clip').forEach(el => el.remove());
      document.querySelectorAll('.section-tag').forEach(el => el.remove());
      // Render audio & chord clips
      DAW.clips.forEach(clip => {
        const lane = document.querySelector(`.track-lane[data-track-id="${clip.trackId}"]`); if (!lane) return;
        const hint = lane.querySelector('.empty-lane-hint'); if (hint) hint.remove();
        if (clip.type !== 'chord') refreshClipWaveImage(clip);
        const el = document.createElement('div');
        el.className = 'clip' + (clip.type === 'chord' ? ' chord-clip' : '') + (DAW.selectedIds.has(clip.id) ? ' selected' : '');
        el.dataset.clipId = clip.id; el.style.left = timeToX(clip.start) + 'px'; el.style.width = Math.max(30, timeToX(clip.duration)) + 'px';
        if (clip.type !== 'chord') {
          el.style.background = `linear-gradient(180deg, ${clip.color}bb, ${clip.color}88)`;
          el.innerHTML = `<img class="clip-wave" alt="" draggable="false" ${clip.waveUrl ? `src="${clip.waveUrl}"` : ''}><div class="clip-title">${clip.name}</div><div class="resize-handle left" data-edge="left"></div><div class="resize-handle right" data-edge="right"></div>`;
          // Mouseover event to show file path in storageInfoBar
          el.addEventListener('mouseenter', (e) => {
            const filePath = getClipFilePath(clip);
            if (filePath) {
              const storageBar = document.getElementById('storageInfoBar');
              const storageText = document.getElementById('storageText');
              if (storageBar && storageText) {
                storageBar.style.display = 'block';
                storageText.textContent = filePath;
                storageText.title = filePath;
              }
            }
          });
          el.addEventListener('mouseleave', () => {
            const storageBar = document.getElementById('storageInfoBar');
            const storageText = document.getElementById('storageText');
            if (storageBar && storageText) {
              storageBar.style.display = 'none';
              storageText.textContent = '';
            }
          });
        } else {
          const chordColor = clip.color || '#9F7AEA';
          el.style.background = `linear-gradient(180deg, ${chordColor}cc, ${chordColor}77)`;
          el.style.borderColor = chordColor;
          el.innerHTML = `<span>${clip.name}</span><div class="resize-handle left" data-edge="left"></div><div class="resize-handle right" data-edge="right"></div>`;
        }
        el.addEventListener('mousedown', onClipMouseDown); lane.appendChild(el);
      });
      // Render section tags (fully decoupled from clips)
      DAW.sections.forEach(sec => {
        const lane = document.querySelector(`.track-lane[data-track-id="${sec.trackId}"]`); if (!lane) return;
        const hint = lane.querySelector('.empty-lane-hint'); if (hint) hint.remove();
        const el = document.createElement('div');
        el.className = 'section-tag' + (DAW.selectedSectionIds.has(sec.id) ? ' selected' : '');
        el.dataset.sectionId = sec.id;
        el.style.left = timeToX(sec.start) + 'px';
        el.style.width = Math.max(50, timeToX(sec.duration)) + 'px';
        el.textContent = sec.label;
        el.style.background = sec.color ? `rgba(${parseInt(sec.color.slice(1,3),16)},${parseInt(sec.color.slice(3,5),16)},${parseInt(sec.color.slice(5,7),16)},0.35)` : 'rgba(63,184,175,0.25)';
        el.style.borderColor = sec.color || 'var(--accent-teal)';

        // Drag to move + custom double-click detection
        // (native dblclick is unreliable because renderClips recreates elements)
        el.addEventListener('mousedown', (e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          e.preventDefault();

          // Custom double-click: two clicks within 350ms at same position
          // Track state on sec object (survives renderClips element recreation)
          const now = Date.now();
          const dx = Math.abs(e.clientX - (sec._clickX || 0));
          const dy = Math.abs(e.clientY - (sec._clickY || 0));
          if (sec._clickTimer && (now - (sec._clickTime || 0)) < 350 && dx < 5 && dy < 5) {
            clearTimeout(sec._clickTimer);
            sec._clickTimer = null;
            // Double-click → enter rename mode
            el.contentEditable = 'true';
            el.focus();
            const range = document.createRange();
            range.selectNodeContents(el);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            const finishEdit = () => {
              el.contentEditable = 'false';
              const newName = el.textContent.trim();
              if (newName && newName !== sec.label) { sec.label = newName; saveState(); }
              el.removeEventListener('blur', finishEdit);
              el.removeEventListener('keydown', onKey);
            };
            const onKey = (ke) => {
              if (ke.key === 'Enter') { ke.preventDefault(); el.blur(); }
              if (ke.key === 'Escape') { el.textContent = sec.label; el.blur(); }
              ke.stopPropagation();
            };
            el.addEventListener('blur', finishEdit);
            el.addEventListener('keydown', onKey);
            return;
          }

          // First click → record position, start timer
          sec._clickX = e.clientX;
          sec._clickY = e.clientY;
          sec._clickTime = now;
          sec._clickTimer = setTimeout(() => { sec._clickTimer = null; }, 350);

          // Selection logic (same as clips)
          if (e.ctrlKey || e.metaKey) {
            if (DAW.selectedSectionIds.has(sec.id)) DAW.selectedSectionIds.delete(sec.id);
            else DAW.selectedSectionIds.add(sec.id);
            renderClips();
            return;
          }
          // If clicking an already-selected section, preserve full multi-selection for cross-lane drag
          if (!DAW.selectedSectionIds.has(sec.id)) {
            DAW.selectedSectionIds = new Set([sec.id]);
            DAW.selectedIds.clear();
            renderClips();
          }

          // Build cross-lane drag items from ALL selected items (clips + sections)
          const dragItems = [];
          selectedClips().forEach(c => dragItems.push({ id: c.id, origStart: c.start, origDur: c.duration, origOffset: c.offset }));
          (DAW.sections || []).filter(s => DAW.selectedSectionIds.has(s.id)).forEach(s => dragItems.push({ id: s.id, origStart: s.start, origDur: s.duration, origOffset: 0, _isSection: true }));
          if (dragItems.length === 0) return;

          DAW.drag = { type: 'move', edge: null, primaryId: sec.id, startX: e.clientX, items: dragItems };
          document.addEventListener('mousemove', onDocMouseMove);
          document.addEventListener('mouseup', onDocMouseUp);
        });
        // Resize handles (left + right) with snap
        const resL = document.createElement('div');
        resL.className = 'resize-handle left';
        resL.addEventListener('mousedown', (e) => {
          e.stopPropagation(); e.preventDefault();
          const startX = e.clientX; const origStart = sec.start; const origDur = sec.duration;
          const onMove = (ev) => {
            const dt = xToTime(ev.clientX - startX);
            let newStart = snapTime(origStart + dt); let newDur = origStart + origDur - newStart;
            if (newStart < 0) { newDur += newStart; newStart = 0; }
            if (newDur >= 0.5) { sec.start = roundMs(newStart); sec.duration = roundMs(newDur); el.style.left = timeToX(sec.start) + 'px'; el.style.width = Math.max(50, timeToX(sec.duration)) + 'px'; }
          };
          const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); saveState(); };
          document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
        });
        const resR = document.createElement('div');
        resR.className = 'resize-handle right';
        resR.addEventListener('mousedown', (e) => {
          e.stopPropagation(); e.preventDefault();
          const startX = e.clientX; const origDur = sec.duration;
          const onMove = (ev) => { sec.duration = Math.max(0.5, roundMs(snapTime(origDur + xToTime(ev.clientX - startX)))); el.style.width = Math.max(50, timeToX(sec.duration)) + 'px'; };
          const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); saveState(); };
          document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
        });
        el.appendChild(resL);
        el.appendChild(resR);
        lane.appendChild(el);
      });
    }

    function updatePlayheadUI() {
      const x = timeToX(DAW.playhead); $('main-playhead').style.left = x + 'px'; $('playhead-hit').style.left = x + 'px';
      $('time-display').value = formatTime(DAW.playhead); $('ph-label').textContent = formatTime(DAW.playhead);
      const activeChord = DAW.clips.filter(c => c.type === 'chord' && DAW.playhead >= c.start && DAW.playhead < c.start + c.duration).pop();
      if (activeChord && $('live-chord')) $('live-chord').textContent = activeChord.name;
      else if ($('live-chord')) $('live-chord').textContent = 'None';
    }

    function updateHud() { $('clip-count').textContent = String(DAW.clips.length + (DAW.sections || []).length); }

    // ===== ICON PICKER =====
    const ICON_SVG_MAP = {
      '🎤': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>',
      '🎸': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 2l-2 2c-1.5 1.5-4 1.5-5.5 0L11 6l-2-2c-1.5-1.5-4-1.5-5.5 0L2 4V20l2-2c1.5 1.5 4 1.5 5.5 0l1.5-1.5 2 2c1.5 1.5 4 1.5 5.5 0l2-2V2z"/><line x1="7" y1="11" x2="13" y2="17"/><line x1="11" y1="7" x2="17" y2="13"/></svg>',
      '🎹': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2"/><line x1="6" y1="2" x2="6" y2="14"/><line x1="10" y1="2" x2="10" y2="14"/><line x1="14" y1="2" x2="14" y2="14"/><line x1="18" y1="2" x2="18" y2="14"/><rect x="4" y="2" width="2" height="8" rx="1" fill="currentColor" opacity="0.3"/><rect x="8" y="2" width="2" height="8" rx="1" fill="currentColor" opacity="0.3"/><rect x="12" y="2" width="2" height="8" rx="1" fill="currentColor" opacity="0.3"/><rect x="16" y="2" width="2" height="8" rx="1" fill="currentColor" opacity="0.3"/></svg>',
      '🎺': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v8m0 0l4 4m-4-4l-4 4"/><circle cx="12" cy="18" r="4"/><path d="M8 22h8"/></svg>',
      '🎻': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2v6m6-6v6"/><ellipse cx="12" cy="16" rx="6" ry="8"/><line x1="12" y1="8" x2="12" y2="24"/></svg>',
      '🥁': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="12" rx="10" ry="6"/><line x1="4" y1="6" x2="4" y2="18"/><line x1="20" y1="6" x2="20" y2="18"/><path d="M8 2l4 4m4-4l-4 4"/></svg>',
      '🎷': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2l2 6-4 4"/><path d="M18 2l-2 6 4 4"/><path d="M12 8v14"/><circle cx="12" cy="22" r="2"/></svg>',
      '🎵': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
      '🎶': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/><path d="M9 9l12-2"/></svg>',
      '🎼': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/><line x1="9" y1="9" x2="21" y2="7"/></svg>',
      '🎙️': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/><circle cx="12" cy="1" r="1" fill="currentColor"/></svg>',
      '🎧': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>',
      '📡': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/><circle cx="12" cy="12" r="2"/></svg>',
      '🎛️': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>',
      '⏺': '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8"/></svg>',
      '♫': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
      '🏷': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
    };
    function getIconSvg(icon) { return ICON_SVG_MAP[icon] || icon; }

    const INSTRUMENT_ICONS = ['🎤','🎸','🎹','🎺','🎻','🥁','🎷','🎵','🎶','🎼','🎙️','🎧','📡','🎛️','⏺','♫','🏷'];

    let _iconPickerTrack = null;

    function openIconPicker(track) {
      _iconPickerTrack = track;
      const grid = $('iconPickerGrid');
      grid.innerHTML = '';
      INSTRUMENT_ICONS.forEach(icon => {
        const item = document.createElement('div');
        item.className = 'icon-picker-item' + (icon === track.icon ? ' active' : '');
        item.innerHTML = getIconSvg(icon);
        item.onclick = () => {
          track.icon = icon;
          $('iconPickerOverlay').classList.remove('show');
          _iconPickerTrack = null;
          saveState(); renderAll();
        };
        grid.appendChild(item);
      });
      $('iconPickerOverlay').classList.add('show');
    }

    // Close icon picker on overlay click
    if ($('iconPickerOverlay')) {
      $('iconPickerOverlay').addEventListener('click', (e) => {
        if (e.target === $('iconPickerOverlay')) {
          $('iconPickerOverlay').classList.remove('show');
          _iconPickerTrack = null;
        }
      });
    }

    // ===== HEADER RESIZE (drag to resize track names column) =====
    (function initHeaderResize() {
      const resizeEl = document.getElementById('timelineHeaderResize');
      const grid = document.querySelector('.timeline-workspace-grid');
      if (!resizeEl || !grid) return;

      let startX = 0, startW = 0;
      const onMouseMove = (e) => {
        const dx = e.clientX - startX;
        const newW = Math.max(120, Math.min(500, startW + dx));
        grid.style.gridTemplateColumns = newW + 'px 4px 1fr';
        document.documentElement.style.setProperty('--header-w', newW + 'px');
      };
      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      resizeEl.addEventListener('mousedown', (e) => {
        e.preventDefault();
        startX = e.clientX;
        startW = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-w')) || 240;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });
    })();

    function addNewTrack(name, icon) {
      const n = DAW.tracks.length + 1; ensureAudioCtx();
      const newT = { id: uid('t'), name: name || `Line ${n}`, icon: icon || '🎛️', type: 'audio', muted: false, solo: false, vol: 0.8, pan: 0, transpose: 0, locked: false };
      newT._pannerNode = DAW.audioCtx.createStereoPanner(); newT._gainNode = DAW.audioCtx.createGain();
      newT._pannerNode.connect(newT._gainNode); newT._gainNode.connect(DAW.masterGain); DAW.tracks.push(newT);
      saveState(); renderAll(); toast(t('newTrackAdded'));
    }

     let _audioSaveTimer = null;
     let _audioSaveRunning = false;
     let _audioSaveQueued = false;

     function scheduleAudioBlobSave() {
     if (!edCur?.id) return;

     clearTimeout(_audioSaveTimer);

    _audioSaveTimer = setTimeout(async () => {
    if (_audioSaveRunning) {
      _audioSaveQueued = true;
      return;
    }

    _audioSaveRunning = true;

    try {
      await saveAudioBlobsForProject(edCur.id);
    } catch (e) {
      console.warn('Audio save error:', e);
    } finally {
      _audioSaveRunning = false;

      if (_audioSaveQueued) {
        _audioSaveQueued = false;
        scheduleAudioBlobSave();
      }
    }
  }, 1200);
}

    function openFileForTrack(trackId) { DAW.loadTrackId = trackId; renderTracks(); $('audio-file-input').value = ''; $('audio-file-input').click(); }
    $('audio-file-input').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0]; const trackId = DAW.loadTrackId; DAW.loadTrackId = null; renderTracks();
      if (!file || !trackId) return;
      // Clear all selections before import
      clearSelection();
      try {
        ensureAudioCtx(); toast(t('decoding')); const { buffer } = await decodeFileToBuffer(file);
        
        // ایجاد شناسه پایدار برای کلیپ
        const clipId = 'clip_' + uid('c');
        
        // ذخیره در Pool
        const storageMode = await askAudioCopyMode(file.name);
        const storage = {
          mode: storageMode ? 'copy' : 'reference',
          projectPath: storageMode ? `Audio/${clipId}_${file.name}` : null,
          externalPath: storageMode ? null : (isElectron && file.path ? file.path : null)
        };
        
        DAW.pool[clipId] = {
          id: clipId,
          name: file.name.replace(/\.[^.]+$/, ''),
          originalName: file.name,
          storage: storage,
          sampleRate: buffer.sampleRate,
          channels: buffer.numberOfChannels,
          frames: buffer.length,
          duration: buffer.duration,
          offlineOps: []
        };
        
        // ذخیره در کش با کلید clipId
        DAW.bufferCache.set(clipId, buffer);

        const clip = {
          id: clipId,
          type: 'audio',
          trackId,
          name: file.name.replace(/\.[^.]+$/, ''),
          fileName: file.name,
          start: roundMs(DAW.playhead),
          duration: buffer.duration,
          offset: 0,
          sourceDuration: buffer.duration,
          color: COLORS[DAW.clips.length % COLORS.length],
          _peaks: peaksFromBuffer(buffer, 2000),
          waveUrl: null,
          _embedded: storageMode,
          // ─── ذخیره Blob اصلی برای ذخیره حجم (به‌جای Base64) ───
          // این فایل MP3/WAV اصلی هست که مستقیماً در IndexedDB ذخیره می‌شه
          _originalBlob: storageMode ? file : null
        };
        // ذخیره مسیر/هندل فایل برای لینک‌شده‌ها
        if (!storageMode) {
          if (isElectron && file.path) {
            clip._filePath = file.path;
            console.log(`[INPUT] Electron file path saved: ${file.name} → ${file.path}`);
          } else if (isElectron) {
            // در الکترون ولی file.path موجود نیست (الکترون 32+)
            console.warn(`[INPUT] Electron but file.path is missing for: ${file.name}`);
            if (window.electronAPI && window.electronAPI.getPathForFile) {
              try {
                const filePath = await window.electronAPI.getPathForFile(file);
                if (filePath) {
                  clip._filePath = filePath;
                  console.log(`[INPUT] Got path via webUtils: ${file.name} → ${filePath}`);
                }
              } catch(_) {}
            }
            if (!clip._filePath) {
              try {
                await saveAudioBlobToDB(clipId, file, file.name);
                console.log(`[INPUT] Saved as blob fallback: ${file.name}`);
              } catch(e) {
                console.warn('[BLOB] Could not save file blob to IndexedDB:', e);
              }
            }
          } else {
            // ─── در مرورگر: فایل رو به‌صورت Blob در IndexedDB ذخیره کن ───
            try {
              await saveAudioBlobToDB(clipId, file, file.name);
            } catch(e) {
              console.warn('[BLOB] Could not save file blob to IndexedDB:', e);
            }
          }
        }
        refreshClipWaveImage(clip); DAW.clips.push(clip); DAW.selectedIds = new Set([clip.id]); ensureTimelineFits(clip.start + clip.duration + 5);
        saveState(); renderAll(); if (DAW.isPlaying) scheduleAllFromPlayhead();
        if (storageMode) {
          toast(`${t('loadedOk')} ${clip.name} (کپی در پروژه)`);
          saveAudioBlobsForProject(edCur.id).catch(() => {});
        } else {
          toast(`${t('loadedOk')} ${clip.name} (لینک — فقط مسیر ذخیره شد)`);
        }
        edSaveSong();
      } catch (err) { console.error(err); toast(t('loadFailed')); }
    });

    function setSelection(ids) {
  DAW.selectedIds = new Set(ids);
  renderClips();
  updateHud();
}

    function clearSelection() { DAW.selectedIds.clear(); DAW.selectedSectionIds.clear(); renderClips(); updateHud(); }
   function clearEditorTextSelection() {
     window.getSelection()?.removeAllRanges();
     $('editor')?.blur();
}

    function deleteSelected() {
      const clipIds = [...DAW.selectedIds];
      const sectionIds = [...DAW.selectedSectionIds];
      
      if (!clipIds.length && !sectionIds.length) { 
        toast(t('nothingSelected')); 
        return; 
      }
      
      stopAllVoices();
      
      // Delete selected clips
      if (clipIds.length) {
        DAW.clips = DAW.clips.filter(c => !DAW.selectedIds.has(c.id));
        DAW.selectedIds.clear();
      }
      
      // Delete selected sections
      if (sectionIds.length) {
        DAW.sections = DAW.sections.filter(s => !DAW.selectedSectionIds.has(s.id));
        DAW.selectedSectionIds.clear();
      }
      
      saveState(); 
      renderAll();
      if (DAW.isPlaying) scheduleAllFromPlayhead(); 
      toast(t('deleted'));
    }

    function copySelected() {
      const sels = selectedClips(); if (!sels.length) { toast(t('nothingSelected')); return; }
      const minStart = Math.min(...sels.map(c => c.start));
      DAW.clipboard = sels.map(c => { const cp = {...c}; delete cp._peaks; delete cp.waveUrl; cp.relStart = c.start - minStart; return cp; });
      toast(`${DAW.clipboard.length} ${t('clipsCopied')}`);
    }

    function cutSelected() { copySelected(); if (DAW.clipboard.length) { deleteSelected(); toast(t('cutDone')); } }

    function pasteClipboard() {
      if (!DAW.clipboard.length) { toast(t('clipboardEmpty')); return; }
      const base = DAW.playhead; const newIds = [];
      for (const src of DAW.clipboard) {
        const clip = { ...src, id: uid('c'), start: roundMs(base + (src.relStart || 0)) };
        if (clip.type === 'audio') { if (!DAW.bufferCache.has(clip.bufferKey)) continue; clip._peaks = peaksFromBuffer(DAW.bufferCache.get(clip.bufferKey), 2000); refreshClipWaveImage(clip); }
        DAW.clips.push(clip); newIds.push(clip.id); ensureTimelineFits(clip.start + clip.duration + 5);
      }
      DAW.selectedIds = new Set(newIds); saveState(); renderAll(); if (DAW.isPlaying) scheduleAllFromPlayhead(); toast(t('pastedAtPlayhead'));
      edSaveSong();
    }

    // CTRL+D: Duplicate selected (copy + paste immediately after)
    function duplicateSelected() {
      const sels = selectedClips();
      if (!sels.length) { toast(t('nothingSelected')); return; }
      const newIds = [];
      sels.forEach(src => {
        const clip = { ...src, id: uid('c'), start: roundMs(src.start + src.duration) };
        if (clip.type === 'audio') {
          if (!DAW.bufferCache.has(clip.bufferKey)) return;
          clip._peaks = peaksFromBuffer(DAW.bufferCache.get(clip.bufferKey), 2000);
          refreshClipWaveImage(clip);
        }
        DAW.clips.push(clip);
        newIds.push(clip.id);
        ensureTimelineFits(clip.start + clip.duration + 5);
      });
      DAW.selectedIds = new Set(newIds);
      saveState(); renderAll();
      if (DAW.isPlaying) scheduleAllFromPlayhead();
      toast(newIds.length + ' کلیپ کپی شد');
    }

    function splitClipAt(clip, atTime) {
      const t = roundMs(atTime); if (t <= clip.start + 0.01 || t >= clip.start + clip.duration - 0.01) return null;
      const leftDur = roundMs(t - clip.start); const rightDur = roundMs(clip.duration - leftDur);
      clip.duration = leftDur; if (clip.type === 'audio') refreshClipWaveImage(clip);
      const right = { ...clip, id: uid('c'), start: t, duration: rightDur };
      if (clip.type === 'audio') { right.offset = roundMs(clip.offset + leftDur); refreshClipWaveImage(right); }
      DAW.clips.push(right); return right;
    }

    function splitSelectedAtPlayhead() {
      const sels = selectedClips(); if (!sels.length) { toast(t('nothingSelected')); return; } const created = [];
      sels.forEach(c => { const r = splitClipAt(c, DAW.playhead); if (r) created.push(r.id); });
      if (created.length) { DAW.selectedIds = new Set(created); saveState(); renderAll(); if (DAW.isPlaying) scheduleAllFromPlayhead(); toast(t('splitDone')); }
    }

    function cutAtTime(time, trackId = null) {
  const t = roundMs(time);
  if (!trackId) return false;

  const hits = DAW.clips.filter(c => {
    if (c.trackId !== trackId) return false;
    return t > c.start + 0.01 &&
           t < c.start + c.duration - 0.01;
  });

      if (!hits.length) {
        seekTransport(t, true);
        toast(t('noClipToCut'));
        return false;
      }

      const created = [];
sels.forEach(c => {
  if (c.type !== 'chord') return;
  const r = splitClipAt(c, DAW.playhead);
  if (r) created.push(r.id);
});


      seekTransport(t, true);
      if (created.length) {
        DAW.selectedIds = new Set(created);
        saveState(); renderAll();
        if (DAW.isPlaying) scheduleAllFromPlayhead();
        toast(`${t('clipsCut')}: ${hits.length}`);
        return true;
      }
      renderAll();
      return false;
    }

    function clientToTime(clientX) { const inner = $('tl-inner').getBoundingClientRect(); return clamp(xToTime(clientX - inner.left), 0, getProjectEnd()); }
    function clientToInnerPoint(clientX, clientY) { const inner = $('tl-inner').getBoundingClientRect(); return { x: clientX - inner.left, y: clientY - inner.top }; }

    function onClipMouseDown(e) {
  if (e.button !== 0) return;

  clearEditorTextSelection();
  edClearChordSelection();
  if ($('editor')) $('editor').blur();

  // Deselect sections when clicking on any clip
  if (DAW.selectedSectionIds.size > 0) { DAW.selectedSectionIds.clear(); renderClips(); }

  e.stopPropagation();
  e.preventDefault();

  const clipId = e.currentTarget.dataset.clipId;
  const clip = getClip(clipId);
  if (!clip) return;

  // Check if track is locked
  const track = DAW.tracks.find(t => t.id === clip.trackId);
  if (track && track.locked) { toast('ترک قفل است'); return; }

  edClearChordSelection();

  // دبل‌کلیک سفارشی (native dblclick به خاطر preventDefault و بازسازی کلیپ‌ها قابل‌اعتماد نیست)
  const _now = Date.now();
  const _dx = Math.abs(e.clientX - (clip._clickX || 0));
  const _dy = Math.abs(e.clientY - (clip._clickY || 0));
  if (clip._clickTimer && (_now - (clip._clickTime || 0)) < 350 && _dx < 5 && _dy < 5) {
    clearTimeout(clip._clickTimer); clip._clickTimer = null;
    if (clip.type === 'chord') openChordEditor(clip.id);
    return;
  }
  clip._clickX = e.clientX; clip._clickY = e.clientY; clip._clickTime = _now;
  clip._clickTimer = setTimeout(() => { clip._clickTimer = null; }, 350);

      // Shift+Click to Cut
      if (e.shiftKey) {
        const t = clientToTime(e.clientX);
        cutAtTime(t, clip.trackId);
        return;
      }

      // Alt+Click to Duplicate (Copy and immediately drag the copy)
      if (e.altKey) {
        const sels = selectedClips();
        if (!sels.find(c => c.id === clipId)) DAW.selectedIds = new Set([clipId]);
        
        const toDuplicate = selectedClips();
        const newIds = [];
        const dragItems = [];
        
        toDuplicate.forEach(c => {
            const newClip = { ...c, id: uid('c') };
            delete newClip._peaks;
            if (c.type === 'audio') {
                const buf = DAW.bufferCache.get(c.bufferKey);
                if (buf) newClip._peaks = peaksFromBuffer(buf, 2000);
                refreshClipWaveImage(newClip);
            }
            DAW.clips.push(newClip);
            newIds.push(newClip.id);
            dragItems.push({ id: newClip.id, origStart: newClip.start, origDur: newClip.duration, origOffset: newClip.offset });
        });
        
        DAW.selectedIds = new Set(newIds);
        DAW.drag = { type: 'move', edge: null, primaryId: dragItems[0]?.id, startX: e.clientX, items: dragItems };
        renderAll();
        document.addEventListener('mousemove', onDocMouseMove);
        document.addEventListener('mouseup', onDocMouseUp);
        return;
      }

      if (e.ctrlKey || e.metaKey) { if (DAW.selectedIds.has(clipId)) DAW.selectedIds.delete(clipId); else DAW.selectedIds.add(clipId); renderClips(); return; }
      // If clicking an already-selected clip, preserve the full multi-selection for cross-lane drag
      if (!DAW.selectedIds.has(clipId)) { DAW.selectedIds = new Set([clipId]); DAW.selectedSectionIds.clear(); renderClips(); }

      const edge = e.target.dataset.edge || null;
      let dragItems;
      if (edge) {
        // Resize: only the clicked clip
        dragItems = [{ id: clipId, origStart: clip.start, origDur: clip.duration, origOffset: clip.offset }];
      } else {
        // Move: all selected clips + all selected sections
        dragItems = selectedClips().map(c => ({ id: c.id, origStart: c.start, origDur: c.duration, origOffset: c.offset }));
        (DAW.sections || []).filter(s => DAW.selectedSectionIds.has(s.id)).forEach(s => dragItems.push({ id: s.id, origStart: s.start, origDur: s.duration, origOffset: 0, _isSection: true }));
      }
      DAW.drag = { type: edge ? 'resize' : 'move', edge, primaryId: clipId, startX: e.clientX, items: dragItems };
      document.addEventListener('mousemove', onDocMouseMove); document.addEventListener('mouseup', onDocMouseUp);
    }

    let dragOverLaneTrackId = null;

    function onDocMouseMove(e) {
      if (DAW.drag) {
        const dt = xToTime(e.clientX - DAW.drag.startX);
        
        // Check if we're over a different track lane during move
        if (DAW.drag.type === 'move') {
          const targetLane = e.target.closest('.track-lane');
          if (targetLane) {
            const laneTrackId = targetLane.dataset.trackId;
            const targetTrack = DAW.tracks.find(t => t.id === laneTrackId);
            // Only allow drop on audio tracks (not section or chord)
            if (targetTrack && targetTrack.type === 'audio') {
              dragOverLaneTrackId = laneTrackId;
            } else {
              dragOverLaneTrackId = null;
            }
          } else {
            dragOverLaneTrackId = null;
          }
        }
        
        if (DAW.drag.type === 'move') {
          DAW.drag.items.forEach(it => {
            let item;
            if (it._isSection) { item = (DAW.sections || []).find(s => s.id === it.id); }
            else { item = getClip(it.id); }
            if (!item) return;
            item.start = Math.max(0, roundMs(snapTime(it.origStart + dt)));
            ensureTimelineFits(item.start + (item.duration || it.origDur) + 5);
          });
        } else if (DAW.drag.type === 'resize') {
          const it = DAW.drag.items.find(x => x.id === DAW.drag.primaryId); const clip = getClip(DAW.drag.primaryId); if (!it || !clip) return;
          if (DAW.drag.edge === 'right') {
            const maxDur = clip.type === 'chord' ? 1000 : clip.sourceDuration - clip.offset;
            clip.duration = clamp(roundMs(snapTime(it.origDur + dt)), 0.03, maxDur); if (clip.type === 'audio') refreshClipWaveImage(clip);
          } else {
            let newStart = it.origStart + dt, newOffset = it.origOffset + dt, newDur = it.origDur - dt;
            if (clip.type === 'chord') {
               if (newStart < 0) { newDur += newStart; newStart = 0; }
               if (newDur > 0.03) { clip.start = roundMs(snapTime(newStart)); clip.duration = roundMs(it.origStart + it.origDur - snapTime(newStart)); }
            } else {
               if (newOffset < 0) { newStart -= newOffset; newDur += newOffset; newOffset = 0; }
               if (newStart < 0) { const sh = -newStart; newStart = 0; newOffset += sh; newDur -= sh; }
               if (newDur >= 0.03 && newOffset + newDur <= clip.sourceDuration + 1e-6) { clip.start = roundMs(newStart); clip.offset = roundMs(newOffset); clip.duration = roundMs(newDur); refreshClipWaveImage(clip); }
            }
          }
        }
        renderRuler(); renderClips(); updateHud();
      }
      if (DAW.marquee) {
        const p = clientToInnerPoint(e.clientX, e.clientY); const x1 = Math.min(DAW.marquee.x0, p.x), y1 = Math.min(DAW.marquee.y0, p.y);
        const x2 = Math.max(DAW.marquee.x0, p.x), y2 = Math.max(DAW.marquee.y0, p.y); const box = $('marquee');
        box.style.display = 'block'; box.style.left = x1 + 'px'; box.style.top = y1 + 'px'; box.style.width = (x2 - x1) + 'px'; box.style.height = (y2 - y1) + 'px';
        // Select clips inside marquee
        const clipIds = [];
        document.querySelectorAll('.clip').forEach(el => { const r = el.getBoundingClientRect(), ir = $('tl-inner').getBoundingClientRect(); const cx1 = r.left - ir.left, cy1 = r.top - ir.top, cx2 = cx1 + r.width, cy2 = cy1 + r.height; if (!(cx2 < x1 || cx1 > x2 || cy2 < y1 || cy1 > y2)) clipIds.push(el.dataset.clipId); });
        DAW.selectedIds = new Set(clipIds);
        document.querySelectorAll('.clip').forEach(el => el.classList.toggle('selected', DAW.selectedIds.has(el.dataset.clipId)));
        // Select sections inside marquee
        const secIds = [];
        document.querySelectorAll('.section-tag').forEach(el => { const r = el.getBoundingClientRect(), ir = $('tl-inner').getBoundingClientRect(); const cx1 = r.left - ir.left, cy1 = r.top - ir.top, cx2 = cx1 + r.width, cy2 = cy1 + r.height; if (!(cx2 < x1 || cx1 > x2 || cy2 < y1 || cy1 > y2)) secIds.push(el.dataset.sectionId); });
        DAW.selectedSectionIds = new Set(secIds);
        document.querySelectorAll('.section-tag').forEach(el => el.classList.toggle('selected', DAW.selectedSectionIds.has(el.dataset.sectionId)));
      }
    }

    function onDocMouseUp() {
      if (DAW.drag) {
        // If we were dragging over a different track lane, move clips to that track
        if (DAW.drag.type === 'move' && dragOverLaneTrackId) {
          DAW.drag.items.forEach(it => {
            const clip = getClip(it.id);
            if (clip && !it._isSection) {
              clip.trackId = dragOverLaneTrackId;
            }
          });
        }
        dragOverLaneTrackId = null;
        DAW.drag = null;
        saveState();
        if (DAW.isPlaying) scheduleAllFromPlayhead();
        renderAll();
      }
      if (DAW.marquee) { DAW.marquee = null; $('marquee').style.display = 'none'; renderClips(); }
      document.removeEventListener('mousemove', onDocMouseMove); document.removeEventListener('mouseup', onDocMouseUp);
    }

    function seekTransport(t, keepPlaying = true, noSnap = false) {
      DAW.playhead = clamp(roundMs(noSnap ? t : snapTime(t)), 0, getProjectEnd());
      if (DAW.isPlaying) { DAW.playOriginPerf = performance.now(); DAW.playOriginTime = DAW.playhead; }
      updatePlayheadUI(); if (DAW.isPlaying && !DAW.isScrubbing) scheduleAllFromPlayhead(); else stopAllVoices();
    }

    // Return-to-start on pause (Cubase style)
    let returnToStartOnPause = false;
    let playStartPos = 0;

    function toggleReturnToStart() {
      returnToStartOnPause = !returnToStartOnPause;
      const btn = $('returnToStartBtn');
      if (btn) {
        btn.style.background = returnToStartOnPause ? 'var(--accent-teal)' : '';
        btn.style.color = returnToStartOnPause ? '#000' : '';
        btn.style.borderColor = returnToStartOnPause ? 'var(--accent-teal)' : '';
      }
      toast(returnToStartOnPause ? 'برگشت به ابتدا فعال شد' : 'برگشت به ابتدا غیرفعال شد');
    }

    function togglePlay() {
      if (DAW.isPlaying) {
        if (returnToStartOnPause) {
          const savedPos = playStartPos;
          pauseTransport();
          seekTransport(savedPos, false);
        } else {
          pauseTransport();
        }
      } else {
        playStartPos = DAW.playhead;
        startTransport();
      }
    }

    function startTransport() {
      ensureAudioCtx();
      DAW.isPlaying = true; DAW.isScrubbing = false; DAW.playOriginPerf = performance.now(); DAW.playOriginTime = DAW.playhead;
      $('play-btn').style.color = 'var(--accent-neon-pink)'; scheduleAllFromPlayhead();

      // Update perf play button
      if (perfModeActive) $('perfPlayBtn').textContent = '⏸';

      // Auto-start metronome if enabled
      if (metroActive && !metroTimer) startMetronome();

      const tick = () => {
        if (!DAW.isPlaying) return;
        if (!DAW.isScrubbing) DAW.playhead = DAW.playOriginTime + (performance.now() - DAW.playOriginPerf) / 1000;

        // Loop A-B: if playhead reaches B, jump back to A
        if (DAW.loopEnabled && !DAW.isRecording && DAW.playhead >= DAW.loopB) {
          const overshoot = DAW.playhead - DAW.loopB;
          DAW.playhead = DAW.loopA + overshoot;
          DAW.playOriginPerf = performance.now();
          DAW.playOriginTime = DAW.playhead;
          scheduleAllFromPlayhead();
        }

        updatePlayheadUI();
        checkMetronomeTick(DAW.playhead);
        const scroll = $('tl-scroll'); const x = timeToX(DAW.playhead);
        if (DAW.playheadMode === 'center') {
          // Stationary: keep playhead visually at center by scrolling
          scroll.scrollLeft = Math.max(0, x - scroll.clientWidth / 2);
        } else {
          // Page scrolling: playhead reaches right edge → jump back to left
          const margin = 60;
          if (x > scroll.scrollLeft + scroll.clientWidth - margin) {
            scroll.scrollLeft = Math.max(0, x - margin);
          } else if (x < scroll.scrollLeft + margin) {
            scroll.scrollLeft = Math.max(0, x - margin);
          }
        }
        // ─── Early prep: وقتی ۱۵ ثانیه به انتها مونده، شروع به ساختن state آهنگ بعدی کن ───
        // این زمان زیاد هست تا مطمئن بشیم حتی برای فایل‌های بزرگ هم کافیه.
        if (arrPerformActive && !_arrNextState && !arrPreparePending) {
          const end = getArrangerEnd();
          if (end > 0 && DAW.playhead >= end - 15) {
            // فقط اگر قبلاً برای این ایندکس prep شروع نشده، لاگ بزن
            if (_arrPrepStartedForIndex !== arrPerformIdx + 1) {
              _arrPrepStartedForIndex = arrPerformIdx + 1;
              console.log(`[Arranger] Starting prep at ${DAW.playhead.toFixed(1)}s (end: ${end.toFixed(1)}s)`);
            }
            arrPreparePending = true;
            prepareNextArrSong()
              .then(() => { arrPreparePending = false; })
              .catch((e) => {
                console.error('[Arranger] Prep failed:', e);
                arrPreparePending = false;
                _arrNextState = null;
              });
          }
        }
        if (DAW.playhead >= (arrPerformActive ? getArrangerEnd() : getProjectEnd())) {
          // Gapless arranger: hot-swap if next song is ready
          // Guard: اگر در حال کراس‌فید هستیم، صبر کن تا تموم شه
          if (arrPerformActive && _arrNextState && !_arrIsCrossfading) {
            const crossfadeDur = arrPerformData?.crossfade || 0;
            if (crossfadeDur > 0) arrCrossfadeSwap();
            else hotSwapToNextSong();
            DAW.rafId = requestAnimationFrame(tick); return;
          }
          // اگر کراس‌فید در حال اجراست، به تیک بعدی منتقل شو
          if (_arrIsCrossfading) {
            DAW.rafId = requestAnimationFrame(tick); return;
          }
          // ─── اگر _arrNextState آماده نیست ولی prep در حال اجراست: صبر کن (وارد حالت pause شو) ───
          // به‌جای stop، playback رو pause می‌کنیم تا وقتی prep تموم شد، ادامه بدیم
          if (arrPerformActive && !_arrNextState && arrPreparePending) {
            console.log('[Arranger] Reached end but prep still running. Entering wait mode...');
            // playback رو متوقف کن ولی transport رو stop نکن
            stopAllVoices();
            DAW.isPlaying = false;
            // ─── مکانیزم poll مستقل از tick ───
            // چون tick با DAW.isPlaying=false متوقف می‌شه، یک poll جداگانه می‌سازیم
            // که وقتی prep تموم شد، hot-swap رو انجام بده
            if (!_arrWaitPollActive) {
              _arrWaitPollActive = true;
              const waitPoll = () => {
                if (!arrPerformActive) { _arrWaitPollActive = false; return; }
                if (_arrNextState) {
                  console.log('[Arranger] Prep finished during wait — hot-swapping now');
                  _arrWaitPollActive = false;
                  if (arrPerformData?.crossfade > 0) arrCrossfadeSwap();
                  else hotSwapToNextSong();
                } else if (!arrPreparePending) {
                  // prep تموم شده ولی _arrNextState هنوز null — fallback
                  console.warn('[Arranger] Prep finished but no next state — fallback to loadArrSong');
                  _arrWaitPollActive = false;
                  arrPreparePending = true;
                  loadArrSong(arrPerformIdx + 1)
                    .then(() => { arrPreparePending = false; })
                    .catch((e) => { console.error(e); arrPreparePending = false; });
                } else {
                  // هنوز صبر کن
                  setTimeout(waitPoll, 100);
                }
              };
              setTimeout(waitPoll, 100);
            }
            return;
          }
          // ─── اگر نه prep در حال اجراست و نه _arrNextState آماده‌ست: fallback به loadArrSong ───
          if (arrPerformActive && !_arrNextState && !arrPreparePending) {
            console.warn('[Arranger] Next song not ready and no prep running — fallback to loadArrSong');
            arrPreparePending = true;
            loadArrSong(arrPerformIdx + 1)
              .then(() => { arrPreparePending = false; })
              .catch((e) => {
                console.error('[Arranger] Fallback loadArrSong failed:', e);
                arrPreparePending = false;
              });
            return;
          }
          stopTransport(); return;
        }
        // Update sync highlight during playback (works for both sync mode and popup)
        if (syncActive) updateSyncHighlight();
        else if (_lyricPopup && !_lyricPopup.closed) updateSyncHighlight();
        DAW.rafId = requestAnimationFrame(tick);
      };

      // Count-in: play metronome for N bars before starting
      if (countInBars > 0 && metroActive) {
        const bpm = parseInt($('edTempo')?.value) || 120;
        const sig = $('edTimeSig')?.value || '4/4';
        const beatsPerBar = parseInt(sig.split('/')[0]);
        const beatDur = 60 / bpm;
        let countBeat = 0;
        const totalBeats = countInBars * beatsPerBar;
        $('play-btn').style.color = 'var(--accent-cyan-glow)';
        toast('🔢 شمارش: ' + countInBars + ' میزان');
        const countInTick = () => {
          if (countBeat >= totalBeats) {
            DAW.isPlaying = true; DAW.isScrubbing = false; DAW.playOriginPerf = performance.now(); DAW.playOriginTime = DAW.playhead;
            $('play-btn').style.color = 'var(--accent-neon-pink)'; scheduleAllFromPlayhead();
            if (DAW.rafId) cancelAnimationFrame(DAW.rafId); DAW.rafId = requestAnimationFrame(tick);
            return;
          }
          playClick(countBeat % beatsPerBar === 0);
          countBeat++;
          setTimeout(countInTick, beatDur * 1000);
        };
        countInTick();
        // Stop metronome after count-in — it was only for counting
        metroActive = false;
        $('metroToggleBtn').textContent = '🔇';
        return;
      }

      DAW.isPlaying = true; DAW.isScrubbing = false; DAW.playOriginPerf = performance.now(); DAW.playOriginTime = DAW.playhead;
      $('play-btn').style.color = 'var(--accent-neon-pink)'; scheduleAllFromPlayhead();
      if (DAW.rafId) cancelAnimationFrame(DAW.rafId); DAW.rafId = requestAnimationFrame(tick);
    }

    function pauseTransport() {
      if (DAW.isRecording) endRec();
      DAW.isPlaying = false; DAW.isScrubbing = false; if (DAW.rafId) cancelAnimationFrame(DAW.rafId); DAW.rafId = null; stopAllVoices(); $('play-btn').style.color = 'var(--accent-cyan-glow)'; updatePlayheadUI();

      // Auto-stop metronome
      if (metroTimer) stopMetronome();

      // Clear sync highlights in editor
      const editorEl = $('editor');
      if (editorEl) [...editorEl.children].forEach(el => { el.classList.remove('sync-playing', 'sync-done'); });

      // Update perf play button
      if (perfModeActive) $('perfPlayBtn').textContent = '▶';
    }
    function stopTransport() { pauseTransport(); DAW.playhead = 0; updatePlayheadUI();
      // Auto-advance arranger when song finishes
      if (arrPerformActive && arrPerformData) {
        // If pause mode, don't auto-advance
        if (perfPauseMode && perfModeActive) {
          if (perfModeActive) renderPerfUI();
          return;
        }
        loadArrSong(arrPerformIdx + 1);
      }
      // Update perf UI play button
      if (perfModeActive) { $('perfPlayBtn').textContent = '▶'; renderPerfUI(); }
    }
    // Arranger end: uses selectionEnd if defined, otherwise end of song content
    // Does NOT depend on loopEnabled — selection range is separate from loop
    function getArrangerEnd() {
      if (selectionEnd > 0) return selectionEnd;
      // Fallback: end of last clip/section in current project
      let end = 0;
      DAW.clips.forEach(c => end = Math.max(end, c.start + c.duration));
      DAW.sections.forEach(s => end = Math.max(end, s.start + s.duration));
      return end > 0 ? end : getProjectEnd();
    }
    function transportToStart() { seekTransport(0); }
    function transportToEnd() { let end = 0; DAW.clips.forEach(c => end = Math.max(end, c.start + c.duration)); seekTransport(end); }

    /* ============================================================
       RECORDING (mic/input) + MIXER
       ============================================================ */
    function ensureRecLane() {
      let tr = DAW.tracks.find(t => t.id === 'tRec');
      if (!tr) {
        ensureAudioCtx();
        tr = { id: 'tRec', name: 'Rec', icon: '●', type: 'audio', isRec: true, muted: false, solo: false, vol: 0.8, pan: 0, transpose: 0, locked: false };
        const idx = DAW.tracks.findIndex(t => t.type === 'section');
        if (idx >= 0) DAW.tracks.splice(idx + 1, 0, tr); else DAW.tracks.push(tr);
      }
      if (tr.type === 'audio' && !tr._gainNode) {
        ensureAudioCtx();
        tr._pannerNode = DAW.audioCtx.createStereoPanner();
        tr._gainNode = DAW.audioCtx.createGain();
        tr._pannerNode.connect(tr._gainNode);
        tr._gainNode.connect(DAW.masterGain);
      }
      if (typeof updateTrackMix === 'function') updateTrackMix(tr.id);
      return tr;
    }

    function updateRecUI() {
      const btn = $('recBtn');
      if (btn) btn.classList.toggle('rec-on', !!DAW.isRecording);
      const laneName = document.querySelector('.track-name[data-track-id="tRec"]');
      if (laneName) laneName.classList.toggle('rec-lane-name', !!DAW.isRecording);
      const lane = document.querySelector('.track-lane[data-track-id="tRec"]');
      if (lane) lane.classList.toggle('rec-lane', !!DAW.isRecording);
    }

    function recMimeType() {
      if (typeof MediaRecorder === 'undefined') return undefined;
      const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
      for (const t of types) {
        try { if (MediaRecorder.isTypeSupported(t)) return t; } catch (_) {}
      }
      return undefined;
    }

    async function startRec() {
      if (DAW.isRecording) return;
      if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        toast('ضبط صدا در این محیط پشتیبانی نمی‌شود'); return;
      }
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (err) {
        console.error(err);
        toast('دسترسی به میکروفن/ورودی صوتی رد شد'); return;
      }
      try {
        const ctx = ensureAudioCtx();
        const recLane = ensureRecLane(); renderAll();
        const audioSource = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser(); analyser.fftSize = 1024;
        const dest = ctx.createMediaStreamDestination();
        audioSource.connect(analyser);
        analyser.connect(dest);

        const chunks = [];
        const mrType = recMimeType();
        const recorder = new MediaRecorder(dest.stream, mrType ? { mimeType: mrType } : undefined);
        recorder.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) chunks.push(ev.data); };
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: mrType || recorder.mimeType || 'audio/webm' });
          finishRec(blob);
        };

        DAW.isRecording = true;
        DAW.recLaneId = recLane ? recLane.id : 'tRec';
        DAW.recStartTime = DAW.playhead;
        DAW.recEndTime = DAW.playhead;
        DAW.recPeaks = [];
        DAW.recAnalyser = analyser;
        DAW.recStream = stream;
        DAW.recMediaRecorder = recorder;

        try { recorder.start(250); } catch (e) {
          console.error(e); toast('خطا در شروع ضبط');
          DAW.isRecording = false; cleanupRecResources(); return;
        }
        renderAll();
        updateRecUI();
        if (!DAW.isPlaying) startTransport();
        toast('● ضبط شروع شد — برای توقف R را بزنید');

        const tickRecWave = () => {
          if (!DAW.isRecording) { DAW.recRafId = null; return; }
          try {
            const data = new Float32Array(DAW.recAnalyser.fftSize);
            DAW.recAnalyser.getFloatTimeDomainData(data);
            let max = 0;
            for (let i = 0; i < data.length; i++) { const a = Math.abs(data[i]); if (a > max) max = a; }
            DAW.recPeaks.push(max);
          } catch (_) {}
          renderLiveRecWave();
          DAW.recRafId = requestAnimationFrame(tickRecWave);
        };
        DAW.recRafId = requestAnimationFrame(tickRecWave);
      } catch (err) {
        console.error(err);
        toast('خطا در راه‌اندازی ضبط');
        DAW.isRecording = false; cleanupRecResources();
      }
    }

    function cleanupRecResources() {
      if (DAW.recRafId) { cancelAnimationFrame(DAW.recRafId); DAW.recRafId = null; }
      try { if (DAW.recMediaRecorder && DAW.recMediaRecorder.state !== 'inactive') DAW.recMediaRecorder.stop(); } catch (_) {}
      try { if (DAW.recStream) DAW.recStream.getTracks().forEach(t => t.stop()); } catch (_) {}
      DAW.recStream = null; DAW.recMediaRecorder = null; DAW.recAnalyser = null; DAW.recPeaks = [];
      document.querySelectorAll('.rec-live-clip').forEach(el => el.remove());
    }

    function endRec() {
      if (!DAW.isRecording) return;
      DAW.recEndTime = DAW.playhead;
      cleanupRecResources(); // رویداد onstop، finishRec را صدا می‌زند
      DAW.isRecording = false;
      updateRecUI();
    }

    function toggleRec() {
      if (DAW.isRecording) {
        endRec();
        if (DAW.isPlaying) pauseTransport();
      } else {
        startRec();
      }
    }

    function renderLiveRecWave() {
      const lane = document.querySelector('.track-lane[data-track-id="' + DAW.recLaneId + '"]');
      if (!lane) return;
      const dur = Math.max(0.02, DAW.playhead - DAW.recStartTime);
      const w = Math.min(20000, Math.max(6, Math.floor(timeToX(dur))));
      let el = document.querySelector('.clip.rec-live-clip');
      if (!el) {
        el = document.createElement('div');
        el.className = 'clip rec-live-clip';
        el.dataset.rec = '1';
        el.style.top = '6px';
        el.style.height = 'calc(var(--lane-h) - 12px)';
        el.style.pointerEvents = 'none';
        lane.appendChild(el);
      }
      el.style.left = timeToX(DAW.recStartTime) + 'px';
      el.style.width = w + 'px';
      el.innerHTML = '<img class="clip-wave" src="' + recWaveDataUrl(DAW.recPeaks, w, 52) + '"><div class="clip-title">● ضبط زنده</div>';
    }

    function recWaveDataUrl(peaks, w, h) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(2, w); canvas.height = Math.max(2, h);
      const c = canvas.getContext('2d');
      c.fillStyle = 'rgba(255,120,120,0.9)';
      const mid = h / 2;
      for (let i = 0; i < w; i++) {
        const idx = Math.min(peaks.length - 1, Math.floor((i / w) * peaks.length));
        const amp = Math.min(1, peaks[idx] || 0);
        const hh = Math.max(1.5, amp * (h * 0.86));
        c.fillRect(i, mid - hh / 2, 1, hh);
      }
      return canvas.toDataURL('image/png');
    }

    function finishRec(blob) {
      const start = DAW.recStartTime || 0;
      const end = (DAW.recEndTime != null && DAW.recEndTime >= start) ? DAW.recEndTime : DAW.playhead;
      const dur = Math.max(0.05, end - start);
      if (!blob || blob.size < 500) { toast('ضبط خالی بود'); return; }
      (async () => {
        try {
          ensureAudioCtx();
          const { buffer } = await decodeFileToBuffer(blob);
          const bufferKey = 'rec_' + uid('b') + '_' + Date.now();
          DAW.bufferCache.set(bufferKey, buffer);
          const clip = {
            id: uid('c'), type: 'audio', trackId: DAW.recLaneId || 'tRec',
            name: 'Recording ' + formatTime(start),
            start: roundMs(start), duration: roundMs(dur), offset: 0,
            sourceDuration: buffer.duration,
            color: '#EF4444', bufferKey,
            _peaks: peaksFromBuffer(buffer, 2000), waveUrl: null,
            _embedded: true, _originalBlob: blob
          };
          refreshClipWaveImage(clip);
          DAW.clips.push(clip);
          DAW.selectedIds = new Set([clip.id]);
          ensureTimelineFits(clip.start + clip.duration + 5);
          saveState(); renderAll();
          try { await saveAudioBlobToDB(bufferKey, blob, 'recording.webm'); } catch (_) {}
          toast('✓ ضبط ذخیره شد');
        } catch (err) {
          console.error(err);
          toast('خطا در ذخیره‌ی ضبط');
        }
      })();
    }

    /* ===== MIXER ===== */
    let _mixerPos = null;
    function toggleMixer() {
      const p = $('mixerPanel'); if (!p) return;
      initMixerDrag();
      const show = !p.classList.contains('show');
      p.classList.toggle('show', show);
      if (show) { if (_mixerPos) { p.style.transform = 'none'; p.style.left = _mixerPos.left + 'px'; p.style.top = _mixerPos.top + 'px'; } renderMixer(); }
    }
    function renderMixer() {
      const wrap = $('mixerChannels'); if (!wrap) return;
      wrap.innerHTML = '';
      const tracks = DAW.tracks.filter(t => t.type === 'audio');
      if (!tracks.length) { wrap.innerHTML = '<div style="color:var(--text-secondary);padding:12px;">ترک صوتی وجود ندارد</div>'; return; }
      tracks.forEach(tr => {
        const ch = document.createElement('div');
        ch.className = 'mixer-channel' + (tr.id === 'tRec' ? ' rec-channel' : '');
        const volPct = Math.round((tr.vol || 0) * 100);
        const bal = tr.pan < 0 ? 'L ' + Math.round(Math.abs(tr.pan) * 100) : (tr.pan > 0 ? 'R ' + Math.round(tr.pan * 100) : '(C)');
        ch.innerHTML =
          '<div class="mixer-ch-top"><span class="mixer-ch-name">' + (tr.icon || '') + '</span>' +
          '<input class="mixer-ch-name-input" value="' + tr.name + '" data-mn="' + tr.id + '" title="تغییر نام لاین" spellcheck="false"></div>' +
          '<div class="mixer-ch-controls">' +
            '<button class="t-btn ' + (tr.muted ? 'on' : '') + '" data-mm="' + tr.id + '" title="Mute">M</button>' +
            '<button class="t-btn ' + (tr.solo ? 'on-solo' : '') + '" data-ms="' + tr.id + '" title="Solo">S</button>' +
          '</div>' +
          '<div class="mixer-ch-fader"><label>Volume (' + volPct + '%)</label>' +
            '<input type="range" min="0" max="1" step="0.01" value="' + (tr.vol || 0) + '" data-mv="' + tr.id + '"></div>' +
          '<div class="mixer-ch-fader"><label>Balance ' + bal + '</label>' +
            '<input type="range" min="-1" max="1" step="0.01" value="' + (tr.pan || 0) + '" data-mp="' + tr.id + '"></div>';
        wrap.appendChild(ch);
      });
      wrap.querySelectorAll('[data-mn]').forEach(inp => inp.addEventListener('change', () => {
        const tr = DAW.tracks.find(t => t.id === inp.dataset.mn); if (!tr) return;
        tr.name = inp.value.trim() || tr.name; saveState(); renderTracks(); renderClips(); if (DAW.isPlaying) scheduleAllFromPlayhead();
      }));
      wrap.querySelectorAll('[data-mm]').forEach(b => b.addEventListener('click', () => {
        const tr = DAW.tracks.find(t => t.id === b.dataset.mm); if (!tr) return;
        tr.muted = !tr.muted; updateTrackMix(tr.id); renderMixer(); renderTracks(); renderClips(); if (DAW.isPlaying) scheduleAllFromPlayhead();
      }));
      wrap.querySelectorAll('[data-ms]').forEach(b => b.addEventListener('click', () => {
        const tr = DAW.tracks.find(t => t.id === b.dataset.ms); if (!tr) return;
        tr.solo = !tr.solo; DAW.tracks.forEach(t => updateTrackMix(t.id)); renderMixer(); renderTracks(); renderClips(); if (DAW.isPlaying) scheduleAllFromPlayhead();
      }));
      wrap.querySelectorAll('[data-mv]').forEach(r => r.addEventListener('input', () => {
        const tr = DAW.tracks.find(t => t.id === r.dataset.mv); if (!tr) return;
        tr.vol = +r.value; updateTrackMix(tr.id);
        r.parentElement.querySelector('label').textContent = 'Volume (' + Math.round(tr.vol * 100) + '%)';
      }));
      wrap.querySelectorAll('[data-mp]').forEach(r => {
        r.addEventListener('input', () => {
          const tr = DAW.tracks.find(t => t.id === r.dataset.mp); if (!tr) return;
          tr.pan = +r.value; updateTrackMix(tr.id);
          const lab = r.parentElement.querySelector('label');
          lab.textContent = 'Balance ' + (tr.pan < 0 ? 'L ' + Math.round(Math.abs(tr.pan) * 100) : (tr.pan > 0 ? 'R ' + Math.round(tr.pan * 100) : '(C)'));
        });
        r.addEventListener('dblclick', (e) => {
          e.preventDefault();
          const tr = DAW.tracks.find(t => t.id === r.dataset.mp); if (!tr) return;
          tr.pan = 0; r.value = 0; updateTrackMix(tr.id);
          r.parentElement.querySelector('label').textContent = 'Balance (C)';
        });
      });
    }
    function initMixerDrag() {
      const panel = $('mixerPanel'); if (!panel || panel._dragReady) return;
      panel._dragReady = true;
      const head = panel.querySelector('.mixer-head'); if (!head) return;
      head.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;
        e.preventDefault();
        const rect = panel.getBoundingClientRect();
        panel.style.transform = 'none';
        const offX = e.clientX - rect.left, offY = e.clientY - rect.top;
        const move = (ev) => {
          let x = ev.clientX - offX, y = ev.clientY - offY;
          x = Math.max(-panel.offsetWidth + 80, Math.min(x, window.innerWidth - 40));
          y = Math.max(0, Math.min(y, window.innerHeight - 30));
          panel.style.left = x + 'px'; panel.style.top = y + 'px';
        };
        const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); const r = panel.getBoundingClientRect(); _mixerPos = { left: r.left, top: r.top }; };
        document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
      });
    }

    /* ============================================================
       SETTINGS (theme, audio device, toggles) + movable windows
       ============================================================ */
    const SETTINGS_KEY = 'ed_app_settings';
    let APP_SETTINGS = {};
    function loadSettings(){ try { APP_SETTINGS = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch(_){ APP_SETTINGS = {}; } }
    function saveSettings(){ try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(APP_SETTINGS)); } catch(_){} }
    const THEMES = {
      dark:     { '--dark-bg':'#0F131E', '--panel-bg':'#161B26', '--workspace-bg':'#121622', '--timeline-bg':'#0D1017', '--accent-teal':'#3FB8AF', '--accent-cyan-glow':'#00F2FE', '--accent-neon-pink':'#FF2E93' },
      midnight: { '--dark-bg':'#0a0c14', '--panel-bg':'#12141f', '--workspace-bg':'#0d0f18', '--timeline-bg':'#090b11', '--accent-teal':'#818CF8', '--accent-cyan-glow':'#A5B4FC', '--accent-neon-pink':'#FF6BB5' },
      ocean:    { '--dark-bg':'#04131c', '--panel-bg':'#0a2230', '--workspace-bg':'#071b27', '--timeline-bg':'#051420', '--accent-teal':'#21D4FD', '--accent-cyan-glow':'#4FB3E8', '--accent-neon-pink':'#FF7EB3' },
      sunset:   { '--dark-bg':'#1a0f14', '--panel-bg':'#2a1a22', '--workspace-bg':'#221320', '--timeline-bg':'#1a1018', '--accent-teal':'#FF9E6D', '--accent-cyan-glow':'#FFB1A8', '--accent-neon-pink':'#FF4D8D' },
      forest:   { '--dark-bg':'#08130d', '--panel-bg':'#101f16', '--workspace-bg':'#0c1811', '--timeline-bg':'#08140d', '--accent-teal':'#34D399', '--accent-cyan-glow':'#6EE7B7', '--accent-neon-pink':'#F472B6' }
    };
    function applyThemeVars(vars) { const r = document.documentElement.style; if (!vars) return; for (const k in vars) r.setProperty(k, vars[k]); }
    function applyTheme(name) {
      applyThemeVars(THEMES[name] || null);
      APP_SETTINGS.theme = name || 'dark'; saveSettings();
      if (APP_SETTINGS.accent) { const r = document.documentElement.style; r.setProperty('--accent-teal', APP_SETTINGS.accent); r.setProperty('--accent-cyan-glow', APP_SETTINGS.accent); }
    }
    function applyAccent(color) {
      const r = document.documentElement.style;
      r.setProperty('--accent-teal', color); r.setProperty('--accent-cyan-glow', color);
      APP_SETTINGS.accent = color; saveSettings();
    }
    async function loadOutputDevices() {
      const sel = $('setOutDevice'); if (!sel) return;
      try {
        if (navigator && navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
          const devs = await navigator.mediaDevices.enumerateDevices();
          devs.filter(d => d.kind === 'audiooutput').forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.deviceId; opt.textContent = d.label || ('خروجی ' + (sel.options.length + 1));
            sel.appendChild(opt);
          });
        }
      } catch(_) {}
      sel.value = APP_SETTINGS.outDevice || 'default';
    }
    function applyOutputDevice(id) {
      APP_SETTINGS.outDevice = id; saveSettings();
      try {
        const ctx = ensureAudioCtx();
        if (ctx && ctx.destination && typeof ctx.destination.setSinkId === 'function') {
          ctx.destination.setSinkId(id).then(() => toast('دستگاه خروجی تغییر کرد')).catch(() => toast('تغییر دستگاه پشتیبانی نمی‌شود'));
        } else { toast('تغییر دستگاه خروجی پشتیبانی نمی‌شود'); }
      } catch(_) { toast('تغییر دستگاه خروجی پشتیبانی نمی‌شود'); }
    }
    function applySettingsToggles() {
      const metro = $('setMetronome').checked;
      if (metro !== metroActive) toggleMetronome();
      APP_SETTINGS.metronome = metro;
      returnToStartOnPause = $('setReturnToStart').checked;
      APP_SETTINGS.returnToStart = returnToStartOnPause;
      const wantLock = $('setSizeLock').checked;
      if (wantLock !== !!_sizeLocked) toggleSizeLock();
      APP_SETTINGS.sizeLock = wantLock;
      saveSettings();
    }
    function openSettings() {
      loadSettings();
      if ($('setTheme')) $('setTheme').value = APP_SETTINGS.theme || 'dark';
      if (APP_SETTINGS.accent && $('setAccent')) $('setAccent').value = APP_SETTINGS.accent;
      if ($('setMetronome')) $('setMetronome').checked = !!metroActive;
      if ($('setReturnToStart')) $('setReturnToStart').checked = !!returnToStartOnPause;
      if ($('setSizeLock')) $('setSizeLock').checked = !!_sizeLocked;
      $('settingsModal').classList.add('show');
      $('settingsModal').focus();
      loadOutputDevices();
    }
    function closeSettings() { $('settingsModal').classList.remove('show'); }
    function resetSettings() {
      localStorage.removeItem(SETTINGS_KEY);
      APP_SETTINGS = {};
      applyTheme('dark');
      const r = document.documentElement.style;
      r.removeProperty('--accent-teal'); r.removeProperty('--accent-cyan-glow'); r.removeProperty('--accent-neon-pink');
      metroActive = false; if ($('metroToggleBtn')) $('metroToggleBtn').textContent = '🔇';
      returnToStartOnPause = false;
      if (_sizeLocked) toggleSizeLock();
      openSettings();
      toast('تنظیمات بازنشانی شد');
    }
    loadSettings();
    if (APP_SETTINGS.theme) applyTheme(APP_SETTINGS.theme);
    if (APP_SETTINGS.accent) { const r = document.documentElement.style; r.setProperty('--accent-teal', APP_SETTINGS.accent); r.setProperty('--accent-cyan-glow', APP_SETTINGS.accent); }

    // Generic: drag windows from their title/header
    function initMovableWindows() {
      document.addEventListener('mousedown', (e) => {
        const head = e.target.closest('h3, h4, .mv-head, .shortcut-panel-header');
        if (!head) return;
        if (head.closest('#arrangerModal')) return;
        const panel = head.closest('.mv-window') || head.closest('.chord-editor') || head.closest('.icon-picker-panel') || head.closest('.arr-song-note-panel') || head.closest('.shortcut-panel');
        if (!panel) return;
        if (e.target.closest('button, input, select, textarea')) return;
        e.preventDefault();
        const r = panel.getBoundingClientRect();
        const w = panel.offsetWidth, h = panel.offsetHeight;
        panel.style.position = 'fixed';
        panel.style.margin = '0';
        panel.style.left = r.left + 'px';
        panel.style.top = r.top + 'px';
        const ox = e.clientX - r.left, oy = e.clientY - r.top;
        const move = (me) => {
          let x = me.clientX - ox, y = me.clientY - oy;
          x = Math.max(-w + 60, Math.min(x, window.innerWidth - 40));
          y = Math.max(0, Math.min(y, window.innerHeight - 30));
          panel.style.left = x + 'px'; panel.style.top = y + 'px';
        };
        const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
        document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
      });
    }
    initMovableWindows();

    // Playhead mode toggle
    function togglePlayheadMode() {
      DAW.playheadMode = DAW.playheadMode === 'page' ? 'center' : 'page';
      const btn = $('playheadModeBtn');
      if (btn) btn.classList.toggle('ph-center', DAW.playheadMode === 'center');
      toast(DAW.playheadMode === 'center' ? 'پلی‌هدر ثابت در مرکز' : 'اسکرول صفحه‌ای');
    }

    /* ===== HIGHLIGHT EFFECT ===== */
    const HL_EFFECTS = ['neon', 'frost', 'shift', 'depth', 'pulse'];
    const HL_NAMES = { neon: 'Neon Glow', frost: 'Frosted Glass', shift: 'Color Shift', depth: 'Double Shadow', pulse: 'Pulse Glow' };

    function getHighlightEffect() { return edCur?.styles?.highlightEffect || 'depth'; }

    function setHighlightEffect(effect) {
      if (!HL_EFFECTS.includes(effect)) return;
      if (!edCur) return;
      edCur.styles.highlightEffect = effect;
      // Update selector UI
      document.querySelectorAll('.hl-opt').forEach(el => {
        el.classList.toggle('active', el.dataset.effect === effect);
      });
      const nameEl = $('hl-effect-name');
      if (nameEl) nameEl.textContent = HL_NAMES[effect] || effect;
      // Apply to editor container
      applyHighlightClassToEditor();
      // Apply to popup
      applyHighlightClassToPopup();
      edSaveSong();
    }

    function applyHighlightClassToEditor() {
      const ed = $('editor');
      if (!ed) return;
      HL_EFFECTS.forEach(hl => ed.classList.remove('hl-' + hl));
      ed.classList.add('hl-' + getHighlightEffect());
    }

    function applyHighlightClassToPopup() {
      if (!_lyricPopup || _lyricPopup.closed) return;
      const popupDoc = _lyricPopup.document;
      if (!popupDoc) return;
      const body = popupDoc.body;
      if (!body) return;
      HL_EFFECTS.forEach(hl => body.classList.remove('hl-' + hl));
      body.classList.add('hl-' + getHighlightEffect());
    }

    function initHighlightEffect() {
      const effect = getHighlightEffect();
      document.querySelectorAll('.hl-opt').forEach(el => {
        el.classList.toggle('active', el.dataset.effect === effect);
      });
      const nameEl = $('hl-effect-name');
      if (nameEl) nameEl.textContent = HL_NAMES[effect] || effect;
      applyHighlightClassToEditor();
    }

    /* ===== LOOP A-B ===== */
    function toggleLoop() {
      DAW.loopEnabled = !DAW.loopEnabled;
      const btn = $('loopToggleBtn');
      if (btn) btn.classList.toggle('loop-active', DAW.loopEnabled);
      renderLoopRegion();
      toast(DAW.loopEnabled ? 'Loop ON' : 'Loop OFF');
    }

    function setLoopA() {
      DAW.loopA = DAW.playhead;
      if (DAW.loopB <= DAW.loopA) DAW.loopB = Math.max(DAW.loopA + 1, DAW.loopA + 5);
      renderLoopRegion();
      toast('Loop A: ' + formatTime(DAW.loopA));
    }

    function setLoopB() {
      DAW.loopB = DAW.playhead;
      if (DAW.loopA >= DAW.loopB) DAW.loopA = Math.max(0, DAW.loopB - 5);
      renderLoopRegion();
      toast('Loop B: ' + formatTime(DAW.loopB));
    }

    function clearLoop() {
      DAW.loopA = 0;
      DAW.loopB = 10;
      selectionEnd = 0;
      renderLoopRegion();
      toast('محدوده پاک شد');
    }

    // P key: set loop range from selection (no activate)
    function setLoopFromSelection() {
      const sels = selectedClips();
      if (!sels.length) { toast('آیتمی انتخاب نشده'); return; }
      const starts = sels.map(c => c.start);
      const ends = sels.map(c => c.start + c.duration);
      DAW.loopA = Math.min(...starts);
      DAW.loopB = Math.max(...ends);
      selectionEnd = DAW.loopB;
      DAW.loopEnabled = false;
      renderLoopRegion();
      toast('محدوده: ' + formatTime(DAW.loopA) + ' → ' + formatTime(DAW.loopB));
    }

    // Alt+P: set loop range from selection + activate + play from start
    function setLoopFromSelectionAndPlay() {
      const sels = selectedClips();
      if (!sels.length) { toast('آیتمی انتخاب نشده'); return; }
      const starts = sels.map(c => c.start);
      const ends = sels.map(c => c.start + c.duration);
      DAW.loopA = Math.min(...starts);
      DAW.loopB = Math.max(...ends);
      DAW.loopEnabled = true;
      DAW.playhead = DAW.loopA;
      const btn = $('loopToggleBtn');
      if (btn) btn.classList.add('loop-active');
      renderLoopRegion();
      updatePlayheadUI();
      // Stop any current playback, then start fresh from loopA
      if (DAW.isPlaying) { DAW.isPlaying = false; if (DAW.rafId) cancelAnimationFrame(DAW.rafId); stopAllVoices(); }
      startTransport();
      toast('Loop ON: ' + formatTime(DAW.loopA) + ' → ' + formatTime(DAW.loopB));
    }

    function renderLoopRegion() {
      const strip = $('loop-strip');
      const locators = $('loop-locators');
      const locLeft = $('loop-loc-left');
      const locRight = $('loop-loc-right');
      const hasRange = DAW.loopA < DAW.loopB;

      if (!hasRange) {
        if (strip) strip.style.display = 'none';
        if (locators) locators.style.display = 'none';
        return;
      }

      const xA = timeToX(DAW.loopA);
      const xB = timeToX(DAW.loopB);
      const w = xB - xA;

      if (strip) {
        strip.style.display = 'block';
        strip.style.left = xA + 'px';
        strip.style.width = w + 'px';
        if (DAW.loopEnabled) {
          strip.classList.add('loop-active');
          strip.classList.remove('loop-inactive');
        } else {
          strip.classList.remove('loop-active');
          strip.classList.add('loop-inactive');
        }
      }
      if (locators) locators.style.display = 'block';
      if (locLeft) locLeft.style.left = (xA - 5) + 'px';
      if (locRight) locRight.style.left = (xB - 5) + 'px';
    }

    // Cubase-style locator dragging on ruler
    (function initLoopDrag() {
      let dragTarget = null;

      $('loop-loc-left')?.addEventListener('mousedown', (e) => { e.stopPropagation(); e.preventDefault(); dragTarget = 'A'; addDragListeners(); });
      $('loop-loc-right')?.addEventListener('mousedown', (e) => { e.stopPropagation(); e.preventDefault(); dragTarget = 'B'; addDragListeners(); });

      function addDragListeners() {
        document.addEventListener('mousemove', onDragMove);
        document.addEventListener('mouseup', onDragUp);
      }
      function onDragMove(e) {
        if (!dragTarget) return;
        const inner = $('tl-inner');
        if (!inner) return;
        const rect = inner.getBoundingClientRect();
        const t = clamp(xToTime(e.clientX - rect.left), 0, getProjectEnd());
        if (dragTarget === 'A') {
          DAW.loopA = Math.min(t, DAW.loopB - 0.5);
        } else {
          DAW.loopB = Math.max(t, DAW.loopA + 0.5);
        }
        renderLoopRegion();
      }
      function onDragUp() {
        if (dragTarget) { dragTarget = null; saveState(); }
        document.removeEventListener('mousemove', onDragMove);
        document.removeEventListener('mouseup', onDragUp);
      }
    })();

    /* ===== POPUP WINDOW FULLSCREEN ===== */
    let _lyricPopup = null;
    let _focusMode = false;
    let _savedGridRows = ''; // saved gridTemplateRows before focus mode
    function toggleFocusMode() {
      _focusMode = !_focusMode;
      document.body.classList.toggle('focus-mode', _focusMode);
      // Override inline gridTemplateRows from timeline-sep drag
      const grid = $('app-container') || document.querySelector('.app-container');
      if (grid) {
        if (_focusMode) {
          _savedGridRows = grid.style.gridTemplateRows;
          grid.style.gridTemplateRows = '';
        } else {
          grid.style.gridTemplateRows = _savedGridRows || '';
        }
      }
      if (_focusMode) toast(t('focusMode'));
      else toast(t('normalMode'));
      if (typeof edCur !== 'undefined' && edCur) { setTimeout(() => edRenderChords(), 50); }
    }
    function openLyricPopup() {
      if (_lyricPopup && !_lyricPopup.closed) { _lyricPopup.focus(); return; }
      _lyricPopup = window.open('', 'lyricPopup', 'width=900,height=700,menubar=no,toolbar=no,location=no,status=no');
      if (!_lyricPopup) { toast(t('popupBlocked')); return; }
      try { _lyricPopup.__popupRole = 'player'; } catch(_) {}
      syncLyricPopup();
      setTimeout(safeMirrorTimeline, 1000);
    }

    // ===== LYRIC-ONLY POPUP (singer view, no chords) =====
    let _lyricOnlyPopup = null;
    function openLyricOnlyPopup() {
      if (_lyricOnlyPopup && !_lyricOnlyPopup.closed) { _lyricOnlyPopup.focus(); return; }
      _lyricOnlyPopup = window.open('', 'lyricOnlyPopup', 'width=650,height=400,menubar=no,toolbar=no,location=no,status=no');
      if (!_lyricOnlyPopup) { toast(t('popupBlocked')); return; }
      try { _lyricOnlyPopup.__popupRole = 'singer'; } catch(_) {}
      syncLyricOnlyPopup();
    }
    function syncLyricOnlyPopup() {
      if (!_lyricOnlyPopup || _lyricOnlyPopup.closed) return;
      if (!edCur) return;
      const doc = _lyricOnlyPopup.document;
      const title = edCur.title || 'بدون نام';
      const artist = edCur.artist || '';
      const tSize = edCur.styles?.tSize || 38;
      const tColor = edCur.styles?.tColor || '#0fa966';
      const tFont = edCur.styles?.tFont || 'Vazirmatn';
      const tBold = edCur.styles?.tBold ? 'bold' : 'normal';
      const align = edCur.styles?.align || 'center';
      const lines = (edCur.lyrics || '').split('\n');

      doc.title = title + ' — ' + artist + ' | خواننده';
      doc.documentElement.dir = 'rtl';
      doc.documentElement.lang = 'fa';
      doc.head.innerHTML = `
        <style>
          @font-face { font-family: 'Vazirmatn'; src: url('../fonts/Vazirmatn-Regular.woff2') format('woff2'); font-weight: normal; }
          @font-face { font-family: 'Vazirmatn Bold'; src: url('../fonts/Vazirmatn-Bold.woff2') format('woff2'); }
          @font-face { font-family: 'Vazirmatn Thin'; src: url('../fonts/Vazirmatn-Thin.woff2') format('woff2'); }
          @font-face { font-family: 'Vazirmatn Black'; src: url('../fonts/Vazirmatn-Black.woff2') format('woff2'); }
          @font-face { font-family: 'BArshia'; src: url('../fonts/BArshia.woff2') format('woff2'); }
          @font-face { font-family: 'BFarnaz'; src: url('../fonts/BFarnaz.woff2') format('woff2'); }
          @font-face { font-family: 'BJadid'; src: url('../fonts/BJadidBd.woff2') format('woff2'); }
          @font-face { font-family: 'BZar'; src: url('../fonts/BZar.woff2') format('woff2'); font-weight: normal; }
          @font-face { font-family: 'BZar Bold'; src: url('../fonts/BZarBd.woff2') format('woff2'); }
          @font-face { font-family: 'Lalezar'; src: url('../fonts/Lalezar-Regular.woff2') format('woff2'); }
          @font-face { font-family: 'Mada'; src: url('../fonts/Mada-Bold.woff2') format('woff2'); }
          @font-face { font-family: 'Rubik'; src: url('../fonts/Rubik-Bold.woff2') format('woff2'); }
          @font-face { font-family: 'JetBrains Mono'; src: url('../fonts/JetBrainsMono-Regular.woff2') format('woff2'); font-weight: normal; }
          @font-face { font-family: 'JetBrains Mono Bold'; src: url('../fonts/JetBrainsMono-Bold.woff2') format('woff2'); }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { background: #0F131E; color: #E2E8F0; font-family: 'Vazirmatn', sans-serif; overflow: hidden; height: 100vh; display: flex; flex-direction: column; }
          .lop-header { text-align: center; padding: 8px 12px 4px; background: linear-gradient(180deg, #1C2333, #161B26); border-bottom: 1px solid #232B3E; }
          .lop-header .title { font-size: 15px; font-weight: 900; color: #00F2FE; }
          .lop-header .sub { font-size: 10px; color: #718096; }
          .lop-body { flex: 1; overflow: auto; padding: 16px 20px; position: relative; line-height: 2.4; }
          .lop-body { flex: 1; overflow-y: auto; padding: 16px; }
          .eline { min-height: 1.2em; white-space: pre-wrap; }
          .lop-active { color: #FF2E93 !important; text-shadow: 0 0 8px rgba(255,46,147,0.5); }
          .lop-active-bg { background: rgba(255,46,147,0.08); border-radius: 6px; }
          ::-webkit-scrollbar { width: 8px; height: 8px; }
          ::-webkit-scrollbar-track { background: #1A202C; }
          ::-webkit-scrollbar-thumb { background: #4A5568; border-radius: 4px; }
          ::-webkit-scrollbar-thumb:hover { background: #718096; }
        </style>`;
      let html = `<div class="lop-header"><div class="title">${title}</div><div class="sub">${artist}</div></div><div class="lop-body" id="lopBody">`;
      lines.forEach((line, i) => {
        html += `<div class="eline" data-li="${i}" style="font-size:${tSize}px;color:${tColor};font-family:'${tFont}';font-weight:${tBold};text-align:${align};">${line || '\u200B'}</div>`;
      });
      html += '</div>';
      doc.body.innerHTML = html;
      doc.body.setAttribute('data-popup-role', 'singer');

      // Sync playhead highlight
      window.addEventListener('message', function lopSync(ev) {
        if (ev.data?.type === 'syncUpdate') {
          if (_lyricOnlyPopup.closed) { window.removeEventListener('message', lopSync); return; }
          const body = _lyricOnlyPopup.document.getElementById('lopBody');
          if (!body) return;
          const activeIdx = ev.data.activeIdx;
          [...body.children].forEach(el => {
            if (!el.dataset.li) return;
            const li = +el.dataset.li;
            el.classList.toggle('lop-active', li === activeIdx);
            el.classList.toggle('lop-active-bg', li === activeIdx);
          });
          if (activeIdx >= 0) {
            const activeEl = body.querySelector('[data-li="' + activeIdx + '"]');
            if (activeEl) {
              const bodyH = body.clientHeight;
              const elTop = activeEl.offsetTop;
              const elH = activeEl.offsetHeight;
              body.scrollTo({ top: elTop - bodyH / 2 + elH / 2, behavior: 'smooth' });
            }
          }
        }
      });
      // Direct highlight sync (same pattern as lyricPopup)
      function _syncSingerHighlight() {
        if (!_lyricOnlyPopup || _lyricOnlyPopup.closed) return;
        const body = _lyricOnlyPopup.document.getElementById('lopBody');
        if (!body) return;
        const times = edCur?.syncTimes || [];
        const t = DAW?.playhead || 0;
        let activeIdx = -1;
        for (let i = 0; i < times.length; i++) {
          if (Number.isFinite(times[i]) && times[i] <= t) activeIdx = i;
          else if (Number.isFinite(times[i]) && times[i] > t) break;
        }
        [...body.children].forEach(el => {
          if (!el.dataset.li) return;
          const li = +el.dataset.li;
          el.classList.toggle('lop-active', li === activeIdx);
          el.classList.toggle('lop-active-bg', li === activeIdx);
        });
        if (activeIdx >= 0) {
          const activeEl = body.querySelector('[data-li="' + activeIdx + '"]');
          if (activeEl) {
            const bodyH = body.clientHeight;
            body.scrollTo({ top: activeEl.offsetTop - bodyH / 2 + activeEl.offsetHeight / 2, behavior: 'smooth' });
          }
        }
      }
      _lyricOnlyPopup._syncHighlight = _syncSingerHighlight;
    }

    // ===== CHORD LINE POPUP (detachable, small) =====
    let _chordLinePopup = null;
    function openChordLinePopup() {
      if (_chordLinePopup && !_chordLinePopup.closed) { _chordLinePopup.focus(); return; }
      _chordLinePopup = window.open('', 'chordLinePopup', 'width=650,height=400,menubar=no,toolbar=no,location=no,status=no');
      if (!_chordLinePopup) { toast(t('popupBlocked')); return; }
      syncChordLinePopup();
    }
    
    // Manual sync function: sync Chord Line from Lyrics Chord (user-initiated only)
    function syncChordLineFromLyrics() {
      if (!edCur) return;
      // Build chordLineClips from edCur.chords (the source from Lyrics Chord import/edit)
      const lines = (edCur.lyrics || '').split('\n');
      edCur.chordLineClips = [];
      
      // Group chords by line index
      const chordsByLine = {};
      (edCur.chords || []).forEach(ch => {
        if (!chordsByLine[ch.lineIndex]) chordsByLine[ch.lineIndex] = [];
        chordsByLine[ch.lineIndex].push(ch);
      });
      
      // Create clip objects for each line that has chords
      lines.forEach((line, lineIdx) => {
        const lineChords = chordsByLine[lineIdx] || [];
        if (lineChords.length > 0) {
          // Sort chords by charIndex for proper LTR rendering
          lineChords.sort((a, b) => a.charIndex - b.charIndex);
          edCur.chordLineClips.push({
            lineIndex: lineIdx,
            lineText: line,
            chords: lineChords.map(ch => ({
              charIndex: ch.charIndex,
              anchorType: ch.anchorType,
              name: ch.name || ''
            }))
          });
        }
      });
      
      edCur.hasManualChordLineEdits = false; // Reset manual edit flag after sync
      edSaveSong();
      
      // Refresh the popup if open
      syncChordLinePopup();
      
      toast('کورد لاین بروز شد');
    }
    
    function syncChordLinePopup() {
      if (!_chordLinePopup || _chordLinePopup.closed) return;
      if (!edCur) return;
      const doc = _chordLinePopup.document;
      const title = edCur.title || 'بدون نام';
      const artist = edCur.artist || '';
      const keyStr = (edCur.key || 'C') + ((edCur.keyMode || 'maj') === 'min' ? 'm' : '');
      const transpose = edCur.transpose || 0;
      const tSize = edCur.styles?.tSize || 38;
      const tColor = edCur.styles?.tColor || '#0fa966';
      const tFont = edCur.styles?.tFont || 'Vazirmatn';
      const tBold = edCur.styles?.tBold ? 'bold' : 'normal';
      const align = edCur.styles?.align || 'center';
      const cSize = edCur.styles?.cSize || 38;
      const cColor = edCur.styles?.cColor || '#e6aa28';
      const cFont = edCur.styles?.cFont || 'JetBrains Mono';
      const lines = (edCur.lyrics || '').split('\n');
      
      // Use chordLineClips if available and has data, otherwise fall back to edCur.chords
      let chordsToRender = [];
      if (edCur.chordLineClips && edCur.chordLineClips.length > 0 && !edCur.hasManualChordLineEdits) {
        // Use synced chordLineClips data
        edCur.chordLineClips.forEach(clip => {
          clip.chords.forEach(ch => {
            chordsToRender.push({
              lineIndex: clip.lineIndex,
              charIndex: ch.charIndex,
              anchorType: ch.anchorType,
              _name: edTransposeChord(ch.name, transpose)
            });
          });
        });
      } else {
        // Fall back to edCur.chords (default behavior or after manual edits)
        chordsToRender = edCur.chords.map(ch => ({
          lineIndex: ch.lineIndex,
          charIndex: ch.charIndex,
          anchorType: ch.anchorType,
          _name: edTransposeChord(ch.name, transpose)
        }));
      }

      doc.title = title + ' — ' + artist + ' | Chord Line';
      doc.documentElement.dir = 'rtl';
      doc.documentElement.lang = 'fa';
      doc.head.innerHTML = `
        <style>
          @font-face { font-family: 'Vazirmatn'; src: url('../fonts/Vazirmatn-Regular.woff2') format('woff2'); font-weight: normal; }
          @font-face { font-family: 'Vazirmatn Bold'; src: url('../fonts/Vazirmatn-Bold.woff2') format('woff2'); }
          @font-face { font-family: 'Vazirmatn Thin'; src: url('../fonts/Vazirmatn-Thin.woff2') format('woff2'); }
          @font-face { font-family: 'Vazirmatn Black'; src: url('../fonts/Vazirmatn-Black.woff2') format('woff2'); }
          @font-face { font-family: 'BArshia'; src: url('../fonts/BArshia.woff2') format('woff2'); }
          @font-face { font-family: 'BFarnaz'; src: url('../fonts/BFarnaz.woff2') format('woff2'); }
          @font-face { font-family: 'BJadid'; src: url('../fonts/BJadidBd.woff2') format('woff2'); }
          @font-face { font-family: 'BZar'; src: url('../fonts/BZar.woff2') format('woff2'); font-weight: normal; }
          @font-face { font-family: 'BZar Bold'; src: url('../fonts/BZarBd.woff2') format('woff2'); }
          @font-face { font-family: 'Lalezar'; src: url('../fonts/Lalezar-Regular.woff2') format('woff2'); }
          @font-face { font-family: 'Mada'; src: url('../fonts/Mada-Bold.woff2') format('woff2'); }
          @font-face { font-family: 'Rubik'; src: url('../fonts/Rubik-Bold.woff2') format('woff2'); }
          @font-face { font-family: 'JetBrains Mono'; src: url('../fonts/JetBrainsMono-Regular.woff2') format('woff2'); font-weight: normal; }
          @font-face { font-family: 'JetBrains Mono Bold'; src: url('../fonts/JetBrainsMono-Bold.woff2') format('woff2'); }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { background: #0F131E; color: #E2E8F0; font-family: 'Vazirmatn', sans-serif; overflow: hidden; height: 100vh; display: flex; flex-direction: column; }
          .clp-header { text-align: center; padding: 8px 12px 4px; background: linear-gradient(180deg, #1C2333, #161B26); border-bottom: 1px solid #232B3E; }
          .clp-header .title { font-size: 15px; font-weight: 900; color: #00F2FE; }
          .clp-header .sub { font-size: 10px; color: #718096; }
          .clp-body { flex: 1; overflow: auto; padding: 16px 20px; position: relative; line-height: 2.4; }
          .clp-body { flex: 1; overflow-y: auto; padding: 16px; }
          .eline { min-height: 1.2em; white-space: pre-wrap; }
          .clp-chord { position: absolute; pointer-events: none; font-weight: bold; color: ${cColor}; font-family: '${cFont}', monospace; font-size: ${cSize}px; direction: ltr; white-space: nowrap; z-index: 5; }
          .clp-chord-line { position: absolute; width: 2px; pointer-events: none; opacity: .4; background: ${cColor}; z-index: 4; }
          .clp-active { color: #FF2E93 !important; text-shadow: 0 0 8px rgba(255,46,147,0.5); }
          .clp-active-bg { background: rgba(255,46,147,0.08); border-radius: 6px; }
        </style>`;
      let html = `<div class="clp-header"><div class="title">${title}</div><div class="sub">${artist} · ${keyStr}</div></div><div class="clp-body" id="clpBody">`;
      lines.forEach((line, i) => {
        html += `<div class="eline" data-li="${i}" style="font-size:${tSize}px;color:${tColor};font-family:'${tFont}';font-weight:${tBold};text-align:${align};">${line || '\u200B'}</div>`;
      });
      html += '</div>';
      doc.body.innerHTML = html;

      // Render chords
      const pb = doc.getElementById('clpBody');
      const wrapRect = pb.getBoundingClientRect();
      const GAP = Math.max(10, cSize * 0.6);
      const MARGIN = 5;

      chords.forEach(ch => {
        if (!ch._name) return;
        const lineEl = pb.children[ch.lineIndex];
        if (!lineEl) return;

        const segs = [];
        let total = 0;
        const walker = doc.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          segs.push({ node, start: total, len: node.textContent.length });
          total += node.textContent.length;
        }
        if (!segs.length) return;

        const len = total;
        const r = doc.createRange();
        if (ch.anchorType === 'LineStart') {
          const s = segs[0]; r.setStart(s.node, 0); r.setEnd(s.node, Math.min(1, s.len));
        } else if (ch.anchorType === 'LineEnd') {
          const s = segs[segs.length - 1]; const p = Math.max(0, s.len - 1);
          r.setStart(s.node, p); r.setEnd(s.node, Math.min(p + 1, s.len));
        } else {
          const ci = Math.min(ch.charIndex, Math.max(0, len - 1));
          const s = segs.find(sg => ci >= sg.start && ci < sg.start + sg.len) || segs[segs.length - 1];
          const local = Math.max(0, ci - s.start);
          r.setStart(s.node, Math.min(local, s.len));
          r.setEnd(s.node, Math.min(local + 1, s.len));
        }
        const rect = r.getBoundingClientRect();
        const x = (ch.anchorType === 'LineStart') ? rect.right + MARGIN : (ch.anchorType === 'LineEnd') ? rect.left - MARGIN : (rect.left + rect.right) / 2;
        const top = rect.top - wrapRect.top + pb.scrollTop - cSize - GAP;

        const el = doc.createElement('span');
        el.className = 'clp-chord';
        el.textContent = ch._name;
        el.style.top = top + 'px';
        el.style.left = (x - wrapRect.left - el.offsetWidth / 2) + 'px';
        pb.appendChild(el);

        const ln = doc.createElement('div');
        ln.className = 'clp-chord-line';
        ln.style.left = (x - wrapRect.left) + 'px';
        ln.style.top = (top + cSize) + 'px';
        ln.style.height = Math.max(4, GAP) + 'px';
        pb.appendChild(ln);
      });

      // Sync playhead highlight
      window.addEventListener('message', function clpSync(ev) {
        if (ev.data?.type === 'syncUpdate') {
          if (_chordLinePopup.closed) { window.removeEventListener('message', clpSync); return; }
          const body = _chordLinePopup.document.getElementById('clpBody');
          if (!body) return;
          [...body.children].forEach(el => {
            if (!el.dataset.li) return;
            const li = +el.dataset.li;
            el.classList.toggle('clp-active', li === ev.data.activeIdx);
            el.classList.toggle('clp-active-bg', li === ev.data.activeIdx);
          });
        }
      });
    }

    // === Player View persistent settings (survives popup rebuilds) ===
    const _pvSettingsKey = 'achord_player_view_settings';
    const _pvDefaults = { font:'Vazirmatn', tColor:'#0fa966', cColor:'#e6aa28', hlColor:'#FF2E93', bgColor:'#0F131E', tSize:53, cSize:40, scaleLock:true, bold:true };
    let _pvSettings = Object.assign({}, _pvDefaults);
    try { const s = JSON.parse(localStorage.getItem(_pvSettingsKey)); if (s) _pvSettings = Object.assign({}, _pvDefaults, s); } catch(_) {}
    function _pvSave() { try { localStorage.setItem(_pvSettingsKey, JSON.stringify(_pvSettings)); } catch(_) {} }
    // Wheel handlers — re-attached on each syncLyricPopup() call
    const _fontList = [
      'Vazirmatn', 
      'Vazirmatn Thin', 
      'Vazirmatn Bold', 
      'Vazirmatn Black', 
      'BArshia', 
      'BFarnaz', 
      'BJadid', 
      'BZar', 
      'BZar Bold', 
      'Lalezar'
    ];
    
    // Helper to ensure font name is properly quoted for CSS
    function _getFontFamilyCSS(fontName) {
      return "'" + fontName + "', sans-serif";
    }
    function _pvSetupWheelHandlers() {
      if (!_lyricPopup || _lyricPopup.closed) return;
      const pDoc = _lyricPopup.document;
      // Remove old handler if exists
      if (_lyricPopup._pvWheelHandler) {
        pDoc.removeEventListener('wheel', _lyricPopup._pvWheelHandler);
      }
      // Create new handler
      const handler = (e) => {
        if (!_lyricPopup || _lyricPopup.closed) return;
        const target = e.target;
        // Ctrl+Wheel anywhere → lyric size
        if (e.ctrlKey) {
          e.preventDefault();
          const delta = e.deltaY < 0 ? 1 : -1;
          _pvSettings.tSize = Math.max(12, Math.min(55, _pvSettings.tSize + delta));
          if (_pvSettings.scaleLock) {
            _pvSettings.cSize = Math.max(8, Math.min(40, Math.round(_pvSettings.tSize * 0.7)));
          }
          _pvSave(); _pvApply();
          return;
        }
        // Plain wheel on chord → chord size
        if (target && target.classList && target.classList.contains('p-chord')) {
          e.preventDefault();
          const delta = e.deltaY < 0 ? 1 : -1;
          _pvSettings.cSize = Math.max(8, Math.min(40, _pvSettings.cSize + delta));
          if (_pvSettings.scaleLock) {
            _pvSettings.tSize = Math.max(12, Math.min(55, Math.round(_pvSettings.cSize / 0.7)));
          }
          _pvSave(); _pvApply();
          return;
        }
        // Wheel on font selector → cycle fonts
        if (target && target.id === 'pv-font') {
          e.preventDefault();
          let idx = _fontList.indexOf(_pvSettings.font);
          idx = e.deltaY < 0 ? (idx - 1 + _fontList.length) % _fontList.length : (idx + 1) % _fontList.length;
          _pvSettings.font = _fontList[idx];
          target.value = _pvSettings.font;
          _pvSave(); _pvApply();
          return;
        }
      };
      _lyricPopup._pvWheelHandler = handler;
      pDoc.addEventListener('wheel', handler, { passive: false });
    }

    function syncLyricPopup() {
      if (!_lyricPopup || _lyricPopup.closed) return;
      // If popup already has chord script, update in-place (no full rebuild)
      const _existingScript = _lyricPopup.document.querySelector('script[data-pv="chord"]');
      if (_existingScript) {
        const doc = _lyricPopup.document;
        const pb = doc.getElementById('popupBody');
        if (!pb) return;

        const lines = (edCur?.lyrics || '').split('\n');
        const transpose = edCur?.transpose || 0;
        const chords = (edCur?.chords || []).map(ch => ({
          lineIndex: ch.lineIndex, charIndex: ch.charIndex,
          anchorType: ch.anchorType, _name: edTransposeChord(ch.name, transpose)
        }));
        const tSize = edCur?.styles?.tSize || 38;
        const tColor = edCur?.styles?.tColor || '#0fa966';
        const tFont = edCur?.styles?.tFont || 'Vazirmatn';
        const tBold = edCur?.styles?.tBold ? 'bold' : 'normal';
        const align = edCur?.styles?.align || 'center';

        // بررسی آیا ساختار خط‌ها واقعاً عوض شده
        const existingLines = Array.from(pb.querySelectorAll('.popup-sync-line'));
        let structureChanged = existingLines.length !== lines.length;
        if (!structureChanged) {
          for (let i = 0; i < lines.length; i++) {
            if (!existingLines[i] || existingLines[i].textContent !== (lines[i] || '\u200B')) {
              structureChanged = true; break;
            }
          }
        }

        if (structureChanged) {
          // فقط وقتی تعداد خط‌ها یا متن عوض شده rebuild کن
          let h = '';
          lines.forEach((line, i) => {
            h += `<div class="eline popup-sync-line" data-li="${i}">${line || '\u200B'}</div>`;
          });
          pb.innerHTML = h;
        }

        // آپدیت text و style خط‌ها روی DOM موجود
        const lineEls = pb.querySelectorAll('.popup-sync-line');
        lineEls.forEach((el, i) => {
          const nextText = lines[i] || '\u200B';
          if (el.textContent !== nextText) el.textContent = nextText;
          el.style.fontSize = tSize + 'px';
          el.style.color = tColor;
          el.style.fontFamily = `'${tFont}', sans-serif`;
          el.style.fontWeight = tBold;
          el.style.textAlign = align;
        });

        // آپدیت chord data و رندر
        _lyricPopup._pChords = chords;
        try {
          _lyricPopup._pStructureVersion = (_lyricPopup._pStructureVersion || 0) + (structureChanged ? 1 : 0);
          // اگر ساختار عوض شده، کش المان‌های chord قبلی را پاک کن
          if (structureChanged) {
            _lyricPopup.eval('if(typeof _pChordEls!=="undefined"){Object.keys(_pChordEls).forEach(function(k){var el=_pChordEls[k];if(el&&el.isConnected)el.remove();delete _pChordEls[k];});}if(typeof _pChordLineEls!=="undefined"){Object.keys(_pChordLineEls).forEach(function(k){var el=_pChordLineEls[k];if(el&&el.isConnected)el.remove();delete _pChordLineEls[k];});}');
          }
          const _evalChords = '_pChords=' + JSON.stringify(chords) + ';' +
            'window._pStructureVersion=' + JSON.stringify(_lyricPopup._pStructureVersion || 0) + ';' +
            'if(typeof _pScheduleChordRender==="function"){_pScheduleChordRender("' + (structureChanged ? 'structure' : 'data') + '");' +
            '}else if(typeof _pRenderChords==="function"){_pRenderChords();}';
          _lyricPopup.eval('(function(){' + _evalChords + '})();');
          // Fallback chain: اگر rAF یا layout هنوز آماده نباشد
          if (structureChanged) {
            [120, 300, 600].forEach(function(ms) {
              setTimeout(function() {
                try {
                  if (_lyricPopup && !_lyricPopup.closed && typeof _lyricPopup._pRenderChords === 'function') {
                    _lyricPopup.eval('(function(){' + _evalChords + 'window._pRenderReason="fallback";if(typeof _pScheduleChordRender==="function"){_pScheduleChordRender("structure");}else{_pRenderChords();}})();');
                  }
                } catch(_) {}
              }, ms);
            });
          }
        } catch(_) {
          // اگر eval کل fail شد، fallback بعد از layout
          setTimeout(function() {
            try {
              if (_lyricPopup && !_lyricPopup.closed && typeof _lyricPopup._pRenderChords === 'function') {
                _lyricPopup._pRenderChords();
              }
            } catch(_) {}
          }, 250);
        }

        // Re-apply saved settings
        try {
          const s = JSON.parse(localStorage.getItem('${_pvSettingsKey}')) || {};
          lineEls.forEach(el => {
            el.style.fontSize = (s.tSize || tSize) + 'px';
            el.style.color = s.tColor || tColor;
            el.style.fontWeight = s.bold ? 'bold' : tBold;
            el.style.fontFamily = "'" + (s.font || tFont) + "', sans-serif";
          });
          if (s.cSize || s.cColor) {
            _lyricPopup.eval(
              '(function(){' +
                '_pCfg.cSize=' + JSON.stringify(s.cSize || 38) + ';' +
                '_pCfg.cColor=' + JSON.stringify(s.cColor || '#e6aa28') + ';' +
                'if(typeof _pScheduleChordRender==="function"){_pScheduleChordRender("style");' +
                '}else if(typeof _pRenderChords==="function"){_pRenderChords();}' +
              '})();'
            );
          }
        } catch(_) {}
        // Force Reflow: مجبور کردن مرورگر به محاسبه مجدد چیدمان
        try { void pb.offsetHeight; } catch(_) {}
        // Dispatch resize event to force layout recalculation
        try { _lyricPopup.dispatchEvent(new Event('resize')); } catch(_) {}
        return;
      }
      const title = edCur?.title || t('untitled');
      const artist = edCur?.artist || '';
      const keyStr = (edCur?.key || 'C') + ((edCur?.keyMode || 'maj') === 'min' ? 'm' : '');
      const sub = [artist, keyStr ? (currentLang==='fa'?'گام: ':'Key: ') + keyStr : null].filter(Boolean).join('  ·  ');
      const tSize = edCur?.styles?.tSize || 38;
      const tColor = edCur?.styles?.tColor || '#0fa966';
      const tFont = edCur?.styles?.tFont || 'Vazirmatn';
      const tBold = edCur?.styles?.tBold ? 'bold' : 'normal';
      const align = edCur?.styles?.align || 'center';
      const cSize = edCur?.styles?.cSize || 38;
      const cColor = edCur?.styles?.cColor || '#e6aa28';
      const cFont = edCur?.styles?.cFont || 'JetBrains Mono';
      const transpose = edCur?.transpose || 0;
      const lines = (edCur?.lyrics || '').split('\n');
      const chords = (edCur?.chords || []).map(ch => ({ lineIndex: ch.lineIndex, charIndex: ch.charIndex, anchorType: ch.anchorType, _name: edTransposeChord(ch.name, transpose) }));
      _lyricPopup.document.title = title + ' — ' + artist + ' | نوازنده';
      _lyricPopup.document.documentElement.dir = 'rtl';
      _lyricPopup.document.documentElement.lang = 'fa';
      _lyricPopup.document.head.innerHTML = `
        <style>
          @font-face { font-family: 'Vazirmatn'; src: url('../fonts/Vazirmatn-Regular.woff2') format('woff2'); font-weight: normal; }
          @font-face { font-family: 'Vazirmatn Bold'; src: url('../fonts/Vazirmatn-Bold.woff2') format('woff2'); }
          @font-face { font-family: 'Vazirmatn Thin'; src: url('../fonts/Vazirmatn-Thin.woff2') format('woff2'); }
          @font-face { font-family: 'Vazirmatn Black'; src: url('../fonts/Vazirmatn-Black.woff2') format('woff2'); }
          @font-face { font-family: 'BArshia'; src: url('../fonts/BArshia.woff2') format('woff2'); }
          @font-face { font-family: 'BFarnaz'; src: url('../fonts/BFarnaz.woff2') format('woff2'); }
          @font-face { font-family: 'BJadid'; src: url('../fonts/BJadidBd.woff2') format('woff2'); }
          @font-face { font-family: 'BZar'; src: url('../fonts/BZar.woff2') format('woff2'); font-weight: normal; }
          @font-face { font-family: 'BZar Bold'; src: url('../fonts/BZarBd.woff2') format('woff2'); }
          @font-face { font-family: 'Lalezar'; src: url('../fonts/Lalezar-Regular.woff2') format('woff2'); }
          @font-face { font-family: 'Mada'; src: url('../fonts/Mada-Bold.woff2') format('woff2'); }
          @font-face { font-family: 'Rubik'; src: url('../fonts/Rubik-Bold.woff2') format('woff2'); }
          @font-face { font-family: 'JetBrains Mono'; src: url('../fonts/JetBrainsMono-Regular.woff2') format('woff2'); font-weight: normal; }
          @font-face { font-family: 'JetBrains Mono Bold'; src: url('../fonts/JetBrainsMono-Bold.woff2') format('woff2'); }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { background: #0F131E; color: #E2E8F0; font-family: 'Vazirmatn', sans-serif; overflow: hidden; height: 100vh; display: flex; flex-direction: column; }
          .popup-header { text-align: center; padding: 16px 20px 10px; background: linear-gradient(180deg, #1C2333, #161B26); border-bottom: 1px solid #232B3E; box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
          .popup-header .title { font-size: 20px; font-weight: 900; color: #00F2FE; text-shadow: 0 0 20px rgba(0,242,254,0.3); }
          .popup-header .sub { font-size: 12px; color: #718096; margin-top: 3px; }
          .popup-body { flex: 1; overflow: auto; padding: 30px 40px; position: relative; }
          .eline { min-height: 1.4em; line-height: 2.6; white-space: pre-wrap; transition: opacity 0.3s ease, color 0.3s ease, background 0.3s ease, text-shadow 0.3s ease; }
          .popup-sync-line {
  position: relative;
  margin-top: 1.8em;
  padding: 4px 12px;
  border-bottom: none !important;
  transition: opacity 0.2s ease, color 0.2s ease, background 0.2s ease, text-shadow 0.2s ease;
}

.popup-sync-line.active {
  color: #fff;
  border-radius: 8px;
  z-index: 10;
}

.popup-sync-line.done {
  opacity: 0.50;
}

/* ===== Highlight Effects (matching main editor) ===== */
@keyframes hl-gradient-sweep { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
@keyframes hl-pulse-glow { 0%,100% { box-shadow: 0 0 8px rgba(34,211,100,0.3), inset 0 0 12px rgba(34,211,100,0.05); } 50% { box-shadow: 0 0 20px rgba(34,211,100,0.6), inset 0 0 20px rgba(34,211,100,0.1); } }
@keyframes hl-text-pulse { 0%,100% { text-shadow: 0 0 6px rgba(34,211,100,0.5), 0 0 12px rgba(34,211,100,0.3); } 50% { text-shadow: 0 0 12px rgba(34,211,100,0.8), 0 0 30px rgba(34,211,100,0.5), 0 0 50px rgba(34,211,100,0.2); } }
/* Neon */
body.hl-neon .popup-sync-line.active { color: #00F2FE; text-shadow: 0 0 8px rgba(0,242,254,0.8), 0 0 20px rgba(0,242,254,0.4); }
body.hl-neon .popup-sync-line.active::before { content: ''; position: absolute; left: 0; right: 0; top: -1.8em; bottom: 0; background: linear-gradient(180deg, rgba(0,242,254,0.2), rgba(0,242,254,0.04) 55%, transparent); border: 1px solid rgba(0,242,254,0.3); border-radius: 8px; pointer-events: none; box-shadow: 0 0 15px rgba(0,242,254,0.3), 0 0 30px rgba(0,242,254,0.1); }
/* Frost */
body.hl-frost .popup-sync-line.active { color: #fff; }
body.hl-frost .popup-sync-line.active::before { content: ''; position: absolute; left: 0; right: 0; top: -1.8em; bottom: 0; background: linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.03) 50%, rgba(200,220,255,0.08) 100%); border: 1px solid rgba(255,255,255,0.15); border-radius: 12px; pointer-events: none; box-shadow: inset 0 1px 0 rgba(255,255,255,0.15), 0 4px 16px rgba(0,0,0,0.3); }
body.hl-frost .popup-sync-line.active::after { content: ''; position: absolute; left: 0; right: 0; top: -1.8em; bottom: 0; background: rgba(255,255,255,0.06); backdrop-filter: blur(8px); border-radius: 12px; pointer-events: none; z-index: -1; }
/* Shift */
body.hl-shift .popup-sync-line.active { background: linear-gradient(135deg, #ff2e93, #7b2fff, #00F2FE, #3FB8AF, #ff2e93); background-size: 400% 400%; animation: hl-gradient-sweep 4s ease infinite; -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
body.hl-shift .popup-sync-line.active::before { content: ''; position: absolute; left: 0; right: 0; top: -1.8em; bottom: 0; background: linear-gradient(135deg, rgba(255,46,147,0.15), rgba(123,47,255,0.15), rgba(0,242,254,0.15)); background-size: 400% 400%; animation: hl-gradient-sweep 4s ease infinite; border-radius: 8px; pointer-events: none; }
/* Depth */
body.hl-depth .popup-sync-line.active { color: #E2E8F0; text-shadow: 0 1px 0 rgba(0,0,0,0.8), 0 2px 0 rgba(0,0,0,0.7), 0 3px 0 rgba(0,0,0,0.6), 0 4px 8px rgba(0,0,0,0.5), 0 0 15px rgba(255,46,147,0.3); }
body.hl-depth .popup-sync-line.active::before { content: ''; position: absolute; left: 0; right: 0; top: -1.8em; bottom: 0; background: linear-gradient(180deg, rgba(255,46,147,0.15), rgba(255,46,147,0.02) 60%, transparent); border: 1px solid rgba(255,46,147,0.2); border-radius: 8px; pointer-events: none; box-shadow: 0 6px 20px rgba(0,0,0,0.4), 0 2px 6px rgba(255,46,147,0.2); }
/* Pulse */
body.hl-pulse .popup-sync-line.active { color: #22D364; animation: hl-text-pulse 2s ease-in-out infinite; }
body.hl-pulse .popup-sync-line.active::before { content: ''; position: absolute; left: 0; right: 0; top: -1.8em; bottom: 0; background: linear-gradient(180deg, rgba(34,211,100,0.12), rgba(34,211,100,0.02) 55%, transparent); border: 1px solid rgba(34,211,100,0.25); border-radius: 10px; pointer-events: none; animation: hl-pulse-glow 2s ease-in-out infinite; }

          .p-chord {
  position: absolute;
  pointer-events: none;
  font-weight: bold;
  color: ${cColor};
  font-family: '${cFont}', monospace;
  font-size: ${cSize}px;
  line-height: 1.15;
  box-sizing: border-box;
  background: transparent;
  border-radius: 4px;
  padding: 0 2px;
  direction: ltr;
  white-space: nowrap;
  z-index: 5;
}

          .p-chord-line { position: absolute; width: 2px; pointer-events: none; opacity: .5; background: ${cColor}; z-index: 4; }

          #pv-settings-toggle { transition: color 0.2s, transform 0.2s; }
          #pv-settings-toggle:hover { color: #00F2FE; transform: scale(1.05); }
          #pv-settings { transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
          #pv-settings select { transition: border-color 0.2s, box-shadow 0.2s; }
          #pv-settings select:hover, #pv-settings select:focus { border-color: #00F2FE; box-shadow: 0 0 0 2px rgba(0,242,254,0.15); outline: none; }
          #pv-settings input[type="range"] { transition: filter 0.2s; }
          #pv-settings input[type="range"]:hover { filter: brightness(1.3); }
          #pv-settings label:hover { background: rgba(255,255,255,0.04); }
          .pv-hint { font-size: 10px; color: #4A5568; margin-top: 8px; text-align: center; letter-spacing: 0.3px; }
          ::-webkit-scrollbar { width: 8px; height: 8px; }
          ::-webkit-scrollbar-track { background: #1A202C; }
          ::-webkit-scrollbar-thumb { background: #4A5568; border-radius: 4px; }
          ::-webkit-scrollbar-thumb:hover { background: #718096; }
        </style>`;
      let html = `<div class="popup-header"><div class="title">${title}</div><div class="sub">${sub}</div>
        <div id="pv-settings-toggle" style="cursor:pointer;font-size:11px;color:#718096;margin-top:4px;user-select:none;transition:color 0.2s;">⚙ تنظیمات نمایش</div>
        <div id="pv-settings" style="display:none;text-align:right;padding:12px 14px;font-size:12px;margin-top:8px;background:linear-gradient(135deg,#1A202C,#161B26);border:1px solid #2D3748;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.4);">
          <div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center;align-items:center;">
            <label style="color:#A0AEC0;display:flex;align-items:center;gap:5px;">فونت:
              <select id="pv-font" style="background:#0D1117;color:#E2E8F0;border:1px solid #30363D;border-radius:8px;padding:4px 10px;font-size:11px;cursor:pointer;transition:border-color 0.2s;">
                <option value="Vazirmatn">Vazirmatn</option><option value="Vazirmatn Thin">Vazirmatn Thin</option><option value="Vazirmatn Bold">Vazirmatn Bold</option><option value="Vazirmatn Black">Vazirmatn Black</option><option value="BArshia">BArshia</option><option value="BFarnaz">BFarnaz</option><option value="BJadid">BJadid</option><option value="BZar">BZar</option><option value="BZar Bold">BZar Bold</option><option value="Lalezar">Lalezar</option>
              </select>
            </label>
            <label style="color:#A0AEC0;display:flex;align-items:center;gap:5px;cursor:pointer;"><input type="color" id="pv-tColor" value="${tColor}" style="width:24px;height:24px;border:2px solid #30363D;border-radius:6px;cursor:pointer;background:none;padding:0;"> متن</label>
            <label style="color:#A0AEC0;display:flex;align-items:center;gap:5px;cursor:pointer;"><input type="color" id="pv-cColor" value="${cColor}" style="width:24px;height:24px;border:2px solid #30363D;border-radius:6px;cursor:pointer;background:none;padding:0;"> آکورد</label>
            <label style="color:#A0AEC0;display:flex;align-items:center;gap:5px;cursor:pointer;"><input type="color" id="pv-bgColor" value="#0F131E" style="width:24px;height:24px;border:2px solid #30363D;border-radius:6px;cursor:pointer;background:none;padding:0;"> پس‌زمینه</label>
            <div style="display:flex;align-items:center;gap:5px;color:#A0AEC0;">متن: <input type="range" id="pv-tSize" min="12" max="55" value="${tSize}" style="width:70px;accent-color:#00F2FE;height:4px;"> <span id="pv-tSizeVal" style="min-width:22px;text-align:center;font-family:monospace;color:#00F2FE;font-weight:bold;">${tSize}</span></div>
            <div style="display:flex;align-items:center;gap:5px;color:#A0AEC0;">آکورد: <input type="range" id="pv-cSize" min="8" max="40" value="${cSize}" style="width:70px;accent-color:#00F2FE;height:4px;"> <span id="pv-cSizeVal" style="min-width:22px;text-align:center;font-family:monospace;color:#00F2FE;font-weight:bold;">${cSize}</span></div>
            <label style="color:#A0AEC0;display:flex;align-items:center;gap:5px;cursor:pointer;padding:4px 8px;border-radius:6px;transition:background 0.2s;" title="قفل نسبت اندازه متن و آکورد"><input type="checkbox" id="pv-scaleLock" checked style="accent-color:#00F2FE;"> 🔗 قفل</label>
            <label style="color:#A0AEC0;display:flex;align-items:center;gap:5px;cursor:pointer;padding:4px 8px;border-radius:6px;transition:background 0.2s;"><input type="checkbox" id="pv-bold" style="accent-color:#00F2FE;"> <b>B</b> ضخیم</label>
          </div>
          <div class="pv-hint">Ctrl+Wheel: تغییر اندازه متن | Wheel روی آکورد: تغییر اندازه آکورد | Wheel روی فونت: پیمایش فونت‌ها</div>
        </div>
      </div><div class="popup-body" id="popupBody">`;
      lines.forEach((line, i) => {
        html += `<div class="eline popup-sync-line" data-li="${i}" style="font-size:${tSize}px;color:${tColor};font-family:'${tFont}';font-weight:${tBold};text-align:${align};">${line || '\u200B'}</div>`;
      });
      html += '</div>';
      // ظرف خالی برای نوار آکورد آینه‌ای + دستگیره ریسایز
      html += '<div id="chordMirrorResize" style="position:fixed;bottom:0;left:0;width:100%;height:94px;z-index:9999;">' +
        '<div id="chordMirrorHandle" style="width:100%;height:4px;background:linear-gradient(90deg,#4A5568,#9F7AEA,#4A5568);cursor:ns-resize;border-radius:2px 2px 0 0;opacity:0.5;transition:opacity 0.2s;" onmouseover="this.style.opacity=\'1\'" onmouseout="this.style.opacity=\'0.5\'"></div>' +
        '<div id="playerChordMirror" style="width:100%;height:90px;background:#111;overflow:hidden;border-top:1px solid #333;"></div>' +
        '</div>';
      _lyricPopup.document.body.innerHTML = html;
      _lyricPopup.document.body.setAttribute('data-popup-role', 'player');
      // Apply highlight effect class to popup body
      applyHighlightClassToPopup();
      // Inject chord positioning script via createElement (not insertAdjacentHTML)
      const chordsJson = JSON.stringify(chords);
      const configJson = JSON.stringify({ cSize, cColor, cFont });
      const sc = _lyricPopup.document.createElement('script');
      sc.setAttribute('data-pv', 'chord');
      sc.textContent = `
        var _pChords = ${chordsJson};
        var _pCfg = ${configJson};
        var _pChordEls = Object.create(null);
        var _pChordLineEls = Object.create(null);
        var _pRenderPending = false;
        var _pRenderReason = 'init';
        var _pStructureVersion = 0;
        var _pLastRenderedSignature = '';
        var _pLastStructureVersion = -1;

        function _pChordKey(ch) {
          return [ch.lineIndex, ch.charIndex, ch.anchorType || ''].join('|');
        }

        function _pAnchorRect(editorEl, ch) {
          var lineEl = editorEl.children[ch.lineIndex]; if (!lineEl) return null;
          var segs = [], total = 0, node;
          var walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT);
          while (node = walker.nextNode()) { segs.push({ node: node, start: total, len: node.textContent.length }); total += node.textContent.length; }
          if (!segs.length) return null;
          var len = total, r = document.createRange();
          if (ch.anchorType === 'LineStart') { var s = segs[0]; r.setStart(s.node,0); r.setEnd(s.node,Math.min(1,s.len)); }
          else if (ch.anchorType === 'LineEnd') { var s2 = segs[segs.length-1]; var p = Math.max(0,s2.len-1); r.setStart(s2.node,p); r.setEnd(s2.node,Math.min(p+1,s2.len)); }
          else { var ci = Math.min(ch.charIndex, Math.max(0, len-1)); var s3 = null; for (var k=0;k<segs.length;k++) { if (ci >= segs[k].start && ci < segs[k].start+segs[k].len) { s3=segs[k]; break; } } if(!s3) s3=segs[segs.length-1]; var local = Math.max(0, ci-s3.start); r.setStart(s3.node, Math.min(local,s3.len)); r.setEnd(s3.node, Math.min(local+1,s3.len)); }
          return { rect: r.getBoundingClientRect(), lineRect: lineEl.getBoundingClientRect(), type: ch.anchorType };
        }

        function _pChordSignature() {
          return JSON.stringify({
            chords: (_pChords || []).map(function(ch) { return { l: ch.lineIndex, c: ch.charIndex, a: ch.anchorType, n: ch._name }; }),
            cSize: _pCfg.cSize, cColor: _pCfg.cColor, cFont: _pCfg.cFont
          });
        }

        function _pEnsureChordEl(key, pb) {
          var el = _pChordEls[key];
          if (el && el.isConnected) return { el: el, created: false };
          el = document.createElement('span');
          el.className = 'p-chord';
          el.setAttribute('data-chord-key', key);
          el.style.cssText = 'position:absolute;pointer-events:none;font-weight:bold;line-height:1.15;box-sizing:border-box;background:transparent;z-index:5;direction:ltr;white-space:nowrap;visibility:hidden;';
          pb.appendChild(el);
          _pChordEls[key] = el;
          return { el: el, created: true };
        }

        function _pEnsureChordLineEl(key, pb) {
          var el = _pChordLineEls[key];
          if (el && el.isConnected) return { el: el, created: false };
          el = document.createElement('div');
          el.className = 'p-chord-line';
          el.setAttribute('data-chordline-key', key);
          el.style.cssText = 'position:absolute;width:2px;pointer-events:none;opacity:.5;z-index:4;visibility:hidden;';
          pb.appendChild(el);
          _pChordLineEls[key] = el;
          return { el: el, created: true };
        }

        function _pCleanupUnused(usedKeys) {
          Object.keys(_pChordEls).forEach(function(key) {
            if (usedKeys[key]) return;
            var el = _pChordEls[key];
            if (el && el.isConnected) el.remove();
            delete _pChordEls[key];
          });
          Object.keys(_pChordLineEls).forEach(function(key) {
            if (usedKeys[key]) return;
            var el = _pChordLineEls[key];
            if (el && el.isConnected) el.remove();
            delete _pChordLineEls[key];
          });
        }

        function _pRenderChords() {
          var pb = document.getElementById('popupBody');
          if (!pb) return;
          var signature = _pChordSignature();
          var structureChanged = _pLastStructureVersion !== _pStructureVersion;
          var contentChanged = _pLastRenderedSignature !== signature;
          if (!structureChanged && !contentChanged && _pRenderReason !== 'resize') return;

          var wrapRect = pb.getBoundingClientRect();
          var scrollTop = pb.scrollTop;
          var GAP = Math.max(10, _pCfg.cSize * 0.6);
          var MARGIN = 5;
          var usedKeys = Object.create(null);

          (_pChords || []).forEach(function(ch) {
            if (!ch || !ch._name) return;
            var a = _pAnchorRect(pb, ch);
            if (!a) return;
            var key = _pChordKey(ch);
            var ensured = _pEnsureChordEl(key, pb);
            var el = ensured.el;
            usedKeys[key] = true;
            // آپدیت text و style فقط اگر عوض شده
            if (el.textContent !== ch._name) el.textContent = ch._name;
            var nf = _pCfg.cSize + 'px', nc = _pCfg.cColor, nfa = '"' + _pCfg.cFont + '",monospace';
            if (el.style.fontSize !== nf) el.style.fontSize = nf;
            if (el.style.color !== nc) el.style.color = nc;
            if (el.style.fontFamily !== nfa) el.style.fontFamily = nfa;
            var elW = el.offsetWidth;
            var x;
            if (ch.anchorType === 'LineStart') { x = a.rect.right + MARGIN; }
            else if (ch.anchorType === 'LineEnd') { x = a.rect.left - MARGIN; }
            else { x = (a.rect.left + a.rect.right) / 2; }
            var nt = (a.rect.top - wrapRect.top + scrollTop - _pCfg.cSize - GAP) + 'px';
            var nl = (x - wrapRect.left - elW / 2) + 'px';
            if (el.style.top !== nt) el.style.top = nt;
            if (el.style.left !== nl) el.style.left = nl;
            if (ensured.created) el.style.visibility = 'visible';

            // Chord line (vertical connector from chord to lyric)
            var lnEnsured = _pEnsureChordLineEl(key, pb);
            var ln = lnEnsured.el;
            var lnX = (x - wrapRect.left) + 'px';
            var lnTop = (parseFloat(nt) + _pCfg.cSize) + 'px';
            var lnH = Math.max(4, GAP) + 'px';
            if (ln.style.left !== lnX) ln.style.left = lnX;
            if (ln.style.top !== lnTop) ln.style.top = lnTop;
            if (ln.style.height !== lnH) ln.style.height = lnH;
            if (ln.style.background !== _pCfg.cColor) ln.style.background = _pCfg.cColor;
            if (lnEnsured.created) ln.style.visibility = 'visible';
          });
          _pCleanupUnused(usedKeys);
          _pLastRenderedSignature = signature;
          _pLastStructureVersion = _pStructureVersion;
          _pRenderReason = 'idle';
        }

        function _pScheduleChordRender(reason) {
          _pRenderReason = reason || _pRenderReason || 'unknown';
          if (_pRenderPending) return;
          _pRenderPending = true;
          requestAnimationFrame(function() { _pRenderPending = false; _pRenderChords(); });
        }

        _pScheduleChordRender('init');
        window.addEventListener('resize', function() { _pScheduleChordRender('resize'); });

        window._pCfg = _pCfg;
        window._pChords = _pChords;
        window._pRenderChords = _pRenderChords;
        window._pScheduleChordRender = _pScheduleChordRender;
        window._pChordEls = _pChordEls;
        window._pChordLineEls = _pChordLineEls;

        // === Wheel handlers ===
        var _pvKey = '${_pvSettingsKey}';
        function _pvLoad() { try { return JSON.parse(localStorage.getItem(_pvKey)) || {}; } catch(e) { return {}; } }
        function _pvSaveLocal(s) { try { localStorage.setItem(_pvKey, JSON.stringify(s)); } catch(e) {} }
        function _pvApplyLocal(s) {
          document.body.style.background = s.bgColor || '#0F131E';
          var fontName = s.font || 'Vazirmatn';
          document.querySelectorAll('.eline').forEach(function(el) {
            el.style.color = s.tColor || '#0fa966';
            el.style.fontSize = (s.tSize || 38) + 'px';
            el.style.fontWeight = s.bold ? 'bold' : 'normal';
            el.style.fontFamily = fontName;
          });
          _pCfg.cSize = s.cSize || 38;
          _pCfg.cColor = s.cColor || '#e6aa28';
          _pCfg.cFont = fontName;
          if (typeof _pScheduleChordRender === 'function') { _pScheduleChordRender('style'); }
          else { _pRenderChords(); }
        }
        document.addEventListener('wheel', function(e) {
          var s = _pvLoad(); if (!s.tSize) s.tSize = 20; if (!s.cSize) s.cSize = 14;
          if (s.scaleLock === undefined) s.scaleLock = true;
          var t = e.target;
          if (t && t.id === 'pv-tSize') {
            e.preventDefault();
            s.tSize = Math.max(12, Math.min(55, s.tSize + (e.deltaY < 0 ? 1 : -1)));
            if (s.scaleLock) s.cSize = Math.max(8, Math.min(40, Math.round(s.tSize * 0.7)));
            t.value = s.tSize;
            var tv = document.getElementById('pv-tSizeVal'); if (tv) tv.textContent = s.tSize;
            var cs = document.getElementById('pv-cSize'); var cv = document.getElementById('pv-cSizeVal');
            if (cs) cs.value = s.cSize; if (cv) cv.textContent = s.cSize;
            _pvSaveLocal(s); _pvApplyLocal(s); return;
          }
          if (t && t.id === 'pv-cSize') {
            e.preventDefault();
            s.cSize = Math.max(8, Math.min(40, s.cSize + (e.deltaY < 0 ? 1 : -1)));
            if (s.scaleLock) s.tSize = Math.max(12, Math.min(55, Math.round(s.cSize / 0.7)));
            t.value = s.cSize;
            var cv2 = document.getElementById('pv-cSizeVal'); if (cv2) cv2.textContent = s.cSize;
            var ts = document.getElementById('pv-tSize'); var tv2 = document.getElementById('pv-tSizeVal');
            if (ts) ts.value = s.tSize; if (tv2) tv2.textContent = s.tSize;
            _pvSaveLocal(s); _pvApplyLocal(s); return;
          }
          if (t && t.id === 'pv-font') {
            e.preventDefault();
            var _fl = ['Vazirmatn','Vazirmatn Thin','Vazirmatn Bold','Vazirmatn Black','BArshia','BFarnaz','BJadid','BZar','BZar Bold','Lalezar'];
            var idx = _fl.indexOf(s.font || 'Vazirmatn');
            idx = e.deltaY < 0 ? (idx - 1 + _fl.length) % _fl.length : (idx + 1) % _fl.length;
            s.font = _fl[idx]; t.value = s.font;
            _pvSaveLocal(s); _pvApplyLocal(s); return;
          }
        }, { passive: false });
      `;
      _lyricPopup.document.body.appendChild(sc);
      // Override _pCfg with saved Player View settings (not editor defaults)
      _lyricPopup._pCfg = { cSize: _pvSettings.cSize, cColor: _pvSettings.cColor, cFont: 'JetBrains Mono' };
      // ==========================================
// PART 2: Audio Import & Hard Drive Auto-Load
// ==========================================
// NOTE: loadAudioFromHardDrive, pathDirname, pathJoin در بالای فایل (global scope) تعریف شدن.
// اینجا فقط توابع دیگه مرتبط با audio import قرار می‌گیرن.

/**
 * مدیریت افزودن فایل صوتی جدید به پروژه
 */
async function handleAudioImport(file, copyToProject = false) {
  const absolutePath = isElectron ? file.path : null;

  const newTrack = {
    id: 'track_' + Date.now(),
    name: file.name,
    isCopied: copyToProject,
    filePath: copyToProject ? null : absolutePath,
    volume: 1.0,
    pan: 0,
    isMuted: false,
    clips: []
  };

  const arrayBuffer = await file.arrayBuffer();
  ensureAudioCtx();
  const audioBuffer = await DAW.audioCtx.decodeAudioData(arrayBuffer);
  
  newTrack.clips.push({
    id: 'clip_' + Date.now(),
    startTime: 0,
    offset: 0,
    duration: audioBuffer.duration,
    buffer: audioBuffer
  });

  if (audioBuffer.duration > DAW.projectDuration) {
    DAW.projectDuration = audioBuffer.duration;
  }

  DAW.tracks.push(newTrack);
  if (typeof renderTimeline === 'function') renderTimeline();
}
// ==========================================
// PART 3: Project Load & Audio Export (WAV)
// ==========================================

/**
 * بارگذاری پروژه و لود اتوماتیک فایل‌های صوتی از مسیر ذخیره‌شده
 */
async function loadProject(projectData, projectFilePath = null) {
  const loader = document.getElementById('loading-indicator');
  if (loader) loader.style.display = 'block';

  // پاک‌سازی وضعیت فعلی
  DAW.pool = {};
  DAW.bufferCache.clear();
  DAW.tracks = [];
  DAW.clips = [];
  
  // بازیابی اطلاعات پروژه
  DAW.project = projectData.project || {};
  DAW.projectRoot = projectFilePath ? pathDirname(projectFilePath) : null;
  
  // بازیابی Pool کلیپ‌ها
  if (projectData.pool) {
    DAW.pool = projectData.pool;
  }
  
  // بازیابی ترک‌ها و کلیپ‌ها
  DAW.tracks = projectData.tracks || [];
  DAW.clips = projectData.clips || [];
  DAW.sections = projectData.sections || [];
  DAW.edCur = projectData.edCur || null;
  DAW.edSeqPoints = projectData.edSeqPoints || [];

  // لود کردن فایل‌های صوتی برای هر کلیپ در Pool
  for (const [clipId, clip] of Object.entries(DAW.pool)) {
    try {
      await resolveClipAudio(clip, projectFilePath);
    } catch (error) {
      console.warn(`فایل صوتی برای کلیپ ${clipId} پیدا نشد:`, error.message);
      clip.runtime = { loaded: false, error: error.message };
    }
  }

  // همچنین کلیپ‌های قدیمی که ممکن است در tracks باشند را لود کن
  for (const clip of DAW.clips) {
    if (clip.type !== 'chord' && clip.relativePath && !DAW.bufferCache.has(clip.id)) {
      try {
        // ساخت یک شیء clip موقت برای resolveClipAudio
        const tempClip = {
          id: clip.id || `clip_${Date.now()}`,
          fileName: clip.fileName || clip.name,
          relativePath: clip.relativePath,
          storage: { mode: 'copy', projectPath: clip.relativePath }
        };
        await resolveClipAudio(tempClip, projectFilePath);
        // کپی بافر به کلیپ اصلی
        const buffer = DAW.bufferCache.get(tempClip.id);
        if (buffer) {
          DAW.bufferCache.set(clip.id || tempClip.id, buffer);
        }
      } catch (e) {
        console.warn('لود کلیپ قدیمی شکست خورد:', e.message);
      }
    }
  }

  DAW.projectDuration = projectData.projectDuration || 0;
  if (typeof renderTimeline === 'function') renderTimeline();
  if (loader) loader.style.display = 'none';
}

/**
 * تابع مرکزی برای Resolve و Load فایل‌های صوتی
 */
async function resolveClipAudio(clip, projectFilePath = null) {
  let filePath = null;
  
  // بررسی حالت‌های مختلف ذخیره‌سازی
  if (clip.storage && clip.storage.mode === 'copy') {
    // حالت کپی: فایل در پوشه پروژه است
    const projRoot = projectFilePath ? pathDirname(projectFilePath) : DAW.projectRoot;
    if (!projRoot || !clip.storage.projectPath) {
      throw new Error(`Project root is missing for clip: ${clip.id}`);
    }
    filePath = (window.electronAPI?.resolvePath)
               ? await window.electronAPI.resolvePath(projRoot, clip.storage.projectPath)
               : pathJoin(projRoot, clip.storage.projectPath);
  } else if (clip.storage && clip.storage.mode === 'reference') {
    // حالت رفرنس: مسیر خارجی
    filePath = clip.storage.externalPath;
  } else if (clip.relativePath) {
    // حالت جدید: مسیر نسبی
    const projRoot = projectFilePath ? pathDirname(projectFilePath) : DAW.projectRoot;
    if (projRoot) {
      filePath = (window.electronAPI?.resolvePath)
                 ? await window.electronAPI.resolvePath(projRoot, clip.relativePath)
                 : pathJoin(projRoot, clip.relativePath);
    }
  } else if (clip._filePath) {
    // سازگاری با نسخه قدیمی
    filePath = clip._filePath;
  } else if (clip.filePath) {
    filePath = clip.filePath;
  }
  
  if (!filePath) {
    throw new Error(`No audio path for clip: ${clip.id || 'unknown'}`);
  }
  
  // خواندن فایل صوتی از طریق Electron API
  let arrayBuffer;
  if (window.electronAPI?.readAudioFile) {
    arrayBuffer = await window.electronAPI.readAudioFile(filePath);
  } else {
    throw new Error('Electron API not available for reading audio files');
  }
  
  if (!arrayBuffer) {
    throw new Error(`Failed to read audio file: ${filePath}`);
  }
  
  // دیکد کردن AudioBuffer
  const audioCtx = DAW.audioCtx || (DAW.audioCtx = new (window.AudioContext || window.webkitAudioContext)());
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
  
  // ذخیره در کش با کلید پایدار clipId
  DAW.bufferCache.set(clip.id, audioBuffer);
  
  // آپدیت وضعیت runtime
  clip.runtime = {
    loaded: true,
    resolvedPath: filePath,
    loadedAt: Date.now()
  };
  
  return audioBuffer;
}

/**
 * تبدیل AudioBuffer به فرمت استاندارد WAV جهت ذخیره‌سازی
 */
function bufferToWave(abuffer, len) {
  let numOfChan = abuffer.numberOfChannels,
      length = len * numOfChan * 2 + 44,
      out = new DataView(new ArrayBuffer(length)),
      channels = [], i, sample,
      offset = 0, pos = 0;

  function setUint16(data) { out.setUint16(pos, data, true); pos += 2; }
  function setUint32(data) { out.setUint32(pos, data, true); pos += 4; }

  setUint32(0x46464952); // "RIFF"
  setUint32(length - 8);
  setUint32(0x45564157); // "WAVE"
  setUint32(0x20746d66); // "fmt "
  setUint32(16);
  setUint16(1);
  setUint16(numOfChan);
  setUint32(abuffer.sampleRate);
  setUint32(abuffer.sampleRate * 2 * numOfChan);
  setUint16(numOfChan * 2);
  setUint16(16);
  setUint32(0x61746164); // "data"
  setUint32(length - pos - 4);

  for (i = 0; i < numOfChan; i++) {
    channels.push(abuffer.getChannelData(i));
  }

  while (offset < len) {
    for (i = 0; i < numOfChan; i++) {
      sample = Math.max(-1, Math.min(1, channels[i][offset]));
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
      out.setInt16(pos, sample, true);
      pos += 2;
    }
    offset++;
  }
  return new Blob([out], { type: "audio/wav" });
  // ==========================================
// PART 4: Timeline Rendering & UI Event Listeners
// ==========================================

/**
 * رندر کردن ظاهر تراک‌ها روی تایم‌لاین
 */
function renderTimeline() {
  const container = document.getElementById('timeline-tracks-container');
  if (!container) return;
  container.innerHTML = '';

  DAW.tracks.forEach(track => {
    const trackEl = document.createElement('div');
    trackEl.className = 'track-row';
    trackEl.innerHTML = `
      <div class="track-header">${track.name}</div>
      <div class="track-content"></div>
    `;
    container.appendChild(trackEl);
  });
}

// اتصال رویدادهای اولیه صفحه پس از بارگذاری DOM - بخش اول (خط ۳۶۲۳)
document.addEventListener('DOMContentLoaded', () => {
  const audioInput = document.getElementById('audio-file-input');
  if (audioInput) {
    audioInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const copy = confirm("آیا می‌خواهید فایل صوتی در پوشه پروژه کپی شود؟");
        handleAudioImport(file, copy);
      }
    });
  }

  // ============================================
  // Menu Command Handlers (Electron)
  // ============================================
  if (isElectron && window.electronAPI && window.electronAPI.onMenuCommand) {
    console.log('[App] Registering menu command handlers...');

    // File Menu
    window.electronAPI.onMenuCommand('menu-new-song', () => {
      console.log('[Menu] New Song requested');
      if (typeof createNewProject === 'function') createNewProject();
      else alert('قابلیت ایجاد پروژه جدید هنوز پیاده‌سازی نشده است.');
    });

    window.electronAPI.onMenuCommand('menu-open-project', () => {
      console.log('[Menu] Open Project requested');
      if (typeof openProjectDialog === 'function') openProjectDialog();
      else alert('قابلیت باز کردن پروژه هنوز پیاده‌سازی نشده است.');
    });

    window.electronAPI.onMenuCommand('menu-save', () => {
      console.log('[Menu] Save requested');
      if (typeof saveCurrentProject === 'function') saveCurrentProject();
      else alert('قابلیت ذخیره پروژه هنوز پیاده‌سازی نشده است.');
    });

    window.electronAPI.onMenuCommand('menu-save-as', () => {
      console.log('[Menu] Save As requested');
      if (typeof saveProjectAs === 'function') saveProjectAs();
      else alert('قابلیت ذخیره با نام جدید هنوز پیاده‌سازی نشده است.');
    });

    window.electronAPI.onMenuCommand('menu-export', () => {
      console.log('[Menu] Export requested');
      if (typeof exportProject === 'function') exportProject();
      else alert('قابلیت خروجی گرفتن هنوز پیاده‌سازی نشده است.');
    });

    window.electronAPI.onMenuCommand('menu-import', () => {
      console.log('[Menu] Import requested');
      if (typeof importProject === 'function') importProject();
      else alert('قابلیت ورود پروژه هنوز پیاده‌سازی نشده است.');
    });

    // Playback Menu
    window.electronAPI.onMenuCommand('menu-play-pause', () => {
      console.log('[Menu] Play/Pause requested');
      if (typeof togglePlayPause === 'function') togglePlayPause();
      else if (typeof playPause === 'function') playPause();
      else alert('قابلیت پخش/توقف هنوز پیاده‌سازی نشده است.');
    });

    window.electronAPI.onMenuCommand('menu-stop', () => {
      console.log('[Menu] Stop requested');
      if (typeof stopPlayback === 'function') stopPlayback();
      else if (typeof perfStop === 'function') perfStop();
      else alert('قابلیت توقف پخش هنوز پیاده‌سازی نشده است.');
    });

    window.electronAPI.onMenuCommand('menu-go-to-start', () => {
      console.log('[Menu] Go to Start requested');
      if (typeof goToStart === 'function') goToStart();
      else if (DAW && typeof seekTo === 'function') seekTo(0);
      else alert('قابلیت رفتن به ابتدا هنوز پیاده‌سازی نشده است.');
    });

    window.electronAPI.onMenuCommand('menu-go-to-end', () => {
      console.log('[Menu] Go to End requested');
      if (typeof goToEnd === 'function') goToEnd();
      else alert('قابلیت رفتن به انتها هنوز پیاده‌سازی نشده است.');
    });

    // Tools Menu
    window.electronAPI.onMenuCommand('menu-arranger', () => {
      console.log('[Menu] Arranger requested');
      const panel = document.getElementById('arr-perf-panel');
      if (panel) {
        panel.style.display = panel.style.display === 'none' || panel.style.display === '' ? 'flex' : 'none';
      } else {
        alert('پنجره Arranger پیدا نشد.');
      }
    });

    window.electronAPI.onMenuCommand('menu-archive', () => {
      console.log('[Menu] Archive requested');
      if (typeof edOpenArchive === 'function') {
        edOpenArchive();
      } else {
        alert('آرشیو هنوز بارگذاری نشده است.');
      }
    });

    window.electronAPI.onMenuCommand('menu-midi-settings', () => {
      console.log('[Menu] MIDI Settings requested');
      if (typeof openMidiSettings === 'function') openMidiSettings();
      else alert('تنظیمات MIDI هنوز پیاده‌سازی نشده است.');
    });

    window.electronAPI.onMenuCommand('menu-preferences', () => {
      console.log('[Menu] Preferences requested');
      if (typeof openPreferences === 'function') openPreferences();
      else alert('تنظیمات برنامه هنوز پیاده‌سازی نشده است.');
    });

    console.log('[App] Menu command handlers registered successfully.');
  }
});
}
      // Also override on the popup's global scope for the chord script
      try { _lyricPopup.eval('_pCfg.cSize=' + _pvSettings.cSize + ';_pCfg.cColor="' + _pvSettings.cColor + '";'); } catch(_) {}
      // Settings panel initialization — use persistent _pvSettings from outer scope
      const _pvDoc = _lyricPopup.document;
      function _pvApply() {
        const root = _pvDoc.body;
        root.style.background = _pvSettings.bgColor;
        // Apply to all lines
        _pvDoc.querySelectorAll('.eline').forEach(el => {
          el.style.color = _pvSettings.tColor;
          el.style.fontSize = _pvSettings.tSize + 'px';
          el.style.fontWeight = _pvSettings.bold ? 'bold' : 'normal';
          el.style.fontFamily = _getFontFamilyCSS(_pvSettings.font);
        });
        // Update chord config in popup's global scope
        try { _lyricPopup.eval('_pCfg.cSize=' + _pvSettings.cSize + ';_pCfg.cColor="' + _pvSettings.cColor + '";'); } catch(_) {}
        // Re-render chords with new sizes
        try { _lyricPopup.eval('if(typeof _pScheduleChordRender==="function"){_pScheduleChordRender("style");}else if(typeof _pRenderChords==="function"){_pRenderChords();}'); } catch(_) {}
      }
      // Toggle settings panel (auto-hide: clicking outside closes it)
      const _pvToggle = _pvDoc.getElementById('pv-settings-toggle');
      const _pvPanel = _pvDoc.getElementById('pv-settings');
      if (_pvToggle && _pvPanel) {
        _pvToggle.onclick = (e) => { e.stopPropagation(); _pvPanel.style.display = _pvPanel.style.display === 'none' ? 'block' : 'none'; };
        _pvDoc.body.addEventListener('click', (e) => { if (!_pvPanel.contains(e.target) && e.target !== _pvToggle) _pvPanel.style.display = 'none'; });
      }
      // Wire up controls
      const _pvFont = _pvDoc.getElementById('pv-font'); if (_pvFont) { _pvFont.value = _pvSettings.font; _pvFont.onchange = () => { _pvSettings.font = _pvFont.value; _pvSave(); _pvApply(); }; }
      const _pvTC = _pvDoc.getElementById('pv-tColor'); if (_pvTC) { _pvTC.value = _pvSettings.tColor; _pvTC.oninput = () => { _pvSettings.tColor = _pvTC.value; _pvSave(); _pvApply(); }; }
      const _pvCC = _pvDoc.getElementById('pv-cColor'); if (_pvCC) { _pvCC.value = _pvSettings.cColor; _pvCC.oninput = () => { _pvSettings.cColor = _pvCC.value; _pvSave(); _pvApply(); }; }
      const _pvBG = _pvDoc.getElementById('pv-bgColor'); if (_pvBG) { _pvBG.value = _pvSettings.bgColor; _pvBG.oninput = () => { _pvSettings.bgColor = _pvBG.value; _pvSave(); _pvApply(); }; }
      const _pvTS = _pvDoc.getElementById('pv-tSize'); const _pvTV = _pvDoc.getElementById('pv-tSizeVal');
      if (_pvTS) { _pvTS.value = _pvSettings.tSize; if (_pvTV) _pvTV.textContent = _pvSettings.tSize; _pvTS.oninput = () => { _pvSettings.tSize = +_pvTS.value; if (_pvTV) _pvTV.textContent = _pvSettings.tSize; if (_pvSettings.scaleLock) { _pvSettings.cSize = Math.round(_pvSettings.tSize * 0.7); const cs = _pvDoc.getElementById('pv-cSize'); const cv = _pvDoc.getElementById('pv-cSizeVal'); if (cs) cs.value = _pvSettings.cSize; if (cv) cv.textContent = _pvSettings.cSize; } _pvSave(); _pvApply(); }; }
      const _pvCS = _pvDoc.getElementById('pv-cSize'); const _pvCV = _pvDoc.getElementById('pv-cSizeVal');
      if (_pvCS) { _pvCS.value = _pvSettings.cSize; if (_pvCV) _pvCV.textContent = _pvSettings.cSize; _pvCS.oninput = () => { _pvSettings.cSize = +_pvCS.value; if (_pvCV) _pvCV.textContent = _pvSettings.cSize; if (_pvSettings.scaleLock) { _pvSettings.tSize = Math.round(_pvSettings.cSize / 0.7); const ts = _pvDoc.getElementById('pv-tSize'); const tv = _pvDoc.getElementById('pv-tSizeVal'); if (ts) ts.value = _pvSettings.tSize; if (tv) tv.textContent = _pvSettings.tSize; } _pvSave(); _pvApply(); }; }
      const _pvSL = _pvDoc.getElementById('pv-scaleLock'); if (_pvSL) { _pvSL.checked = _pvSettings.scaleLock; _pvSL.onchange = () => { _pvSettings.scaleLock = _pvSL.checked; _pvSave(); }; }
      const _pvBold = _pvDoc.getElementById('pv-bold'); if (_pvBold) { _pvBold.checked = _pvSettings.bold; _pvBold.onchange = () => { _pvSettings.bold = _pvBold.checked; _pvSave(); _pvApply(); }; }
      // Apply saved settings on load
      _pvApply();
      // ریسایز درگ‌کردنی نوار آکورد
      (function() {
        const _handle = _pvDoc.getElementById('chordMirrorHandle');
        const _wrapper = _pvDoc.getElementById('chordMirrorResize');
        const _mirror = _pvDoc.getElementById('playerChordMirror');
        if (!_handle || !_wrapper || !_mirror) return;
        let _dragging = false, _startY = 0, _startH = 0;
        _handle.addEventListener('mousedown', function(e) {
          e.preventDefault(); _dragging = true; _startY = e.clientY; _startH = _wrapper.offsetHeight;
          _pvDoc.body.style.cursor = 'ns-resize'; _pvDoc.body.style.userSelect = 'none';
        });
        _pvDoc.addEventListener('mousemove', function(e) {
          if (!_dragging) return;
          const newH = Math.max(40, Math.min(300, _startH + (_startY - e.clientY)));
          _wrapper.style.height = newH + 'px';
          _mirror.style.height = (newH - 4) + 'px';
        });
        _pvDoc.addEventListener('mouseup', function() {
          if (_dragging) { _dragging = false; _pvDoc.body.style.cursor = ''; _pvDoc.body.style.userSelect = ''; }
        });
      })();
      // Highlight sync: update popup directly from main window (not postMessage)
      // فقط class toggling — هیچ inline style reset — هیچ DOM rebuild
      let _pvLastScrolledIdx = -999;
      function _syncLyricPopupHighlight() {
        if (!_lyricPopup || _lyricPopup.closed) return;
        const popupBody = _lyricPopup.document.getElementById('popupBody');
        if (!popupBody) return;
        const times = edCur?.syncTimes || [];
        const t = DAW?.playhead || 0;
        let activeIdx = -1;
        for (let i = 0; i < times.length; i++) {
          if (Number.isFinite(times[i]) && times[i] <= t) activeIdx = i;
          else if (Number.isFinite(times[i]) && times[i] > t) break;
        }
        // فقط class toggling — بدون reset inline styles
        [...popupBody.children].forEach(el => {
          if (!el.dataset.li) return;
          const li = +el.dataset.li;
          el.classList.toggle('active', li === activeIdx);
          el.classList.toggle('done', (times[li] != null) && times[li] < t && li !== activeIdx);
        });
        // اسکرول فقط وقتی خط فعال عوض شده
        if (activeIdx >= 0 && activeIdx !== _pvLastScrolledIdx) {
          _pvLastScrolledIdx = activeIdx;
          const activeEl = popupBody.querySelector('[data-li="' + activeIdx + '"]');
          if (activeEl) {
            const bodyH = popupBody.clientHeight;
            popupBody.scrollTo({ top: activeEl.offsetTop - bodyH / 2 + activeEl.offsetHeight / 2, behavior: 'smooth' });
          }
        }
      }
      _lyricPopup._syncHighlight = _syncLyricPopupHighlight;
      // Fallback chord render chain: اگر rAF اولیه در full rebuild fail شد
      [200, 500, 1000].forEach(function(ms) {
        setTimeout(function() {
          try {
            if (_lyricPopup && !_lyricPopup.closed && typeof _lyricPopup._pRenderChords === 'function') {
              _lyricPopup._pRenderChords();
            }
          } catch(_) {}
        }, ms);
      });
      // Force Reflow: مجبور کردن مرورگر به محاسبه مجدد چیدمان
      try {
        const _pb = _lyricPopup.document.getElementById('popupBody');
        if (_pb) void _pb.offsetHeight;
        _lyricPopup.dispatchEvent(new Event('resize'));
      } catch(_) {}
    }

    /* ===== SYNC / LINE GUIDE ===== */
    let syncCursor = 0,
    syncHistory = [],
    syncRedoHistory = [],
    syncWatch = null,
    syncActive = false;

let lastSyncActiveLi = -999;
let syncTapKeyHandler = null;

    function formatSyncTime(t) { if (!Number.isFinite(t)) return '--:--.-'; const m = Math.floor(t / 60); const s = (t % 60).toFixed(1); return `${String(m).padStart(2,'0')}:${s.padStart(4,'0')}`; }
    function createSyncLineEl(line, li, time) {
  const d = document.createElement('div');
  d.className = 'sline';
  d.dataset.li = li;

  const text = document.createElement('span');
  text.className = 's-text';
  text.textContent = line || ' ';

  const timeEl = document.createElement('span');
  timeEl.className = 's-time';
  timeEl.textContent = formatSyncTime(time);

  d.appendChild(text);
  d.appendChild(timeEl);
  d.onclick = () => selectSyncLine(li);

  return d;
}

    function renderSyncLyrics() {
  const box = $('syncLyrics');
  if (!box) return;

  const lines = (edCur?.lyrics || '').split('\n');
  const times = edCur?.syncTimes || [];
  const existingCount = box.children.length;

  // فقط وقتی تعداد خط‌ها عوض شده، rebuild کامل انجام بده
  if (existingCount !== lines.length) {
    const frag = document.createDocumentFragment();

    lines.forEach((line, li) => {
      frag.appendChild(createSyncLineEl(line, li, times[li]));
    });

    box.replaceChildren(frag);
    selectSyncLine(syncCursor);
    return;
  }

  // در حالت عادی فقط سطرهایی که لازم است آپدیت شوند
  for (let li = 0; li < lines.length; li++) {
    const row = box.children[li];
    if (!row) continue;

    if (row.dataset.li !== String(li)) {
      row.dataset.li = li;
      row.onclick = () => selectSyncLine(li);
    }

    const textEl = row.querySelector('.s-text');
    const timeEl = row.querySelector('.s-time');

    const nextText = lines[li] || ' ';
    const nextTime = formatSyncTime(times[li]);

    if (textEl && textEl.textContent !== nextText) {
      textEl.textContent = nextText;
    }

    if (timeEl && timeEl.textContent !== nextTime) {
      timeEl.textContent = nextTime;
    }
  }

  selectSyncLine(syncCursor);
}


    function selectSyncLine(li) {
  if (li < 0) li = 0;
  syncCursor = li;

  const rows = document.querySelectorAll('#syncLyrics .sline');
  let selectedEl = null;

  rows.forEach(el => {
    const isSel = (+el.dataset.li === li);
    if (el.classList.contains('selected') !== isSel) {
      el.classList.toggle('selected', isSel);
    }
    if (isSel) selectedEl = el;
  });

  if (selectedEl) {
    selectedEl.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });
  }

  const total = (edCur?.lyrics || '').split('\n').length;
  const info = $('syncInfo');
  if (info) {
    info.textContent = `${t('linesOf')} ${li + 1} ${t('lineOf')} ${total}`;
  }
}


    function syncTap() {
      if (!syncActive) return;
      const lines = (edCur?.lyrics || '').split('\n');
      if (syncCursor >= lines.length) return;
      const t = DAW.playhead;
      syncHistory.push(JSON.stringify(edCur?.syncTimes || []));
      syncRedoHistory = [];
      if (!edCur.syncTimes) edCur.syncTimes = [];
      edCur.syncTimes[syncCursor] = t;
      // Skip empty lines
      let next = syncCursor + 1;
      while (next < lines.length && !lines[next].trim()) { edCur.syncTimes[next] = t; next++; }
      syncCursor = next;
      renderSyncLyrics();
      if (syncCursor >= lines.length) {
        toast(t('syncFinished'));
        if (DAW.isPlaying) pauseTransport();
      }
      edSaveSong();
    }

    function updateSyncHighlight() {
  const t = DAW.playhead;
  const times = edCur?.syncTimes || [];
  let activeLi = -1;

  for (let i = 0; i < times.length; i++) {
    const tm = times[i];
    if (Number.isFinite(tm) && tm <= t) {
      activeLi = i;
    } else if (Number.isFinite(tm) && tm > t) {
      break;
    }
  }

  // === Performance Architecture v2: sync playback + highlight to Store ===
  if (typeof PerformanceStore !== 'undefined' && typeof SharedEngine !== 'undefined' && typeof _songDocument !== 'undefined' && _songDocument) {
    PerformanceStore.setPlaybackState({ time: t, isPlaying: !!DAW.isPlaying });
    const hl = SharedEngine.computeHighlight(PerformanceStore.getState().playbackState, _songDocument);
    PerformanceStore.setHighlightState(hl);
  }

  // اگر خط فعال عوض نشده، فقط در صورت نیاز تایم/پروگرس پنل را آپدیت کن
  const changed = activeLi !== lastSyncActiveLi;
  lastSyncActiveLi = activeLi;

  // Highlight lines in main editor
  const editorEl = $('editor');
  if (editorEl) {
    [...editorEl.children].forEach((el, li) => {
      if (!el.classList.contains('eline')) return;

      const isPlaying = (li === activeLi);
      const isDone = Number.isFinite(times[li]) && times[li] < t && li !== activeLi;

      if (changed || el.classList.contains('sync-playing') !== isPlaying) {
        el.classList.toggle('sync-playing', isPlaying);
      }

      if (changed || el.classList.contains('sync-done') !== isDone) {
        el.classList.toggle('sync-done', isDone);
      }
    });

    // Center active line in editorWrap فقط وقتی خط عوض شد
    if (changed && activeLi >= 0 && editorEl.children[activeLi]) {
      const wrap = $('editorWrap');
      if (wrap) {
        const activeEl = editorEl.children[activeLi];
        const wrapH = wrap.clientHeight;
        const elTop = activeEl.offsetTop;
        const elH = activeEl.offsetHeight;

        wrap.scrollTo({
          top: elTop - wrapH / 2 + elH / 2,
          behavior: 'smooth'
        });
      }
    }
  }

  // Update sync panel UI
  if (syncActive) {
    document.querySelectorAll('#syncLyrics .sline').forEach(el => {
      const li = +el.dataset.li;

      const isPlaying = (li === activeLi);
      const isDone = Number.isFinite(times[li]) && times[li] < t && li !== activeLi;

      if (changed || el.classList.contains('playing') !== isPlaying) {
        el.classList.toggle('playing', isPlaying);
      }

      if (changed || el.classList.contains('done') !== isDone) {
        el.classList.toggle('done', isDone);
      }
    });

    const total = getProjectEnd();
    if (total > 0) {
      const fill = $('syncTimelineFill');
      if (fill) fill.style.width = (t / total * 100) + '%';
    }

    const curTime = $('syncCurTime');
    if (curTime) curTime.textContent = formatSyncTime(t);
  }

  // Sync highlight to popup windows (direct DOM update, not postMessage)
  if (_lyricPopup && !_lyricPopup.closed && _lyricPopup._syncHighlight) {
    _lyricPopup._syncHighlight();
  }
  if (_lyricOnlyPopup && !_lyricOnlyPopup.closed && _lyricOnlyPopup._syncHighlight) {
    _lyricOnlyPopup._syncHighlight();
  }
  if (_chordLinePopup && !_chordLinePopup.closed && _chordLinePopup._syncHighlight) {
    _chordLinePopup._syncHighlight();
  }
}


    // Sync tick loop
    function syncTick() {
  if (!syncActive) return;

  updateSyncHighlight();
  syncWatch = requestAnimationFrame(syncTick);
}


    function enterSyncMode() {
      syncActive = true;
      syncCursor = 0;
      const lines = (edCur?.lyrics || '').split('\n');
      while (syncCursor < lines.length && !lines[syncCursor].trim()) syncCursor++;
      if (syncCursor >= lines.length) syncCursor = 0;
      if (!edCur.syncTimes) edCur.syncTimes = [];
      syncHistory = []; syncRedoHistory = [];
      renderSyncLyrics();
      $('syncSection').classList.add('show');
      // Add Space key handler for sync tap
      syncTapKeyHandler = (e) => {
        if (e.code === 'Space' && e.ctrlKey && syncActive && !e.target.closest('input,textarea,[contenteditable]')) {
          e.preventDefault(); syncTap();
        }
      };
      window.addEventListener('keydown', syncTapKeyHandler);
      // Start highlight tick
      syncTick();
    }

    function exitSyncMode() {
      syncActive = false;
      $('syncSection').classList.remove('show');
      if (syncTapKeyHandler) { window.removeEventListener('keydown', syncTapKeyHandler); syncTapKeyHandler = null; }
      if (syncWatch) { cancelAnimationFrame(syncWatch); syncWatch = null; }
      edSaveSong();
    }

    // Chord visibility toggle (editor only, independent of popup)
    if ($('edToggleChords')) $('edToggleChords').onclick = () => {
      edChordsVisible = !edChordsVisible;
      $('edToggleChords').classList.toggle('active', edChordsVisible);
      edRenderChords();
    };

    // Sequential chords (آکورد ترتیبی)
    function edRemapSeqPoints(oldText, newText) {
      if (!edCur?.seqPoints?.length) return;
      function lineCharToAbs(text, li, ci) { const lines = text.split('\n'); let abs = 0; for (let i=0;i<li&&i<lines.length;i++) abs += lines[i].length+1; return abs + Math.min(ci, (lines[li]||'').length); }
      function absToLineChar(text, abs) { const lines = text.split('\n'); let pos = abs; for (let i=0;i<lines.length;i++) { if (pos <= lines[i].length) return {lineIndex:i,charIndex:pos}; pos -= lines[i].length+1; } return {lineIndex:lines.length-1,charIndex:(lines[lines.length-1]||'').length}; }
      function remapItem(item) {
        if (item.anchorType === 'LineStart') { const nl = newText.split('\n'); item.lineIndex = Math.min(item.lineIndex, nl.length-1); item.charIndex = 0; return; }
        if (item.anchorType === 'LineEnd') { const nl = newText.split('\n'); item.lineIndex = Math.min(item.lineIndex, nl.length-1); item.charIndex = (nl[item.lineIndex]||'').length; return; }
        const abs = lineCharToAbs(oldText, item.lineIndex, item.charIndex);
        const anchorChar = oldText[abs];
        if (!anchorChar || anchorChar === '\n') { const cl = absToLineChar(newText, Math.min(abs, newText.length)); item.lineIndex = cl.lineIndex; item.charIndex = cl.charIndex; item.anchorType = 'OnCharacter'; return; }
        let best = -1, bestD = Infinity, sf = 0;
        while (sf < newText.length) { const f = newText.indexOf(anchorChar, sf); if (f === -1) break; const d = Math.abs(f-abs); if (d < bestD) { bestD = d; best = f; } if (f >= abs) break; sf = f+1; }
        if (best === -1) { const cl = absToLineChar(newText, Math.min(abs, newText.length)); item.lineIndex = cl.lineIndex; item.charIndex = cl.charIndex; item.anchorType = 'OnCharacter'; return; }
        const pos = absToLineChar(newText, best); item.lineIndex = pos.lineIndex; item.charIndex = pos.charIndex; item.anchorType = 'OnCharacter';
      }
      edCur.seqPoints.forEach(sp => remapItem(sp));
      edCur.seqPoints = edCur.seqPoints.filter(p => p.lineIndex >= 0);
      if (edSeqModeActive) edSeqPoints = edCur.seqPoints;
    }

    function edToggleSeqMode() {
      edSeqModeActive = !edSeqModeActive;
      if (edSeqModeActive) {
        edSeqPoints = []; edCur.seqPoints = [];
        edSeqChordingActive = false;
        $('edSeqToggle').classList.add('active');
        toast(t('selectPointsActive'));
      } else {
        $('edSeqToggle').classList.remove('active');
        edCur.seqPoints = edSeqPoints; edRenderChords(); edCommit();

      }
    }
    function edStartSeqChording() {
      if (edSeqPoints.length === 0) { toast(t('selectPointsFirst')); return; }
      edSeqModeActive = false; $('edSeqToggle').classList.remove('active');
      edSeqChordingActive = true; edSeqCursor = 0;
      edSeqPoints.forEach(sp => { edCur.chords.push({ ...sp, name: '' }); });
      edRenderChords();
      edCommit();

      toast(t('chordingStarted'));
    }
    function edSeqNavigate(dir) {
      if (!edSeqChordingActive) return;
      edSeqCursor = Math.max(0, Math.min(edSeqPoints.length - 1, edSeqCursor + dir));
      edRenderChords();
    }

    if ($('edSeqToggle')) $('edSeqToggle').onclick = edToggleSeqMode;
    if ($('edSeqStart')) $('edSeqStart').onclick = edStartSeqChording;
    if ($('edSeqPrev')) $('edSeqPrev').onclick = () => edSeqNavigate(-1);
    if ($('edSeqNext')) $('edSeqNext').onclick = () => edSeqNavigate(1);

    // ===== Sequential: حالت کورد لاین (نقطه‌گذاری با آهنگ روی تایم لاین) =====
    let edClMode = false, edClTapActive = false, edClMarkers = [];
    function edUpdateClCount() {
      const c = $('edClCount'); if (c) c.textContent = edClMarkers.length ? String(edClMarkers.length) : '';
    }
    function edRenderClMarkers() {
      const lanes = $('lanes-container'); if (!lanes) return;
      let overlay = $('clMarkersOverlay');
      if (!overlay) { overlay = document.createElement('div'); overlay.id = 'clMarkersOverlay'; overlay.className = 'cl-markers-overlay'; lanes.appendChild(overlay); }
      overlay.innerHTML = '';
      if (!edClMarkers.length) { overlay.style.display = 'none'; return; }
      overlay.style.display = '';
      edClMarkers.forEach((m, i) => {
        const mk = document.createElement('div');
        mk.className = 'cl-tap-marker' + (edClTapActive ? ' armed' : '');
        mk.style.left = timeToX(m.time) + 'px';
        const badge = document.createElement('div');
        badge.className = 'cl-tap-badge';
        badge.textContent = i + 1;
        badge.title = 'نقطه ' + (i + 1) + ' — ' + formatTime(m.time) + ' (کلیک = حذف)';
        badge.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); if (i >= 0 && i < edClMarkers.length) { edClMarkers.splice(i, 1); edRenderClMarkers(); edUpdateClCount(); } });
        mk.appendChild(badge); overlay.appendChild(mk);
      });
    }
    function edSetSeqMode(mode) {
      edClMode = (mode === 'chord');
      const ly = $('edSeqModeLyrics'), ch = $('edSeqModeChord');
      if (ly) ly.classList.toggle('active', !edClMode);
      if (ch) ch.classList.toggle('active', edClMode);
      const lt = $('edSeqLyricsTools'), ct = $('edSeqChordTools');
      if (lt) lt.style.display = edClMode ? 'none' : '';
      if (ct) ct.style.display = edClMode ? '' : 'none';
      // هنگام رفتن به کورد لاین، حالت انتخاب نقطه روی متن (لایرس) را ببند
      if (edClMode && edSeqModeActive) edToggleSeqMode();
      if (!edClMode) { edClTapActive = false; const b = $('edClStart'); if (b) b.classList.remove('active'); }
      edRenderClMarkers();
    }
    function edToggleClTap() {
      edClTapActive = !edClTapActive;
      const b = $('edClStart'); if (b) b.classList.toggle('active', edClTapActive);
      edRenderClMarkers(); edUpdateClCount();
      toast(edClTapActive ? 'نقطه‌گذاری کورد لاین فعال شد — آهنگ را پخش کن و هر بار تعویض آکورد، کلید ۰ را بزن' : 'نقطه‌گذاری متوقف شد');
    }
    function edClTap() {
      if (!edClTapActive) { toast('اول روی ⏺ کلیک کن تا نقطه‌گذاری با آهنگ فعال شود'); return; }
      if (!DAW || typeof DAW.playhead !== 'number') return;
      const t = roundMs(Math.max(0, DAW.playhead));
      edClMarkers.push({ time: t });
      ensureTimelineFits(t + 6);
      edRenderClMarkers(); edUpdateClCount();
    }
    function edClUndoMarker() {
      if (!edClMarkers.length) { toast('نقطه‌ای برای حذف نیست'); return; }
      edClMarkers.pop(); edRenderClMarkers(); edUpdateClCount();
    }
    function edClClearMarkers() {
      if (!edClMarkers.length) return;
      edClMarkers = []; edRenderClMarkers(); edUpdateClCount(); toast('همه نقاط پاک شد');
    }
    function edClApplyMarkers() {
      if (!edClMarkers.length) { toast('اول با آهنگ نقطه‌گذاری کن (دکمه ⏺ و کلید ۰)'); return; }
      const lyrics = (edCur?.chords || []).filter(c => c && c.name && String(c.name).trim() !== '');
      if (lyrics.length === 0) { toast('آکوردی در بخش لایرس نیست تا کپی شود'); return; }
      if (lyrics.length !== edClMarkers.length) {
        toast('⚠️ تعداد آکوردهای لایرس (' + lyrics.length + ') با تعداد نقاط تایم‌لاین (' + edClMarkers.length + ') یکی نیست — اول تعداد را برابر کن');
        return;
      }
      const chordTrack = DAW.tracks.find(t => t.type === 'chord');
      if (!chordTrack) { toast('ترک کورد لاین پیدا نشد'); return; }
      // آکوردها در edCur.chords به ترتیب موسیقایی ذخیره شده‌اند (از بیت اول تا آخر)
      // Chord Line فقط جهت نمایش LTR دارد — ترتیب موسیقایی باید حفظ شود
      edClMarkers.forEach((m, i) => {
        DAW.clips.push({ id: uid('c'), type: 'chord', trackId: chordTrack.id, name: lyrics[i].name, start: roundMs(m.time), duration: 2, color: '#9F7AEA' });
      });
      const lastT = edClMarkers[edClMarkers.length - 1].time;
      edClMarkers = []; edClTapActive = false;
      const b = $('edClStart'); if (b) b.classList.remove('active');
      edRenderClMarkers(); edUpdateClCount();
      ensureTimelineFits(lastT + 6);
      saveState(); renderAll(); edSaveSong();
      toast('✔ ' + lyrics.length + ' آکورد لایرس به کورد لاین (تایم‌لاین) کپی شد');
    }
    if ($('edSeqModeLyrics')) $('edSeqModeLyrics').onclick = () => edSetSeqMode('lyrics');
    if ($('edSeqModeChord')) $('edSeqModeChord').onclick = () => edSetSeqMode('chord');
    if ($('edClStart')) $('edClStart').onclick = edToggleClTap;
    if ($('edClUndo')) $('edClUndo').onclick = edClUndoMarker;
    if ($('edClClear')) $('edClClear').onclick = edClClearMarkers;
    if ($('edClApply')) $('edClApply').onclick = edClApplyMarkers;
    edUpdateClCount();

    // Editor click for seq mode point placement
    if ($('editor')) $('editor').addEventListener('click', (e) => {
      if (!edSeqModeActive) return;
      e.preventDefault();
      const sel = window.getSelection(); if (!sel.rangeCount) return;
      const rng = sel.getRangeAt(0);
      const lineEl = rng.startContainer.parentElement?.closest?.('.eline') || (rng.startContainer.classList?.contains('eline') ? rng.startContainer : null);
      if (!lineEl) return;
      const lineIndex = [...$('editor').children].indexOf(lineEl);
      const text = lineEl.textContent.replace(/\u200B/g,'');
      const off = Math.min(rng.startOffset, text.length);
      let anchorType = 'OnCharacter', charIndex = off;
      if (off === 0) anchorType = 'LineStart';
      else if (off >= text.length) anchorType = 'LineEnd';
      edSeqPoints.push({ anchorType, lineIndex, charIndex, name: '' });
      edCur.seqPoints = edSeqPoints; edRenderChords(); edCommit();

    }, true);

    // Wire up sync buttons
    function initSyncUI() {
      if ($('tab-sync')) $('tab-sync').onclick = () => {
        const tab = $('tab-sync');
        if (syncActive) { exitSyncMode(); tab.classList.remove('active-teal'); return; }
        tab.classList.add('active-teal');
        enterSyncMode();
      };
      if ($('syncExitBtn')) $('syncExitBtn').onclick = () => { exitSyncMode(); const tab = $('tab-sync'); if (tab) tab.classList.remove('active-teal'); };
      if ($('syncPlayBtn')) $('syncPlayBtn').onclick = () => {
        if (DAW.isPlaying) { pauseTransport(); $('syncPlayBtn').textContent = t('syncPlay'); } else { startTransport(); $('syncPlayBtn').textContent = t('syncPause'); }
      };
      if ($('syncTapBtn')) $('syncTapBtn').onclick = syncTap;
      if ($('syncMinus')) $('syncMinus').onclick = () => {
        if (!edCur?.syncTimes) return;
        syncHistory.push(JSON.stringify(edCur.syncTimes)); syncRedoHistory = [];
        let t = edCur.syncTimes[syncCursor]; if (!Number.isFinite(t)) t = DAW.playhead;
        edCur.syncTimes[syncCursor] = Math.max(0, t - 0.1); renderSyncLyrics(); edSaveSong();
      };
      if ($('syncPlus')) $('syncPlus').onclick = () => {
        if (!edCur?.syncTimes) return;
        syncHistory.push(JSON.stringify(edCur.syncTimes)); syncRedoHistory = [];
        let t = edCur.syncTimes[syncCursor]; if (!Number.isFinite(t)) t = DAW.playhead;
        edCur.syncTimes[syncCursor] = t + 0.1; renderSyncLyrics(); edSaveSong();
      };
      if ($('syncDelBtn')) $('syncDelBtn').onclick = () => {
        if (!edCur?.syncTimes) return;
        syncHistory.push(JSON.stringify(edCur.syncTimes)); syncRedoHistory = [];
        edCur.syncTimes[syncCursor] = undefined; renderSyncLyrics(); edSaveSong();
      };
      if ($('syncResetBtn')) $('syncResetBtn').onclick = () => {
        if (!confirm('تمام زمان‌های سینک پاک شود؟')) return;
        syncHistory.push(JSON.stringify(edCur?.syncTimes || [])); syncRedoHistory = [];
        edCur.syncTimes = []; syncCursor = 0; renderSyncLyrics(); edSaveSong();
      };
      if ($('syncUndoBtn')) $('syncUndoBtn').onclick = () => {
        if (!syncHistory.length) return;
        syncRedoHistory.push(JSON.stringify(edCur?.syncTimes || []));
        edCur.syncTimes = JSON.parse(syncHistory.pop()); renderSyncLyrics(); edSaveSong();
      };
      if ($('syncRedoBtn')) $('syncRedoBtn').onclick = () => {
        if (!syncRedoHistory.length) return;
        syncHistory.push(JSON.stringify(edCur?.syncTimes || []));
        edCur.syncTimes = JSON.parse(syncRedoHistory.pop()); renderSyncLyrics(); edSaveSong();
      };
      if ($('syncTimeline')) $('syncTimeline').onclick = (e) => {
        const rect = $('syncTimeline').getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        seekTransport(ratio * getProjectEnd(), true);
        updateSyncHighlight();
      };
    }

    /* ===== ARRANGER ===== */
    let arrangers = JSON.parse(localStorage.getItem('arrangers_v1') || '[]');
    window.arrangers = arrangers; // exposed for ProjectHub
    let editingArr = null;

    // ===== Normalize playlist name for comparison (case-insensitive, whitespace-insensitive) =====
    const normalizePlaylistName = (name) =>
      String(name || "")
        .trim()
        .replace(/\s+/g, " ")
        .toLocaleLowerCase("fa-IR");

    // ===== Check if playlist name already exists (excluding optional current id) =====
    function playlistNameExists(name, excludeId = null) {
      const normalizedName = normalizePlaylistName(name);
      return arrangers.some(a => a.id !== excludeId && normalizePlaylistName(a.name) === normalizedName);
    }

    // ===== Arranger Enhanced: Per-song settings =====
    // Each arranger item: { id, transpose: 0, notes: '' }
    // Arranger level: { crossfade: 0, pauseBetween: false }
    function ensureArrItem(arr, idx) {
      if (!arr._itemSettings) arr._itemSettings = {};
      const id = arr.items[idx];
      if (!arr._itemSettings[id]) arr._itemSettings[id] = { transpose: 0, notes: '' };
      return arr._itemSettings[id];
    }
    function getArrItemSetting(arr, songId) {
      if (!arr._itemSettings) return { transpose: 0, notes: '' };
      return arr._itemSettings[songId] || { transpose: 0, notes: '' };
    }

    function saveArrangers() { localStorage.setItem('arrangers_v1', JSON.stringify(arrangers)); }

    function openArrangerModal() {
      $('arrangerModal').classList.add('show');
      renderArrangerManager();
      // اگر ارنجری وجود داره، مستقیم ادیتور رو باز کن
      if (arrangers.length > 0) {
        editingArr = arrangers[0];
        openArrEditor();
      } else {
        $('arrEditor').style.display = 'none';
      }
      // درگ پنل ارنجر
      _setupArrangerModalDrag();
      // اضافه کردن هندلر کیبورد برای دکمه ESC و فوکوس
      const arrModal = $('arrangerModal');
      if (arrModal) {
        arrModal.focus();
        if (!arrModal._escHandler) {
          arrModal._escHandler = (e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              closeArrangerModal();
            }
          };
          arrModal.addEventListener('keydown', arrModal._escHandler);
        }
      }
    }
    function closeArrangerModal() {
      $('arrangerModal').classList.remove('show');
      // ریست موقعیت
      const editor = $('arrangerModal').querySelector('.chord-editor');
      if (editor) { editor.style.left = ''; editor.style.top = ''; }
      editingArr = null;
    }

    // Expose for ProjectHub (Hub arranger track click)
    window.openArrangerModal = openArrangerModal;
    window.closeArrangerModal = closeArrangerModal;

    // درگ arrangerModal
    function _setupArrangerModalDrag() {
      const handle = $('arrModalDragHandle');
      const modal = $('arrangerModal');
      const editor = modal.querySelector('.chord-editor');
      if (!handle || !editor || handle._dragSetup) return;
      handle._dragSetup = true;
      let dragging = false, startX, startY, origX, origY;
      handle.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'H3') {
          if (e.target.tagName === 'H3') {} else return;
        }
        dragging = true;
        const rect = editor.getBoundingClientRect();
        startX = e.clientX; startY = e.clientY;
        origX = rect.left; origY = rect.top;
        e.preventDefault();
      });
      document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        editor.style.left = (origX + e.clientX - startX) + 'px';
        editor.style.top = (origY + e.clientY - startY) + 'px';
      });
      document.addEventListener('mouseup', () => { dragging = false; });
    }

    function renderArrangerManager() {
      const box = $('arrManager'); box.innerHTML = '';

      // ─── هدر بخش پلی‌لیست‌ها ───
      const header = document.createElement('div');
      header.className = 'arr-manager-header';
      header.innerHTML = `
        <div style="display:flex;align-items:center;">
          <h4>📋 پلی‌لیست‌های ذخیره‌شده</h4>
          <span class="arr-count-badge">${arrangers.length}</span>
        </div>
      `;
      box.appendChild(header);

      // ─── نوار ابزار: پلی‌لیست جدید + ایمپورت/اکسپورت ───
      const toolbar = document.createElement('div');
      toolbar.className = 'arr-manager-toolbar';
      toolbar.innerHTML = `
        <button class="arr-btn-new" onclick="createNewArranger()" title="ساخت پلی‌لیست جدید">
          ＋ پلی‌لیست جدید
        </button>
        <div style="display:flex;gap:6px;">
          <button class="arr-btn-import" onclick="importArrangerFromFile()" title="بارگذاری یک پلی‌لیست از فایل JSON">
            📥 ورود یک پلی‌لیست
          </button>
          <button class="arr-btn-import" onclick="importAllPlaylistsFromFile()" title="بارگذاری کامل همه پلی‌لیست‌ها از فایل پشتیبان">
            📥 ورود کامل پلی‌لیست‌ها
          </button>
          <button class="arr-btn-import" onclick="exportAllPlaylistsToFile()" title="خروجی کامل همه پلی‌لیست‌ها در یک فایل" ${arrangers.length === 0 ? 'disabled' : ''}>
            📤 خروجی کامل پلی‌لیست‌ها
          </button>
        </div>
      `;
      box.appendChild(toolbar);

      // ─── حالت خالی ───
      if (!arrangers.length) {
        const empty = document.createElement('div');
        empty.className = 'arr-empty-state';
        empty.innerHTML = `
          <div class="arr-empty-icon">🎼</div>
          <div class="arr-empty-text">هنوز پلی‌لیستی نساخته‌اید.<br>روی «پلی‌لیست جدید» بزنید تا اولین پلی‌لیست رو بسازید.</div>
        `;
        box.appendChild(empty);
        return;
      }

      // ─── لیست کارت‌های پلی‌لیست ───
      arrangers.forEach(arr => {
        const isActive = editingArr && editingArr.id === arr.id;
        const card = document.createElement('div');
        card.className = 'arr-card' + (isActive ? ' arr-card-active' : '');

        // ساخت badge ها برای کراس‌فید و توقف
        const badges = [];
        if (arr.crossfade) badges.push(`<span class="arr-badge badge-crossfade">🔄 کراس‌فید: ${arr.crossfade}s</span>`);
        if (arr.pauseBetween) badges.push(`<span class="arr-badge badge-pause">⏸ توقف بین آهنگ‌ها</span>`);

        card.innerHTML = `
          <div class="meta">
            <b>${arr.name || t('untitled')}</b>
            <span>${arr.items.length} ${t('songN')}</span>
            ${badges.length ? `<div class="arr-card-badges">${badges.join('')}</div>` : ''}
          </div>
          <div class="acts">
            <button data-a="edit" title="ویرایش">✏️ ویرایش</button>
            <button data-a="export" class="act-export" title="خروجی به فایل">📤</button>
            <button data-a="del" class="act-del" title="حذف">🗑</button>
          </div>
        `;

        card.onclick = (e) => {
          const a = e.target.dataset.a;
          if (!a) {
            // کلیک روی کارت = ویرایش
            editingArr = arr;
            openArrEditor();
            return;
          }
          if (a === 'del') {
            if (confirm(`حذف پلی‌لیست «${arr.name || t('untitled')}»؟`)) {
              arrangers = arrangers.filter(x => x.id !== arr.id);
              saveArrangers();
              if (editingArr && editingArr.id === arr.id) {
                editingArr = null;
                $('arrEditor').style.display = 'none';
              }
              renderArrangerManager();
              toast('🗑 پلی‌لیست حذف شد');
            }
          } else if (a === 'edit') {
            editingArr = arr;
            openArrEditor();
          } else if (a === 'export') {
            exportArranger(arr);
          }
        };
        box.appendChild(card);
      });
    }

    // Send current song to Arranger Track
    function sendCurrentSongToArranger() {
      if (!edCur) { toast('ترانه‌ای باز نیست'); return; }
      // Save current song to archive first
      edSaveToArchive().then(() => {
        // If no arrangers exist, create one
        if (!arrangers.length) {
          const arr = { id: Date.now(), name: 'پلی‌لیست جدید', items: [], crossfade: 0, pauseBetween: false };
          arrangers.unshift(arr);
          editingArr = arr;
        } else {
          // Use first arranger or last edited one
          editingArr = arrangers[0];
        }
        // Add current song to arranger if not already there
        if (!editingArr.items.includes(edCur.id)) {
          editingArr.items.push(edCur.id);
        }
        saveArrangers();
        // Open arranger editor
        openArrangerModal();
        toast('ترانه به پلی‌لیست اضافه شد');
      });
    }

    async function createNewArranger() {
      const name = await customPrompt('نام پلی‌لیست جدید:', 'پلی‌لیست ' + (arrangers.length + 1));
      if (name === null) return; // کاربر کنسل کرد
      const trimmedName = name.trim() || ('پلی‌لیست ' + (arrangers.length + 1));

      // ─── بررسی نام تکراری با مقایسه normalize شده ───
      if (playlistNameExists(trimmedName)) {
        toast(`⚠ پلی‌لیستی با نام «${trimmedName}» از قبل وجود دارد. نام دیگری انتخاب کنید.`);
        return createNewArranger(); // دوباره بپرس
      }

      const arr = { 
        id: 'playlist_' + Date.now(), 
        name: trimmedName, 
        items: [], 
        crossfade: 0, 
        pauseBetween: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      arrangers.unshift(arr);
      saveArrangers();
      editingArr = arr;
      renderArrangerManager(); // اول لیست پلی‌لیست‌ها رو refresh کن
      openArrEditor();          // بعد ادیتور رو باز کن
      toast(`✅ پلی‌لیست «${arr.name}» ساخته شد`);
    }

    // Expose for ProjectHub (Hub "➕ جدید" button)
    window.createNewArranger = createNewArranger;

    function openArrEditor() {
      if (!editingArr) return;
      // ابتدا style های قدیمی رو پاک کن
      const arrManager = $('arrManager');
      arrManager.style.maxHeight = '';
      arrManager.style.borderBottom = '';
      arrManager.style.paddingBottom = '';
      arrManager.style.marginBottom = '';

      // ادیتور رو نمایش بده
      const arrEditor = $('arrEditor');
      arrEditor.style.display = 'block';

      // اطمینان از اینکه پنجره ارنجر هم نمایش داده شده
      const modal = $('arrangerModal');
      if (modal && !modal.classList.contains('show')) {
        modal.classList.add('show');
      }

      $('arrName').value = editingArr.name || '';
      // Sync crossfade/pause controls
      if (editingArr.crossfade) {
        $('arrCrossfadeRange').value = editingArr.crossfade;
        $('arrCrossfadeVal').textContent = editingArr.crossfade + 's';
      } else {
        $('arrCrossfadeRange').value = '0';
        $('arrCrossfadeVal').textContent = '0s';
      }
      if (editingArr.pauseBetween) $('arrPauseBtn').classList.add('arr-stl-active');
      else $('arrPauseBtn').classList.remove('arr-stl-active');
      renderArrPool(); renderArrSetlist();
      // Reset to editor tab
      switchArrTab('editor');
      // Highlight active arranger card
      renderArrangerManager();
      console.log(`[Arranger] Editor opened for: "${editingArr.name}"`);
    }

    function switchArrTab(tab) {
      document.querySelectorAll('.arr-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
      $('arrTabEditor').style.display = tab === 'editor' ? '' : 'none';
      $('arrTabSongs').style.display = tab === 'songs' ? '' : 'none';
      if (tab === 'songs') renderArrSongsList();
    }

    function renderArrSongsList() {
      const box = $('arrSongsList');
      if (!editingArr || !editingArr.items.length) {
        box.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-secondary);">ترانه‌ای در این ارنجر وجود ندارد</div>';
        return;
      }
      const allSongs = edGetAllSongs();
      let html = '';
      editingArr.items.forEach((songId, idx) => {
        const song = allSongs.find(s => s.id === songId);
        if (!song) return;
        const setting = getArrItemSetting(editingArr, songId);
        const key = song.key || '';
        const rhythm = song.rhythm || '';
        const transpose = setting.transpose ? (setting.transpose > 0 ? '+' + setting.transpose : setting.transpose) : '0';
        html += `<div class="arr-song-card">
          <div class="song-header">
            <div class="song-num">${idx + 1}</div>
            <div class="song-title">${song.title || 'بدون عنوان'}</div>
          </div>
          <div class="song-meta">
            ${song.artist ? '<span>🎤 ' + song.artist + '</span>' : ''}
            ${key ? '<span>🎵 گام: ' + key + '</span>' : ''}
            ${rhythm ? '<span>🥁 ریتم: ' + rhythm + '</span>' : ''}
            <span>♯ تغییر گام: ${transpose}</span>
          </div>
          ${setting.notes ? '<div style="margin-top:6px;font-size:0.8rem;color:var(--accent-cyan-glow);">📝 ' + setting.notes + '</div>' : ''}
        </div>`;
      });
      box.innerHTML = html;
    }
    function closeArrEditor() {
      saveArrangers();
      $('arrEditor').style.display = 'none';
      editingArr = null;
      renderArrangerManager();
    }

    /**
     * saveCurrentArranger — ذخیره پلی‌لیست فعلی
     * نام پلی‌لیست رو از input می‌خونه، در localStorage ذخیره می‌کنه،
     * و لیست پلی‌لیست‌ها رو refresh می‌کنه.
     * اگر نام تکراری باشه، خطا میده.
     */
    function saveCurrentArranger() {
      if (!editingArr) {
        toast('⚠ هیچ پلی‌لیستی در حال ویرایش نیست');
        return;
      }
      const nameInput = $('arrName');
      let newName = nameInput ? nameInput.value.trim() : '';
      if (!newName) newName = 'پلی‌لیست بدون نام';

      // ─── بررسی نام تکراری با مقایسه normalize شده (به‌جز خود پلی‌لیست فعلی) ───
      if (playlistNameExists(newName, editingArr.id)) {
        toast(`⚠ پلی‌لیستی با نام «${newName}» از قبل وجود دارد.`);
        return;
      }

      editingArr.name = newName;
      editingArr.updatedAt = new Date().toISOString();

      // ذخیره crossfade فعلی
      const cfRange = $('arrCrossfadeRange');
      if (cfRange) editingArr.crossfade = parseFloat(cfRange.value) || 0;

      saveArrangers();
      renderArrangerManager();
      toast(`✅ پلی‌لیست «${editingArr.name}» ذخیره شد (${editingArr.items.length} آهنگ)`);
    }

    // Debounced save for playlist name input
    let _saveNameDebounceTimer = null;
    function saveCurrentArrangerDebounced() {
      if (_saveNameDebounceTimer) clearTimeout(_saveNameDebounceTimer);
      _saveNameDebounceTimer = setTimeout(() => {
        saveCurrentArranger();
      }, 500);
    }

    /**
     * exportCurrentArranger — اکسپورت پلی‌لیست فعلی به فایل JSON
     */
    function exportCurrentArranger() {
      if (!editingArr) {
        toast('⚠ هیچ پلی‌لیستی در حال ویرایش نیست');
        return;
      }
      // اول پلی‌لیست رو ذخیره کن
      saveCurrentArranger();
      exportArranger(editingArr);
    }

    /**
     * exportArranger — اکسپورت یک پلی‌لیست مشخص به فایل JSON
     * @param {Object} arr - پلی‌لیست برای اکسپورت
     */
    async function exportArranger(arr) {
      if (!arr) { toast('⚠ پلی‌لیست نامعتبر'); return; }

      const allSongs = edGetAllSongs();
      const songData = {};
      arr.items.forEach(id => {
        const song = allSongs.find(s => s.id === id);
        if (song) songData[id] = song;
      });

      const exportData = {
        type: 'akordyar-playlist',
        version: '1.0',
        name: arr.name || 'پلی‌لیست',
        items: arr.items,
        crossfade: arr.crossfade || 0,
        pauseBetween: !!arr.pauseBetween,
        _itemSettings: arr._itemSettings || {},
        songs: songData,
        exportDate: new Date().toISOString()
      };

      const fileName = (arr.name || 'playlist').replace(/[\/\\:*?"<>|]/g, '_') + '.json';

      if (window.showSaveFilePicker) {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: fileName,
            types: [{ description: 'JSON Playlist', accept: { 'application/json': ['.json'] } }]
          });
          const writable = await handle.createWritable();
          await writable.write(JSON.stringify(exportData, null, 2));
          await writable.close();
          toast(`✅ اکسپورت شد: ${fileName}`);
        } catch (e) {
          if (e.name !== 'AbortError') toast('خطا در اکسپورت: ' + e.message);
        }
      } else {
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = fileName; a.click();
        URL.revokeObjectURL(url);
        toast(`✅ اکسپورت شد: ${fileName}`);
      }
    }

    /**
     * importArrangerFromFile — بارگذاری پلی‌لیست از فایل JSON
     * اگر پلی‌لیستی با همان نام وجود داشته باشد، خطا می‌دهد.
     */
    async function importArrangerFromFile() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          const data = JSON.parse(text);

          // بررسی فرمت
          if (!data || (!data.items && !data.songs)) {
            toast('❌ فایل معتبر نیست — فرمت پلی‌لیست نیست');
            return;
          }

          // بررسی نسخه فایل
          const supportedVersions = [1, '1.0', 2, '2.0'];
          if (data.version && !supportedVersions.includes(data.version)) {
            toast(`❌ نسخه فایل (${data.version}) پشتیبانی نمی‌شود.`);
            return;
          }

          // خواندن و اعتبارسنجی نام پلی‌لیست
          let baseName = data.name || file.name.replace(/\.json$/i, '');
          if (!baseName || !baseName.trim()) {
            toast('❌ نام پلی‌لیست در فایل خالی است.');
            return;
          }
          baseName = baseName.trim();

          // ─── بررسی نام تکراری با مقایسه normalize شده ───
          if (playlistNameExists(baseName)) {
            toast(`⚠ پلی‌لیستی با نام «${baseName}» از قبل وجود دارد.\nبرای ورود این فایل، ابتدا نام پلی‌لیست را در فایل خروجی یا در پروژه‌ی مبدا تغییر دهید.`);
            return;
          }

          // اعتبارسنجی items
          if (!Array.isArray(data.items)) {
            toast('❌ آرایه‌ی items در فایل معتبر نیست.');
            return;
          }

          // بررسی songId برای هر آیتم
          for (let i = 0; i < data.items.length; i++) {
            const item = data.items[i];
            // آیتم می‌تونه هم رشته/عدد (songId مستقیم) باشه هم آبجکت با خاصیت songId
            const songId = (item && typeof item === 'object') ? item.songId : item;
            if (!songId) {
              toast(`❌ آیتم شماره ${i + 1} فاقد songId معتبر است.`);
              return;
            }
          }

          // اگر آهنگ‌ها داخل فایل هستن، اول اونا رو به آرشیو اضافه کن
          let importedSongsCount = 0;
          if (data.songs && typeof data.songs === 'object') {
            const allSongs = edGetAllSongs();
            for (const [id, song] of Object.entries(data.songs)) {
              if (song && song.title) {
                if (!allSongs.find(s => s.id === id)) {
                  allSongs.push(song);
                  importedSongsCount++;
                }
              }
            }
            if (importedSongsCount > 0) {
              edSetAllSongs(allSongs);
              console.log(`[Import] ${importedSongsCount} song(s) imported from playlist`);
            }
          }

          // ساخت پلی‌لیست جدید با ساختار استاندارد
          const newArr = {
            id: 'playlist_' + Date.now(),
            name: baseName,
            items: Array.isArray(data.items) ? data.items.map(it => (it && typeof it === 'object') ? it.songId : it) : [],
            crossfade: data.crossfade || 0,
            pauseBetween: !!data.pauseBetween,
            _itemSettings: data._itemSettings || {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };

          arrangers.unshift(newArr);
          saveArrangers();
          editingArr = newArr;
          renderArrangerManager();
          openArrEditor();

          toast(`✅ پلی‌لیست «${newArr.name}» بارگذاری شد (${newArr.items.length} آهنگ${importedSongsCount > 0 ? `، ${importedSongsCount} آهنگ جدید` : ''})`);
        } catch (e) {
          console.error('[Import] Error:', e);
          toast('❌ خطا در بارگذاری فایل: ' + e.message);
        }
      };
      input.click();
    }

    // Crossfade control
    function arrSetCrossfade(val) {
      if (editingArr) { editingArr.crossfade = val; saveArrangers(); }
      $('arrCrossfadeVal').textContent = val + 's';
    }

    // Pause between songs toggle
    function arrTogglePauseBetween() {
      if (!editingArr) return;
      editingArr.pauseBetween = !editingArr.pauseBetween;
      $('arrPauseBtn').classList.toggle('arr-stl-active', editingArr.pauseBetween);
      saveArrangers();
    }

    // Auto transpose all songs
    async function arrAutoTranspose() {
      if (!editingArr) return;
      const val = await customPrompt('تغییر گام برای همه آهنگ‌ها (مثلاً 2 یا -3):', '0');
      if (val === null) return;
      const semi = parseInt(val);
      if (isNaN(semi)) return;
      const allSongs = edGetAllSongs();
      editingArr.items.forEach(id => {
        const setting = ensureArrItem(editingArr, editingArr.items.indexOf(id));
        setting.transpose = (setting.transpose || 0) + semi;
      });
      saveArrangers(); renderArrSetlist();
    }

    // Clear all notes
    function arrClearNotes() {
      if (!editingArr || !confirm('یادداشت‌های همه آهنگ‌ها پاک شود؟')) return;
      editingArr.items.forEach(id => {
        const setting = ensureArrItem(editingArr, editingArr.items.indexOf(id));
        setting.notes = '';
      });
      saveArrangers(); renderArrSetlist();
    }

    // Song Note Modal
    let _arrNoteIdx = -1;
    function arrFilterSongs() {
      renderArrPool();
      renderArrSetlist();
    }
    function openArrSongNote(idx) {
      _arrNoteIdx = idx;
      const allSongs = edGetAllSongs();
      const id = editingArr.items[idx];
      const song = allSongs.find(x => x.id === id);
      const setting = ensureArrItem(editingArr, idx);
      $('arrSongNoteTitle').textContent = (song ? (song.title || 'بدون نام') : '') + ' — یادداشت اجرا';
      $('arrSongNoteText').value = setting.notes || '';
      $('arrSongNoteOverlay').classList.add('show');
    }
    function closeArrSongNote() {
      $('arrSongNoteOverlay').classList.remove('show');
      _arrNoteIdx = -1;
    }
    function saveArrSongNote() {
      if (_arrNoteIdx < 0 || !editingArr) return;
      const setting = ensureArrItem(editingArr, _arrNoteIdx);
      setting.notes = $('arrSongNoteText').value;
      saveArrangers(); closeArrSongNote(); renderArrSetlist();
    }

    function renderArrPool() {
      const box = $('arrPool'); box.innerHTML = '';
      const allSongs = edGetAllSongs();
      const inList = new Set(editingArr.items);
      let avail = allSongs.filter(s => !inList.has(s.id));
      const query = ($('arrSearchInput')?.value || '').trim().toLowerCase();
      if (query) {
        avail = avail.filter(s => {
          const matchText = ((s.title || '') + ' ' + (s.artist || '') + ' ' + (s.key || '') + ' ' + (s.genre || '')).toLowerCase();
          return matchText.includes(query);
        });
      }
      if (!avail.length) { box.innerHTML = `<div style="padding:14px;color:var(--text-secondary);font-size:13px;">${query ? 'نتیجه‌ای یافت نشد' : t('allInSetlist')}</div>`; return; }
      avail.forEach(s => {
        const it = document.createElement('div'); it.className = 'arr-item';
        it.innerHTML = `<span class="ai-title">${s.title || t('untitled')}<small>${s.artist || '—'}</small></span><button>＋</button>`;
        it.onclick = () => { editingArr.items.push(s.id); saveArrangers(); renderArrPool(); renderArrSetlist(); };
        box.appendChild(it);
      });
    }

    // ===== Arranger Setlist Management =====
    let _arrDragIndex = null; // Persist drag index across render calls

    function renderArrSetlist() {
      const box = $('arrSetlist'); box.innerHTML = '';
      if (!editingArr.items.length) { box.innerHTML = `<div style="padding:14px;color:var(--text-secondary);font-size:13px;">${t('addFromLeft')}</div>`; return; }
      const allSongs = edGetAllSongs();
      const query = ($('arrSearchInput')?.value || '').trim().toLowerCase();
      
      editingArr.items.forEach((id, i) => {
        const s = allSongs.find(x => x.id === id); if (!s) return;
        // Live filtering
        if (query) {
          const matchText = ((s.title || '') + ' ' + (s.artist || '') + ' ' + (s.key || '') + ' ' + (s.genre || '')).toLowerCase();
          if (!matchText.includes(query)) return;
        }
        const setting = ensureArrItem(editingArr, i);
        const transVal = setting.transpose || 0;
        const transSign = transVal > 0 ? '+' + transVal : String(transVal);
        const hasNotes = !!(setting.notes && setting.notes.trim());
        const it = document.createElement('div'); it.className = 'arr-item'; it.draggable = true; it.dataset.i = i;
        it.innerHTML = `
          <div class="arr-item-controls">
            <button data-a="up" title="بالا">↑</button>
            <button data-a="down" title="پایین">↓</button>
            <span class="arr-item-number">${i + 1}</span>
          </div>
          <div class="arr-item-info" draggable="true">
            <span class="ai-title">${s.title || t('untitled')}</span>
            <small>${s.artist || '—'}</small>
          </div>
          <div class="ai-ctrls">
            <button class="ai-trans-btn" data-a="trans-down" title="بمل">♭</button>
            <span class="ai-trans-val">${transSign}</span>
            <button class="ai-trans-btn" data-a="trans-up" title="دیز">♯</button>
            <button class="ai-notes-btn ${hasNotes ? 'has-notes' : ''}" data-a="notes" title="یادداشت اجرا">📝</button>
            <button data-a="del" title="حذف">✕</button>
          </div>`;
        it.onclick = (e) => {
          const btn = e.target.closest('[data-a]');
          if (!btn) return;
          const a = btn.dataset.a;
          if (a === 'up' && i > 0) { [editingArr.items[i - 1], editingArr.items[i]] = [editingArr.items[i], editingArr.items[i - 1]]; }
          else if (a === 'down' && i < editingArr.items.length - 1) { [editingArr.items[i + 1], editingArr.items[i]] = [editingArr.items[i], editingArr.items[i + 1]]; }
          else if (a === 'del') { editingArr.items.splice(i, 1); }
          else if (a === 'trans-up') { setting.transpose = (setting.transpose || 0) + 1; }
          else if (a === 'trans-down') { setting.transpose = (setting.transpose || 0) - 1; }
          else if (a === 'notes') { openArrSongNote(i); return; }
          else return;
          saveArrangers(); renderArrSetlist();
        };
        it.addEventListener('dragstart', () => { _arrDragIndex = i; it.style.opacity = '.4'; });
        it.addEventListener('dragover', e => { e.preventDefault(); it.classList.add('dragover'); });
        it.addEventListener('dragleave', () => it.classList.remove('dragover'));
        it.addEventListener('drop', e => {
          e.preventDefault(); it.classList.remove('dragover');
          if (_arrDragIndex === null || _arrDragIndex === i) return;
          const moved = editingArr.items.splice(_arrDragIndex, 1)[0];
          editingArr.items.splice(i, 0, moved);
          saveArrangers(); renderArrSetlist(); _arrDragIndex = null;
        });
        it.addEventListener('dragend', () => { it.style.opacity = ''; });
        box.appendChild(it);
      });
    }

    // ===== Performance Mode (Live Dashboard) =====
    let arrPerformIdx = -1, arrPerformActive = false, arrPerformData = null, arrPreparePending = false;
    let _arrNextState = null;
    let _arrHasLoggedNoNextSong = false; // جلوگیری از تکرار لاگ "No more songs"
    let _arrPrepStartedForIndex = -1;    // جلوگیری از تکرار لاگ "Starting prep"
    let perfModeActive = false;
    let perfStageMode = false;
    let perfPauseMode = false;
    let perfLiveTranspose = 0;
    let perfTimer = null, perfStartTime = 0;

    // Crossfade state
    let _arrCrossfadeGain = null;
    let _arrIsCrossfading = false;

    // ─── Background Preload State ───
    // برای preload همه آهنگ‌های ارنجر در پس‌زمینه
    let _bgPreloadActive = false;
    let _bgPreloadedSongIds = new Set(); // آهنگ‌هایی که preload شد

    // ─── Wait Poll State ───
    // وقتی آهنگ فعلی تموم می‌شه ولی prep آهنگ بعدی هنوز انجام نشده،
    // این فلگ فعال می‌شه و یک poll مستقل از tick، منتظر اتمام prep می‌مونه
    let _arrWaitPollActive = false;

    async function openPerfMode() {
      if (!editingArr || !editingArr.items.length) { toast(t('emptySetlist')); return; }
      arrPerformData = editingArr;
      arrPerformIdx = 0;
      arrPerformActive = true;
      perfModeActive = true;
      perfLiveTranspose = 0;
      perfPauseMode = !!editingArr.pauseBetween;
      _arrNextState = null;

      const panel = $('arrPerfOverlay');
      panel.style.display = 'flex';
      $('perfArrangerName').textContent = '🎤 ' + (editingArr.name || 'اجرا');
      $('perfPauseModeBtn').classList.toggle('arr-stl-active', perfPauseMode);

      // درگ پنل
      _setupPerfPanelDrag(panel);

      closeArrangerModal();
      renderPerfUI();
      await loadArrSong(0);
      renderPerfUI();
      startPerfTimer();

      // ─── Background preload همه آهنگ‌های ارنجر ───
      // این کار تضمین می‌کنه که وقتی به آهنگ بعدی می‌رسیم، صدا از قبل لود شده.
      // preload به‌صورت غیرمسدودکننده در پس‌زمینه انجام می‌شه.
      _startBackgroundPreload();

      // باز کردن Player View و Singer View مثل F9
      if (typeof openLyricOnlyPopup === 'function') openLyricOnlyPopup();
      if (typeof openLyricPopup === 'function') setTimeout(openLyricPopup, 300);
    }

    // درگ پنل اجرا
    function _setupPerfPanelDrag(panel) {
      const handle = $('arrPerfDragHandle');
      if (!handle || handle._dragSetup) return;
      handle._dragSetup = true;
      let dragging = false, startX, startY, origX, origY;
      handle.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        dragging = true;
        const rect = panel.getBoundingClientRect();
        startX = e.clientX; startY = e.clientY;
        origX = rect.left; origY = rect.top;
        e.preventDefault();
      });
      document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        panel.style.left = (origX + e.clientX - startX) + 'px';
        panel.style.top = (origY + e.clientY - startY) + 'px';
        panel.style.right = 'auto';
      });
      document.addEventListener('mouseup', () => { dragging = false; });
    }

    function perfStop() {
      arrPerformActive = false;
      perfModeActive = false;
      _arrNextState = null;
      _bgPreloadActive = false; // توقف background preload
      _arrWaitPollActive = false; // توقف wait poll
      arrPreparePending = false; // reset prep flag
      _arrHasLoggedNoNextSong = false; // reset no-next-song log flag
      _arrPrepStartedForIndex = -1;    // reset prep log flag
      pauseTransport();
      $('arrPerfOverlay').style.display = 'none';
      stopPerfTimer();
    }

    /**
     * _startBackgroundPreload — preload تمام آهنگ‌های ارنجر در پس‌زمینه
     *
     * این تابع بلافاصله بعد از openPerfMode صدا زده می‌شه و تمام آهنگ‌های
     * ست‌لیست رو به‌صورت یکی‌یکی preload می‌کنه. این کار تضمین می‌کنه که
     * وقتی به آهنگ بعدی می‌رسیم، بافر صوتی از قبل در DAW.bufferCache هست.
     *
     * مهم: این تابع غیرمسدودکننده هست و نباید پخش فعلی رو مختل کنه.
     */
    function _startBackgroundPreload() {
      if (_bgPreloadActive) return;
      if (!arrPerformData || !arrPerformData.items.length) return;

      _bgPreloadActive = true;
      _bgPreloadedSongIds = new Set();

      const allSongs = edGetAllSongs();
      const songsToPreload = arrPerformData.items
        .map(id => allSongs.find(s => s.id === id))
        .filter(s => s); // فیلتر null ها

      console.log(`[BG Preload] Starting background preload for ${songsToPreload.length} songs`);

      // اجرای preload به‌صورت زنجیره‌ای (یکی‌یکی، نه موازی) برای جلوگیری از overload
      (async () => {
        for (let i = 0; i < songsToPreload.length; i++) {
          if (!_bgPreloadActive) {
            console.log('[BG Preload] Cancelled');
            return;
          }
          const song = songsToPreload[i];
          if (_bgPreloadedSongIds.has(song.id)) continue;

          try {
            // اگه آهنگ فعلی داره پخش می‌شه و نزدیک انتها هست، اولویت با prepareNextArrSong باشه
            // اینجا فقط preload می‌کنیم اگه bufferCache نداشته باشیم
            const hasAudioClips = song._dawClips && song._dawClips.some(c => c.type !== 'chord' && c.bufferKey);
            if (!hasAudioClips) {
              _bgPreloadedSongIds.add(song.id);
              continue;
            }

            // چک کن: آیا همه بافرها از قبل لود شدن؟
            const allLoaded = song._dawClips.every(c =>
              c.type === 'chord' || !c.bufferKey || DAW.bufferCache.has(c.bufferKey)
            );
            if (allLoaded) {
              _bgPreloadedSongIds.add(song.id);
              continue;
            }

            console.log(`[BG Preload] (${i + 1}/${songsToPreload.length}) Preloading: "${song.title || song.id}"`);
            await preloadAudioForSong(song);
            _bgPreloadedSongIds.add(song.id);

            // یک وقفه کوتاه بین هر آهنگ برای اجازه دادن به playback tick
            await new Promise(r => setTimeout(r, 50));
          } catch (e) {
            console.warn(`[BG Preload] Error preloading "${song.title}":`, e);
            _bgPreloadedSongIds.add(song.id); // علامت‌گذاری به‌عنوان پردازش‌شده برای جلوگیری از loop بی‌نهایت
          }
        }
        console.log('[BG Preload] Complete');
        _bgPreloadActive = false;
      })();
    }

    function perfTogglePauseMode() {
      document.activeElement?.blur();
      perfPauseMode = !perfPauseMode;
      $('perfPauseModeBtn').classList.toggle('arr-stl-active', perfPauseMode);
    }

    function perfTogglePlay() {
      document.activeElement?.blur();
      if (DAW.isPlaying) {
        pauseTransport();
        $('perfPlayBtn').textContent = '▶';
      } else {
        ensureAudioCtx();
        if (DAW.playhead <= 0) seekTransport(0, false);
        startTransport();
        $('perfPlayBtn').textContent = '⏸';
      }
    }

    function perfRestartSong() {
      document.activeElement?.blur();
      seekTransport(0, false);
      ensureAudioCtx();
      startTransport();
      $('perfPlayBtn').textContent = '⏸';
    }

    function perfPrevSong() {
      document.activeElement?.blur();
      if (arrPerformIdx > 0) {
        arrPerformActive = true;
        loadArrSong(arrPerformIdx - 1);
        renderPerfUI();
      }
    }

    function perfNextSong() {
      document.activeElement?.blur();
      if (arrPerformData && arrPerformIdx < arrPerformData.items.length - 1) {
        arrPerformActive = true;
        loadArrSong(arrPerformIdx + 1);
        renderPerfUI();
      }
    }

    // Per-song transpose during performance
    function perfTranspose(semi) {
      document.activeElement?.blur();
      if (!arrPerformData) return;
      const setting = ensureArrItem(arrPerformData, arrPerformIdx);
      setting.transpose = (setting.transpose || 0) + semi;
      // Apply transpose to all audio tracks
      DAW.tracks.forEach(t => {
        if (t.type === 'audio') {
          t.transpose = (t.transpose || 0) + semi;
        }
      });
      if (DAW.isPlaying) scheduleAllFromPlayhead();
      saveArrangers();
      perfLiveTranspose += semi;
      renderPerfUI();
    }

    // Tempo change during performance
    function perfTempoChange(delta) {
      const cur = parseInt($('edTempo')?.value) || 120;
      const newVal = clamp(cur + delta, 20, 300);
      $('edTempo').value = newVal;
      if (edCur) { edCur.tempo = newVal; edSaveSong(); }
      renderPerfUI();
    }

    // Jump to specific song from performance sidebar
    function perfJumpToSong(idx) {
      if (idx < 0 || !arrPerformData || idx >= arrPerformData.items.length) return;
      arrPerformActive = true;
      loadArrSong(idx);
      renderPerfUI();
    }

    // Render performance mode UI
    function renderPerfUI() {
      if (!perfModeActive || !arrPerformData) return;
      const arr = arrPerformData;
      const allSongs = edGetAllSongs();

      // Current song info
      const songId = arr.items[arrPerformIdx];
      const song = allSongs.find(s => s.id === songId);
      const setting = getArrItemSetting(arr, songId);

      $('perfSongNum').textContent = `${arrPerformIdx + 1} / ${arr.items.length}`;
      $('perfSongTitle').textContent = song ? (song.title || 'بدون نام') : '—';
      $('perfSongArtist').textContent = song ? (song.artist || '') : '';
      const keyName = song?.key || edCur?.key || 'C';
      const keyMode = song?.keyMode || edCur?.keyMode || 'maj';
      const transVal = setting.transpose || 0;
      $('perfSongKey').innerHTML = `${keyName} ${keyMode === 'maj' ? 'ماژور' : 'مینور'} ${transVal ? `<span class="perf-trans">(${transVal > 0 ? '+' : ''}${transVal})</span>` : ''}`;
      $('perfTransVal').textContent = transVal > 0 ? '+' + transVal : String(transVal);
      if ($('perfTempoVal')) $('perfTempoVal').textContent = edCur?.tempo || 120;

      // Render setlist
      const setlistEl = $('perfSetlist');
      if (!setlistEl) return;
      setlistEl.innerHTML = '';
      
      let draggedIndex = -1;
      
      arr.items.forEach((id, i) => {
        const s = allSongs.find(x => x.id === id);
        const st = getArrItemSetting(arr, id);
        const div = document.createElement('div');
        div.className = 'arr-perf-setlist-item' + (i === arrPerformIdx ? ' pf-current' : '') + (i === arrPerformIdx + 1 ? ' pf-next' : '') + (i < arrPerformIdx ? ' pf-done' : '');
        div.draggable = true;
        div.innerHTML = `<span class="pf-num">${i + 1}</span><span class="pf-name">${s ? (s.title || 'بدون نام') : '—'}</span><span class="pf-key">${s?.key || '—'}${st.transpose ? (st.transpose > 0 ? '+' : '') + st.transpose : ''}</span>`;
        
        // Click to jump
        div.onclick = () => perfJumpToSong(i);
        
        // Drag events
        div.addEventListener('dragstart', (e) => {
          draggedIndex = i;
          div.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(i));
        });
        
        div.addEventListener('dragend', () => {
          draggedIndex = -1;
          div.classList.remove('dragging');
          // Remove all drag-over styles
          Array.from(setlistEl.children).forEach(child => {
            child.classList.remove('drag-over-top', 'drag-over-bottom');
            child.style.borderTop = '';
            child.style.borderBottom = '';
          });
        });
        
        div.addEventListener('dragover', (e) => {
          e.preventDefault();
          if (draggedIndex === -1 || draggedIndex === i) return;
          
          const rect = div.getBoundingClientRect();
          const midpoint = rect.top + rect.height / 2;
          
          // Remove old classes
          Array.from(setlistEl.children).forEach(child => {
            child.classList.remove('drag-over-top', 'drag-over-bottom');
            child.style.borderTop = '';
            child.style.borderBottom = '';
          });
          
          if (e.clientY < midpoint) {
            div.classList.add('drag-over-top');
            div.style.borderTop = '2px solid var(--accent-teal)';
          } else {
            div.classList.add('drag-over-bottom');
            div.style.borderBottom = '2px solid var(--accent-teal)';
          }
        });
        
        div.addEventListener('dragleave', () => {
          div.classList.remove('drag-over-top', 'drag-over-bottom');
          div.style.borderTop = '';
          div.style.borderBottom = '';
        });
        
        div.addEventListener('drop', (e) => {
          e.preventDefault();
          if (draggedIndex === -1 || draggedIndex === i) return;
          
          const rect = div.getBoundingClientRect();
          const midpoint = rect.top + rect.height / 2;
          let dropIndex = i;
          
          // Determine insert position
          if (e.clientY < midpoint) {
            dropIndex = i;
          } else {
            dropIndex = i + 1;
          }
          
          // Adjust if dragging from before the drop position
          if (draggedIndex < dropIndex) {
            dropIndex--;
          }
          
          // Reorder the array
          if (draggedIndex !== dropIndex) {
            const movedItem = arr.items.splice(draggedIndex, 1)[0];
            arr.items.splice(dropIndex, 0, movedItem);
            
            // Save updated playlist
            saveArrangers();
            
            // Re-render to reflect changes
            renderPerfPanel();
          }
          
          // Cleanup
          draggedIndex = -1;
          div.classList.remove('drag-over-top', 'drag-over-bottom');
          div.style.borderTop = '';
          div.style.borderBottom = '';
        });
        
        setlistEl.appendChild(div);
      });

      // Render section navigation buttons
      const secNav = $('perfSectionNav');
      secNav.innerHTML = '';
      const sections = ['مقدمه', 'ورس', 'کورس', 'بریج', 'آوترو'];
      const sectionTimes = [0]; // at least start
      if (DAW.sections && DAW.sections.length) {
        DAW.sections.forEach(s => sectionTimes.push(s.start));
      }
      // Add end
      sectionTimes.push(getArrangerEnd());
      sections.forEach((name, i) => {
        if (i < sectionTimes.length - 1 || i === 0) {
          const btn = document.createElement('button');
          btn.textContent = name;
          btn.onclick = () => {
            if (i < sectionTimes.length) {
              seekTransport(sectionTimes[i], false);
              if (!DAW.isPlaying) { ensureAudioCtx(); startTransport(); $('perfPlayBtn').textContent = '⏸'; }
            }
          };
          secNav.appendChild(btn);
        }
      });

      // Show notes if any
      const noteBadge = $('perfNoteBadge');
      if (setting.notes && setting.notes.trim()) {
        $('perfNoteText').textContent = setting.notes;
        noteBadge.classList.add('show');
      } else {
        noteBadge.classList.remove('show');
      }

      // Scroll to current in sidebar
      const currentItem = setlistEl.querySelector('.pf-current');
      if (currentItem) currentItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Timer for performance
    function startPerfTimer() {
      stopPerfTimer();
      perfStartTime = Date.now();
      perfTimer = setInterval(() => {
        if (!perfModeActive) return;
        const elapsed = Date.now() - perfStartTime;
        const min = Math.floor(elapsed / 60000);
        const sec = Math.floor((elapsed % 60000) / 1000);
        $('perfTime').textContent = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
      }, 1000);
    }
    function stopPerfTimer() {
      if (perfTimer) { clearInterval(perfTimer); perfTimer = null; }
    }

    // Override startArrangerPerform to use new perf mode
    async function startArrangerPerform() {
      await openPerfMode();
    }

    // Pre-build the next song's full DAW state while current plays
    // این تابع حالا با try/catch/finally کامل نوشته شده تا arrPreparePending
    // هرگز گیر نکنه. اگه خطایی رخ بده، retry می‌کنه.
    async function prepareNextArrSong(retryCount = 0) {
      const arr = arrPerformData || editingArr;
      const nextIdx = arrPerformIdx + 1;

      // اگر آهنگ بعدی وجود نداره، _arrNextState رو null کن
      if (!arr || nextIdx >= arr.items.length) {
        _arrNextState = null;
        // فقط یک‌بار لاگ بزن
        if (!_arrHasLoggedNoNextSong) {
          _arrHasLoggedNoNextSong = true;
          console.log('[Arranger Prep] No more songs — _arrNextState cleared');
        }
        return;
      }

      const allSongs = edGetAllSongs();
      const song = allSongs.find(s => s.id === arr.items[nextIdx]);
      if (!song) {
        _arrNextState = null;
        console.warn(`[Arranger Prep] Song at index ${nextIdx} not found in archive (id: ${arr.items[nextIdx]})`);
        return;
      }

      try {
        const songData = JSON.parse(JSON.stringify(song));
        if (!songData.styles) songData.styles = {};
        const defaults = { tSize:23,tColor:'#0fa966',tFont:'Vazirmatn',tBold:true,align:'center',cSize:23,cColor:'#e6aa28',cFont:'JetBrains Mono' };
        Object.keys(defaults).forEach(k => { if (songData.styles[k] === undefined) songData.styles[k] = defaults[k]; });

        // ─── Pre-load کامل صدا برای آهنگ بعدی ───
        const preloadResult = await preloadAudioForSong(songData);
        if (preloadResult.missing > 0) {
          console.warn(`[Arranger Prep] ${preloadResult.missing} audio clip(s) missing for "${songData.title}":`, preloadResult.missingNames);
        } else {
          console.log(`[Arranger Prep] ✓ Audio ready for "${songData.title}" (loaded: ${preloadResult.loaded})`);
        }

        const tracks = songData._dawTracks ? JSON.parse(JSON.stringify(songData._dawTracks)) : [];
        let clips = songData._dawClips ? JSON.parse(JSON.stringify(songData._dawClips)) : [];
        let sections = songData._dawSections ? JSON.parse(JSON.stringify(songData._dawSections)) : [];
        const oldSec = clips.filter(c => c.type === 'section');
        if (oldSec.length) { oldSec.forEach(c => { sections.push({ id: c.id, trackId: c.trackId, label: c.name, start: c.start, duration: c.duration, color: c.color }); }); clips = clips.filter(c => c.type !== 'section'); }

        const loopState = songData._dawLoop ? { loopEnabled: !!songData._dawLoop.loopEnabled, loopA: songData._dawLoop.loopA || 0, loopB: songData._dawLoop.loopB || 10 } : { loopEnabled: false, loopA: 0, loopB: 10 };
        const selEnd = (loopState.loopA < loopState.loopB) ? loopState.loopB : 0;

        // آپدیت sourceDuration و peaks برای کلیپ‌های که لود شدن
        clips.forEach(c => { if (c.type !== 'chord' && c.bufferKey && DAW.bufferCache.has(c.bufferKey)) { const buffer = DAW.bufferCache.get(c.bufferKey); c.sourceDuration = buffer.duration; c._peaks = peaksFromBuffer(buffer, 2000); } });

        // Apply per-song transpose to tracks
        const nextSetting = getArrItemSetting(arr, arr.items[nextIdx]);
        if (nextSetting.transpose) {
          tracks.forEach(t => { if (t.type === 'audio') t.transpose = (t.transpose || 0) + nextSetting.transpose; });
        }

        _arrNextState = { song: songData, idx: nextIdx, clips, sections, tracks, edCur: songData, selectionEnd: selEnd, loopState };
        console.log(`[Arranger Prep] ✓ _arrNextState ready for song ${nextIdx + 1}: "${songData.title}"`);
        
        // ─── تأیید نهایی: مطمئن شو همه بافرهای مورد نیاز واقعاً لود شدن ───
        const audioClipsInNext = clips.filter(c => c.type !== 'chord' && c.bufferKey);
        const missingBuffers = audioClipsInNext.filter(c => !DAW.bufferCache.has(c.bufferKey));
        if (missingBuffers.length > 0) {
          console.warn(`[Arranger Prep] ⚠ ${missingBuffers.length} buffer(s) still missing after prep:`, missingBuffers.map(c => c.fileName || c.bufferKey));
          // تلاش مجدد برای لود بافرهای گمشده
          await restoreAudioForProjectSilently(songData.id, true);
          console.log(`[Arranger Prep] ✓ Retry complete - buffers rechecked`);
        }
      } catch (e) {
        console.error(`[Arranger Prep] Error preparing song ${nextIdx + 1} (retry ${retryCount}):`, e);
        _arrNextState = null;

        // Retry mechanism: حداکثر ۲ بار با وقفه ۱ ثانیه
        if (retryCount < 2 && arrPerformActive) {
          console.log(`[Arranger Prep] Retrying in 1s... (attempt ${retryCount + 1}/2)`);
          await new Promise(r => setTimeout(r, 1000));
          if (arrPerformActive && arrPerformIdx === nextIdx - 1) {
            return prepareNextArrSong(retryCount + 1);
          }
        }
      }
    }

    // Crossfade between songs — نسخه بهبودیافته با overlap واقعی
    //
    // استراتژی:
    //   1. صدای آهنگ فعلی رو از طریق masterGain fade-out می‌کنیم
    //   2. همزمان hot-swap می‌کنیم و آهنگ جدید رو schedule می‌کنیم
    //   3. masterGain رو fade-in می‌کنیم
    //
    // این روش یک "gapless crossfade" ایجاد می‌کنه: در طول fadeTime،
    // صدای قدیمی fade-out و صدای جدید fade-in می‌شه. در نقطه میانی،
    // هر دو آهنگ در حال پخش هستن (overlap).
    function arrCrossfadeSwap() {
      const crossfadeDur = arrPerformData?.crossfade || 0;
      if (crossfadeDur <= 0 || !_arrNextState) { hotSwapToNextSong(); return; }

      _arrIsCrossfading = true;
      ensureAudioCtx();
      const ctx = DAW.audioCtx;
      const curGain = DAW.masterGain;
      const now = ctx.currentTime;
      const fadeTime = Math.min(Math.max(crossfadeDur, 0.5), 5); // بین 0.5 تا 5 ثانیه

      console.log(`[Arranger Crossfade] Starting ${fadeTime}s crossfade`);

      // ─── مرحله 1: fade-out صدای فعلی ───
      const currentVolume = curGain.gain.value;
      curGain.gain.cancelScheduledValues(now);
      curGain.gain.setValueAtTime(currentVolume, now);
      curGain.gain.linearRampToValueAtTime(0, now + fadeTime * 0.5);

      // ─── مرحله 2: در نیمه راه، hot-swap کن ───
      // در این نقطه، masterGain صفر هست، پس swap بی‌صدا انجام می‌شه
      setTimeout(() => {
        try {
          // قبل از swap، صدای فعلی رو کامل قطع کن
          stopAllVoices();

          // hot-swap به آهنگ جدید
          hotSwapToNextSong();

          // حالا masterGain رو از 0 به 1 fade-in کن
          const fadeInNow = ctx.currentTime;
          curGain.gain.cancelScheduledValues(fadeInNow);
          curGain.gain.setValueAtTime(0, fadeInNow);
          curGain.gain.linearRampToValueAtTime(currentVolume, fadeInNow + fadeTime * 0.5);

          console.log('[Arranger Crossfade] Fade-in started');
        } catch(e) {
          console.error('[Arranger Crossfade] Error during swap:', e);
        } finally {
          _arrIsCrossfading = false;
        }
      }, fadeTime * 500); // نصف fadeTime به میلی‌ثانیه
    }
// ==========================================
// PART 4: Timeline Rendering & UI Event Listeners
// ==========================================

/**
 * رندر کردن ظاهر تراک‌ها روی تایم‌لاین
 */
function renderTimeline() {
  const container = document.getElementById('timeline-tracks-container');
  if (!container) return;
  container.innerHTML = '';

  DAW.tracks.forEach(track => {
    const trackEl = document.createElement('div');
    trackEl.className = 'track-row';
    trackEl.innerHTML = `
      <div class="track-header">${track.name}</div>
      <div class="track-content"></div>
    `;
    container.appendChild(trackEl);
  });
}

// اتصال رویدادهای اولیه صفحه پس از بارگذاری DOM
document.addEventListener('DOMContentLoaded', () => {
  const audioInput = document.getElementById('audio-file-input');
  if (audioInput) {
    audioInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const copy = confirm("آیا می‌خواهید فایل صوتی در پوشه پروژه کپی شود؟");
        handleAudioImport(file, copy);
      }
    });
  }
});

    /**
     * همگام‌سازی UI بعد از تغییر آهنگ — فراخوانی مشترک بین loadArrSong و hotSwapToNextSong
     */
    // تابع ایمن برای کپی آکوردها از تایم‌لاین به پلیر
    function syncUIAfterSongChange() {
      if (typeof rebuildSongDocumentFromEdCur === 'function') rebuildSongDocumentFromEdCur();
      if (_lyricPopup && !_lyricPopup.closed) {
        try {
          const _script = _lyricPopup.document.querySelector('script[data-pv="chord"]');
          if (_script) _script.remove();
        } catch(_) {}
        setTimeout(() => { try { syncLyricPopup(); } catch(_) {} }, 50);
        setTimeout(() => { try { syncLyricPopup(); } catch(_) {} }, 300);
        setTimeout(() => { try { safeMirrorTimeline(); } catch(_) {} }, 1000);
      }
      if (_lyricOnlyPopup && !_lyricOnlyPopup.closed) {
        setTimeout(() => { try { syncLyricOnlyPopup(); } catch(_) {} }, 50);
        setTimeout(() => { try { syncLyricOnlyPopup(); } catch(_) {} }, 300);
      }
      if (typeof _forceRenderOpenPopupsFull === 'function') _forceRenderOpenPopupsFull();
      notifyPerformanceTrackChanged();
    }

    // Instant hot-swap: apply pre-built state without any async work
    function hotSwapToNextSong() {
      if (!_arrNextState) return false;
      const ns = _arrNextState;
      _arrNextState = null;
      arrPerformIdx = ns.idx;

      // ─── Reset prep log flags after successful swap ───
      _arrHasLoggedNoNextSong = false;
      _arrPrepStartedForIndex = -1;

      console.log(`[Arranger] Hot-swapping to song ${ns.idx + 1}: "${ns.song?.title || 'Untitled'}"`);

      stopAllVoices();

      // ─── پاک‌سازی نودهای صوتی ترک‌های قدیمی ───
      // این نودها هنوز به masterGain وصلی هستن و باید قطع بشن تا bleed صدا نداشته باشیم
      DAW.tracks.forEach(tr => {
        if (tr._gainNode) { try { tr._gainNode.disconnect(); } catch(_){} tr._gainNode = null; }
        if (tr._pannerNode) { try { tr._pannerNode.disconnect(); } catch(_){} tr._pannerNode = null; }
      });

      DAW.clips = ns.clips;
      DAW.sections = ns.sections;
      DAW.tracks = ns.tracks;
      updateNextIdFromClips();
      DAW.selectedIds.clear(); DAW.selectedSectionIds = new Set();
      DAW.loopEnabled = ns.loopState.loopEnabled;
      DAW.loopA = ns.loopState.loopA;
      DAW.loopB = ns.loopState.loopB;
      selectionEnd = ns.selectionEnd;
      isRecordingChords = false; currentRecordingClipId = null;

      edCur = ns.edCur;

      ensureAudioCtx();
      // ساخت نودهای صوتی جدید برای ترک‌های آهنگ جدید
      DAW.tracks.forEach(tr => {
        if (tr.type === 'audio') {
          if (tr.transpose === undefined) tr.transpose = 0;
          tr._pannerNode = DAW.audioCtx.createStereoPanner();
          tr._gainNode = DAW.audioCtx.createGain();
          tr._pannerNode.connect(tr._gainNode);
          tr._gainNode.connect(DAW.masterGain);
          updateTrackMix(tr.id);
        }
      });

      // بررسی: آیا بافرهای صوتی بارگذاری شدن؟
      const audioClips = DAW.clips.filter(c => c.type !== 'chord' && c.bufferKey);
      const loadedClips = audioClips.filter(c => DAW.bufferCache.has(c.bufferKey));
      const missingClips = audioClips.filter(c => !DAW.bufferCache.has(c.bufferKey));
      console.log(`[Arranger] Audio clips: ${loadedClips.length}/${audioClips.length} loaded` + (missingClips.length > 0 ? `, ${missingClips.length} missing: ${missingClips.map(c=>c.fileName||c.bufferKey).join(', ')}` : ''));

      DAW.playhead = 0;
      DAW.playOriginPerf = performance.now();
      DAW.playOriginTime = 0;
      scheduleAllFromPlayhead();

      undoStack = []; undoIndex = -1; PERF.lastSerializedState = '';
      edSyncToolbar(); edRenderEditor(true); renderAll(); saveState();
      initHighlightEffect();

      // Update perf UI
      renderPerfUI();

      toast(`${t('songN')} ${ns.idx + 1}/${(arrPerformData||editingArr).items.length}: ${ns.song.title || t('untitled')}`);

      // If pause mode, stop playback and wait for manual next
      if (perfPauseMode) {
        pauseTransport();
        $('perfPlayBtn').textContent = '▶';
      }

      // Check if we should auto-advance after crossfade
      if (arrPerformActive && ns.idx + 1 < (arrPerformData||editingArr).items.length) prepareNextArrSong();
      // Sync popup windows, SongDocument, and embedded view
      syncUIAfterSongChange();
      // آینه آکوردها در پاپ‌آپ
      setTimeout(safeMirrorTimeline, 1000);

      return true;
    }

    /**
     * بعد از هر تعویض ترک/آهنگ صدا زده شود.
     * rebuild + full render embedded + popupها
     */
    function notifyPerformanceTrackChanged() {
      requestAnimationFrame(function () {
        if (typeof window.onPerformanceSongChanged === 'function') {
          window.onPerformanceSongChanged();
        } else if (typeof rebuildSongDocumentFromEdCur === 'function') {
          if (typeof rebuildSongDocumentFromEdCur === 'function') rebuildSongDocumentFromEdCur();
        }
      });
    }

    async function loadArrSong(idx) {
      const arr = arrPerformData || editingArr;
      if (!arr || idx >= arr.items.length) { arrPerformActive = false; _arrNextState = null; toast(t('arrangerFinished')); return; }
      arrPerformIdx = idx;

      // ─── Reset prep state ───
      // وقتی کاربر دستی آهنگی رو انتخاب می‌کنه، state های prep قبلی رو پاک کن
      _arrNextState = null;
      arrPreparePending = false;
      _arrWaitPollActive = false;
      _arrHasLoggedNoNextSong = false; // reset no-next-song log flag
      _arrPrepStartedForIndex = -1;    // reset prep log flag

      const allSongs = edGetAllSongs();
      const song = allSongs.find(s => s.id === arr.items[idx]);
      if (!song) { await loadArrSong(idx + 1); return; }

      console.log(`[Arranger] loadArrSong(${idx}): "${song.title}"`);

      pauseTransport(); stopAllVoices();
      DAW.clips = []; DAW.sections = []; DAW.selectedIds.clear(); DAW.selectedSectionIds = new Set();

      // ─── مهم: bufferCache رو پاک نکن! ───
      // قبلاً اینجا DAW.bufferCache.clear() بود که همه بافرهای preload شده رو پاک می‌کرد.
      // این باعث می‌شد هر بار که آهنگ لود می‌شه، همه فایل‌ها دوباره از اول لود بشن.
      // به‌جاش، فقط waveCache (تصاویر waveform) رو پاک می‌کنیم که اون هم بعداً rebuild می‌شه.
      DAW.waveCache.clear();

      DAW.loopEnabled = false; DAW.loopA = 0; DAW.loopB = 10;
      selectionEnd = 0;
      isRecordingChords = false; currentRecordingClipId = null;

      edCur = JSON.parse(JSON.stringify(song));
      // اگر lyrics خالیه ولی rawText داریم، parse کن
      if (typeof ensureSongParsed === 'function') ensureSongParsed(edCur);
      if (!edCur.styles) edCur.styles = {};
      const defaults = { tSize:23,tColor:'#0fa966',tFont:'Vazirmatn',tBold:true,align:'center',cSize:23,cColor:'#e6aa28',cFont:'JetBrains Mono' };
      Object.keys(defaults).forEach(k => { if (edCur.styles[k] === undefined) edCur.styles[k] = defaults[k]; });

      if (edCur._dawTracks) DAW.tracks = JSON.parse(JSON.stringify(edCur._dawTracks));
      if (edCur._dawClips) DAW.clips = JSON.parse(JSON.stringify(edCur._dawClips));
      if (edCur._dawSections) DAW.sections = JSON.parse(JSON.stringify(edCur._dawSections)); else DAW.sections = [];
      updateNextIdFromClips();
      const _oldSec = DAW.clips.filter(c => c.type === 'section');
      if (_oldSec.length) { _oldSec.forEach(c => { DAW.sections.push({ id: c.id, trackId: c.trackId, label: c.name, start: c.start, duration: c.duration, color: c.color }); }); DAW.clips = DAW.clips.filter(c => c.type !== 'section'); }
      if (edCur._dawLoop) { DAW.loopEnabled = !!edCur._dawLoop.loopEnabled; DAW.loopA = edCur._dawLoop.loopA || 0; DAW.loopB = edCur._dawLoop.loopB || 10; }
      selectionEnd = (DAW.loopA < DAW.loopB) ? DAW.loopB : 0;

      // Apply per-song transpose
      const setting = getArrItemSetting(arr, song.id);
      if (setting.transpose) {
        DAW.tracks.forEach(t => { if (t.type === 'audio') t.transpose = (t.transpose || 0) + setting.transpose; });
      }

      // ─── پاک‌سازی نودهای صوتی قدیمی قبل از ساخت نودهای جدید ───
      DAW.tracks.forEach(tr => {
        if (tr._gainNode) { try { tr._gainNode.disconnect(); } catch(_){} tr._gainNode = null; }
        if (tr._pannerNode) { try { tr._pannerNode.disconnect(); } catch(_){} tr._pannerNode = null; }
      });

      ensureAudioCtx();
      DAW.tracks.forEach(t => { if (t.type === 'audio') { if (t.transpose === undefined) t.transpose = 0; t._pannerNode = DAW.audioCtx.createStereoPanner(); t._gainNode = DAW.audioCtx.createGain(); t._pannerNode.connect(t._gainNode); t._gainNode.connect(DAW.masterGain); updateTrackMix(t.id); } });

      // لود کامل صدا از تمام منابع (IndexedDB، filePath، FileHandle، dirHandle)
      // این خط قبلاً فقط loadAudioBlobsForProject رو صدا می‌زد و فایل‌های linked لود نمی‌شدن
      try {
        const restoreResult = await restoreAudioForProjectSilently(edCur.id, true);
        if (restoreResult.missing > 0) {
          console.warn(`[Arranger] ${restoreResult.missing} audio clip(s) could not be loaded:`, restoreResult.missingNames);
          toast(`⚠ ${restoreResult.missing} فایل صوتی پیدا نشد — ${restoreResult.missingNames.slice(0, 2).join(', ')}${restoreResult.missingNames.length > 2 ? '...' : ''}`);
        } else {
          console.log(`[Arranger] ✓ Audio loaded for "${song.title}" (${restoreResult.loaded} clips)`);
        }
      } catch(e) {
        console.warn('Audio load error:', e);
        toast('⚠ خطا در لود فایل صوتی');
      }

      undoStack = []; undoIndex = -1; PERF.lastSerializedState = '';
      edSyncToolbar(); edRenderEditor(true); renderAll(); saveState();
      initHighlightEffect();
      // Sync popup windows, SongDocument, and embedded view
      syncUIAfterSongChange();

      toast(`${t('songN')} ${idx + 1}/${arr.items.length}: ${song.title || t('untitled')}`);
      seekTransport(0, false);
      ensureAudioCtx();
      if (arrPerformActive && !DAW.isPlaying && !perfPauseMode) startTransport();
      if (arrPerformActive && idx + 1 < arr.items.length) {
        // ─── شروع prep آهنگ بعدی با delay کوتاه ───
        // تا playback فعلی شروع بشه و بعد prep شروع شه
        setTimeout(() => {
          if (arrPerformActive && arrPerformIdx === idx && !_arrNextState && !arrPreparePending) {
            arrPreparePending = true;
            prepareNextArrSong()
              .then(() => { arrPreparePending = false; })
              .catch((e) => { console.error('[Arranger] Prep after loadArrSong failed:', e); arrPreparePending = false; });
          }
        }, 500);
      }

      // Update perf UI
      if (perfModeActive) renderPerfUI();
      // آینه آکوردها در پاپ‌آپ
      setTimeout(safeMirrorTimeline, 1000);
    }

    function setZoom(pps, anchorClientX) {
      const scroll = $('tl-scroll'); const oldPps = DAW.pxPerSecond; const newPps = clamp(pps, 5, 260);
      if (Math.abs(newPps - oldPps) < 0.01) return;
      let anchorTime = DAW.playhead; if (typeof anchorClientX === 'number') anchorTime = clientToTime(anchorClientX);
      const rel = timeToX(anchorTime) - scroll.scrollLeft; DAW.pxPerSecond = newPps; $('zoom-range').value = String(Math.round(newPps));
      // خودکار بزرگ کردن تایم‌لاین بر اساس عرض صفحه نمایش
      const visibleTime = scroll.clientWidth / newPps;
      ensureTimelineFits(visibleTime + 10);
      DAW.clips.forEach(c => refreshClipWaveImage(c)); renderAll(); scroll.scrollLeft = Math.max(0, timeToX(anchorTime) - rel);
      updateZoomFontScale();
    }

    function setVerticalZoom(newH) {
      newH = clamp(Math.round(newH), 24, 200);
      if (Math.abs(newH - DAW.laneHeight) < 1) return;
      DAW.laneHeight = newH;
      document.documentElement.style.setProperty('--lane-h', newH + 'px');
      // Reset all per-lane heights to follow global zoom
      DAW.tracks.forEach(t => { t.laneHeight = null; });
      document.querySelectorAll('.track-lane').forEach(el => { el.style.removeProperty('--lane-h'); el.style.removeProperty('height'); });
      document.querySelectorAll('.track-name').forEach(el => { el.style.removeProperty('--lane-h'); el.style.removeProperty('height'); });
      document.querySelectorAll('.lane-grid').forEach(c => drawLaneGrid(c));
      updateZoomFontScale();
    }

    // Unified font scaling for chord clips and section tags
    function updateZoomFontScale() {
      const BASE_FONT = 16; // 1rem in px
      const DEFAULT_PPS = 70;
      const DEFAULT_LANE_H = 64;
      const vScale = DAW.laneHeight / DEFAULT_LANE_H;
      const hScale = DAW.pxPerSecond / DEFAULT_PPS;
      const combined = Math.sqrt(vScale * hScale);
      const scaled = clamp(BASE_FONT * combined, 10, 32);
      document.documentElement.style.setProperty('--zoom-font', scaled + 'px');
    }

    function setLaneHeight(trackId, newH) {
      newH = clamp(Math.round(newH), 24, 200);
      const track = DAW.tracks.find(t => t.id === trackId);
      if (!track) return;
      track.laneHeight = newH;
      const lane = document.querySelector(`.track-lane[data-track-id="${trackId}"]`);
      const name = document.querySelector(`.track-name[data-track-id="${trackId}"]`);
      if (lane) { lane.style.setProperty('--lane-h', newH + 'px'); lane.style.height = newH + 'px'; drawLaneGrid(lane.querySelector('.lane-grid')); }
      if (name) { name.style.setProperty('--lane-h', newH + 'px'); name.style.height = newH + 'px'; }
    }

    /* ===== CHORD EDITOR & MIDI ===== */
    function buildChordEditor() {
      const fillCol = (colId, arr, key) => {
        const col = $(colId); col.innerHTML = '';
        arr.forEach(val => {
          const div = document.createElement('div');
          div.className = 'chord-item' + (currentChord[key] === val ? ' active' : '');
          div.textContent = val === '' || val === 'None' ? 'None' : val;
          div.onclick = () => { currentChord[key] = val; col.querySelectorAll('.chord-item').forEach(d => d.classList.remove('active')); div.classList.add('active'); updateChordPreview(); };
          col.appendChild(div);
        });
      };
      fillCol('col-root', ROOT_NOTES, 'root'); fillCol('col-type', CHORD_TYPES, 'type');
      fillCol('col-tension', TENSIONS, 'tension'); fillCol('col-bass', BASS_NOTES, 'bass');
      buildPiano(); updateChordPreview();
    }

    function buildPiano() {
      const piano = $('piano-keys'); piano.innerHTML = '';
      const whiteNotes = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
      const blackNotes = { 'C#': 0, 'D#': 1, 'F#': 3, 'G#': 4, 'A#': 5 };
      for (let oct = 4; oct <= 5; oct++) {
        whiteNotes.forEach(n => { const key = document.createElement('div'); key.className = 'white-key'; key.dataset.note = n + oct; key.textContent = n + oct; piano.appendChild(key); });
      }
      const whiteWidth = 100 / 14;
      for (let oct = 4; oct <= 5; oct++) {
        let pos = (oct - 4) * 7;
        for (const [n, idx] of Object.entries(blackNotes)) {
          const key = document.createElement('div'); key.className = 'black-key'; key.dataset.note = n + oct; key.textContent = n + oct;
          key.style.left = `calc(${(pos + idx + 1) * whiteWidth}% - 12px)`; piano.appendChild(key);
        }
      }
    }

    function updateChordPreview() {
      const { root, type, tension, bass } = currentChord;
      let name = 'None';
      if (root !== 'None' && type !== 'None') {
        name = `${root}${chordTypeDisplay(type)}${tension}${bass !== 'None' && bass !== root ? '/' + bass : ''}`;
      }
      $('chord-preview').textContent = name;
      if ($('chordManual')) $('chordManual').value = name === 'None' ? '' : name;

      document.querySelectorAll('.piano-keyboard .white-key, .piano-keyboard .black-key').forEach(k => k.classList.remove('active'));
      if (name === '') return;

      const rootIdx = NOTE_SEMITONE[root] != null ? NOTE_SEMITONE[root] : NOTES.indexOf(root);
      const intervals = [...(CHORD_INTERVALS[type] || []), ...(TENSION_INTERVALS[tension] || [])];
      intervals.forEach(i => {
        const noteIdx = (rootIdx + i) % 12; const noteName = NOTES[noteIdx];
        const keyEl4 = document.querySelector(`.piano-keyboard [data-note="${noteName}4"]`);
        const keyEl5 = document.querySelector(`.piano-keyboard [data-note="${noteName}5"]`);
        if (keyEl4) keyEl4.classList.add('active');
        if (keyEl5) keyEl5.classList.add('active');
      });
      if (bass !== 'None' && bass !== root) {
        const bassSharp = NOTE_TO_SHARP[bass] || bass;
        const bassEl4 = document.querySelector(`.piano-keyboard [data-note="${bassSharp}4"]`);
        const bassEl5 = document.querySelector(`.piano-keyboard [data-note="${bassSharp}5"]`);
        if (bassEl4) bassEl4.classList.add('active');
        if (bassEl5) bassEl5.classList.add('active');
      }
    }

    function openChordEditor(clipId = null) {
      DAW.editingChordClipId = clipId;
      edChordModalMode = null;
      if (clipId) {
        const clip = getClip(clipId);
        const m = clip.name.match(/^([A-G][#b]?)(maj|m(?:in)?|dim|aug|sus2|sus4)?(M7|7|9|b9|#9|11|#11|13|6)?(?:\/([A-G][#b]?))?$/);
        if (m) { let tp = m[2] || 'None'; if (tp === 'm') tp = 'min'; currentChord = { root: m[1] || 'None', type: tp, tension: m[3] || '', bass: m[4] || 'None' }; }
        else currentChord = { root: 'None', type: 'None', tension: '', bass: 'None' };
      } else {
        currentChord = { root: 'None', type: 'None', tension: '', bass: 'None' };
      }
      $('chordModalTitle').textContent = t('chordEditor');
      $('chordModalConfirmBtn').textContent = t('placeOnTimeline');
      $('chord-modal').classList.add('show'); buildChordEditor();
      // اضافه کردن هندلر کیبورد برای دکمه ESC
      const chordModal = $('chord-modal');
      if (chordModal) {
        // حذف هندلر قبلی اگر وجود دارد
        if (chordModal._escHandler) chordModal.removeEventListener('keydown', chordModal._escHandler);
        chordModal._escHandler = (e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            closeChordEditor();
          }
        };
        chordModal.addEventListener('keydown', chordModal._escHandler);
        // فوکوس روی مودال برای اینکه ESC بدون کلیک کار کند
        chordModal.focus();
      }
    }

    function closeChordEditor() {
      $('chord-modal').classList.remove('show');
      DAW.editingChordClipId = null;
      if (edChordModalMode === 'editor') { edChordModalMode = null; edChordIdx = null; edPendingAnchor = null; }
    }

    // Unified chord modal confirm/delete — dispatches based on mode
    function chordModalConfirm() {
      if (edChordModalMode === 'editor') { edConfirmChord(); }
      else { placeChordOnTimeline(); }
    }
    function chordModalDelete() {
      if (edChordModalMode === 'editor') { edDeleteChord(); }
      else {
        if (DAW.editingChordClipId) {
          const c = getClip(DAW.editingChordClipId);
          if (c) { c.name = ''; renderClips(); saveState(); }
        }
        closeChordEditor();
      }
    }

    function placeChordOnTimeline() {
      // اگر کاربر نامی دستی تایپ کرده، از آن استفاده کن (هماهنگ با ویرایشگر آکورد)
      let name = ($('chordManual')?.value || '').trim();
      if (name) {
        name = name.replace(/^([A-G][#b]?)maj$/, '$1');
        name = name.replace(/^([A-G][#b]?)min/i, '$1m');
      } else {
        const { root, type, tension, bass } = currentChord;
        if (root === 'None' || type === 'None') {
            toast(t('selectCompleteChord'));
            return;
        }
        name = `${root}${chordTypeDisplay(type)}${tension}${bass !== 'None' && bass !== root ? '/' + bass : ''}`;
      }
      if (DAW.editingChordClipId) {
        const clip = getClip(DAW.editingChordClipId);
        if (clip) { clip.name = name; DAW.editingChordClipId = null; saveState(); renderAll(); closeChordEditor(); toast(`${t('chordEditedTo')} ${name}`); return; }
      }
      // Check if we're placing from Alt+Click on chord track (use mouse position)
      let targetTime = DAW.playhead;
      if (window._tempChordTrackAnchor && window._tempChordTrack) {
        targetTime = window._tempChordTrackAnchor.time;
        // Clean up temp variables to prevent interference with future clicks
        delete window._tempChordTrackAnchor;
        delete window._tempChordTrack;
      }
      const chordTrack = DAW.tracks.find(t => t.type === 'chord'); if (!chordTrack) return;
      const clip = { id: uid('c'), type: 'chord', trackId: chordTrack.id, name, start: roundMs(targetTime), duration: 4, color: '#9F7AEA' };
      DAW.clips.push(clip); DAW.selectedIds = new Set([clip.id]); saveState(); ensureTimelineFits(clip.start + clip.duration + 5);
      renderAll(); closeChordEditor(); toast(`${t('chordPlaced')} ${name}`);
      edSaveSong();
    }

    function toggleMIDITab() {
      toggleTab('tab-midi'); const tab = $('tab-midi');
      if (tab.classList.contains('active-pink')) {
        if (navigator.requestMIDIAccess) {
          navigator.requestMIDIAccess().then(function(ma) {
            midiAccess = ma;
            midiAccess.inputs.forEach(input => input.onmidimessage = handleMIDIMessage);
            toast('MIDI وصل شد - پیام‌ها دریافت میشه');
            if (!midiSyncActive) {
              midiSyncActive = true;
              $('tab-midi-sync').classList.add('active-pink');
              $('midiSyncLabel').textContent = 'ON';
              toast('همگام‌سازی خودکار فعال شد');
            }
          }).catch(function(e) { console.error('MIDI Error:', e); toast('خطا در اتصال MIDI: ' + (e.message || e)); });
        } else { toast('MIDI پشتیبانی نمیشه (HTTPS لازمه)'); }
      } else {
        if (midiAccess) { midiAccess.inputs.forEach(input => input.onmidimessage = null); }
        midiSyncActive = false;
        $('tab-midi-sync')?.classList.remove('active-pink');
        if ($('midiSyncLabel')) $('midiSyncLabel').textContent = 'OFF';
        toast('MIDI قطع شد');
      }
    }

    function identifyChord(midiNotes) {
      if (midiNotes.length < 3) return null; 
      const sorted = [...midiNotes].sort((a, b) => a - b);
      const bassMidi = sorted[0];
      const bassNote = NOTES[bassMidi % 12];

      const uniqueMidiNotes = [...new Set(sorted)];
      
      for (const rootMidi of uniqueMidiNotes) {
        const intervals = uniqueMidiNotes.map(n => n - rootMidi).filter(i => i >= 0).sort((a, b) => a - b);
        const uniqueIntervals = [...new Set(intervals)];

        for (const tmpl of CHORD_TEMPLATES) {
          const req = tmpl.req;
          const hasAll = req.every(r => uniqueIntervals.includes(r));
          if (hasAll) {
            const rootName = NOTES[rootMidi % 12];
            return { root: rootName, type: tmpl.type, tension: tmpl.tension, bass: (bassMidi % 12 === rootMidi % 12) ? 'None' : bassNote };
          }
        }
      }
      return null;
    }

    // ===== MIDI TRANSPORT SYNC =====
    let midiClockRunning = false;
    let midiSyncActive = false;
    let lastClockTime = 0;
    let clockCount = 0;
    let clockDetectTimer = null;
    let clockIntervals = [];
    let midiSyncStartTime = 0;
    let midiSyncBPM = 0;

    function handleMIDIMessage(e) {
      const [status] = e.data;

      // Log ALL messages to monitor first
      updateMidiMonitor(e.data);
      updateMidiStatusDot();

      // MIDI Start (0xFA)
      if (status === 0xFA) {
        midiClockRunning = true;
        if (midiSyncActive) {
          seekTransport(0, false);
          if (!DAW.isPlaying) startTransport();
        }
        return;
      }
      // MIDI Stop (0xFC)
      if (status === 0xFC) {
        midiClockRunning = false;
        if (midiSyncActive && DAW.isPlaying) {
          pauseTransport();
        }
        return;
      }
      // MIDI Continue (0xFB)
      if (status === 0xFB) {
        midiClockRunning = true;
        if (midiSyncActive && !DAW.isPlaying) {
          startTransport();
        }
        return;
      }
      // MIDI Clock (0xF8)
      if (status === 0xF8) {
        if (midiSyncActive) {
          const now = performance.now();

          if (!midiClockRunning) {
            // شروع پخش
            midiClockRunning = true;
            clockIntervals = [];
            clockCount = 0;
            midiSyncStartTime = now;
            if (!DAW.isPlaying) {
              seekTransport(0, false);
              startTransport();
            }
          }

          // محاسبه تمپو از فاصله بین پالس‌ها
          // MIDI Clock = 24 pulses per beat
          // BPM = 60 / (interval_per_beat)
          // interval_per_beat = avg_interval * 24
          if (lastClockTime > 0) {
            const interval = now - lastClockTime;
            if (interval > 5 && interval < 100) { // فقط فاصله‌های معقول
              clockIntervals.push(interval);
              if (clockIntervals.length > 48) clockIntervals.shift(); // حداکثر ۴۸ پالس آخر

              // محاسبه میانگین فاصله
              if (clockCount % 24 === 0 && clockIntervals.length >= 12) {
                const avgInterval = clockIntervals.reduce((a, b) => a + b, 0) / clockIntervals.length;
                const beatInterval = avgInterval * 24; // فاصله هر بیت
                const newBPM = Math.round(60000 / beatInterval);

                // فقط اگه تمپو تغییر کرده، آپدیت کن
                if (newBPM >= 20 && newBPM <= 300 && newBPM !== midiSyncBPM) {
                  midiSyncBPM = newBPM;
                  $('edTempo').value = newBPM;
                  if (edCur) { edCur.tempo = newBPM; edSaveSong(); }
                  toast(`تمپوی کیوبیس: ${newBPM} BPM`);
                }
              }
            }
          }
          lastClockTime = now;
          clockCount++;

          // تایمر توقف
          clearTimeout(clockDetectTimer);
          clockDetectTimer = setTimeout(() => {
            if (midiClockRunning && midiSyncActive) {
              midiClockRunning = false;
              lastClockTime = 0;
              clockIntervals = [];
              if (DAW.isPlaying) pauseTransport();
            }
          }, 500);
        }
        return;
      }
      // MTC Quarter Frame (0xF1)
      if (status === 0xF1) {
        return;
      }
      // SysEx (0xF0) - MTC Full Message
      if (status === 0xF0) {
        const msg = e.data;
        if (msg.length >= 10 && msg[1] === 0x7F && msg[3] === 0x01 && msg[4] === 0x01) {
          const hours = msg[5] & 0x1F;
          const minutes = msg[6] & 0x3F;
          const seconds = msg[7] & 0x3F;
          const frames = msg[8] & 0x1F;
          const totalSeconds = hours * 3600 + minutes * 60 + seconds + frames / 30;
          if (midiSyncActive) {
            seekTransport(totalSeconds, false);
          }
        }
        return;
      }

      // Regular MIDI Note messages
      const note = e.data[1];
      const velocity = e.data[2];
      if (status === 144 && velocity > 0) {
        // MIDI Learn mode: capture this note for mapping
        if (midiLearnActive) { handleMidiLearnInput(note); return; }
        // MIDI Map: execute mapped function
        const mappedFunc = getMidiMap(note);
        if (mappedFunc) { executeMidiMappedFunction(mappedFunc); return; }
        activeMidiNotes.add(note); highlightPianoKey(note, true);
      }
      else if (status === 128 || (status === 144 && velocity === 0)) { activeMidiNotes.delete(note); highlightPianoKey(note, false); }

      clearTimeout(midiTimeout); midiTimeout = setTimeout(evaluateMidiInput, 50);
    }

    function evaluateMidiInput() {
      const isEditorOpen = $('chord-modal').classList.contains('show');
      const isEdChordModalOpen = edChordModalMode === 'editor' && $('chord-modal')?.classList.contains('show');

      if (activeMidiNotes.size === 0) {
        if (isRecordingChords && currentRecordingClipId) {
          const c = getClip(currentRecordingClipId); if (c) c.duration = roundMs(Math.max(0.5, DAW.playhead - c.start));
          currentRecordingClipId = null; saveState(); renderAll();
        }
        return;
      }

      const chord = identifyChord([...activeMidiNotes]);
      if (!chord) return;

      const name = `${chord.root}${chordTypeDisplay(chord.type)}${chord.tension}${chord.bass !== 'None' && chord.bass !== chord.root ? '/' + chord.bass : ''}`;

      // Show in MIDI monitor
      updateMidiChordDisplay(name, [...activeMidiNotes].map(n => noteNames[n % 12] + (Math.floor(n / 12) - 1)).join(', '));
      logMidiMsg('SYS', [0, 0, 0]); // chord identified marker

      // Update DAW Editor Live if open
      if (isEditorOpen) {
        currentChord = chord;
        updateChordPreview();
        document.querySelectorAll('.chord-item').forEach(el => el.classList.remove('active'));
        const rIdx = ROOT_NOTES.indexOf(chord.root);
        const tIdx = CHORD_TYPES.indexOf(chord.type);
        const teIdx = TENSIONS.indexOf(chord.tension);
        const bIdx = BASS_NOTES.indexOf(chord.bass);
        if(rIdx > -1) document.querySelector(`#col-root .chord-item:nth-child(${rIdx + 1})`)?.classList.add('active');
        if(tIdx > -1) document.querySelector(`#col-type .chord-item:nth-child(${tIdx + 1})`)?.classList.add('active');
        if(teIdx > -1) document.querySelector(`#col-tension .chord-item:nth-child(${teIdx + 1})`)?.classList.add('active');
        if(bIdx > -1) document.querySelector(`#col-bass .chord-item:nth-child(${bIdx + 1})`)?.classList.add('active');
      }

      // Update Lyrics Editor chord modal if open
      if (isEdChordModalOpen) {
        if ($('chordManual')) $('chordManual').value = name;
        if ($('chord-preview')) $('chord-preview').textContent = name;
      }

      // Update selected lyrics editor chord
if (edCur && edSelectedChords.length > 0 && !isEdChordModalOpen) {
  edSelectedChords.forEach(i => {
    if (edCur.chords[i]) edCur.chords[i].name = name;
  });
  edRenderChords();
  edCommit();
}



      // Sequential chording via MIDI
      if (edSeqChordingActive && edCur && !isEdChordModalOpen) {
        const seqIdx = edCur.chords.length - edSeqPoints.length + edSeqCursor;
        if (edCur.chords[seqIdx]) {
          edCur.chords[seqIdx].name = name;
          edCommit(); edRenderChords();
          if (edSeqCursor < edSeqPoints.length - 1) {
            edSeqCursor++;
          } else {
            const seqStart = edCur.chords.length - edSeqPoints.length;
            edCur.chords = edCur.chords.filter((c, i) => i < seqStart || c.name);
            edSeqChordingActive = false;
            edSeqPoints = []; edCur.seqPoints = [];
            edCommit(); edRenderChords();
            toast(t('chordDone'));
          }
        }
        return;
      }

      // Update DAW timeline recording
      if (isRecordingChords) {
        if (!currentRecordingClipId || getClip(currentRecordingClipId)?.name !== name) {
          if (currentRecordingClipId) { const oldC = getClip(currentRecordingClipId); if (oldC) oldC.duration = roundMs(Math.max(0.5, DAW.playhead - oldC.start)); }
          const chordTrack = DAW.tracks.find(t => t.type === 'chord');
          if (chordTrack) {
            const newClip = { id: uid('c'), type: 'chord', trackId: chordTrack.id, name, start: roundMs(DAW.playhead), duration: 2, color: '#9F7AEA' };
            DAW.clips.push(newClip); currentRecordingClipId = newClip.id; ensureTimelineFits(newClip.start + newClip.duration + 5); renderAll();
          }
        } else {
          const clip = getClip(currentRecordingClipId); if (clip) { clip.duration = roundMs(Math.max(0.5, DAW.playhead - clip.start)); renderClips(); }
        }
      } else if (DAW.selectedIds.size === 1) {
        const selId = [...DAW.selectedIds][0]; const clip = getClip(selId);
        if (clip && clip.type === 'chord' && clip.name !== name) { clip.name = name; renderClips(); }
      }
    }

    function highlightPianoKey(midiNote, on) {
      const noteName = NOTES[midiNote % 12] + (Math.floor(midiNote / 12) - 1);
      const keyEl = document.querySelector(`.piano-keyboard [data-note="${noteName}"]`);
      if (keyEl) { if (on) keyEl.classList.add('active'); else keyEl.classList.remove('active'); }
    }

    function toggleMIDISync() {
      midiSyncActive = !midiSyncActive;
      $('tab-midi-sync').classList.toggle('active-pink', midiSyncActive);
      $('midiSyncLabel').textContent = midiSyncActive ? 'ON' : 'OFF';
      toast(midiSyncActive ? 'همگام‌سازی فعال شد' : 'همگام‌سازی غیرفعال شد');
    }

    function toggleTab(id) { const tab = $(id); if (id === 'tab-sync') tab.classList.toggle('active-teal'); else if (id === 'tab-midi') tab.classList.toggle('active-pink'); }

    /* ===================== KEYBOARD ===================== */
    // ===== SHORTCUT SYSTEM =====
    const SHORTCUT_DEFAULTS = [
      { id: 'undo',          label: 'برگشت (Undo)',           code: 'KeyZ',    ctrl: true,  shift: false },
      { id: 'redo',          label: 'جلو (Redo)',              code: 'KeyY',    ctrl: true,  shift: false },
      { id: 'play',          label: 'پخش / توقف',             code: 'Space',   ctrl: false, shift: false },
      { id: 'split',         label: 'برش در پخشگر',           code: 'KeyS',    ctrl: false, shift: false },
      { id: 'copy',          label: 'کپی',                    code: 'KeyC',    ctrl: true,  shift: false },
      { id: 'cut',           label: 'بریدن',                   code: 'KeyX',    ctrl: true,  shift: false },
      { id: 'paste',         label: 'چسباندن',                 code: 'KeyV',    ctrl: true,  shift: false },
      { id: 'selectAll',     label: 'انتخاب همه',              code: 'KeyA',    ctrl: true,  shift: false },
      { id: 'duplicate',     label: 'کپی + چسباندن',            code: 'KeyD',    ctrl: true,  shift: false },
      { id: 'delete',        label: 'حذف انتخاب‌شده',          code: 'Delete',  ctrl: false, shift: false },
      { id: 'loop',          label: 'روشن/خاموش حلقه',         code: 'NumpadDivide', ctrl: false, shift: false },
      { id: 'loopA',         label: 'شروع حلقه',               code: 'KeyI',    ctrl: false, shift: false },
      { id: 'loopB',         label: 'پایان حلقه',              code: 'KeyO',    ctrl: false, shift: false },
      { id: 'fullscreen',    label: 'پنجره تمام‌صفحه',         code: 'F9',      ctrl: false, shift: false },
      { id: 'focusMode',     label: 'حالت تمرکز',              code: 'F10',     ctrl: false, shift: false },
      { id: 'seekBack',      label: 'عقب‌رفتن',               code: 'ArrowLeft',  ctrl: false, shift: false },
      { id: 'seekFwd',       label: 'جلورفتن',                 code: 'ArrowRight', ctrl: false, shift: false },
      { id: 'goStart',       label: 'رفتن به ابتدا',           code: 'Home',    ctrl: false, shift: false },
      { id: 'setLoopFromSel',label: 'محدوده loop از selection',  code: 'KeyP',    ctrl: false, shift: false },
    ];

    let SHORTCUTS = {};
    function loadShortcuts() {
      try { SHORTCUTS = JSON.parse(localStorage.getItem('ed_shortcuts') || '{}'); } catch(_) { SHORTCUTS = {}; }
    }
    function saveShortcuts() { localStorage.setItem('ed_shortcuts', JSON.stringify(SHORTCUTS)); }
    function getShortcut(id) {
      const def = SHORTCUT_DEFAULTS.find(s => s.id === id);
      return SHORTCUTS[id] || (def ? { code: def.code, ctrl: def.ctrl, shift: def.shift } : null);
    }
    function matchShortcut(e, id) {
      const sk = getShortcut(id); if (!sk) return false;
      const mod = e.ctrlKey || e.metaKey;
      return e.code === sk.code && mod === !!sk.ctrl && e.shiftKey === !!sk.shift;
    }
    function formatKeyName(code) {
      const map = { 'Space':'Space','KeyA':'A','KeyB':'B','KeyC':'C','KeyD':'D','KeyE':'E','KeyF':'F','KeyG':'G','KeyH':'H','KeyI':'I','KeyJ':'J','KeyK':'K','KeyL':'L','KeyM':'M','KeyN':'N','KeyO':'O','KeyP':'P','KeyQ':'Q','KeyR':'R','KeyS':'S','KeyT':'T','KeyU':'U','KeyV':'V','KeyW':'W','KeyX':'X','KeyY':'Y','KeyZ':'Z','Delete':'Del','Backspace':'Bksp','Home':'Home','End':'End','F9':'F9','F10':'F10','ArrowLeft':'←','ArrowRight':'→','ArrowUp':'↑','ArrowDown':'↓' };
      return map[code] || code;
    }
    loadShortcuts();

    let _editingShortcutId = null;
    // ===== IMPORT FROM URL/TEXT =====
    let _importParsed = null;
    function openImportChordModal() { $('importChordModal').classList.add('show'); $('importText').value = ''; $('importUrl').value = ''; $('importPreview').style.display = 'none'; _importParsed = null; }
    function closeImportChordModal() { $('importChordModal').classList.remove('show'); _importParsed = null; }

    // ===== AUTO IMPORT (Rewritten — multi-artist, progress, retry, accurate counts) =====

    // ---- State ----
    window._aiResults = [];       // flat array of all fetched songs (with status tracking)
    window._aiArtistMap = {};     // { artistName: { expected, fetched, status, songs:[] } }
    window._aiStats = { total: 0, fetched: 0, archived: 0, filesSaved: 0, dupes: 0, errors: 0 };
    window._aiFailedSongs = [];   // songs that failed after all retries

    // ---- Helpers ----
    function parseArtistNames(raw) {
      return raw.split(/[,\n،]+/).map(s => s.trim()).filter(s => s.length > 0);
    }
    function updateAutoArtistTags() {
      const names = parseArtistNames($('autoArtistName')?.value || '');
      const el = $('autoArtistTags');
      if (!el) return;
      el.innerHTML = names.map((n, i) =>
        `<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(63,184,175,0.15);border:1px solid var(--accent-teal);border-radius:6px;padding:3px 10px;font-size:0.8rem;color:var(--accent-cyan-glow);font-weight:700;">🎵 ${n}${names.length > 1 ? ` <span style="opacity:0.5;font-size:0.7rem;">#${i + 1}</span>` : ''}</span>`
      ).join('');
    }
    function normalizeKey(s) { return (s || '').replace(/\s+/g, '').toLowerCase(); }
    function songUniqueId(song) {
      // اگه URL داریم، از اون استفاده کن (هر صفحه یکتا‌ست)
      if (song.url) return normalizeKey(song.url);
      // اگه URL نداریم، artist + title
      return normalizeKey(song.artist) + '::' + normalizeKey(song.title);
    }

    // ---- Progress UI ----
    function updateAutoProgress(current, total, detail) {
      const pct = total > 0 ? Math.round((current / total) * 100) : 0;
      const fill = $('autoProgressFill');
      const label = $('autoProgressLabel');
      const pctEl = $('autoProgressPct');
      const detailEl = $('autoProgressDetail');
      if (fill) fill.style.width = pct + '%';
      if (label) label.textContent = `${current} / ${total}`;
      if (pctEl) pctEl.textContent = pct + '%';
      if (detailEl && detail) detailEl.innerHTML = detail;
    }
    function showProgressBar() { $('autoProgressBar')?.classList.add('show'); }
    function hideProgressBar() { $('autoProgressBar')?.classList.remove('show'); }

    // ---- Modal open/close ----
    function openAutoImportModal() {
      $('autoImportModal').classList.add('show');
      $('autoImportStatus').style.display = 'none';
      $('autoImportResults').innerHTML = '';
      $('autoImportDone').style.display = 'none';
      $('autoImportForm').style.display = 'block';
      $('autoImportFooter').style.display = 'flex';
      $('autoImportBtn').disabled = false;
      $('autoArtistTags').innerHTML = '';
      hideProgressBar();
      const ta = $('autoArtistName');
      if (ta && !ta._tagListenerAttached) { ta.addEventListener('input', updateAutoArtistTags); ta._tagListenerAttached = true; }
      // Show/hide cookie field based on source
      const srcSel = $('autoSource');
      if (srcSel && !srcSel._cookieListener) {
        srcSel._cookieListener = true;
        srcSel.addEventListener('change', () => {
          $('autoCookieField').style.display = srcSel.value === 'laminor' ? 'block' : 'none';
        });
        // Init on open
        $('autoCookieField').style.display = srcSel.value === 'laminor' ? 'block' : 'none';
      }
    }
    function closeAutoImportModal() { $('autoImportModal').classList.remove('show'); }

    function autoImportNewRequest() {
      $('autoImportStatus').style.display = 'none';
      $('autoImportResults').innerHTML = '';
      $('autoImportDone').style.display = 'none';
      $('autoImportSummary').textContent = '';
      $('autoImportFolderInput').style.display = 'none';
      $('autoImportForm').style.display = 'block';
      $('autoImportFooter').style.display = 'flex';
      $('autoImportBtn').disabled = false;
      $('autoImportBtn').textContent = '🚀 شروع ورودی اتومات';
      hideProgressBar();
    }

    // ---- Fetch ALL songs for one artist (server handles everything) ----
    async function fetchArtistFromServer(artistName, apiUrl, totalCount, onProgress) {
      if (onProgress) onProgress(`🎵 ${artistName} — در حال دریافت تمام ${totalCount} ترانه...`);
      console.log(`[FETCH] Starting: ${artistName} — requesting ${totalCount} songs from server`);

      try {
        const resp = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            artistName,
            count: totalCount,
            start: 1,
            sessionCookie: $('autoSessionCookie')?.value || ''
          })
        });
        const data = await resp.json();

        if (data.error) {
          console.log(`[FETCH] Server error: ${data.error}`);
          return { error: data.error, candidates: data.candidates, results: [] };
        }

        const got = data.results ? data.results.length : 0;
        console.log(`[FETCH] DONE: ${artistName} — server returned ${got} songs (imported: ${data.imported}, failed: ${data.failed})`);
        return { totalSongs: totalCount, results: data.results || [] };
      } catch (e) {
        console.log(`[FETCH] Network error: ${e.message}`);
        return { error: e.message, results: [] };
      }
    }

    // ---- Chord Parser Helpers (shared by all import paths) ----
    const IMPORT_DEBUG = false;

    // charIndex contract:
    // Zero-based JavaScript string index in the exact final lyric line.
    // It is not an RTL visual column and must not be reversed after parsing.

    function normalizeRawText(rawText) {
      if (!rawText) return '';
      let t = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      while (t.startsWith('\n')) t = t.substring(1);
      while (t.endsWith('\n')) t = t.substring(0, t.length - 1);
      return t;
    }

    // Only for line-type classification. NEVER use result for positions.
    function normalizeLineForDetection(line) {
      return line.replace(/[│┃┃│┆┇┊┋╎╏║►▶◆◇○●★☆♦♣♠♥♪♫]/g, ' ').replace(/\s{2,}/g, ' ').trim();
    }

    function expandTabsForVisualColumns(line, tabSize) {
      tabSize = tabSize || 4;
      let result = '';
      let col = 0;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '\t') {
          const spaces = tabSize - (col % tabSize);
          for (let s = 0; s < spaces; s++) result += ' ';
          col += spaces;
        } else {
          result += line[i];
          col++;
        }
      }
      return result;
    }

    function hasPersian(s) {
      return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(s);
    }

    // Single reusable chord-token regex for both detection and extraction
    const CHORD_ONLY_REGEX = /^[A-Ga-g][#b]?(?:m[maj7]*|maj(?:7|9|11|13)*|min(?:7|9|11|13)*|dim(?:7)?|aug(?:7)?|sus[24]?(?:7)?|add\d+|\/[A-Ga-g][#b]?|\d+)?(?:[\s*]+[A-Ga-g][#b]?(?:m[maj7]*|maj(?:7|9|11|13)*|min(?:7|9|11|13)*|dim(?:7)?|aug(?:7)?|sus[24]?(?:7)?|add\d+|\/[A-Ga-g][#b]?|\d+)?)*\s*$/;

    const CHORD_EXTRACT_REGEX = /[A-Ga-g][#b]?(?:m[maj7]*|maj(?:7|9|11|13)*|min(?:7|9|11|13)*|dim(?:7)?|aug(?:7)?|sus[24]?(?:7)?|add\d+|\/[A-Ga-g][#b]?|\d+)?/g;

    function extractChordPositions(originalLine) {
      const expanded = expandTabsForVisualColumns(originalLine);
      const positions = [];
      let match;
      const re = new RegExp(CHORD_EXTRACT_REGEX.source, 'g');
      while ((match = re.exec(expanded)) !== null) {
        positions.push({
          name: match[0],
          startColumn: match.index,
          endColumn: match.index + match[0].length,
          centerColumn: match.index + match[0].length / 2
        });
      }
      return positions;
    }

    // Strip star markers and collect anchor positions in one pass.
    // Returns { cleanText, anchors } where anchors[i] is the zero-based
    // JavaScript string index in cleanText where chord i should be placed.
    //
    // Contract:
    // 1. A star before a visible character anchors the chord to that character.
    //    Example: "عش*ق" -> anchor points to "ق".
    // 2. A star inside trailing whitespace or after the visible text
    //    becomes a LineEnd anchor.
    // 3. Trailing horizontal whitespace is removed from final lyrics.
    // 4. charIndex is always based on the final cleanText.
    // 5. JavaScript UTF-16 indexing is preserved so the result remains
    //    compatible with slice(), substring(), DOM text offsets.
    function stripStarsAndCollectAnchors(rawLyricLine) {
      const raw = String(rawLyricLine ?? '');
      let textWithoutStars = '';
      const rawAnchors = [];
      for (let i = 0; i < raw.length; i++) {
        if (raw[i] === '*') {
          rawAnchors.push(textWithoutStars.length);
        } else {
          textWithoutStars += raw[i];
        }
      }
      // Remove only horizontal trailing whitespace.
      const cleanText = textWithoutStars.replace(/[ \t\u00A0]+$/u, '');
      const visibleLength = cleanText.length;
      const anchors = rawAnchors.map(function(idx) {
        return Math.min(idx, visibleLength);
      });
      return { cleanText: cleanText, anchors: anchors };
    }

    function snapToWordBoundary(charIndex, lyricText) {
      const len = lyricText.length;
      if (len === 0) return 0;
      charIndex = Math.max(0, Math.min(charIndex, len - 1));
      // Find the nearest word-start to the left
      let bestLeft = charIndex;
      for (let i = charIndex; i >= 0; i--) {
        const prevChar = i > 0 ? lyricText[i - 1] : ' ';
        const curChar = lyricText[i];
        if ((prevChar === ' ' || prevChar === '\u200C' || i === 0) && curChar !== ' ' && curChar !== '\u200C') {
          bestLeft = i; break;
        }
      }
      // Find the nearest word-start to the right
      let bestRight = charIndex;
      for (let i = charIndex; i < len; i++) {
        const prevChar = i > 0 ? lyricText[i - 1] : ' ';
        const curChar = lyricText[i];
        if ((prevChar === ' ' || prevChar === '\u200C' || i === 0) && curChar !== ' ' && curChar !== '\u200C') {
          bestRight = i; break;
        }
      }
      const distLeft = Math.abs(bestLeft - charIndex);
      const distRight = Math.abs(bestRight - charIndex);
      if (distLeft <= distRight) return bestLeft;
      return bestRight;
    }

    // Determine anchor type from source context, not from clamped positions.
    function determineAnchorType(charIndex, lyricLength, explicitStart, explicitEnd) {
      if (lyricLength === 0 || explicitStart || charIndex === 0) return 'LineStart';
      if (explicitEnd || charIndex >= lyricLength) return 'LineEnd';
      return 'OnCharacter';
    }

    // Helper to correctly assign charIndex and anchorType for explicit anchors (stars).
    // LineEnd anchor: charIndex === lyricLength (points past the last character).
    function makeExplicitAnchor(rawIndex, lyricLength) {
      if (lyricLength <= 0) {
        return { charIndex: 0, anchorType: 'LineStart' };
      }
      if (rawIndex <= 0) {
        return { charIndex: 0, anchorType: 'LineStart' };
      }
      if (rawIndex >= lyricLength) {
        return { charIndex: lyricLength, anchorType: 'LineEnd' };
      }
      return { charIndex: rawIndex, anchorType: 'OnCharacter' };
    }

    // Map chord visual columns to lyric character indices for no-star lines.
    // Both lines share the same monospace coordinate system from <pre>.
    // Chord line is LTR; lyric line may be RTL.
    //
    // For RTL: charIndex = lyricVisualWidth - chordEndColumn
    //   (end of chord token maps to the correct text boundary)
    // For LTR: charIndex = chordStartColumn (direct mapping)
    //
    // No proportional scaling. No word-boundary snapping.
    function mapChordColumnsToLyricIndices(chordLine, lyricLine, chordPositions) {
      const lyricLen = lyricLine.length;
      if (lyricLen === 0) return [];
      const isRTL = hasPersian(lyricLine);
      // Use expanded lyric width for accurate column mapping
      const lyricExpanded = expandTabsForVisualColumns(lyricLine);
      const lyricVisualWidth = lyricExpanded.length;
      return chordPositions.map(function(ch) {
        let charIdx;
        if (isRTL) {
          // RTL: end of chord token maps to text boundary from the right
          charIdx = lyricVisualWidth - ch.endColumn;
        } else {
          // LTR: start of chord token maps directly
          charIdx = ch.startColumn;
        }
        charIdx = Math.max(0, Math.min(charIdx, lyricLen));
        return { name: ch.name, charIndex: charIdx };
      });
    }

    // Validate parsed song result in development mode.
    function validateParsedSong(result) {
      const warnings = [];
      if (typeof result.lyrics !== 'string') { warnings.push({ code: 'INVALID_LYRICS_TYPE', message: 'lyrics must be string' }); return warnings; }
      if (!Array.isArray(result.chords)) { warnings.push({ code: 'INVALID_CHORDS_TYPE', message: 'chords must be array' }); return warnings; }
      const lines = result.lyrics.split('\n');
      for (let i = 0; i < result.chords.length; i++) {
        const ch = result.chords[i];
        if (typeof ch.lineIndex !== 'number' || ch.lineIndex !== Math.floor(ch.lineIndex)) { warnings.push({ code: 'INVALID_LINE_INDEX', message: 'chord ' + i + ': lineIndex must be integer' }); continue; }
        if (typeof ch.charIndex !== 'number' || ch.charIndex !== Math.floor(ch.charIndex)) { warnings.push({ code: 'INVALID_CHAR_INDEX', message: 'chord ' + i + ': charIndex must be integer' }); continue; }
        if (ch.lineIndex < 0 || ch.lineIndex >= lines.length) { warnings.push({ code: 'LINE_INDEX_OUT_OF_RANGE', message: 'chord ' + i + ': lineIndex ' + ch.lineIndex + ' out of range' }); continue; }
        const line = lines[ch.lineIndex];
        // LineEnd anchor: charIndex === lyricLine.length is valid
        if (ch.anchorType === 'LineEnd') {
          if (ch.charIndex !== line.length) { warnings.push({ code: 'INVALID_LINE_END_INDEX', message: 'chord ' + i + ': LineEnd charIndex ' + ch.charIndex + ' != lyric length ' + line.length }); }
        } else if (line.length > 0 && (ch.charIndex < 0 || ch.charIndex >= line.length)) {
          warnings.push({ code: 'CLAMPED_CHAR_INDEX', message: 'chord ' + i + ': charIndex ' + ch.charIndex + ' out of range for line length ' + line.length });
        }
        if (!ch.name || typeof ch.name !== 'string' || !ch.name.trim()) { warnings.push({ code: 'EMPTY_CHORD_NAME', message: 'chord ' + i + ': empty name' }); }
        if (!['LineStart', 'OnCharacter', 'LineEnd'].includes(ch.anchorType)) { warnings.push({ code: 'INVALID_ANCHOR_TYPE', message: 'chord ' + i + ': invalid anchorType ' + ch.anchorType }); }
      }
      if (result.lyrics.includes('*')) { warnings.push({ code: 'STAR_IN_FINAL_LYRICS', message: 'Final lyrics contain star characters' }); }
      return warnings;
    }

    // ---- Common Parser: rawText → { lyrics, chords } ----
    // charIndex contract:
    // Zero-based JavaScript string index in the exact final lyric line.
    // It is not an RTL visual column and must not be reversed after parsing.
    function parseRawSongToEdCur(parsedSong) {
      const result = { title: parsedSong.title || '', artist: parsedSong.artist || '', key: parsedSong.key || '', keyMode: 'maj', timeSignature: parsedSong.rhythm || '', lyrics: '', chords: [], warnings: [] };
      if (parsedSong.key && parsedSong.key.endsWith('m')) { result.keyMode = 'min'; result.key = parsedSong.key.replace(/m$/, ''); }
      const rawText = normalizeRawText(parsedSong.rawText || '');
      if (!rawText) return result;

      const allRawLines = rawText.split('\n');
      const lineInfos = allRawLines.map(function(raw) {
        return { originalLine: raw, detectionLine: normalizeLineForDetection(raw), type: 'unknown' };
      });

      // Classify each line using detectionLine only
      for (let i = 0; i < lineInfos.length; i++) {
        const info = lineInfos[i];
        if (!info.detectionLine) { info.type = 'empty'; continue; }
        if (hasPersian(info.detectionLine)) {
          const endChordMatch = info.detectionLine.match(/\s+([A-G][#b]?(?:m[maj7]*|maj(?:7|9|11|13)*|min(?:7|9|11|13)*|dim(?:7)?|aug(?:7)?|sus[24]?(?:7)?|add\d+|\/[A-G][#b]?|\d+)?(?:\s+[A-G][#b]?(?:m[maj7]*|maj(?:7|9|11|13)*|min(?:7|9|11|13)*|dim(?:7)?|aug(?:7)?|sus[24]?(?:7)?|add\d+|\/[A-G][#b]?|\d+)?)*)\s*$/);
          if (endChordMatch) {
            // Detect chord suffix on detectionLine, but find it in originalLine
            const origText = info.originalLine;
            const chordSuffixRegex = /\s+([A-Ga-g][#b]?(?:m[maj7]*|maj(?:7|9|11|13)*|min(?:7|9|11|13)*|dim(?:7)?|aug(?:7)?|sus[24]?(?:7)?|add\d+|\/[A-Ga-g][#b]?|\d+)?(?:\s+[A-Ga-g][#b]?(?:m[maj7]*|maj(?:7|9|11|13)*|min(?:7|9|11|13)*|dim(?:7)?|aug(?:7)?|sus[24]?(?:7)?|add\d+|\/[A-Ga-g][#b]?|\d+)?)*)\s*$/;
            const origMatch = origText.match(chordSuffixRegex);
            let lyricPartOriginal, chordPartOriginal;
            if (origMatch) {
              lyricPartOriginal = origText.substring(0, origText.length - origMatch[0].length);
              chordPartOriginal = origMatch[1];
            } else {
              // Fallback: use detectionLine split positions
              const detLyricPart = info.detectionLine.substring(0, info.detectionLine.length - endChordMatch[0].length).trim();
              const detChordPart = endChordMatch[1].trim();
              lyricPartOriginal = detLyricPart;
              chordPartOriginal = detChordPart;
            }
            if (lyricPartOriginal.trim()) {
              lineInfos[i] = { originalLine: lyricPartOriginal, detectionLine: normalizeLineForDetection(lyricPartOriginal), type: 'lyric' };
              lineInfos.splice(i + 1, 0, { originalLine: chordPartOriginal, detectionLine: normalizeLineForDetection(chordPartOriginal), type: 'chord' });
            } else {
              lineInfos[i] = { originalLine: chordPartOriginal, detectionLine: normalizeLineForDetection(chordPartOriginal), type: 'chord' };
            }
          } else {
            info.type = 'lyric';
          }
        } else {
          if (/^[-=_~─━═━━─﹍﹎＿]{3,}$/.test(info.detectionLine.replace(/\s/g, ''))) { info.type = 'empty'; continue; }
          const stripped = info.detectionLine.replace(/\*/g, '');
          if (stripped && CHORD_ONLY_REGEX.test(stripped)) { info.type = 'chord'; }
          else { info.type = 'lyric'; }
        }
      }

      // Pair: chord line + next non-empty lyric line
      const consumed = new Set();
      const pairs = [];
      for (let i = 0; i < lineInfos.length; i++) {
        const item = lineInfos[i];
        if (item.type === 'chord') {
          let nextLyricIdx = -1;
          for (let j = i + 1; j < lineInfos.length; j++) {
            if (lineInfos[j].type === 'lyric' && !consumed.has(j)) { nextLyricIdx = j; break; }
            if (lineInfos[j].type === 'chord') break;
          }
          if (nextLyricIdx >= 0) {
            consumed.add(nextLyricIdx);
            pairs.push({ chordLineOriginal: item.originalLine, lyricLineOriginal: lineInfos[nextLyricIdx].originalLine });
          } else {
            result.warnings.push({ sourceLineIndex: i, code: 'INSTRUMENTAL_CHORD_LINE', message: 'Chord-only line at source index ' + i + ' preserved as intro/interlude' });
          }
        } else if (item.type === 'lyric' && !consumed.has(i)) {
          pairs.push({ chordLineOriginal: '', lyricLineOriginal: item.originalLine });
        }
      }

      // Build final lyrics and chords
      for (let pairIdx = 0; pairIdx < pairs.length; pairIdx++) {
        const pair = pairs[pairIdx];
        const chordLine = pair.chordLineOriginal;
        const lyricRaw = pair.lyricLineOriginal;

        // Build the final lyric line once, using the original lyric text
        const { cleanText: finalLyricLine, anchors: starAnchors } = stripStarsAndCollectAnchors(lyricRaw);
        pair.finalLyricLine = finalLyricLine;

        if (!chordLine || !finalLyricLine) continue;

        // Extract chord tokens from the chord line
        const chordTokens = chordLine.match(CHORD_EXTRACT_REGEX) || [];
        if (chordTokens.length === 0) continue;

        // Get valid chord tokens for matching
        const validChords = [];
        let cm;
        const ce = new RegExp(CHORD_EXTRACT_REGEX.source, 'g');
        while ((cm = ce.exec(chordLine)) !== null) {
          validChords.push({ name: cm[0] });
        }

        if (starAnchors.length > 0) {
          // Star-based positioning: pair chords with anchors deterministically
          if (validChords.length === starAnchors.length) {
            // Same count: one-to-one pairing
            for (let ci = 0; ci < validChords.length; ci++) {
              const explicit = makeExplicitAnchor(starAnchors[ci], finalLyricLine.length);
              result.chords.push({
                name: validChords[ci].name,
                lineIndex: pairIdx,
                charIndex: explicit.charIndex,
                anchorType: explicit.anchorType
              });
            }
          } else if (validChords.length > starAnchors.length) {
            // More chords than anchors: use anchors for prefix, fallback for rest
            for (let ci = 0; ci < starAnchors.length; ci++) {
              const explicit = makeExplicitAnchor(starAnchors[ci], finalLyricLine.length);
              result.chords.push({
                name: validChords[ci].name,
                lineIndex: pairIdx,
                charIndex: explicit.charIndex,
                anchorType: explicit.anchorType
              });
            }
            // Fallback for remaining chords using column projection
            const remainingChords = validChords.slice(starAnchors.length);
            const chordPositions = extractChordPositions(chordLine);
            const fallbackPositions = chordPositions.slice(starAnchors.length);
            const mapped = mapChordColumnsToLyricIndices(chordLine, finalLyricLine, fallbackPositions);
            for (let fi = 0; fi < mapped.length && fi < remainingChords.length; fi++) {
              const explicit = makeExplicitAnchor(mapped[fi].charIndex, finalLyricLine.length);
              result.chords.push({
                name: remainingChords[fi].name,
                lineIndex: pairIdx,
                charIndex: explicit.charIndex,
                anchorType: explicit.anchorType
              });
            }
            result.warnings.push({ sourceLineIndex: pairIdx, code: 'STAR_CHORD_COUNT_MISMATCH', message: 'More chords (' + validChords.length + ') than star anchors (' + starAnchors.length + ')' });
          } else {
            // More anchors than chords: use only matching count
            for (let ci = 0; ci < validChords.length; ci++) {
              const anchorIdx = ci < starAnchors.length ? starAnchors[ci] : 0;
              const explicit = makeExplicitAnchor(anchorIdx, finalLyricLine.length);
              result.chords.push({
                name: validChords[ci].name,
                lineIndex: pairIdx,
                charIndex: explicit.charIndex,
                anchorType: explicit.anchorType
              });
            }
            result.warnings.push({ sourceLineIndex: pairIdx, code: 'STAR_CHORD_COUNT_MISMATCH', message: 'More star anchors (' + starAnchors.length + ') than chords (' + validChords.length + ')' });
          }
        } else {
          // No-star fallback: column-based projection
          const chordPositions = extractChordPositions(chordLine);
          const mapped = mapChordColumnsToLyricIndices(chordLine, finalLyricLine, chordPositions);
          for (const m of mapped) {
            const explicit = makeExplicitAnchor(m.charIndex, finalLyricLine.length);
            result.chords.push({
              name: m.name,
              lineIndex: pairIdx,
              charIndex: explicit.charIndex,
              anchorType: explicit.anchorType
            });
          }
          if (IMPORT_DEBUG) {
            console.log('[IMPORT DEBUG] no-star pair', pairIdx, { chordLine: chordLine, lyricLine: finalLyricLine, chords: mapped });
          }
        }
      }

      // Build final lyrics string from all final lyric lines
      result.lyrics = pairs.map(function(p) { return p.finalLyricLine || ''; }).join('\n');

      // Validate
      const validationWarnings = validateParsedSong(result);
      if (validationWarnings.length > 0) {
        result.warnings = result.warnings.concat(validationWarnings);
        if (IMPORT_DEBUG) console.warn('[IMPORT WARNINGS]', validationWarnings);
      }

      return result;
    }

    // Thin wrapper for backward compatibility
    function parseSongRawText(song) {
      return parseRawSongToEdCur(song);
    }

    // ---- Save a song to archive (with proper dedup: URL + artist+title) ----
    function saveSongToArchive(song, existingSongs) {
      const songArtist = (song.artist || '').trim();
      const songTitle = (song.title || '').trim();
      const songUrlNorm = song.url ? normalizeKey(song.url) : '';
      const songAtNorm = normalizeKey(songArtist + '::' + songTitle);

      for (const es of existingSongs) {
        // چک URL
        if (songUrlNorm && es.url && normalizeKey(es.url) === songUrlNorm) {
          return { saved: false, duplicate: true };
        }
        // چک artist + title
        const esUid = normalizeKey((es.artist || '') + '::' + (es.title || ''));
        if (songAtNorm && esUid && songAtNorm === esUid) {
          return { saved: false, duplicate: true };
        }
      }

      const tmpEd = parseSongRawText(song);
      tmpEd.artist = songArtist;
      tmpEd.artistKey = archArtistKey(songArtist);
      tmpEd.title = songTitle;
      if (song.url) tmpEd.url = song.url;
      if (song.key) {
        const cleanKey = song.key.replace('m', '');
        const kMode = song.key.endsWith('m') ? 'min' : 'maj';
        if (typeof etIsValidNote === 'function' && etIsValidNote(cleanKey)) { tmpEd.key = cleanKey; tmpEd.keyMode = kMode; }
      }
      if (song.rhythm) tmpEd.timeSignature = song.rhythm;
      existingSongs.unshift(JSON.parse(JSON.stringify(tmpEd)));
      return { saved: true, duplicate: false };
    }

    // ---- Build progress detail HTML ----
    function buildProgressDetail() {
      const a = window._aiStats;
      let d = '';
      d += `<span class="apd-ok">✓ موفق: ${a.archived}</span>  `;
      d += `<span class="apd-fail">✗ ناموفق: ${a.errors}</span>  `;
      d += `<span class="apd-dup">≈ تکراری: ${a.dupes}</span>  `;
      d += `<span class="apd-pending">◯ باقی‌مانده: ${Math.max(0, a.total - a.fetched)}</span>`;
      return d;
    }

    // ---- MAIN: Start Auto Import ----
    async function startAutoImport() {
      const rawInput = $('autoArtistName').value.trim();
      const requestedCount = parseInt($('autoSongCount').value) || 0;
      const saveToArchive = $('autoSaveArchive').checked;

      const artistNames = parseArtistNames(rawInput);
      if (!artistNames.length) { toast('نام خواننده را وارد کنید'); return; }

      const status = $('autoImportStatus');
      const results = $('autoImportResults');
      const btn = $('autoImportBtn');
      status.style.display = 'block';
      results.innerHTML = '';
      btn.disabled = true;
      showProgressBar();

      const source = $('autoSource').value;
      const apiUrl = source === 'akord' ? '/api/akord/auto-import' : '/api/auto-import';

      // Reset state
      window._aiResults = [];
      window._aiArtistMap = {};
      window._aiStats = { total: 0, fetched: 0, archived: 0, filesSaved: 0, dupes: 0, errors: 0 };
      window._aiFailedSongs = [];

      try {
        // ===== PHASE 1: Detect total for each artist =====
        status.textContent = '🔍 در حال شناسایی تعداد ترانه‌ها...';
        let grandExpected = 0;

        for (let ai = 0; ai < artistNames.length; ai++) {
          const artistName = artistNames[ai];
          status.textContent = `🔍 [${ai + 1}/${artistNames.length}] شناسایی ${artistName}...`;
          updateAutoProgress(grandExpected, grandExpected + 1, `<span style="color:var(--accent-teal);">شناسایی ${artistName}...</span>`);

          // Probe: fetch count=1 to get totalSongs
          try {
            const probeResp = await fetch(apiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ artistName, count: 1, start: 1 })
            });
            const probeData = await probeResp.json();

            if (probeData.error) {
              window._aiArtistMap[artistName] = { expected: 0, fetched: 0, status: 'error', error: probeData.error, candidates: probeData.candidates, songs: [] };
              continue;
            }

            const totalSongs = probeData.totalSongs || 1;
            const countToFetch = requestedCount > 0 ? Math.min(requestedCount, totalSongs) : totalSongs;
            console.log(`[AUTO-IMPORT CLIENT] Artist: ${artistName} | totalSongs from probe: ${totalSongs} | countToFetch: ${countToFetch}`);
            window._aiArtistMap[artistName] = { expected: countToFetch, fetched: 0, status: 'pending', songs: [] };
            grandExpected += countToFetch;
          } catch (e) {
            window._aiArtistMap[artistName] = { expected: 0, fetched: 0, status: 'error', error: e.message, songs: [] };
          }
          await new Promise(r => setTimeout(r, 300));
        }

        window._aiStats.total = grandExpected;

        // Show artist summary before fetching
        let summaryLines = ['━━━ خلاصه شناسایی ━━━'];
        for (const [name, data] of Object.entries(window._aiArtistMap)) {
          if (data.error) summaryLines.push(`❌ ${name}: ${data.error}`);
          else summaryLines.push(`🎵 ${name}: ${data.expected} ترانه`);
        }
        summaryLines.push(`📊 جمع کل: ${grandExpected} ترانه`);
        status.textContent = summaryLines.join('\n');
        updateAutoProgress(0, grandExpected, buildProgressDetail());

        // ===== PHASE 2: Fetch all songs for each artist =====
        let processedCount = 0;

        for (const [artistName, artistData] of Object.entries(window._aiArtistMap)) {
          if (artistData.error) continue;

          status.textContent = `🎵 در حال دریافت ${artistName} (${artistData.expected} ترانه)...`;
          updateAutoProgress(processedCount, grandExpected, `<span style="color:var(--accent-teal);">دریافت ${artistName}...</span>\n${buildProgressDetail()}`);

          const fetchResult = await fetchArtistFromServer(artistName, apiUrl, artistData.expected, (msg) => {
            status.textContent = msg;
          });

          if (fetchResult.error) {
            artistData.status = 'error';
            artistData.error = fetchResult.error;
            artistData.candidates = fetchResult.candidates;
            artistData.songs = fetchResult.results || [];
            artistData.fetched = artistData.songs.length;
            processedCount += artistData.songs.length;
            window._aiStats.fetched += artistData.songs.length;
            window._aiStats.errors += artistData.expected - artistData.songs.length;
            continue;
          }

          // Deduplicate within this artist's results by URL
          const seenUrls = new Set();
          const uniqueSongs = [];
          for (const song of fetchResult.results) {
            if (!seenUrls.has(song.url)) {
              seenUrls.add(song.url);
              uniqueSongs.push(song);
            }
          }

          artistData.songs = uniqueSongs;
          artistData.fetched = uniqueSongs.length;
          artistData.status = 'done';
          window._aiResults.push(...uniqueSongs);
          window._aiStats.fetched += uniqueSongs.length;
          processedCount += uniqueSongs.length;

          updateAutoProgress(processedCount, grandExpected, buildProgressDetail());

          // Show per-artist results
          const okCount = uniqueSongs.filter(s => !s.error).length;
          const errCount = uniqueSongs.filter(s => s.error).length;
          const hColor = errCount > 0 ? '#e24f5b' : 'var(--accent-teal)';
          results.innerHTML += `<div style="padding:8px 10px;margin:8px 0 4px;border-radius:6px;background:rgba(255,255,255,0.04);border-left:3px solid ${hColor};font-weight:700;color:var(--text-primary);font-size:0.9rem;">🎵 ${artistName} <span style="color:var(--text-secondary);font-weight:400;font-size:0.8rem;">(${okCount}/${artistData.expected} موفق${errCount ? ', ' + errCount + ' ناموفق' : ''})</span></div>`;

          uniqueSongs.forEach((song, i) => {
            const key = songUniqueId(song);
            if (song.error) {
              results.innerHTML += `<div style="padding:6px 10px;margin:2px 0 2px 16px;border-radius:6px;background:rgba(255,0,0,0.1);border:1px solid #e24f5b;font-size:0.8rem;">❌ ${song.title}: ${song.error}</div>`;
            } else {
              results.innerHTML += `<div style="padding:6px 10px;margin:2px 0 2px 16px;border-radius:6px;background:rgba(63,184,175,0.1);border:1px solid var(--accent-teal);cursor:pointer;font-size:0.8rem;" onclick="loadAutoImportSong('${key}')">🎵 ${song.title} <span style="color:var(--text-secondary);font-size:0.75rem;">(${song.key || '-'})</span></div>`;
            }
          });

          await new Promise(r => setTimeout(r, 300));
        }

        // ===== PHASE 3: Save to archive =====
        if (saveToArchive) {
          status.textContent = '📁 در حال ذخیره در آرشیو...';
          const existingSongs = edGetAllSongs();
          let archived = 0, dupes = 0, noText = 0, parseErr = 0;

          for (const song of window._aiResults) {
            if (song.error) { continue; }
            if (!song.rawText || !song.rawText.trim()) {
              noText++;
              continue;
            }
            try {
              const result = saveSongToArchive(song, existingSongs);
              if (result.duplicate) { dupes++; }
              else if (result.saved) { archived++; }
            } catch (e) {
              parseErr++;
              console.log(`[ARCHIVE] PARSE ERROR: ${song.title} — ${e.message}`);
            }
          }

          console.log(`[ARCHIVE] FINAL: archived=${archived}, dupes=${dupes}, noText=${noText}, parseErr=${parseErr}, total=${window._aiResults.length}`);
          console.log(`[ARCHIVE] Songs with rawText: ${window._aiResults.filter(s => !s.error && s.rawText && s.rawText.trim()).length}`);
          console.log(`[ARCHIVE] Songs WITHOUT rawText: ${noText}`);
          edSetAllSongs(existingSongs);
          window._aiStats.archived = archived;
          window._aiStats.dupes = dupes;
          window._aiStats.errors = window._aiFailedSongs.length;
        }

        // ===== PHASE 4: Final Report =====
        const s = window._aiStats;
        let report = '━━━ گزارش نهایی ━━━\n';
        for (const [name, data] of Object.entries(window._aiArtistMap)) {
          if (data.error) report += `❌ ${name}: ${data.error}\n`;
          else report += `🎵 ${name}: ${data.fetched}/${data.expected} دریافت شد\n`;
        }
        report += `\n📊 مجموع تعداد مورد انتظار: ${s.total}\n`;
        report += `📊 تعداد دریافت‌شده: ${s.fetched}\n`;
        report += `📊 ذخیره‌شده در آرشیو: ${s.archived}\n`;
        report += `📊 تکراری: ${s.dupes}\n`;
        report += `📊 ناموفق: ${s.errors}`;
        if (window._aiFailedSongs.length > 0) {
          report += `\n\n❌ موارد ناموفق:\n`;
          window._aiFailedSongs.forEach(f => { report += `  • ${f.artist} — ${f.title}: ${f.error}\n`; });
        }

        status.textContent = report;
        $('autoImportSummary').textContent = report;
        updateAutoProgress(s.fetched, s.total, buildProgressDetail());

        // Show completion UI
        $('autoImportForm').style.display = 'none';
        $('autoImportFooter').style.display = 'none';
        $('autoImportDone').style.display = 'block';

      } catch (e) {
        const isNetworkErr = e.message.includes('Failed to fetch') || e.message.includes('NetworkError') || e.message.includes('ERR_CONNECTION');
        status.textContent = isNetworkErr
          ? '❌ سرور پیدا نشد!\n\nلطفاً سرور را اجرا کنید:\n1. ترمینال باز کنید\n2. بروید به پوشه پروژه\n3. بزنید: npm start\n4. بعد دوباره تلاش کنید'
          : '❌ خطا: ' + e.message;
        btn.disabled = false;
        btn.textContent = '🔄 تلاش مجدد';
        $('autoImportDone').style.display = 'block';
      }
    }

    // ---- Retry failed songs only ----
    async function autoRetryFailed() {
      const failed = window._aiFailedSongs;
      if (!failed.length) { toast('مورد ناموفقی وجود ندارد'); return; }

      const status = $('autoImportStatus');
      const results = $('autoImportResults');
      const source = $('autoSource').value;
      const apiUrl = source === 'akord' ? '/api/akord/auto-import' : '/api/auto-import';
      showProgressBar();

      status.textContent = `🔄 تلاش مجدد برای ${failed.length} ترانه ناموفق...`;

      // Group failed by artist
      const byArtist = {};
      failed.forEach(f => { (byArtist[f.artist] = byArtist[f.artist] || []).push(f); });

      window._aiFailedSongs = [];
      let retriedCount = 0;

      for (const [artistName, failedSongs] of Object.entries(byArtist)) {
        status.textContent = `🔄 تلاش مجدد ${artistName} (${failedSongs.length} ترانه)...`;
        updateAutoProgress(retriedCount, failed.length, `<span style="color:#D69E2E;">تلاش مجدد ${artistName}...</span>`);

        const fetchResult = await fetchArtistFromServer(artistName, apiUrl, failedSongs.length, (msg) => { status.textContent = msg; });

        if (fetchResult.error) {
          failedSongs.forEach(f => window._aiFailedSongs.push(f));
          retriedCount += failedSongs.length;
          continue;
        }

        // Check which failed songs are now recovered
        const recoveredUrls = new Set(fetchResult.results.filter(r => !r.error).map(r => r.url));
        const recoveredSongs = fetchResult.results.filter(r => !r.error && !r.rawText?.includes(''));

        for (const song of recoveredSongs) {
          if (!song.error && song.rawText) {
            window._aiResults.push(song);
            window._aiStats.fetched++;
            // Add to archive
            const existingSongs = edGetAllSongs();
            const result = saveSongToArchive(song, existingSongs);
            if (result.saved) window._aiStats.archived++;
            else if (result.duplicate) window._aiStats.dupes++;
            edSetAllSongs(existingSongs);
          }
        }

        // Songs still failed
        for (const f of failedSongs) {
          if (!recoveredUrls.has(f.url)) window._aiFailedSongs.push(f);
        }
        retriedCount += failedSongs.length;
        updateAutoProgress(retriedCount, failed.length, buildProgressDetail());
      }

      const stillFailed = window._aiFailedSongs.length;
      status.textContent = `🔄 تلاش مجدد تمام شد\nبازیابی شده: ${failed.length - stillFailed}\nباقی‌مانده ناموفق: ${stillFailed}`;
      updateAutoProgress(window._aiStats.fetched, window._aiStats.total, buildProgressDetail());
      if (stillFailed === 0) toast('✅ همه ترانه‌ها بازیابی شد!');
      else toast(`⚠️ ${stillFailed} ترانه هنوز ناموفق است`);
    }

    // ---- Save to archive (manual button) ----
    function autoImportSaveArchive() {
      const songs = window._aiResults.filter(s => !s.error && s.rawText);
      if (!songs.length) { toast('ترانه‌ای برای ذخیره وجود ندارد'); return;
      }
      if (!confirm(`آیا ${songs.length} ترانه در آرشیو ذخیره شود؟`)) return;

      const existingSongs = edGetAllSongs();
      let saved = 0, dupes = 0;
      for (const song of songs) {
        const result = saveSongToArchive(song, existingSongs);
        if (result.saved) saved++;
        else if (result.duplicate) dupes++;
      }
      edSetAllSongs(existingSongs);
      toast(`📁 ${saved} ترانه ذخیره شد${dupes ? '، ' + dupes + ' تکراری رد شد' : ''}`);
    }

    // ---- Save files to folder ----
    function autoImportSaveConfirm() {
      const songs = window._aiResults.filter(s => !s.error && s.rawText);
      if (!songs.length) { toast('فایلی برای ذخیره وجود ندارد'); return; }
      $('autoImportFolderInput').style.display = 'block';
      if (window.showDirectoryPicker) {
        window.showDirectoryPicker({ mode: 'readwrite' }).then(async dirHandle => {
          window._autoImportDirHandle = dirHandle;
          $('autoSavePathInput').value = dirHandle.name;
          $('autoSavePathInput').disabled = true;
        }).catch(() => {
          window._autoImportDirHandle = null;
          $('autoSavePathInput').disabled = false;
          $('autoSavePathInput').value = '';
        });
      } else {
        $('autoSavePathInput').disabled = false;
        $('autoSavePathInput').value = '';
      }
    }

    async function autoImportDoSave() {
      const songs = Array.isArray(window._aiResults)
        ? window._aiResults.filter(song => !song.error && song.rawText)
        : [];

      if (!songs.length) {
        toast('داده‌ای برای ذخیره نیست');
        return;
      }

      // اطمینان از وجود آمار
      window._aiStats = window._aiStats || {};
      window._aiFailedFiles = [];

      // پاک‌سازی نام پوشه و فایل برای ویندوز و File System API
      function sanitizeFilePart(value, fallback = 'Unknown') {
        const cleaned = String(value || fallback)
          .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
          .replace(/\s+/g, ' ')
          .replace(/[.\s]+$/g, '')
          .trim();

        return cleaned || fallback;
      }

      // گروه‌بندی ترانه‌ها براساس خوانندهٔ واقعی هر نتیجه
      const byArtist = {};

      songs.forEach(song => {
        const artistName = sanitizeFilePart(song.artist, 'Unknown');

        if (!byArtist[artistName]) {
          byArtist[artistName] = [];
        }

        byArtist[artistName].push(song);
      });

      const statusEl = $('autoImportStatus');
      const summaryEl = $('autoImportSummary');
      const folderInputEl = $('autoImportFolderInput');

      const totalFiles = songs.length;

      let savedTotal = 0;
      let errorsTotal = 0;

      const perArtistReport = [];
      const failedFiles = [];

      // ساخت متن گزارش نهایی
      function buildSaveReport({
        perArtist = [],
        saved = 0,
        errors = 0,
        skipped = 0,
        failed = []
      }) {
        let report = '━━━ گزارش ذخیره فایل‌ها ━━━\n';

        if (perArtist.length > 0) {
          perArtist.forEach(item => {
            const itemErrors = Number(item.errors) || 0;
            const itemSkipped = Number(item.skipped) || 0;

            let icon = '✅';

            if (itemErrors > 0) {
              icon = '⚠️';
            } else if (itemSkipped > 0) {
              icon = 'ℹ️';
            }

            report += `${icon} ${item.artist}: ${item.saved} از ${item.expected} فایل`;

            const details = [];

            if (itemSkipped > 0) {
              details.push(`${itemSkipped} رد شد`);
            }

            if (itemErrors > 0) {
              details.push(`${itemErrors} خطا`);
            }

            if (details.length > 0) {
              report += ` (${details.join('، ')})`;
            }

            report += '\n';
          });
        }

        report += `\n📊 مجموع: ${saved} از ${totalFiles} فایل با موفقیت ذخیره شد`;

        if (skipped > 0) {
          report += `\n⏭️ ردشده: ${skipped} فایل`;
        }

        if (errors > 0) {
          report += `\n❌ ناموفق: ${errors} فایل`;
        }

        if (failed.length > 0) {
          report += '\n\nجزئیات خطاها:\n';

          failed.forEach(item => {
            report += `  • ${item.artist} — ${item.title}: ${item.error}\n`;
          });
        }

        return report.trim();
      }

      statusEl.style.display = 'block';

      // ============================================================
      // Method 1: Native File System API
      // ذخیره در پوشه‌های جداگانه برای هر خواننده
      // ============================================================
      if (window._autoImportDirHandle) {
        const artistEntries = Object.entries(byArtist);

        try {
          for (let artistIndex = 0; artistIndex < artistEntries.length; artistIndex++) {
            const [artistName, artistSongs] = artistEntries[artistIndex];

            statusEl.textContent =
              `💾 [${artistIndex + 1}/${artistEntries.length}] ` +
              `ذخیرهٔ ترانه‌های ${artistName} (${artistSongs.length} فایل)...`;

            const artistDirName = sanitizeFilePart(artistName, 'Unknown');

            let artistDir;

            try {
              artistDir =
                await window._autoImportDirHandle.getDirectoryHandle(
                  artistDirName,
                  { create: true }
                );
            } catch (error) {
              const errorMessage = error?.message || String(error);

              artistSongs.forEach(song => {
                failedFiles.push({
                  artist: artistName,
                  title: song.title || 'Untitled',
                  error: `ساخت پوشه ناموفق بود: ${errorMessage}`
                });
              });

              errorsTotal += artistSongs.length;

              perArtistReport.push({
                artist: artistName,
                expected: artistSongs.length,
                saved: 0,
                skipped: 0,
                errors: artistSongs.length
              });

              continue;
            }

            let artistSaved = 0;
            let artistErrors = 0;

            /*
             * جلوگیری از یکسان‌شدن نام فایل‌های همین عملیات ذخیره.
             *
             * برای مثال اگر دو نتیجه هر دو این نام را داشته باشند:
             * گوگوش - همخونه.json
             *
             * فایل دوم به شکل زیر ذخیره می‌شود:
             * گوگوش - همخونه (2).json
             */
            const usedFileNames = new Map();

            for (let songIndex = 0; songIndex < artistSongs.length; songIndex++) {
              const song = artistSongs[songIndex];

              try {
                statusEl.textContent =
                  `💾 [${artistIndex + 1}/${artistEntries.length}] ${artistName}\n` +
                  `فایل ${songIndex + 1} از ${artistSongs.length}: ` +
                  `${song.title || 'Untitled'}`;

                const fileArtist = sanitizeFilePart(
                  song.artist || artistName,
                  artistName
                );

                const fileTitle = sanitizeFilePart(
                  song.title,
                  'Untitled'
                );

                const baseName = `${fileArtist} - ${fileTitle}`;
                const normalizedBaseName = baseName.toLocaleLowerCase('fa-IR');

                const occurrence =
                  (usedFileNames.get(normalizedBaseName) || 0) + 1;

                usedFileNames.set(normalizedBaseName, occurrence);

                const finalBaseName =
                  occurrence === 1
                    ? baseName
                    : `${baseName} (${occurrence})`;

                const filename = `${finalBaseName}.json`;

                const fileHandle = await artistDir.getFileHandle(
                  filename,
                  { create: true }
                );

                const writable = await fileHandle.createWritable();

                try {
                  await writable.write(
                    JSON.stringify(song, null, 2)
                  );

                  await writable.close();
                } catch (writeError) {
                  // اگر عملیات نوشتن شکست خورد، تلاش برای لغو stream
                  try {
                    await writable.abort();
                  } catch (_) {
                    // خطای abort اهمیتی برای گزارش اصلی ندارد
                  }

                  throw writeError;
                }

                artistSaved++;
                savedTotal++;
              } catch (error) {
                const errorMessage = error?.message || String(error);

                artistErrors++;
                errorsTotal++;

                failedFiles.push({
                  artist: artistName,
                  title: song.title || 'Untitled',
                  error: errorMessage
                });
              }
            }

            perArtistReport.push({
              artist: artistName,
              expected: artistSongs.length,
              saved: artistSaved,
              skipped: 0,
              errors: artistErrors
            });
          }

          window._aiStats.filesSaved = savedTotal;
          window._aiFailedFiles = failedFiles;

          const report = buildSaveReport({
            perArtist: perArtistReport,
            saved: savedTotal,
            errors: errorsTotal,
            skipped: 0,
            failed: failedFiles
          });

          statusEl.textContent = report;

          if (summaryEl) {
            summaryEl.textContent = report;
          }

          if (folderInputEl) {
            folderInputEl.style.display = 'none';
          }

          if (errorsTotal > 0) {
            toast(
              `⚠️ ${savedTotal} فایل ذخیره شد، ` +
              `${errorsTotal} فایل ناموفق بود`
            );
          } else {
            toast(`✅ ${savedTotal} فایل با موفقیت ذخیره شد`);
          }
        } catch (error) {
          const errorMessage = error?.message || String(error);

          window._aiStats.filesSaved = savedTotal;
          window._aiFailedFiles = failedFiles;

          statusEl.textContent =
            `❌ عملیات ذخیره متوقف شد.\n` +
            `${savedTotal} فایل قبل از بروز خطا ذخیره شد.\n` +
            `خطا: ${errorMessage}`;

          toast(`خطا در ذخیره فایل‌ها: ${errorMessage}`);
        }

        // مهم: پس از روش Native نباید روش سروری اجرا شود
        return;
      }

      // ============================================================
      // Method 2: Server-side save
      // ذخیره توسط مسیر /api/save-to-folder
      // ============================================================
      const savePath = $('autoSavePathInput').value.trim();

      if (!savePath) {
        toast('آدرس پوشه را وارد کنید');
        return;
      }

      statusEl.textContent = '💾 در حال ذخیره فایل‌ها در سرور...';
      toast('در حال ذخیره...');

      try {
        const resp = await fetch('/api/save-to-folder', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            savePath,
            songs
          })
        });

        let data;

        try {
          data = await resp.json();
        } catch (_) {
          throw new Error(
            `پاسخ سرور JSON معتبر نیست؛ کد وضعیت: ${resp.status}`
          );
        }

        if (!resp.ok) {
          throw new Error(
            data?.error ||
            `درخواست ذخیره ناموفق بود؛ کد وضعیت: ${resp.status}`
          );
        }

        if (data.error) {
          throw new Error(data.error);
        }

        savedTotal = Number(data.saved) || 0;
        errorsTotal = Number(data.errors) || 0;

        const skippedTotal = Number(data.skipped) || 0;

        window._aiStats.filesSaved = savedTotal;
        window._aiFailedFiles = Array.isArray(data.failedFiles)
          ? data.failedFiles
          : [];

        let serverPerArtist = [];

        if (Array.isArray(data.perArtist)) {
          serverPerArtist = data.perArtist.map(item => ({
            artist: item.artist || 'Unknown',
            expected: Number(item.expected) || 0,
            saved: Number(item.saved) || 0,
            skipped: Number(item.skipped) || 0,
            errors: Number(item.errors) || 0
          }));
        } else {
          /*
           * حالت سازگاری با نسخه‌های قدیمی سرور که هنوز
           * perArtist برنمی‌گردانند.
           */
          serverPerArtist = Object.entries(byArtist).map(
            ([artistName, artistSongs]) => ({
              artist: artistName,
              expected: artistSongs.length,
              saved: 0,
              skipped: 0,
              errors: 0
            })
          );
        }

        const report = buildSaveReport({
          perArtist: serverPerArtist,
          saved: savedTotal,
          errors: errorsTotal,
          skipped: skippedTotal,
          failed: window._aiFailedFiles
        });

        statusEl.textContent = report;

        if (summaryEl) {
          summaryEl.textContent = report;
        }

        if (folderInputEl) {
          folderInputEl.style.display = 'none';
        }

        if (errorsTotal > 0) {
          toast(
            `⚠️ ${savedTotal} فایل ذخیره شد، ` +
            `${errorsTotal} خطا` +
            `${skippedTotal ? `، ${skippedTotal} رد شد` : ''}`
          );
        } else {
          toast(
            `✅ ${savedTotal} فایل ذخیره شد` +
            `${skippedTotal ? `، ${skippedTotal} رد شد` : ''}`
          );
        }
      } catch (error) {
        const errorMessage = error?.message || String(error);

        statusEl.textContent =
          `❌ ذخیره در سرور ناموفق بود:\n${errorMessage}`;

        toast(
          `خطا: ${errorMessage}\n` +
          'مطمئن شوید سرور اجرا شده و مسیر ذخیره معتبر است'
        );
      }
    }

    // ---- Load a song from results into editor ----
    function loadAutoImportSong(key) {
      const song = window._aiResults.find(s => songUniqueId(s) === key);
      if (!song || song.error) return;
      if ($('autoFixChords') && $('autoFixChords').checked) {
        if ($('importAutoFix')) $('importAutoFix').checked = true;
      }
      const parsed = { title: song.title, artist: song.artist, key: song.key, rhythm: song.rhythm, rawText: song.rawText, url: song.url };
      _importParsed = parsed;
      $('importText').value = song.rawText;
      $('importUrl').value = song.url;
      openImportChordModal();
      showImportPreview(parsed);
    }

    async function fetchFromUrl() {
      const url = $('importUrl').value.trim();
      if (!url) { toast('لینک را وارد کنید'); return; }
      // Validate URL format
      let parsedUrl;
      try { parsedUrl = new URL(url); } catch(e) { toast('لینک نامعتبر است'); return; }
      const hostname = parsedUrl.hostname;
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) { toast('پروتکل نامعتبر'); return; }
      toast('در حال دریافت...');
      try {
        let html;
        const isLaminor = hostname === 'laminor.org' || hostname === 'www.laminor.org';
        const isAkord = hostname === 'akord.ir' || hostname === 'www.akord.ir';
        if (isAkord) {
          const proxyResp = await fetch('/api/akord/fetch?url=' + encodeURIComponent(url));
          const proxyData = await proxyResp.json();
          if (proxyData.error) throw new Error(proxyData.error);
          html = proxyData.html;
        } else if (isLaminor) {
          const proxyResp = await fetch('/api/fetch?url=' + encodeURIComponent(url));
          const proxyData = await proxyResp.json();
          if (proxyData.error) throw new Error(proxyData.error);
          html = proxyData.html;
        } else {
          const resp = await fetch(url);
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          html = await resp.text();
        }
        // برای لامینور از استخراج‌کننده دقیق (پیکسلی) استفاده کن
        if (isLaminor) {
          try {
            const extraction = await window.extractLaminorFromHtml(html);
            if (extraction && extraction.lines && extraction.lines.length > 0) {
              const converted = window.convertExtractedLinesToEdCur(extraction.lines);
              // گام اصلی (original key) و ریتم/امضای زمان از صفحهٔ لامینور استخراج می‌شود
              const extractedKey = extraction.key ? String(extraction.key).trim() : '';
              const extractedRhythm = extraction.rhythm ? String(extraction.rhythm).trim() : '';
              const parsed = {
                title: '',
                artist: '',
                key: extractedKey,
                rhythm: extractedRhythm,
                rawText: converted.lyrics,
                url,
                _extractedChords: converted.chords,
                _extractionWarnings: converted.warnings,
                _extractionValidation: extraction.validation
              };
              _importParsed = parsed;
              showImportPreview(parsed);
              toast('متن و آکوردها با دقت پیکسلی استخراج شد!');
            } else {
              // Fallback به روش متنی
              const parsed = parseChordPage(html, url);
              if (parsed) {
                _importParsed = parsed;
                showImportPreview(parsed);
                toast('متن استخراج شد (روش متنی)');
              } else { toast('نتوانستم متن را استخراج کنم'); }
            }
          } catch (extractErr) {
            console.warn('[Laminor Extractor] Pixel extraction failed, falling back to text:', extractErr);
            const parsed = parseChordPage(html, url);
            if (parsed) {
              _importParsed = parsed;
              showImportPreview(parsed);
              toast('متن استخراج شد (روش متنی)');
            } else { toast('نتوانستم متن را استخراج کنم'); }
          }
        } else {
          const parsed = parseChordPage(html, url);
          if (parsed) {
            _importParsed = parsed;
            showImportPreview(parsed);
            toast('متن استخراج شد!');
          } else { toast('نتوانستم متن را استخراج کنم'); }
        }
      } catch(e) { console.error(e); toast('خطا در دریافت: ' + e.message); }
    }

    function parseChordPage(html, url) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      let title = '', artist = '', key = '', rhythm = '', lyrics = '';

      // Safe hostname check using URL API
      function isLaminorUrl(u) {
        try { var h = new URL(u).hostname; return h === 'laminor.org' || h === 'www.laminor.org'; } catch(e) { return false; }
      }
      function isAkordUrl(u) {
        try { var h = new URL(u).hostname; return h === 'akord.ir' || h === 'www.akord.ir'; } catch(e) { return false; }
      }

      // Laminor specific parsing
      if (url && isLaminorUrl(url)) {
        const titleEl = doc.querySelector('h1');
        title = titleEl ? titleEl.textContent.replace(/آکورد\s+آهنگ\s*/, '').replace(/\s*-\s*لامینور.*$/, '').trim() : '';
        const artistEl = doc.querySelector('h6 a.color-light-blue, .smh-header-right-section a.color-light-blue');
        artist = artistEl ? artistEl.textContent.trim() : '';
        const keyMatch = html.match(/گام اصلی:\s*([A-G][#b]?m?)/);
        key = keyMatch ? keyMatch[1] : '';
        const rhythmEl = doc.querySelector('a[href*="rhythms/"]');
        rhythm = rhythmEl ? rhythmEl.textContent.trim() : '';
        if (!rhythm) {
          const rhythmMatch = html.match(/ریتم\s+پیشنهادی[\s\S]*?(\d+\/\d+)/);
          rhythm = rhythmMatch ? rhythmMatch[1] : '';
        }
        const preEl = doc.querySelector('pre#main-chord, pre.chord');
        if (preEl) {
          lyrics = preEl.textContent;
        } else {
          // Explicit fallback: try any <pre> only if it looks like chord content
          const allPres = doc.querySelectorAll('pre');
          for (const p of allPres) {
            const t = p.textContent || '';
            if (t.length > 20 && (CHORD_ONLY_REGEX.test(t.split('\n')[0].replace(/\s{2,}/g,' ').trim()) || hasPersian(t))) {
              lyrics = t;
              break;
            }
          }
        }
      }

      // Akord.ir specific parsing
      if (url && isAkordUrl(url)) {
        const titleEl = doc.querySelector('.section-title h4');
        title = titleEl ? titleEl.textContent.replace(/^آکورد\s*/, '').trim() : '';
        const breadcrumbLinks = doc.querySelectorAll('.breadcrumbs a');
        breadcrumbLinks.forEach(a => {
          const href = a.getAttribute('href');
          if (href && href.startsWith('/artists/') && href.split('/').filter(Boolean).length === 1) {
            artist = a.textContent.trim();
          }
        });
        const tags = doc.querySelectorAll('.tags');
        tags.forEach(t => {
          const text = t.textContent.trim();
          if (text.includes('گام:')) key = text.replace('گام:', '').trim();
          if (text.includes('ریتم:')) rhythm = text.replace('ریتم:', '').trim();
          if (text.includes('میزان:')) timeSignature = text.replace('میزان:', '').trim();
        });
        const preEl = doc.querySelector('pre#pre, pre');
        if (preEl) lyrics = preEl.textContent;
      }

      // Generic fallback - only if no lyrics found yet
      if (!lyrics) {
        const allPres = doc.querySelectorAll('pre');
        for (const p of allPres) {
          const t = p.textContent || '';
          if (t.length > 20) { lyrics = t; break; }
        }
      }

      if (!title) {
        const h1 = doc.querySelector('h1');
        title = h1 ? h1.textContent.trim() : '';
      }

      return { title, artist, key, rhythm, rawText: normalizeRawText(lyrics), url };
    }

    function parseChordLyricText(rawText) {
      const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      const chordRegex = /^[A-G][#b]?(m|maj|min|dim|aug|sus[24]?|add\d+|\/[A-G][#b]?|\d+)*(\s+[A-G][#b]?(m|maj|min|dim|aug|sus[24]?|add\d+|\/[A-G][#b]?|\d+)*)*\s*$/;
      const result = { sections: [], allChords: new Set() };

      for (const line of lines) {
        const isChordLine = chordRegex.test(line.replace(/\s{2,}/g, ' ').trim());
        if (isChordLine) {
          const chords = line.match(/[A-G][#b]?(?:m|maj|min|dim|aug|sus[24]?|add\d+)?(?:\/[A-G][#b]?)?/g) || [];
          chords.forEach(c => result.allChords.add(c));
          result.sections.push({ type: 'chord', text: line, chords });
        } else {
          result.sections.push({ type: 'lyric', text: line });
        }
      }
      return result;
    }

    function showImportPreview(parsed) {
      const parsed2 = parseChordLyricText(parsed.rawText);
      let preview = `عنوان: ${parsed.title || 'نامشخص'}\n`;
      preview += `خواننده: ${parsed.artist || 'نامشخص'}\n`;
      preview += `گام: ${parsed.key || 'نامشخص'}\n`;
      preview += `ریتم: ${parsed.rhythm || 'نامشخص'}\n`;
      preview += `آکوردها: ${[...parsed2.allChords].join(', ')}\n`;
      preview += `تعداد خطوط: ${parsed2.sections.length} (${parsed2.sections.filter(s=>s.type==='chord').length} خط آکورد + ${parsed2.sections.filter(s=>s.type==='lyric').length} خط شعر)`;
      $('importPreview').textContent = preview;
      $('importPreview').style.display = 'block';
    }

    function applyImportChords() {
      const text = $('importText').value.trim();
      if (!text && !_importParsed) { toast('متنی وارد نشده'); return; }

      let parsed;
      if (_importParsed && text.length === 0) {
        parsed = _importParsed;
      } else {
        parsed = { title: '', artist: '', key: '', rhythm: '', rawText: text, url: '' };
        const firstLines = text.split('\n').slice(0, 5);
        for (const l of firstLines) {
          if (!parsed.title && l.match(/آهنگ|ترانه|song/i)) { parsed.title = l.replace(/.*[:：]\s*/, '').trim(); }
          if (!parsed.artist && l.match(/خواننده|artist|از\s/i)) { parsed.artist = l.replace(/.*[:：]\s*/, '').replace(/از\s+/, '').trim(); }
        }
      }

      // --- Use canonical parser (only authority for positions) ---
      let parsedResult = parseRawSongToEdCur(parsed);

      // --- اگر استخراج پیکسلی انجام شده، آکوردهای دقیق را جایگزین کن ---
      if (parsed._extractedChords && parsed._extractedChords.length > 0) {
        parsedResult.chords = parsed._extractedChords;
        if (parsed._extractionWarnings) {
          parsedResult.warnings = parsedResult.warnings.concat(parsed._extractionWarnings);
        }
      }

      // --- Apply parsed result to edCur (no post-parse mutations) ---
      if (!edCur) edCur = edBlankSong();
      edCur.lyrics = parsedResult.lyrics;
      edCur.chords = parsedResult.chords;

      // --- Apply metadata ---
      if (parsedResult.title) edCur.title = parsedResult.title;
      if (parsedResult.artist) edCur.artist = parsedResult.artist;
      if (parsedResult.key) {
        const cleanKey = parsedResult.key.replace('m', '');
        if (typeof etIsValidNote === 'function' && etIsValidNote(cleanKey)) edCur.key = cleanKey;
        if (parsedResult.keyMode === 'min') edCur.keyMode = 'min';
      }
      if (parsedResult.timeSignature) edCur.timeSignature = parsedResult.timeSignature;

      // --- Set originalKey as source of truth (Bug 2 fix) ---
      // The imported key IS the original key. Never fall back to a wrong default.
      edCur.originalKey = edCur.key || 'C';
      edCur.originalKeyMode = edCur.keyMode || 'maj';
      edCur.transpose = 0;
      // Initialize baseChordNames from imported chords (original names, no positions)
      edCur.baseChordNames = (edCur.chords || []).map(ch => ch.name || '');
      // Initialize chordLineClips for independent Chord Line state (Bug fix: prevent auto-overwrite from Lyrics)
      if (!edCur.chordLineClips) edCur.chordLineClips = [];
      if (!edCur.hasManualChordLineEdits) edCur.hasManualChordLineEdits = false;

      DAW.clips = DAW.clips.filter(c => c.type !== 'chord');

      // --- Update UI ---
      edSyncToolbar();
      edRenderEditor(true);
      edSaveSong();
      renderAll();
      closeImportChordModal();
      toast('ترانه با ' + edCur.chords.length + ' آکورد وارد شد: ' + (parsedResult.title || 'بدون نام'));
    }

    function openShortcutModal() {
      const list = $('shortcutList'); list.innerHTML = '';
      SHORTCUT_DEFAULTS.forEach(sk => {
        const cur = getShortcut(sk.id);
        const midiNote = Object.entries(MIDI_MAPS).find(([k, v]) => v === sk.id);
        const div = document.createElement('div');
        div.className = 'shortcut-item';
        const keyParts = [];
        if (cur.ctrl) keyParts.push('Ctrl');
        if (cur.shift) keyParts.push('Shift');
        keyParts.push(formatKeyName(cur.code));
        const midiLabel = midiNote ? '🎹N' + midiNote[0].replace('n','') : '';
        const midiRemoveBtn = midiNote ? `<button class="ed-btn" onclick="removeMidiMap(${midiNote[0].replace('n','')});openShortcutModal();" title="حذف MIDI" style="font-size:0.6rem;min-width:18px;height:24px;padding:0 3px;background:#e24f5b;color:#fff;border-color:#e24f5b;">✕</button>` : '';
        div.innerHTML = `<span class="shortcut-label">${sk.label}</span><div style="display:flex;gap:4px;align-items:center;"><div class="shortcut-key" data-sid="${sk.id}"><kbd>${keyParts.join(' + ')}</kbd></div><button class="ed-btn" onclick="startMidiLearn('${sk.id}')" title="MIDI Learn" style="font-size:0.7rem;min-width:28px;height:24px;padding:0 4px;${midiNote ? 'background:#9F7AEA;color:#fff;border-color:#9F7AEA;' : ''}">🎹${midiLabel}</button>${midiRemoveBtn}</div>`;
        div.querySelector('.shortcut-key').addEventListener('click', () => startEditShortcut(sk.id));
        list.appendChild(div);
      });
      $('shortcutModal').classList.add('show');
    }
    function closeShortcutModal() { $('shortcutModal').classList.remove('show'); _editingShortcutId = null; }
    function startEditShortcut(id) {
      _editingShortcutId = id;
      document.querySelectorAll('.shortcut-key').forEach(el => el.classList.remove('editing'));
      const el = document.querySelector(`.shortcut-key[data-sid="${id}"]`);
      if (el) { el.classList.add('editing'); el.querySelector('kbd').textContent = '...کلید را بزنید'; }
    }
    function finishEditShortcut(code, ctrl, shift) {
      if (!_editingShortcutId) return;
      SHORTCUTS[_editingShortcutId] = { code, ctrl: !!ctrl, shift: !!shift };
      saveShortcuts(); _editingShortcutId = null;
      openShortcutModal(); // re-render
      toast('شرتکات ذخیره شد');
    }
    function resetShortcuts() { SHORTCUTS = {}; localStorage.removeItem('ed_shortcuts'); openShortcutModal(); toast('شرتکات به پیش‌فرض بازگشت'); }

    // ===== MIDI MAP (MIDI Learn) =====
    let MIDI_MAPS = {};
    let midiLearnActive = false;
    let midiLearnTargetId = null;
    function loadMidiMaps() { try { MIDI_MAPS = JSON.parse(localStorage.getItem('ed_midi_maps') || '{}'); } catch(_) { MIDI_MAPS = {}; } }
    function saveMidiMaps() { localStorage.setItem('ed_midi_maps', JSON.stringify(MIDI_MAPS)); }
    function getMidiMap(note) { return MIDI_MAPS['n' + note] || null; }
    function setMidiMap(note, funcId) { MIDI_MAPS['n' + note] = funcId; saveMidiMaps(); }
    function removeMidiMap(note) { delete MIDI_MAPS['n' + note]; saveMidiMaps(); }
    function executeMidiMappedFunction(funcId) { const fn = ACTION_FUNCTIONS[funcId]; if (fn) fn(); }
    function startMidiLearn(funcId) {
      midiLearnActive = true;
      midiLearnTargetId = funcId;
      const btn = document.querySelector(`[data-action="${funcId}"]`);
      if (btn) btn.classList.add('mapping-active');
      let toastEl = document.querySelector('.mapping-toast');
      if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'mapping-toast'; document.body.appendChild(toastEl); }
      const label = SHORTCUT_DEFAULTS.find(s => s.id === funcId)?.label || funcId;
      toastEl.textContent = '🎹 «' + label + '» — نت MIDI را بزنید...';
      toastEl.style.display = 'block';
    }
    function handleMidiLearnInput(note) {
      if (!midiLearnActive || !midiLearnTargetId) return;
      setMidiMap(note, midiLearnTargetId);
      midiLearnActive = false;
      midiLearnTargetId = null;
      const btn = document.querySelector(`[data-action="${midiLearnTargetId}"]`);
      if (btn) btn.classList.remove('mapping-active');
      openShortcutModal();
      toast('🎹 MIDI mapping ذخیره شد: Note ' + note);
    }
    loadMidiMaps();

    // Global shortcut capture for editing
    window.addEventListener('keydown', (e) => {
      // Skip if editing a shortcut
      if (_editingShortcutId) {
        e.preventDefault(); e.stopPropagation();
        if (e.key === 'Escape') { _editingShortcutId = null; openShortcutModal(); return; }
        if (e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta') return;
        finishEditShortcut(e.code, e.ctrlKey || e.metaKey, e.shiftKey);
        return;
      }
      // Alt+P: intercept in capture phase before browser menu activates
      if (e.altKey && e.code === 'KeyP') {
        e.preventDefault(); e.stopPropagation();
        setLoopFromSelectionAndPlay();
        return;
      }
      // Space in perf mode: intercept in capture phase before buttons can steal focus
      if (e.code === 'Space' && perfModeActive && !e.target.closest('input,textarea,[contenteditable]')) {
        e.preventDefault(); e.stopPropagation();
        perfTogglePlay();
        return;
      }
      // Space in editor: play/pause (capture phase to prevent button focus issues)
      if (e.code === 'Space' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest('input,textarea,[contenteditable],.arr-perf-panel')) {
        e.preventDefault(); e.stopPropagation();
        togglePlay();
        return;
      }
      // Mapping mode: Ctrl+Shift+Alt held
      if (e.ctrlKey && e.shiftKey && e.altKey) {
        e.preventDefault(); e.stopPropagation();
      }
    }, true);

    window.addEventListener('keydown', (e) => {
      // Skip if editing a shortcut
      if (_editingShortcutId) return;
      const tag = (e.target && e.target.tagName) || '';
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      const isContentEditable = e.target && (e.target.isContentEditable || e.target.contentEditable === 'true');

      // Undo/Redo: always work globally
      if (matchShortcut(e, 'undo')) { e.preventDefault(); undo(); return; }
      if (matchShortcut(e, 'redo')) { e.preventDefault(); redo(); return; }

      // F9: Singer (monitor چپ) + Player (monitor لپ‌تاپ) + پخش
      if (matchShortcut(e, 'fullscreen')) {
        e.preventDefault();
        if (!DAW.isPlaying) { ensureAudioCtx(); if (DAW.playhead <= 0) seekTransport(0, false); startTransport(); }
        // Singer View — monitor 2 (چپ)
        openLyricOnlyPopup();
        // Player View — monitor 1 (لپ‌تاپ)
        setTimeout(openLyricPopup, 300);
        return;
      }
      // Focus mode
      if (matchShortcut(e, 'focusMode')) { e.preventDefault(); toggleFocusMode(); return; }

      // Arrow keys: playhead seeking OR chord movement (skip when Ctrl/Shift held for panel shortcuts)
      if ((e.code === 'ArrowLeft' || e.code === 'ArrowRight') && !isInput && !isContentEditable && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        if ($('chord-modal')?.classList.contains('show')) return;
        // If chords are selected in editor, let the chord handler deal with it
        if (edSelectedChords.length > 0 && edCur) return;
        const barDur = 60 / (parseInt($('edTempo')?.value) || 120) * parseInt(($('edTimeSig')?.value || '4/4').split('/')[0]);
        const step = e.shiftKey ? barDur : 0.05;
        e.preventDefault();
        seekTransport(DAW.playhead + (e.code === 'ArrowRight' ? step : -step), true, true);
        return;
      }

      // Delete — when NOT in text field and clips selected
      if (matchShortcut(e, 'delete') && !isInput && !isContentEditable && DAW.selectedIds.size > 0) {
        e.preventDefault(); deleteSelected();
        return;
      }

      // Don't handle DAW shortcuts when in any text input
      if (isInput || isContentEditable) return;

      if (matchShortcut(e, 'delete')) { e.preventDefault(); deleteSelected(); }
      else if (matchShortcut(e, 'split')) { e.preventDefault(); splitSelectedAtPlayhead(); }
      else if (matchShortcut(e, 'copy')) { e.preventDefault(); copySelected(); }
      else if (matchShortcut(e, 'cut')) { e.preventDefault(); cutSelected(); }
      else if (matchShortcut(e, 'paste')) { e.preventDefault(); pasteClipboard(); }
      else if (matchShortcut(e, 'selectAll')) { e.preventDefault(); setSelection(DAW.clips.map(c => c.id)); }
      else if (matchShortcut(e, 'duplicate')) { e.preventDefault(); duplicateSelected(); }
      else if (matchShortcut(e, 'goStart')) { transportToStart(); }
      else if (matchShortcut(e, 'setLoopFromSel')) { e.preventDefault(); setLoopFromSelection(); }
      else if (matchShortcut(e, 'loop')) { e.preventDefault(); toggleLoop(); }
      else if (matchShortcut(e, 'loopA')) { e.preventDefault(); setLoopA(); }
      else if (matchShortcut(e, 'loopB')) { e.preventDefault(); setLoopB(); }
      else if (e.code === 'KeyV' && !e.ctrlKey && !e.metaKey && !e.altKey && !isInput && !isContentEditable) { e.preventDefault(); togglePlayheadMode(); }
      else if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey && !e.altKey && !isInput && !isContentEditable) { e.preventDefault(); toggleRec(); }
      // Q: کوانتایز آکوردهای انتخاب‌شده در کورد لاین
      else if (e.code === 'KeyQ' && !e.ctrlKey && !e.metaKey && !e.altKey && !isInput && !isContentEditable) {
        e.preventDefault();
        quantizeSelectedChords();
      }
      else if (e.key === 'Escape') {
        if (_focusMode) { toggleFocusMode(); return; }
        if (syncActive) { exitSyncMode(); const tab = $('tab-sync'); if (tab) tab.classList.remove('active-teal'); return; }
        clearSelection();
      }
    });

    /* ===================== INIT & INTERACTIONS ===================== */
    function init() {
      ensureAudioCtx();
      DAW.tracks = [
        { id: 't0', name: 'Chord Line', icon: '♫', type: 'chord' },
        { id: 't0s', name: 'Section', icon: '🏷', type: 'section' },
        { id: 't1', name: 'Vocals', icon: '🎤', type: 'audio', muted: false, solo: false, vol: 0.8, pan: 0, transpose: 0 },
        { id: 't2', name: 'Guitar', icon: '🎸', type: 'audio', muted: false, solo: false, vol: 0.8, pan: 0, transpose: 0 },
        { id: 't3', name: 'Bass', icon: '🎵', type: 'audio', muted: false, solo: false, vol: 0.8, pan: 0, transpose: 0 },
        { id: 't4', name: 'Keys', icon: '🎹', type: 'audio', muted: false, solo: false, vol: 0.8, pan: 0, transpose: 0 },
        { id: 't5', name: 'Drums', icon: '🥁', type: 'audio', muted: false, solo: false, vol: 0.8, pan: 0, transpose: 0 }
      ];
      DAW.tracks.forEach(t => {
        if (t.type === 'audio') {
          t._pannerNode = DAW.audioCtx.createStereoPanner(); t._gainNode = DAW.audioCtx.createGain();
          t._pannerNode.connect(t._gainNode); t._gainNode.connect(DAW.masterGain); updateTrackMix(t.id);
        }
      });
      ensureRecLane();
      DAW.sections = []; DAW.selectedSectionIds = new Set();
      DAW.timelineDuration = 120; DAW.pxPerSecond = 70; saveState(); renderAll();
      updateZoomFontScale();

      const scroll = $('tl-scroll');
      const lanes = $('lanes-container');

      // visual cut guide while holding Shift
      const showGuide = (e) => {
        const guide = $('cut-guide');
        if (!e.shiftKey) { guide.style.display = 'none'; return; }
        const t = clientToTime(e.clientX);
        guide.style.display = 'block';
        guide.style.left = timeToX(t) + 'px';
      };
      lanes.addEventListener('mousemove', showGuide);
      scroll.addEventListener('mousemove', (e) => { if (e.shiftKey) showGuide(e); });
      lanes.addEventListener('mouseleave', () => { if (!$('tl-scroll').matches(':hover')) $('cut-guide').style.display = 'none'; });
      window.addEventListener('keyup', (e) => { if (e.key === 'Shift') $('cut-guide').style.display = 'none'; });

    } // End init()

    // ===== TOOLBAR DRAG & DOCK =====
    (function() {
      let toolbarDragging = false, toolbarOffX = 0, toolbarOffY = 0;
      const headerCtrl = $('headerCenterControls');
      const dragHandle = $('toolbarDragHandle');
      const pinBtn = $('toolbarPinBtn');
      if (!headerCtrl || !dragHandle || !pinBtn) return;

      // Right-click context menu
      const toolbarGroups = [
        { label: 'گام و حالت', selector: '#edKey, #edKeyMode' },
        { label: 'تنظیمات متن', selector: '#edTextSize, #edTextFont, #edTextBold, #edAlignRight, #edAlignCenter, #edAlignLeft' },
        { label: 'تنظیمات آکورد', selector: '#edChordSize, #edChordFont, #edToggleChords' },
        { label: 'ترتیبی', selector: '#edSeqToggle, #edSeqStart, #edSeqPrev, #edSeqNext, #edClStart, #edClUndo, #edClClear, #edClApply, #edSeqModeSeg' },
        { label: 'ترنسپوز', selector: '#edTransDown, #edTransVal, #edTransUp' },
        { label: 'Undo/Redo', selector: '#edUndoBtn, #edRedoBtn' },
        { label: 'قفل ویرایشگر', selector: '#edEditorLockBtn' },
        { label: 'حذف ستاره', selector: '#edRemoveAsterisks' },
        { label: 'برعکس آکورد', selector: '#edReverseChords' },
        { label: 'حذف ستاره + برعکس', selector: '#edDoBoth' },
      ];

      function showToolbarContextMenu(e) {
        e.preventDefault();
        const old = document.querySelector('.toolbar-context-menu');
        if (old) old.remove();

        const menu = document.createElement('div');
        menu.className = 'toolbar-context-menu';

        // Pin/Unpin option
        const pinItem = document.createElement('div');
        pinItem.className = 'ctx-item';
        const isDocked = headerCtrl.classList.contains('floating') || headerCtrl.classList.contains('dock-left') || headerCtrl.classList.contains('dock-right');
        pinItem.innerHTML = `<span class="ctx-check">${isDocked ? '🔗' : '📌'}</span>${isDocked ? 'اتصال به صفحه' : 'جدا کردن'}`;
        pinItem.onclick = () => { toggleToolbarDock(); };
        menu.appendChild(pinItem);

        // Separator
        const sep = document.createElement('div');
        sep.style.cssText = 'height:1px;background:#2d3748;margin:4px 0;';
        menu.appendChild(sep);

        // Show all
        const showAllItem = document.createElement('div');
        showAllItem.className = 'ctx-item';
        showAllItem.innerHTML = `<span class="ctx-check">👁‍🗨</span>نمایش همه`;
        showAllItem.onclick = () => {
          headerCtrl.querySelectorAll('.ed-grp, .ed-sep, .toolbar-drag-handle, .toolbar-pin-btn').forEach(el => { el.style.display = ''; });
          menu.remove();
        };
        menu.appendChild(showAllItem);

        // Separator
        const sep2 = document.createElement('div');
        sep2.style.cssText = 'height:1px;background:#2d3748;margin:4px 0;';
        menu.appendChild(sep2);

        // Show/Hide groups
        toolbarGroups.forEach((g, i) => {
          const item = document.createElement('div');
          item.className = 'ctx-item';
          const checkSpan = document.createElement('span');
          checkSpan.className = 'ctx-check';
          const updateIcon = () => {
            const els2 = headerCtrl.querySelectorAll(g.selector);
            const vis = els2.length > 0 && els2[0].offsetParent !== null;
            checkSpan.textContent = vis ? '👁' : '−';
            return vis;
          };
          updateIcon();
          item.appendChild(checkSpan);
          item.appendChild(document.createTextNode(g.label));
          item.onclick = () => {
            const els = headerCtrl.querySelectorAll(g.selector);
            const currentlyVisible = els.length > 0 && els[0].offsetParent !== null;
            els.forEach(el => {
              const grp = el.closest('.ed-grp') || el;
              grp.style.display = currentlyVisible ? 'none' : '';
            });
            updateIcon();
          };
          menu.appendChild(item);
        });

        document.body.appendChild(menu);
        // Position menu
        if (document.documentElement.dir === 'rtl') {
          menu.style.right = Math.min(window.innerWidth - e.clientX, window.innerWidth - 200) + 'px';
          menu.style.left = 'auto';
        } else {
          menu.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px';
          menu.style.right = 'auto';
        }
        menu.style.top = Math.min(e.clientY, window.innerHeight - 300) + 'px';

        // Close on click outside
        const closeMenu = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', closeMenu); } };
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
      }

      dragHandle.addEventListener('contextmenu', showToolbarContextMenu);

      function toggleToolbarDock() {
        const isFloating = headerCtrl.classList.contains('floating');
        const isDocked = headerCtrl.classList.contains('dock-left') || headerCtrl.classList.contains('dock-right');
        headerCtrl.classList.remove('floating', 'dock-left', 'dock-right');
        if (isFloating || isDocked) {
          headerCtrl.style.cssText = 'flex-wrap:wrap; gap:4px;';
          pinBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 11l-4 4h14l-4-4"/><path d="M12 3v8"/><path d="M3 11h18"/></svg>';
        } else {
          headerCtrl.classList.add('floating');
          headerCtrl.style.left = '50%'; headerCtrl.style.top = '80px';
          headerCtrl.style.transform = 'translateX(-50%)';
          pinBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
        }
      }
      window.toggleToolbarDock = toggleToolbarDock;

      dragHandle.addEventListener('mousedown', (e) => {
        if (e.target.closest('.toolbar-pin-btn') || e.button !== 0) return;
        if (headerCtrl.classList.contains('dock-left') || headerCtrl.classList.contains('dock-right')) {
          headerCtrl.classList.remove('dock-left', 'dock-right');
          headerCtrl.classList.add('floating');
          pinBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
        }
        if (!headerCtrl.classList.contains('floating')) {
          headerCtrl.classList.add('floating');
          const rect = headerCtrl.getBoundingClientRect();
          headerCtrl.style.left = rect.left + 'px'; headerCtrl.style.top = rect.top + 'px';
          headerCtrl.style.transform = 'none';
          pinBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
        }
        toolbarDragging = true;
        const rect = headerCtrl.getBoundingClientRect();
        toolbarOffX = e.clientX - rect.left;
        toolbarOffY = e.clientY - rect.top;
        e.preventDefault();
      });

      document.addEventListener('mousemove', (e) => {
        if (!toolbarDragging) return;
        let x = e.clientX - toolbarOffX;
        let y = e.clientY - toolbarOffY;
        // Clamp to viewport
        x = Math.max(0, Math.min(x, window.innerWidth - 60));
        y = Math.max(0, Math.min(y, window.innerHeight - 40));
        headerCtrl.style.left = x + 'px'; headerCtrl.style.top = y + 'px';
        headerCtrl.style.transform = 'none';
      });

      document.addEventListener('mouseup', (e) => {
        if (!toolbarDragging) return;
        toolbarDragging = false;
        const rect = headerCtrl.getBoundingClientRect();
        const snapThreshold = 40;
        if (rect.left < snapThreshold) {
          headerCtrl.classList.remove('floating', 'dock-right');
          headerCtrl.classList.add('dock-left');
          headerCtrl.style.cssText = '';
          pinBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
        } else if (rect.right > window.innerWidth - snapThreshold) {
          headerCtrl.classList.remove('floating', 'dock-left');
          headerCtrl.classList.add('dock-right');
          headerCtrl.style.cssText = '';
          pinBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
        }
      });
    })(); // End toolbar IIFE

    // ===== Ruler & Playhead (global scope, uses global refs) =====
    (function() {
      const lanes = $('lanes-container');
      const scroll = $('tl-scroll');
      if (!lanes || !scroll) return;

      // Scroll wheel zoom on timeline
      // Ctrl+Alt+wheel = vertical zoom (lane height)
      // Ctrl+wheel or Alt+wheel = horizontal zoom (pxPerSecond)
      scroll.addEventListener('wheel', (e) => {
        if (!e.altKey && !e.ctrlKey) return; e.preventDefault();
        if (e.ctrlKey && e.altKey) {
          // Vertical zoom: Ctrl+Alt+wheel
          const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
          setVerticalZoom(DAW.laneHeight * factor);
        } else {
          // Horizontal zoom: Ctrl+wheel or Alt+wheel
          const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12; setZoom(DAW.pxPerSecond * factor, e.clientX);
        }
      }, { passive: false });

      const beginScrub = (e) => {
  if (DAW.isRecording) { toast('در حال ضبط — برای جابه‌جایی پلی‌هد ابتدا توقف کنید'); return; }
  clearEditorTextSelection();
  edClearChordSelection();

  // Shift+click on playhead-hit: toggle playhead selection (draggable)
  if (e.shiftKey && e.currentTarget === $('playhead-hit')) {
    e.preventDefault();
    DAW.selectedPlayhead = !DAW.selectedPlayhead;
    $('main-playhead').classList.toggle('selected', DAW.selectedPlayhead);
    if (DAW.selectedPlayhead) {
      // Start dragging the selected playhead
      const startX = e.clientX; const origTime = DAW.playhead;
      const onMove = (ev) => { seekTransport(Math.max(0, origTime + xToTime(ev.clientX - startX)), false); };
      const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
      document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
    }
    return;
  }

  clearSelection();
  DAW.selectedPlayhead = false; $('main-playhead').classList.remove('selected');
  e.preventDefault();

  // Cubase-style: click on upper half of ruler to set locators
  const ruler = $('timeline-ruler');
  if (ruler) {
    const rulerRect = ruler.getBoundingClientRect();
    const localY = e.clientY - rulerRect.top;
    const isUpperHalf = localY < rulerRect.height * 0.5;

    if (isUpperHalf && DAW.loopEnabled) {
      const t = clientToTime(e.clientX);
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+Click = set right locator
        DAW.loopB = Math.max(t, DAW.loopA + 0.5);
        renderLoopRegion(); saveState();
      } else {
        // Click = set left locator
        DAW.loopA = Math.min(t, DAW.loopB - 0.5);
        renderLoopRegion(); saveState();
      }
      return;
    }
  }

  seekTransport(clientToTime(e.clientX), true);

        const move = (ev) => seekTransport(clientToTime(ev.clientX), true);
        const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
        document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
      };
      $('timeline-ruler').addEventListener('mousedown', beginScrub);
      $('playhead-hit').addEventListener('mousedown', beginScrub);

      // Timeline separator drag: drag up = lanes bigger, drag down = lanes smaller
      const sepEl = $('timelineSep');
      if (sepEl) {
        sepEl.addEventListener('mousedown', (e) => {
          e.preventDefault();
          const startY = e.clientY;
          const origH = DAW.laneHeight;
          const onMove = (ev) => { const dy = startY - ev.clientY; setVerticalZoom(origH + dy * 0.5); };
          const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
          document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
        });
      }
      
      toast(t('dawReady'));

      // Global deselect: clicking anywhere clears all selections
      document.addEventListener('mousedown', (e) => {
        if (e.target.closest('.chord') || e.target.closest('.clip') || e.target.closest('.section-tag') || e.target.closest('#editorWrap') || e.target.closest('.tl-toolbar') || e.target.closest('.tl-zoom')) return;
        edClearChordSelection();
        clearSelection();
      });

      // Update loop toggle button state
      const loopBtn = $('loopToggleBtn');
      if (loopBtn) loopBtn.classList.toggle('loop-active', DAW.loopEnabled);
      renderLoopRegion();

      // ===== DRAG & DROP audio files onto timeline =====
      const tlScroll = $('tl-scroll');
      tlScroll.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; tlScroll.style.outline = '2px dashed var(--accent-teal)'; });
      tlScroll.addEventListener('dragleave', () => { tlScroll.style.outline = ''; });
      tlScroll.addEventListener('drop', async (e) => {
        e.preventDefault();
        tlScroll.style.outline = '';
        const files = [...(e.dataTransfer.files || [])].filter(f => f.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(f.name));
        if (files.length === 0) return;

        // Clear all selections before import
        clearSelection();
        ensureAudioCtx();
        
        // Detect which track lane the file was dropped on
        const droppedLane = e.target.closest('.track-lane');
        let targetTrackId = null;
        if (droppedLane) {
          const laneTrackId = droppedLane.dataset.trackId;
          const targetTrack = DAW.tracks.find(t => t.id === laneTrackId);
          // Only accept drop on audio tracks (not section or chord)
          if (targetTrack && targetTrack.type === 'audio') {
            targetTrackId = laneTrackId;
          }
        }
        
        let audioTracks = DAW.tracks.filter(t => t.type === 'audio');
        
        // If dropped on a specific audio track, use only that track
        if (targetTrackId) {
          audioTracks = [DAW.tracks.find(t => t.id === targetTrackId)];
        }

        // اگه ترک صوتی کمتر از تعداد فایلهاست، خودکار ترک جدید بساز
        while (audioTracks.length < files.length) {
          addNewTrack();
          audioTracks = DAW.tracks.filter(t => t.type === 'audio');
        }

        const doCopy = await askAudioCopyMode(`${files.length} فایل صوتی`);

        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const trackIdx = i % audioTracks.length;
          const trackId = audioTracks[trackIdx].id;
          try {
            toast(`لود ${i + 1}/${files.length}: ${file.name}`);
            const { buffer } = await decodeFileToBuffer(file);
            const bufferKey = 'buf_' + uid('b') + '_' + file.name;
            DAW.bufferCache.set(bufferKey, buffer);

            // Start each file after the previous one ends
            const lastClipEnd = DAW.clips.filter(c => c.trackId === trackId).reduce((max, c) => Math.max(max, c.start + c.duration), 0);

            const clip = {
              id: uid('c'), type: 'audio', trackId,
              name: file.name.replace(/\.[^.]+$/, ''),
              fileName: file.name,
              start: roundMs(Math.max(lastClipEnd, DAW.playhead)),
              duration: buffer.duration, offset: 0,
              sourceDuration: buffer.duration,
              color: COLORS[DAW.clips.length % COLORS.length],
              bufferKey,
              _peaks: peaksFromBuffer(buffer, 2000),
              waveUrl: null,
              _embedded: doCopy,
              // ─── ذخیره Blob اصلی برای ذخیره حجم (به‌جای Base64) ───
              _originalBlob: doCopy ? file : null
            };
            // ذخیره مسیر/هندل فایل برای لینک‌شده‌ها
            if (!doCopy) {
              if (isElectron && file.path) {
                clip._filePath = file.path;
                console.log(`[DROP] Electron file path saved: ${file.name} → ${file.path}`);
              } else if (isElectron) {
                // در الکترون ولی file.path موجود نیست (الکترون 32+)
                console.warn(`[DROP] Electron but file.path is missing for: ${file.name}`);
                // fallback: استفاده از webUtils.getPathForFile اگه موجود باشه
                if (window.electronAPI && window.electronAPI.getPathForFile) {
                  try {
                    const filePath = await window.electronAPI.getPathForFile(file);
                    if (filePath) {
                      clip._filePath = filePath;
                      console.log(`[DROP] Got path via webUtils: ${file.name} → ${filePath}`);
                    }
                  } catch(_) {}
                }
                // اگه هنوز مسیر نداریم، فایل رو به‌صورت Blob ذخیره کن
                if (!clip._filePath) {
                  try {
                    await saveAudioBlobToDB(bufferKey, file, file.name);
                    console.log(`[DROP] Saved as blob fallback: ${file.name}`);
                  } catch(_) {}
                }
              } else {
                // ─── در مرورگر: فایل درگ‌شده رو به‌صورت Blob در IndexedDB ذخیره کن ───
                try {
                  await saveAudioBlobToDB(bufferKey, file, file.name);
                } catch(_) {}
              }
            }
            refreshClipWaveImage(clip);
            DAW.clips.push(clip);
            ensureTimelineFits(clip.start + clip.duration + 5);
          } catch (err) {
            console.error(err);
            toast(`خطا در لود ${file.name}`);
          }
        }

        if (doCopy) saveAudioBlobsForProject(edCur.id).catch(() => {});
        // ذخیره مسیر فایل‌های لینک‌شده در edCur._audioPaths
        if (!doCopy) {
          if (!edCur._audioPaths) edCur._audioPaths = [];
          for (const clip of DAW.clips.slice(-files.length)) {
            if (!clip._embedded && clip.bufferKey) {
              const existing = edCur._audioPaths.find(p => p.bufferKey === clip.bufferKey);
              if (!existing) {
                edCur._audioPaths.push({
                  bufferKey: clip.bufferKey,
                  fileName: clip.fileName || clip.name,
                  trackId: clip.trackId,
                  filePath: clip._filePath || null
                });
              }
            }
          }
        }
        DAW.selectedIds = new Set(DAW.clips.slice(-files.length).map(c => c.id));
        saveState(); renderAll();
        toast(`${files.length} فایل صوتی لود شد`);
        edSaveSong();
      });

      // Timeline resizable separator
      const sep = $('timelineSep');
      if (sep) {
        sep.addEventListener('mousedown', e => {
          e.preventDefault();
          const startY = e.clientY;
          const grid = $('app-container') || document.querySelector('.app-container');
          const startRow = parseInt(getComputedStyle(grid).gridTemplateRows.split(' ')[3]) || 320;
          const move = ev => {
            const delta = startY - ev.clientY;
            const newH = Math.max(120, Math.min(window.innerHeight - 200, startRow + delta));
            grid.style.gridTemplateRows = `75px 1fr 4px ${newH}px`;
          };
          const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
          document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
        });
      }
      // Init sync UI
      initSyncUI();
    })();

    /* ===================================================================
       LYRIC & CHORD EDITOR (integrated into workspace)
       =================================================================== */

    // -- Song Data --
    const ED_NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const ED_FLAT_NOTES = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
    const ED_ALL_NOTE_NAMES = ['C','C#','Db','D','D#','Eb','E','F','F#','Gb','G','G#','Ab','A','A#','Bb','B'];
    const ED_SEMITONE = {'C':0,'C#':1,'Db':1,'D':2,'D#':3,'Eb':3,'E':4,'F':5,'F#':6,'Gb':6,'G':7,'G#':8,'Ab':8,'A':9,'A#':10,'Bb':10,'B':11};
    const ED_NOTE_TO_SHARP = { 'Db':'C#', 'Eb':'D#', 'Gb':'F#', 'Ab':'G#', 'Bb':'A#' };
    const ED_NOTE_TO_FLAT = { 'C#':'Db', 'D#':'Eb', 'F#':'Gb', 'G#':'Ab', 'A#':'Bb' };
    const ED_FLAT_MAP = { 1:'Db', 3:'Eb', 6:'Gb', 8:'Ab', 10:'Bb' };
    
    // Accidental preference: 'sharp' | 'flat' | 'auto'
    let ED_ACCIDENTAL_PREF = 'auto';

    // Validate a note/key root accepts BOTH sharps and flats (e.g. 'Bb','Eb','F#','Db').
    function etIsValidNote(n) {
      if (!n) return false;
      return ED_ALL_NOTE_NAMES.includes(n) || ED_SEMITONE[n] != null;
    }
    const ED_TYPES = ['','m','7','maj7','m7','dim','aug','sus2','sus4','6','m6','m7b5'];
    const ED_TENS = ['','add9','9','11','13','b9','#9','#11','b13'];

    let edCur = null;
    let edUndoStack = [], edRedoStack = [];
    let edChordIdx = null, edPendingAnchor = null;
    let edSelectedChords = [];
    let edTransposing = 0;
    let edChordDragActive = false;
    let edChordsVisible = true;
    let edSeqModeActive = false, edSeqPoints = [], edSeqChordingActive = false, edSeqCursor = 0;
    let edChordModalMode = null;

    let edInputRenderTimer = null;
    let edSaveTimer = null;
    let edCommitTimer = null;

function edScheduleEditorRefresh() {
  clearTimeout(edInputRenderTimer);
  edInputRenderTimer = setTimeout(() => {
    if (!edCur) return;
    edRenderEditor(false);
  }, 80);
}

function edScheduleSave() {
  clearTimeout(edSaveTimer);
  edSaveTimer = setTimeout(() => {
    if (!edCur) return;
    edSaveSong();
  }, 400);
}


function edBlankSong() {

      return { id: Date.now(), artist:'', title:'', key:'C', keyMode:'maj', originalKey:'C', originalKeyMode:'maj', baseChordNames:[], transpose:0, lyrics:'', chords:[], syncTimes:[], syncWords:[], trackId:null, trackPath:null, seqPoints:[],
        timeSignature:'4/4', tempo:120, genre:'', lineColors:[], chordVersions:[], activeChordVersion:0,
        styles:{ tSize:38,tColor:'#0fa966',tFont:'Vazirmatn',tBold:true,align:'center', cSize:38,cColor:'#e6aa28',cFont:'JetBrains Mono' } };
    }

    async function edInitSong() {
      const saved = localStorage.getItem('ed_current_song');
      if (saved) { try { edCur = JSON.parse(saved); } catch(e) { edCur = null; } }
      if (!edCur) edCur = edBlankSong();
      if (!edCur.styles) edCur.styles = {};
      if (!edCur.lineColors) edCur.lineColors = [];
      if (!edCur.chordVersions) edCur.chordVersions = [];
      if (edCur.activeChordVersion === undefined) edCur.activeChordVersion = 0;
      // Restore editor lock state
      if (edCur.editorLocked) {
        const editor = $('editor');
        if (editor) editor.contentEditable = 'false';
        const lockBtn = $('edEditorLockBtn');
        if (lockBtn) lockBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
      }
      const defaults = { tSize:38,tColor:'#0fa966',tFont:'Vazirmatn',tBold:true,align:'center', cSize:38,cColor:'#e6aa28',cFont:'JetBrains Mono' };
      Object.keys(defaults).forEach(k => { if (edCur.styles[k] === undefined) edCur.styles[k] = defaults[k]; });
      if (edCur._dawTracks) {
        DAW.tracks = edCur._dawTracks;
        ensureAudioCtx();
        DAW.tracks.forEach(t => {
          if (t.type === 'audio') {
            t._pannerNode = DAW.audioCtx.createStereoPanner();
            t._gainNode = DAW.audioCtx.createGain();
            t._pannerNode.connect(t._gainNode);
            t._gainNode.connect(DAW.masterGain);
            updateTrackMix(t.id);
          }
        });
      }
      if (edCur._dawClips) DAW.clips = edCur._dawClips;
      if (edCur._dawSections) DAW.sections = JSON.parse(JSON.stringify(edCur._dawSections));
      updateNextIdFromClips();
      // Migrate any old section clips from DAW.clips to DAW.sections
      const oldSections = DAW.clips.filter(c => c.type === 'section');
      if (oldSections.length > 0) {
        oldSections.forEach(c => { DAW.sections.push({ id: c.id, trackId: c.trackId, label: c.name, start: c.start, duration: c.duration, color: c.color }); });
        DAW.clips = DAW.clips.filter(c => c.type !== 'section');
      }
      // Restore loop state
      if (edCur._dawLoop) { DAW.loopEnabled = !!edCur._dawLoop.loopEnabled; DAW.loopA = edCur._dawLoop.loopA || 0; DAW.loopB = edCur._dawLoop.loopB || 10; }
      // Restore audio blobs from IndexedDB
      try {
        await loadAudioBlobsForProject(edCur.id);
        DAW.clips.forEach(c => {
          if (c.type !== 'chord' && c.bufferKey && DAW.bufferCache.has(c.bufferKey)) {
            const buffer = DAW.bufferCache.get(c.bufferKey);
            c.sourceDuration = buffer.duration;
            c._peaks = peaksFromBuffer(buffer, 2000);
            refreshClipWaveImage(c);
          }
        });
      } catch(e) { console.warn('Audio init load error:', e); }

      // لود اتوماتیک از مسیر فایل ذخیره‌شده (لینک‌شده‌ها — مثل کیوبیس)
      const missingClips = DAW.clips.filter(c => c.type !== 'chord' && c.bufferKey && !DAW.bufferCache.has(c.bufferKey));
      console.log(`[Audio Init] ${missingClips.length} clip(s) need audio loading. isElectron=${isElectron}, _audioPaths=${edCur._audioPaths?.length || 0}`);
      if (missingClips.length > 0 && edCur._audioPaths && edCur._audioPaths.length > 0) {
        // اول از filePath (Electron) لود کن
        if (isElectron && window.electronAPI) {
          for (const ap of edCur._audioPaths) {
            if (!ap.filePath) { console.warn('[LINK] No filePath for:', ap.fileName); continue; }
            const clip = DAW.clips.find(c => c.type !== 'chord' && c.bufferKey === ap.bufferKey);
            if (!clip || DAW.bufferCache.has(clip.bufferKey)) continue;
            try {
              console.log('[LINK] Loading from path:', ap.filePath);
              const audioBuffer = await loadAudioFromHardDrive(ap.filePath);
              DAW.bufferCache.set(clip.bufferKey, audioBuffer);
              clip.sourceDuration = audioBuffer.duration;
              clip._peaks = peaksFromBuffer(audioBuffer, 2000);
              clip._filePath = ap.filePath;
              refreshClipWaveImage(clip);
              console.log('[LINK] ✓ Loaded:', ap.fileName);
            } catch (e) {
              console.warn('[LINK] File not found at path:', ap.filePath, e.message);
            }
          }
        }

        // ─── لود از Blob ذخیره‌شده در IndexedDB (بدون سوال از کاربر) ───
        // این مرحله جدید هست — قبلاً فایل‌های «نه» ذخیره نمی‌شدن و دوباره از کاربر پرسیده می‌شد
        const stillAfterPathBlob = DAW.clips.filter(c => c.type !== 'chord' && c.bufferKey && !DAW.bufferCache.has(c.bufferKey));
        if (stillAfterPathBlob.length > 0) {
          for (const clip of stillAfterPathBlob) {
            try {
              const blobRecord = await getAudioBlobFromDB(clip.bufferKey);
              if (!blobRecord) continue;
              const { buffer } = await decodeFileToBuffer(blobRecord.blob);
              DAW.bufferCache.set(clip.bufferKey, buffer);
              clip.sourceDuration = buffer.duration;
              clip._peaks = peaksFromBuffer(buffer, 2000);
              refreshClipWaveImage(clip);
              console.log('[BLOB] Auto-reloaded:', blobRecord.fileName);
            } catch(e) { console.warn('[BLOB] Auto-reload failed for', clip.bufferKey, e.message); }
          }
        }

        // لود از FileHandle ذخیره‌شده در IndexedDB (بدون سوال از کاربر)
        const stillAfterPath = DAW.clips.filter(c => c.type !== 'chord' && c.bufferKey && !DAW.bufferCache.has(c.bufferKey));
        if (stillAfterPath.length > 0) {
          for (const clip of stillAfterPath) {
            try {
              const handle = await getFileHandle(clip.bufferKey);
              if (!handle) continue;
              if (handle.requestPermission) {
                const perm = await handle.requestPermission({ mode: 'read' });
                if (perm !== 'granted') continue;
                const file = await handle.getFile();
                const { buffer } = await decodeFileToBuffer(file);
                DAW.bufferCache.set(clip.bufferKey, buffer);
                clip.sourceDuration = buffer.duration;
                clip._peaks = peaksFromBuffer(buffer, 2000);
                refreshClipWaveImage(clip);
                console.log('[HANDLE] Auto-reloaded:', clip.fileName);
              }
            } catch(e) { console.warn('[HANDLE] Auto-reload failed for', clip.bufferKey, e.message); }
          }
        }

        // بعد از پوشه ذخیره‌شده (_audioDirHandle) لود کن
        const stillMissing = DAW.clips.filter(c => c.type !== 'chord' && c.bufferKey && !DAW.bufferCache.has(c.bufferKey));
        if (stillMissing.length > 0) {
          let dirHandle = _audioDirHandle;
          if (!dirHandle) { try { await loadDirHandle(); dirHandle = _audioDirHandle; } catch(_){} }
          if (dirHandle) {
            try {
              const perm = await dirHandle.requestPermission({ mode: 'read' });
              if (perm === 'granted') {
                const notFound = [];
                for (const ap of edCur._audioPaths) {
                  const clip = DAW.clips.find(c => c.type !== 'chord' && c.bufferKey === ap.bufferKey);
                  if (!clip || DAW.bufferCache.has(clip.bufferKey)) continue;
                  const candidates = [ap.fileName, ap.fileName ? ap.fileName.replace(/\.[^.]+$/, '') : ''];
                  let loaded = false;
                  for (const name of candidates) {
                    if (!name) continue;
                    try {
                      const fileHandle = await dirHandle.getFileHandle(name);
                      const file = await fileHandle.getFile();
                      const { buffer } = await decodeFileToBuffer(file);
                      DAW.bufferCache.set(clip.bufferKey, buffer);
                      clip.sourceDuration = buffer.duration;
                      clip._peaks = peaksFromBuffer(buffer, 2000);
                      refreshClipWaveImage(clip);
                      loaded = true;
                      break;
                    } catch(_) {}
                  }
                  if (!loaded) notFound.push(ap.fileName || 'نام‌ناشناخته');
                }
                if (notFound.length > 0) toast('فایل‌های صوتی پیدا نشد: ' + notFound.join(', '));
              }
            } catch(_) {}
          }

          // برای فایل‌هایی که هنوز گم شدند، انتخاب دستی از کاربر
          const stillMissing2 = DAW.clips.filter(c => c.type !== 'chord' && c.bufferKey && !DAW.bufferCache.has(c.bufferKey));
          if (stillMissing2.length > 0 && !isElectron) {
            try {
              const newDirHandle = await window.showDirectoryPicker({ mode: 'read' });
              await saveDirHandle(newDirHandle);
              const perm = await newDirHandle.requestPermission({ mode: 'read' });
              if (perm === 'granted') {
                for (const ap of edCur._audioPaths) {
                  const clip = DAW.clips.find(c => c.type !== 'chord' && c.bufferKey === ap.bufferKey);
                  if (!clip || DAW.bufferCache.has(clip.bufferKey)) continue;
                  for (const n of [ap.fileName, ap.fileName ? ap.fileName.replace(/\.[^.]+$/, '') : '']) {
                    if (!n) continue;
                    try {
                      const fh = await newDirHandle.getFileHandle(n);
                      const f = await fh.getFile();
                      const { buffer } = await decodeFileToBuffer(f);
                      DAW.bufferCache.set(clip.bufferKey, buffer);
                      clip.sourceDuration = buffer.duration;
                      clip._peaks = peaksFromBuffer(buffer, 2000);
                      refreshClipWaveImage(clip);
                      break;
                    } catch(_) {}
                  }
                }
              }
            } catch(_) { /* کاربر کنسل کرد */ }
          }
        }
      }
      edSyncToolbar();
      edRenderEditor();

      undoStack = [];
      undoIndex = -1;
      PERF.lastSerializedState = '';

      edSyncToolbar();
      edRenderEditor(true);
      renderAll();
      saveState();

      // Apply highlight effect
      initHighlightEffect();
      // === Performance Architecture v2: init SongDocument ===
      if (typeof rebuildSongDocumentFromEdCur === 'function') rebuildSongDocumentFromEdCur();
      // === Performance Architecture v2: init per-view settings ===
      if (typeof syncViewStylesFromEdCur === 'function') syncViewStylesFromEdCur();
    }

    // -- Unified Save/Load (Timeline + Lyrics + Audio) --
    // IndexedDB for audio blob storage
    let audioDB = null;
    function openAudioDB() {
      if (audioDB) return Promise.resolve(audioDB);
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('AchordAudioDB', 2);
        req.onupgradeneeded = e => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('audioBlobs')) db.createObjectStore('audioBlobs');
          if (!db.objectStoreNames.contains('fileHandles')) db.createObjectStore('fileHandles');
        };
        req.onsuccess = e => { audioDB = e.target.result; resolve(audioDB); };
        req.onerror = () => reject(req.error);
      });
    }

    // ===== ذخیره FileHandle در IndexedDB برای لود اتوماتیک بدون سوال =====
    async function saveFileHandle(bufferKey, handle) {
      try {
        const db = await openAudioDB();
        return new Promise((resolve, reject) => {
          const tx = db.transaction('fileHandles', 'readwrite');
          tx.objectStore('fileHandles').put(handle, bufferKey);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } catch(e) { console.warn('[HANDLE] Save error:', e); }
    }

    async function getFileHandle(bufferKey) {
      try {
        const db = await openAudioDB();
        return new Promise((resolve, reject) => {
          const tx = db.transaction('fileHandles', 'readonly');
          const req = tx.objectStore('fileHandles').get(bufferKey);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
        });
      } catch(e) { return null; }
    }
    // ===== مودال سفارشی بله/نه جای confirm() =====
    let _copyModalResolver = null;
    function askAudioCopyMode(fileName) {
  // در نسخه نصبی (Electron)، صدا همیشه به صورت مسیر ذخیره می‌شود
  if (isElectron) {
    toast(`«${fileName}» به‌صورت مسیر ذخیره شد (حجم کم)`);
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
        _copyModalResolver = resolve;
        const modal = $('audioCopyModal');
        const text = $('audioCopyModalText');
        if (text) text.textContent = `فایل «${fileName}» در پروژه کپی شود؟`;
        if (modal) modal.style.display = 'flex';
      });
    }

    /**
     * saveAudioBlobToDB — ذخیره Blob فایل صوتی در IndexedDB (نه Base64)
     *
     * این تابع برای حالتی هست که کاربر «نه» می‌زنه ولی فایل در مرورگر هست.
     * قبلاً کد showOpenFilePicker رو صدا می‌زد و دوباره از کاربر فایل می‌خواست.
     * حالا به‌جای اون، همون فایل درگ‌شده رو به‌صورت Blob در IndexedDB ذخیره می‌کنیم.
     * اینطوری برای لود بعدی، نیازی به سوال از کاربر نیست.
     *
     * @param {string} bufferKey - کلید یکتای بافر
     * @param {File|Blob} file - فایل صوتی
     * @param {string} fileName - نام فایل
     */
    async function saveAudioBlobToDB(bufferKey, file, fileName) {
      try {
        const db = await openAudioDB();
        return new Promise((resolve, reject) => {
          const tx = db.transaction('fileHandles', 'readwrite');
          // ذخیره به‌صورت Blob خام (نه Base64) — حجم کمتر و لود سریع‌تر
          const record = {
            type: 'blob',
            blob: file,
            fileName: fileName,
            size: file.size,
            lastModified: file.lastModified || Date.now()
          };
          tx.objectStore('fileHandles').put(record, bufferKey);
          tx.oncomplete = () => {
            console.log(`[BLOB] Saved to IndexedDB: ${fileName} (${(file.size/1024/1024).toFixed(2)} MB)`);
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        });
      } catch(e) {
        console.warn('[BLOB] Save error:', e);
      }
    }

    /**
     * getAudioBlobFromDB — خواندن Blob فایل صوتی از IndexedDB
     * @param {string} bufferKey
     * @returns {Promise<{blob:Blob, fileName:string}|null>}
     */
    async function getAudioBlobFromDB(bufferKey) {
      try {
        const db = await openAudioDB();
        return new Promise((resolve, reject) => {
          const tx = db.transaction('fileHandles', 'readonly');
          const req = tx.objectStore('fileHandles').get(bufferKey);
          req.onsuccess = () => {
            const result = req.result;
            if (result && result.type === 'blob' && result.blob) {
              resolve({ blob: result.blob, fileName: result.fileName });
            } else {
              resolve(null);
            }
          };
          req.onerror = () => reject(req.error);
        });
      } catch(e) { return null; }
    }
    // Event listeners for modal buttons
    document.addEventListener('DOMContentLoaded', () => {
      const yesBtn = $('audioCopyYes');
      const noBtn = $('audioCopyNo');
      if (yesBtn) yesBtn.onclick = () => { const m = $('audioCopyModal'); if (m) m.style.display = 'none'; if (_copyModalResolver) { _copyModalResolver(true); _copyModalResolver = null; } };
      if (noBtn) noBtn.onclick = () => { const m = $('audioCopyModal'); if (m) m.style.display = 'none'; if (_copyModalResolver) { _copyModalResolver(false); _copyModalResolver = null; } };
    });

    /**
     * saveAudioBlobsForProject — ذخیره فایل‌های صوتی embedded در IndexedDB
     *
     * استراتژی جدید (بهبود حجم):
     *   1. اگر فایل اصلی (Blob) در _originalBlob ذخیره شده، همون رو مستقیم ذخیره می‌کنیم
     *      (این حالت بهترین هست چون فایل MP3 اصلی بدون تغییر ذخیره می‌شه)
     *   2. در غیر این صورت، AudioBuffer رو به WAV encode می‌کنیم و با CompressionStream
     *      فشرده می‌کنیم (حدود ۵-۱۰ برابر کوچکتر از Float32Array خام)
     *
     * قبلاً این تابع Float32Array خام رو به‌صورت JSON ذخیره می‌کرد که بسیار حجیم بود
     * (یک آهنگ ۳ دقیقه‌ای = ~۱۵۰ مگابایت).
     */
    async function saveAudioBlobsForProject(projectId) {
      const db = await openAudioDB();
      return new Promise(async (resolve, reject) => {
        const tx = db.transaction('audioBlobs', 'readwrite');
        const store = tx.objectStore('audioBlobs');

        // فقط کلیپ‌هایی که _embedded:true دارند ذخیره میشوند
        const embeddedClips = DAW.clips.filter(c =>
          c.type !== 'chord' && c.bufferKey && c._embedded
        );

        // First clear old data for this project
        store.delete(projectId);

        if (embeddedClips.length === 0) { resolve(); return; }

        // ─── مرحله 1: ذخیره Blob های اصلی (اگه موجود باشن) ───
        // این fast path هست — اگه فایل MP3 اصلی رو داریم، همون رو ذخیره می‌کنیم
        const allBlobs = [];
        for (const clip of embeddedClips) {
          const key = clip.bufferKey;
          const buffer = DAW.bufferCache.get(key);
          if (!buffer) continue;

          // اگه Blob اصلی ذخیره شده، از اون استفاده کن
          if (clip._originalBlob) {
            const blob = clip._originalBlob;
            allBlobs.push({
              key,
              format: 'blob',
              mimeType: blob.type || 'audio/mpeg',
              fileName: clip.fileName || clip.name || (key + '.mp3'),
              size: blob.size,
              duration: buffer.duration,
              sampleRate: buffer.sampleRate,
              channels: buffer.numberOfChannels,
              blob: blob
            });
            console.log(`[Audio Save] Saved original blob: ${clip.fileName} (${(blob.size/1024/1024).toFixed(2)} MB)`);
          } else {
            // ─── مرحله 2: encode به WAV و فشرده‌سازی ───
            try {
              const wavBytes = audioBufferToWav(buffer);
              const compressedBlob = await compressBytes(wavBytes);
              allBlobs.push({
                key,
                format: 'wav-deflate',
                mimeType: 'application/octet-stream',
                fileName: (clip.fileName || clip.name || key).replace(/\.[^.]+$/, '') + '.wav.deflate',
                size: compressedBlob.size,
                duration: buffer.duration,
                sampleRate: buffer.sampleRate,
                channels: buffer.numberOfChannels,
                blob: compressedBlob
              });
              console.log(`[Audio Save] Saved WAV+deflate: ${clip.fileName} (raw=${(wavBytes.length/1024/1024).toFixed(2)}MB → compressed=${(compressedBlob.size/1024/1024).toFixed(2)}MB)`);
            } catch (e) {
              console.warn(`[Audio Save] Failed to encode ${clip.fileName}:`, e);
            }
          }
        }

        if (allBlobs.length === 0) { resolve(); return; }
        store.put(allBlobs, projectId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }

    /**
     * compressBytes — فشرده‌سازی Uint8Array با CompressionStream (deflate)
     */
    async function compressBytes(uint8Arr) {
      try {
        const cs = new CompressionStream('deflate');
        const writer = cs.writable.getWriter();
        writer.write(uint8Arr);
        writer.close();
        const reader = cs.readable.getReader();
        const chunks = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        const totalLen = chunks.reduce((s, c) => s + c.length, 0);
        const result = new Uint8Array(totalLen);
        let offset = 0;
        for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
        return new Blob([result], { type: 'application/octet-stream' });
      } catch (e) {
        // fallback: بدون فشرده‌سازی
        return new Blob([uint8Arr], { type: 'application/octet-stream' });
      }
    }
    async function loadAudioBlobsForProject(projectId) {
      const db = await openAudioDB();
      return new Promise(async (resolve, reject) => {
        const tx = db.transaction('audioBlobs', 'readonly');
        const store = tx.objectStore('audioBlobs');
        const req = store.get(projectId);
        req.onsuccess = async () => {
          const allBufs = req.result;
          if (!allBufs) { resolve(); return; }
          ensureAudioCtx();
          for (const entry of allBufs) {
            try {
              let buffer = null;

              if (entry.format === 'blob' && entry.blob) {
                // ─── فرمت جدید: Blob اصلی (MP3, WAV, etc.) ───
                const arrayBuffer = await entry.blob.arrayBuffer();
                buffer = await DAW.audioCtx.decodeAudioData(arrayBuffer);
                console.log(`[Audio Load] Loaded blob: ${entry.fileName}`);
              } else if (entry.format === 'wav-deflate' && entry.blob) {
                // ─── فرمت جدید: WAV فشرده‌شده با deflate ───
                const compressedBytes = new Uint8Array(await entry.blob.arrayBuffer());
                const wavBytes = await decompressBytes(compressedBytes);
                const wavBlob = new Blob([wavBytes], { type: 'audio/wav' });
                const arrayBuffer = await wavBlob.arrayBuffer();
                buffer = await DAW.audioCtx.decodeAudioData(arrayBuffer);
                console.log(`[Audio Load] Loaded WAV+deflate: ${entry.fileName}`);
              } else if (entry.data) {
                // ─── فرمت قدیمی: Float32Array ───
                const chData = Array.isArray(entry.data) ? entry.data : [entry.data];
                buffer = DAW.audioCtx.createBuffer(chData.length, entry.length, entry.sampleRate);
                chData.forEach((ch, i) => { if (i < buffer.numberOfChannels) buffer.getChannelData(i).set(ch); });
                console.log(`[Audio Load] Loaded legacy Float32: ${entry.key}`);
              }

              if (buffer) {
                DAW.bufferCache.set(entry.key, buffer);
              }
            } catch (e) {
              console.warn(`[Audio Load] Failed to load ${entry.key}:`, e);
            }
          }
          resolve();
        };
        req.onerror = () => reject(req.error);
      });
    }
    async function deleteAudioBlobsForProject(projectId) {
      try { const db = await openAudioDB(); return new Promise((resolve) => { const tx = db.transaction('audioBlobs','readwrite'); tx.objectStore('audioBlobs').delete(projectId); tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); }); } catch(e) {}
    }

    /**
     * restoreAudioForProjectSilently — لود کامل صدا برای پروژه بدون پرسش از کاربر
     *
     * این تابع معادل edInitSong برای لود صدا هست، ولی:
     *   - در arranger استفاده می‌شه (که نباید از کاربر سوال بپرسه)
     *   - اگر در حالت silent باشه، showDirectoryPicker صدا زده نمی‌شه
     *
     * ترتیب چک کردن منابع:
     *   1. IndexedDB (embedded blobs)
     *   2. filePath در Electron
     *   3. FileHandle ذخیره‌شده در IndexedDB
     *   4. _audioDirHandle ذخیره‌شده
     *   5. (فقط اگر silent=false) showDirectoryPicker
     *
     * @param {string} projectId - ID پروژه (edCur.id)
     * @param {boolean} silent - اگر true، از showDirectoryPicker استفاده نکن
     * @returns {Promise<{loaded:number, missing:number, missingNames:string[]}>}
     */
    async function restoreAudioForProjectSilently(projectId, silent = true) {
      const result = { loaded: 0, missing: 0, missingNames: [] };
      if (!edCur) return result;

      // ─── مرحله 1: IndexedDB (embedded blobs) ───
      try {
        await loadAudioBlobsForProject(projectId);
      } catch (e) {
        console.warn('[Audio Restore] IndexedDB load failed:', e);
      }

      // آپدیت sourceDuration و peaks برای کلیپ‌های که لود شدن
      DAW.clips.forEach(c => {
        if (c.type !== 'chord' && c.bufferKey && DAW.bufferCache.has(c.bufferKey)) {
          const buffer = DAW.bufferCache.get(c.bufferKey);
          if (buffer) {
            c.sourceDuration = buffer.duration;
            c._peaks = peaksFromBuffer(buffer, 2000);
            refreshClipWaveImage(c);
            result.loaded++;
          }
        }
      });

      // اگر همه کلیپ‌ها لود شدن، نیاز به بقیه مراحل نیست
      let missing = DAW.clips.filter(c =>
        c.type !== 'chord' && c.bufferKey && !DAW.bufferCache.has(c.bufferKey)
      );
      if (missing.length === 0) {
        console.log('[Audio Restore] All audio restored from IndexedDB');
        return result;
      }

      // ─── مرحله 2: filePath در Electron ───
      if (isElectron && window.electronAPI && edCur._audioPaths) {
        for (const ap of edCur._audioPaths) {
          if (!ap.filePath) continue;
          const clip = DAW.clips.find(c =>
            c.type !== 'chord' && c.bufferKey === ap.bufferKey
          );
          if (!clip || DAW.bufferCache.has(clip.bufferKey)) continue;
          try {
            console.log('[Audio Restore] Loading from path:', ap.filePath);
            const audioBuffer = await loadAudioFromHardDrive(ap.filePath);
            DAW.bufferCache.set(clip.bufferKey, audioBuffer);
            clip.sourceDuration = audioBuffer.duration;
            clip._peaks = peaksFromBuffer(audioBuffer, 2000);
            clip._filePath = ap.filePath;
            refreshClipWaveImage(clip);
            result.loaded++;
          } catch (e) {
            console.warn('[Audio Restore] File not found at path:', ap.filePath, e.message);
            // علامت‌گذاری به‌عنوان missing ولی ادامه فرآیند
            result.missing++; 
            result.missingNames.push(ap.fileName || ap.bufferKey);
          }
        }
      }

      // ─── مرحله 3a: Blob ذخیره‌شده در IndexedDB (حالت «نه» در مرورگر) ───
      missing = DAW.clips.filter(c =>
        c.type !== 'chord' && c.bufferKey && !DAW.bufferCache.has(c.bufferKey)
      );
      if (missing.length > 0) {
        for (const clip of missing) {
          try {
            const blobRecord = await getAudioBlobFromDB(clip.bufferKey);
            if (!blobRecord) continue;
            const { buffer } = await decodeFileToBuffer(blobRecord.blob);
            DAW.bufferCache.set(clip.bufferKey, buffer);
            clip.sourceDuration = buffer.duration;
            clip._peaks = peaksFromBuffer(buffer, 2000);
            refreshClipWaveImage(clip);
            result.loaded++;
            console.log('[Audio Restore] Auto-reloaded from Blob:', blobRecord.fileName);
          } catch (e) {
            console.warn('[Audio Restore] Blob reload failed for', clip.bufferKey, e.message);
          }
        }
      }

      // ─── مرحله 3b: FileHandle ذخیره‌شده در IndexedDB (مرورگر قدیمی) ───
      missing = DAW.clips.filter(c =>
        c.type !== 'chord' && c.bufferKey && !DAW.bufferCache.has(c.bufferKey)
      );
      if (missing.length > 0) {
        for (const clip of missing) {
          try {
            const handle = await getFileHandle(clip.bufferKey);
            if (!handle) continue;
            if (handle.requestPermission) {
              const perm = await handle.requestPermission({ mode: 'read' });
              if (perm !== 'granted') continue;
              const file = await handle.getFile();
              const { buffer } = await decodeFileToBuffer(file);
              DAW.bufferCache.set(clip.bufferKey, buffer);
              clip.sourceDuration = buffer.duration;
              clip._peaks = peaksFromBuffer(buffer, 2000);
              refreshClipWaveImage(clip);
              result.loaded++;
              console.log('[Audio Restore] Auto-reloaded from FileHandle:', clip.fileName);
            }
          } catch (e) {
            console.warn('[Audio Restore] FileHandle reload failed for', clip.bufferKey, e.message);
          }
        }
      }

      // ─── مرحله 4: _audioDirHandle ذخیره‌شده ───
      missing = DAW.clips.filter(c =>
        c.type !== 'chord' && c.bufferKey && !DAW.bufferCache.has(c.bufferKey)
      );
      if (missing.length > 0 && edCur._audioPaths) {
        let dirHandle = _audioDirHandle;
        if (!dirHandle) {
          try { await loadDirHandle(); dirHandle = _audioDirHandle; } catch (_) {}
        }
        if (dirHandle) {
          try {
            const perm = await dirHandle.requestPermission({ mode: 'read' });
            if (perm === 'granted') {
              for (const ap of edCur._audioPaths) {
                const clip = DAW.clips.find(c =>
                  c.type !== 'chord' && c.bufferKey === ap.bufferKey
                );
                if (!clip || DAW.bufferCache.has(clip.bufferKey)) continue;
                const candidates = [
                  ap.fileName,
                  ap.fileName ? ap.fileName.replace(/\.[^.]+$/, '') : ''
                ];
                for (const name of candidates) {
                  if (!name) continue;
                  try {
                    const fileHandle = await dirHandle.getFileHandle(name);
                    const file = await fileHandle.getFile();
                    const { buffer } = await decodeFileToBuffer(file);
                    DAW.bufferCache.set(clip.bufferKey, buffer);
                    clip.sourceDuration = buffer.duration;
                    clip._peaks = peaksFromBuffer(buffer, 2000);
                    refreshClipWaveImage(clip);
                    result.loaded++;
                    break;
                  } catch (_) {}
                }
              }
            }
          } catch (_) {}
        }
      }

      // ─── مرحله 5: (فقط غیر-silent) showDirectoryPicker ───
      if (!silent) {
        missing = DAW.clips.filter(c =>
          c.type !== 'chord' && c.bufferKey && !DAW.bufferCache.has(c.bufferKey)
        );
        if (missing.length > 0 && !isElectron && window.showDirectoryPicker) {
          try {
            const newDirHandle = await window.showDirectoryPicker({ mode: 'read' });
            await saveDirHandle(newDirHandle);
            const perm = await newDirHandle.requestPermission({ mode: 'read' });
            if (perm === 'granted') {
              for (const ap of edCur._audioPaths) {
                const clip = DAW.clips.find(c =>
                  c.type !== 'chord' && c.bufferKey === ap.bufferKey
                );
                if (!clip || DAW.bufferCache.has(clip.bufferKey)) continue;
                for (const n of [
                  ap.fileName,
                  ap.fileName ? ap.fileName.replace(/\.[^.]+$/, '') : ''
                ]) {
                  if (!n) continue;
                  try {
                    const fh = await newDirHandle.getFileHandle(n);
                    const f = await fh.getFile();
                    const { buffer } = await decodeFileToBuffer(f);
                    DAW.bufferCache.set(clip.bufferKey, buffer);
                    clip.sourceDuration = buffer.duration;
                    clip._peaks = peaksFromBuffer(buffer, 2000);
                    refreshClipWaveImage(clip);
                    result.loaded++;
                    break;
                  } catch (_) {}
                }
              }
            }
          } catch (_) { /* کاربر کنسل کرد */ }
        }
      }

      // ─── گزارش نهایی ───
      const finalMissing = DAW.clips.filter(c =>
        c.type !== 'chord' && c.bufferKey && !DAW.bufferCache.has(c.bufferKey)
      );
      result.missing = finalMissing.length;
      result.missingNames = finalMissing.map(c => c.fileName || c.bufferKey);
      if (finalMissing.length > 0) {
        console.warn(`[Audio Restore] ${finalMissing.length} clip(s) still missing:`, result.missingNames);
      } else {
        console.log(`[Audio Restore] All audio restored. Loaded: ${result.loaded}`);
      }
      return result;
    }

    /**
     * preloadAudioForSong — لود کامل صدا برای یک آهنگ مشخص، بدون دست زدن به DAW.clips یا edCur
     *
     * این تابع برای preload آهنگ بعدی در ارنجر استفاده می‌شه.
     * برخلاف restoreAudioForProjectSilently، این تابع مستقل از DAW.clips عمل می‌کنه
     * و مستقیماً از clips داخل songData استفاده می‌کنه.
     *
     * @param {Object} songData - داده‌های آهنگ (شامل _dawClips, _audioPaths, id)
     * @returns {Promise<{loaded:number, missing:number, missingNames:string[]}>}
     */
    async function preloadAudioForSong(songData) {
      const result = { loaded: 0, missing: 0, missingNames: [] };
      if (!songData) return result;

      const clips = songData._dawClips || [];
      const audioPaths = songData._audioPaths || [];

      // ساخت lookup: bufferKey → clip (فقط کلیپ‌های صوتی)
      const clipsByBufferKey = new Map();
      for (const clip of clips) {
        if (clip.type !== 'chord' && clip.bufferKey) {
          clipsByBufferKey.set(clip.bufferKey, clip);
        }
      }

      if (clipsByBufferKey.size === 0) {
        console.log('[Preload] No audio clips in song:', songData.title || songData.id);
        return result;
      }

      // شمارش کلیپ‌هایی که قبلاً لود شدن
      let missingCount = 0;
      for (const [bufferKey, clip] of clipsByBufferKey) {
        if (DAW.bufferCache.has(bufferKey)) {
          result.loaded++;
        } else {
          missingCount++;
        }
      }

      if (missingCount === 0) {
        console.log(`[Preload] All ${result.loaded} clip(s) already cached for: ${songData.title || songData.id}`);
        return result;
      }

      console.log(`[Preload] Loading ${missingCount} audio clip(s) for: ${songData.title || songData.id}`);

      // ─── مرحله 1: IndexedDB (embedded blobs) ───
      try {
        await loadAudioBlobsForProject(songData.id);
      } catch (e) {
        console.warn('[Preload] IndexedDB load failed:', e);
      }

      // بررسی مجدد: چه کلیپ‌هایی هنوز گم شدن
      let stillMissing = [...clipsByBufferKey.entries()].filter(([k]) => !DAW.bufferCache.has(k));

      // ─── مرحله 2: filePath در Electron ───
      if (stillMissing.length > 0 && isElectron && window.electronAPI && audioPaths.length > 0) {
        for (const ap of audioPaths) {
          if (!ap.filePath) continue;
          const clip = clipsByBufferKey.get(ap.bufferKey);
          if (!clip || DAW.bufferCache.has(ap.bufferKey)) continue;
          try {
            console.log('[Preload] Loading from path:', ap.filePath);
            const audioBuffer = await loadAudioFromHardDrive(ap.filePath);
            DAW.bufferCache.set(ap.bufferKey, audioBuffer);
            result.loaded++;
          } catch (e) {
            console.warn('[Preload] File not found at path:', ap.filePath, e.message);
            result.missing++;
            result.missingNames.push(ap.fileName || ap.bufferKey);
          }
        }
        stillMissing = [...clipsByBufferKey.entries()].filter(([k]) => !DAW.bufferCache.has(k));
      }

      // ─── مرحله 3a: Blob ذخیره‌شده در IndexedDB (حالت «نه» در مرورگر) ───
      if (stillMissing.length > 0) {
        for (const [bufferKey, clip] of stillMissing) {
          try {
            const blobRecord = await getAudioBlobFromDB(bufferKey);
            if (!blobRecord) continue;
            const { buffer } = await decodeFileToBuffer(blobRecord.blob);
            DAW.bufferCache.set(bufferKey, buffer);
            result.loaded++;
            console.log('[Preload] Auto-reloaded from Blob:', blobRecord.fileName);
          } catch (e) {
            console.warn('[Preload] Blob reload failed for', bufferKey, e.message);
          }
        }
        stillMissing = [...clipsByBufferKey.entries()].filter(([k]) => !DAW.bufferCache.has(k));
      }

      // ─── مرحله 3b: FileHandle ذخیره‌شده در IndexedDB (مرورگر قدیمی) ───
      if (stillMissing.length > 0) {
        for (const [bufferKey, clip] of stillMissing) {
          try {
            const handle = await getFileHandle(bufferKey);
            if (!handle) continue;
            // اگر handle یک FileSystemFileHandle هست
            if (handle.requestPermission) {
              const perm = await handle.requestPermission({ mode: 'read' });
              if (perm !== 'granted') continue;
              const file = await handle.getFile();
              const { buffer } = await decodeFileToBuffer(file);
              DAW.bufferCache.set(bufferKey, buffer);
              result.loaded++;
              console.log('[Preload] Auto-reloaded from FileHandle:', clip.fileName);
            }
          } catch (e) {
            console.warn('[Preload] FileHandle reload failed for', bufferKey, e.message);
          }
        }
        stillMissing = [...clipsByBufferKey.entries()].filter(([k]) => !DAW.bufferCache.has(k));
      }

      // ─── مرحله 4: _audioDirHandle ذخیره‌شده ───
      if (stillMissing.length > 0 && audioPaths.length > 0) {
        let dirHandle = _audioDirHandle;
        if (!dirHandle) {
          try { await loadDirHandle(); dirHandle = _audioDirHandle; } catch (_) {}
        }
        if (dirHandle) {
          try {
            const perm = await dirHandle.requestPermission({ mode: 'read' });
            if (perm === 'granted') {
              for (const ap of audioPaths) {
                const clip = clipsByBufferKey.get(ap.bufferKey);
                if (!clip || DAW.bufferCache.has(ap.bufferKey)) continue;
                const candidates = [
                  ap.fileName,
                  ap.fileName ? ap.fileName.replace(/\.[^.]+$/, '') : ''
                ];
                for (const name of candidates) {
                  if (!name) continue;
                  try {
                    const fileHandle = await dirHandle.getFileHandle(name);
                    const file = await fileHandle.getFile();
                    const { buffer } = await decodeFileToBuffer(file);
                    DAW.bufferCache.set(ap.bufferKey, buffer);
                    result.loaded++;
                    break;
                  } catch (_) {}
                }
              }
            }
          } catch (_) {}
        }
      }

      // ─── گزارش نهایی ───
      const finalMissing = [...clipsByBufferKey.entries()].filter(([k]) => !DAW.bufferCache.has(k));
      result.missing = finalMissing.length;
      result.missingNames = finalMissing.map(([k, c]) => c.fileName || k);

      if (finalMissing.length > 0) {
        console.warn(`[Preload] ${finalMissing.length} clip(s) still missing for "${songData.title}":`, result.missingNames);
      } else {
        console.log(`[Preload] ✓ All audio loaded for "${songData.title}". Total cached: ${result.loaded}`);
      }
      return result;
    }

    // ===== AUDIO BACKUP & RECOVERY =====
    function formatBytes(bytes) {
      if (bytes === 0) return '0 B';
      const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    // Fast base64 encode for Uint8Array
    function uint8ToBase64(uint8Arr) {
      const chunkSize = 65536;
      let binary = '';
      for (let i = 0; i < uint8Arr.length; i += chunkSize) {
        const chunk = uint8Arr.subarray(i, Math.min(i + chunkSize, uint8Arr.length));
        binary += String.fromCharCode.apply(null, chunk);
      }
      return btoa(binary);
    }
    function base64ToUint8(b64) {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 65536) {
        const end = Math.min(i + 65536, binary.length);
        for (let j = i; j < end; j++) bytes[j] = binary.charCodeAt(j);
      }
      return bytes;
    }

    // ===== Audio encoding via OfflineAudioContext (instant, no real-time wait) =====
    async function encodeAudioToWebM(buffer, bitrate) {
      // Use OfflineAudioContext for instant offline rendering (no real-time delay)
      const offlineCtx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
      const src = offlineCtx.createBufferSource();
      src.buffer = buffer;
      src.connect(offlineCtx.destination);
      src.start(0);
      const rendered = await offlineCtx.startRendering();
      // Convert rendered buffer to WAV (fast, reliable, no MediaRecorder needed)
      return audioBufferToWav(rendered);
    }

    function audioBufferToWav(buffer) {
      const numCh = buffer.numberOfChannels;
      const sr = buffer.sampleRate;
      const length = buffer.length;
      const bytesPerSample = 2;
      const blockAlign = numCh * bytesPerSample;
      const dataSize = length * blockAlign;
      const headerSize = 44;
      const arrayBuffer = new ArrayBuffer(headerSize + dataSize);
      const view = new DataView(arrayBuffer);
      const writeStr = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };
      writeStr(0, 'RIFF');
      view.setUint32(4, 36 + dataSize, true);
      writeStr(8, 'WAVE');
      writeStr(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, numCh, true);
      view.setUint32(24, sr, true);
      view.setUint32(28, sr * blockAlign, true);
      view.setUint16(32, blockAlign, true);
      view.setUint16(34, 16, true);
      writeStr(36, 'data');
      view.setUint32(40, dataSize, true);
      let offset = 44;
      for (let ch = 0; ch < numCh; ch++) {
        const channelData = buffer.getChannelData(ch);
        for (let i = 0; i < length; i++) {
          const sample = Math.max(-1, Math.min(1, channelData[i]));
          view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
          offset += 2;
        }
      }
      return new Uint8Array(arrayBuffer);
    }

    async function decodeWebMToBuffer(webmUint8) {
      const blob = new Blob([webmUint8], { type: 'audio/webm' });
      const url = URL.createObjectURL(blob);
      try {
        ensureAudioCtx();
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await DAW.audioCtx.decodeAudioData(arrayBuffer);
        URL.revokeObjectURL(url);
        return audioBuffer;
      } catch(e) {
        URL.revokeObjectURL(url);
        throw e;
      }
    }

    // Legacy format helpers (for importing old backup files)
    function resampleFloat32(src, srcRate, dstRate) {
      if (srcRate === dstRate) return src;
      const ratio = srcRate / dstRate;
      const newLen = Math.round(src.length / ratio);
      const out = new Float32Array(newLen);
      for (let i = 0; i < newLen; i++) {
        const pos = i * ratio; const i0 = Math.floor(pos); const i1 = Math.min(i0 + 1, src.length - 1); const frac = pos - i0;
        out[i] = src[i0] * (1 - frac) + src[i1] * frac;
      }
      return out;
    }
    async function decompressBytes(uint8Arr) {
      const ds = new DecompressionStream('deflate');
      const writer = ds.writable.getWriter();
      writer.write(uint8Arr); writer.close();
      const reader = ds.readable.getReader();
      const chunks = [];
      while (true) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); }
      const totalLen = chunks.reduce((s, c) => s + c.length, 0);
      const result = new Uint8Array(totalLen);
      let offset = 0;
      for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
      return result;
    }

    async function refreshStorageInfo() {
      try {
        const infoBar = $('storageInfoBar');
        if (!infoBar) return;
        infoBar.style.display = 'block';

        // Estimate total usage via navigator.storage
        let usageBytes = 0, quotaBytes = 0;
        if (navigator.storage && navigator.storage.estimate) {
          const est = await navigator.storage.estimate();
          usageBytes = est.usage || 0;
          quotaBytes = est.quota || 0;
        }

        // Count audio blobs specifically
        let audioCount = 0, audioBytes = 0;
        try {
          const db = await openAudioDB();
          const tx = db.transaction('audioBlobs', 'readonly');
          const store = tx.objectStore('audioBlobs');
          const allKeys = await new Promise(r => { const req = store.getAllKeys(); req.onsuccess = () => r(req.result); req.onerror = () => r([]); });
          audioCount = allKeys.length;
          for (const key of allKeys) {
            const data = await new Promise(r => { const req2 = store.get(key); req2.onsuccess = () => r(req2.result); req2.onerror = () => r(null); });
            if (data) {
              for (const entry of (Array.isArray(data) ? data : [])) {
                for (const ch of (entry.data || [])) {
                  if (ch) audioBytes += ch.byteLength || 0;
                }
              }
            }
          }
        } catch(_) {}

        // Update UI
        const pct = quotaBytes > 0 ? Math.min(100, (usageBytes / quotaBytes) * 100) : 0;
        const bar = $('storageBarInner');
        const txt = $('storageText');
        if (bar) {
          bar.style.width = pct.toFixed(1) + '%';
          bar.style.background = pct > 80 ? 'linear-gradient(90deg,#e6aa28,#ff4444)' : pct > 50 ? 'linear-gradient(90deg,#22d364,#e6aa28)' : 'linear-gradient(90deg,#22d364,#00F2FE)';
        }
        if (txt) {
          txt.innerHTML = `مجموع: ${formatBytes(usageBytes)} / ${formatBytes(quotaBytes)} (${pct.toFixed(1)}%)` +
            (audioCount > 0 ? `<br>صدا: ${audioCount} فایل · ${formatBytes(audioBytes)}` : '<br>فایل صوتی ذخیره نشده');
        }

        // Warn if near limit
        if (pct > 85) {
          toast('⚠️ حافظه مرورگر پر است! خروجی کامل بگیرید');
        }
      } catch(e) { console.warn('Storage info error:', e); }
    }

    async function edExportProjectFull() {
      if (!edCur) { toast('ترانه‌ای باز نیست'); return; }
      try {
      edCur.artist = $('edArtist')?.value || '';
      edCur.title = $('edTitle')?.value || '';
      edCur.timeSignature = $('edTimeSig')?.value || '4/4';
      edCur.tempo = parseInt($('edTempo')?.value) || 120;
      edCur.genre = $('edGenre')?.value || '';

      edCur._dawTracks = DAW.tracks.map(tr => ({
        id: tr.id, name: tr.name, icon: tr.icon, muted: tr.muted,
        solo: tr.solo, vol: tr.vol, pan: tr.pan, type: tr.type, transpose: tr.transpose || 0, laneHeight: tr.laneHeight || null
      }));
      edCur._dawClips = DAW.clips.map(c => {
        const cp = { ...c }; delete cp._peaks; delete cp.waveUrl; delete cp._fileHandle; delete cp._originalBlob;
        return cp;
      });
      edCur._dawSections = (DAW.sections || []).map(s => ({ ...s }));
      edCur._dawLoop = { loopEnabled: DAW.loopEnabled, loopA: DAW.loopA, loopB: DAW.loopB };
      // در نسخه نصبی، صدا داخل فایل پروژه ذخیره نمی‌شود
      if (isElectron) edCur._embeddedAudio = {};

      // فقط کلیپ‌های کپی‌شده (_embedded:true) رمزگذاری بشن
      const audioData = {};
      const audioClips = DAW.clips.filter(c => c.type !== 'chord' && c.bufferKey && c._embedded);
      if (audioClips.length > 0) {
        let idx = 0;
        for (const clip of audioClips) {
          const buffer = DAW.bufferCache.get(clip.bufferKey);
          if (!buffer) continue;
          idx++;
          toast(`رمزگذاری صدا ${idx}/${audioClips.length}...`);
          try {
            const encoded = await encodeAudioToWebM(buffer, 128000);
            audioData[clip.bufferKey] = { format: 'wav', data: uint8ToBase64(encoded) };
          } catch(e) {
            console.warn('WAV encode failed, using fallback:', e);
            try {
              const channels = [];
              for (let i = 0; i < buffer.numberOfChannels; i++) {
                channels.push(uint8ToBase64(new Uint8Array(buffer.getChannelData(i).buffer)));
              }
              audioData[clip.bufferKey] = { format: 'float32-b64', sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels, length: buffer.length, data: channels };
            } catch(e2) { console.warn('Fallback encode also failed:', e2); }
          }
        }
      }
      edCur._embeddedAudio = audioData;

      const linkedCount = DAW.clips.filter(c => c.type !== 'chord' && c.bufferKey && !c._embedded).length;
      const defaultName = (edCur.title || 'ترانه جدید') + ' (کامل).json';
      const data = JSON.stringify(edCur);
      const blob = new Blob([data], { type: 'application/json' });

      const sizeMB = (blob.size / (1024*1024)).toFixed(1);
      const audioCount = Object.keys(audioData).length;

      if (window.showSaveFilePicker) {
        try {
          const handle = await window.showSaveFilePicker({ suggestedName: defaultName, types: [{ description: 'فایل پروژه کامل', accept: { 'application/json': ['.json'] } }] });
          const writable = await handle.createWritable(); await writable.write(blob); await writable.close();
          toast(`خروجی ذخیره شد (${sizeMB} MB, ${audioCount} کپی + ${linkedCount} لینک)`);
          refreshStorageInfo();
          return;
        } catch (e) { if (e.name === 'AbortError') { toast('لغو شد'); return; } }
      }
      // Fallback: confirm before download
      const linkedInfo = linkedCount > 0 ? `\nلینک‌شده: ${linkedCount} فایل (بدون صدا)` : '';
      if (!confirm(`دانلود فایل: ${defaultName}\nحجم: ${sizeMB} MB\nصدا: ${audioCount} کپی‌شده${linkedInfo}\n\nذخیره در پوشه دانلود؟`)) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = defaultName; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast(`خروجی ذخیره شد (${sizeMB} MB, ${audioCount} کپی + ${linkedCount} لینک)`);
      refreshStorageInfo();
      } catch(e) { console.error('Export error:', e); toast('خطا در خروجی: ' + e.message); }
    }

    async function edSaveSong() {
  if (!edCur) return;

  edCur.artist = $('edArtist')?.value || '';
  edCur.artistKey = archArtistKey(edCur.artist);
  edCur.title = $('edTitle')?.value || '';
  edCur.timeSignature = $('edTimeSig')?.value || '4/4';
  edCur.tempo = parseInt($('edTempo')?.value) || 120;
  edCur.genre = $('edGenre')?.value || '';
  edCur.key = $('edKey')?.value || edCur.key || 'C';
  edCur.keyMode = $('edKeyMode')?.value || edCur.keyMode || 'maj';

  edCur._dawTracks = DAW.tracks.map(t => ({
    id: t.id,
    name: t.name,
    icon: t.icon,
    muted: t.muted,
    solo: t.solo,
    vol: t.vol,
    pan: t.pan,
    type: t.type,
    transpose: t.transpose || 0,
    laneHeight: t.laneHeight || null
  }));

  edCur._dawClips = DAW.clips.map(c => {
    const cp = { ...c };
    delete cp._peaks;
    delete cp.waveUrl;
    delete cp._fileHandle; // غیرقابل serialize
    delete cp._originalBlob; // Blob خام غیرقابل serialize
    return cp;
  });

  edCur._dawSections = (DAW.sections || []).map(s => ({ ...s }));

  edCur._dawLoop = { loopEnabled: DAW.loopEnabled, loopA: DAW.loopA, loopB: DAW.loopB };

  // ─── ذخیره مسیر فایل‌های صوتی (مهم برای لود مجدد در الکترون) ───
  edCur._audioPaths = [];
  for (const clip of DAW.clips) {
    if (clip.type === 'chord' || !clip.bufferKey) continue;
    edCur._audioPaths.push({
      bufferKey: clip.bufferKey,
      fileName: clip.fileName || clip.name,
      trackId: clip.trackId,
      filePath: clip._filePath || null
    });
  }

  try {
    localStorage.setItem('ed_current_song', JSON.stringify(edCur));
  } catch (e) {
    console.warn('Project save error:', e);
  }

  // Save heavy audio buffers separately with debounce
  scheduleAudioBlobSave();
  // === Performance Architecture v2: sync after save ===
  if (typeof rebuildSongDocumentFromEdCur === 'function') rebuildSongDocumentFromEdCur();
  // === Performance Architecture v2: save per-view settings ===
  if (typeof syncViewStylesToEdCur === 'function') syncViewStylesToEdCur();
}



    // ===== ARCHIVE SYSTEM =====
    const ARCH_SCHEMA_VERSION = 1;
    const ARCH_UNDO_STACK = [];
    let _archCtxSongId = null;
    let _archSelectMode = false;
    let _archSelectedIds = new Set();
    let _archCurrentTab = 'all';
    let _archViewMode = localStorage.getItem('arch_view_mode') || 'card';
    let _archDebounceTimer = null;
    let _archConfirmResolver = null;
    let _archEditSongId = null;
    let _archLoading = false;
    let _archEventsBound = false;
    let _archSearchIndex = null;

    // --- Storage (IndexedDB — ظرفیت بالا + کش همگام) ---
    let _archCache = null;
    const _dbReq = indexedDB.open('ChordSongDB', 1);
    _dbReq.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id' });
    };
    _dbReq.onsuccess = (e) => {
      window._archDB = e.target.result;
      // بارگذاری اولیه کش
      const tx = window._archDB.transaction('songs', 'readonly');
      const req = tx.objectStore('songs').getAll();
      req.onsuccess = () => { _archCache = req.result || []; };
      req.onerror = () => { _archCache = []; };
      // مهاجرت از localStorage
      try {
        const old = JSON.parse(localStorage.getItem('ed_songs_archive') || '[]');
        if (old.length) {
          const tx2 = window._archDB.transaction('songs', 'readwrite');
          old.forEach(s => tx2.objectStore('songs').put(s));
          tx2.oncomplete = () => { localStorage.removeItem('ed_songs_archive'); console.log('Migrated ' + old.length + ' songs to IndexedDB'); };
        }
      } catch(_) {}
    };
    _dbReq.onerror = () => { _archCache = JSON.parse(localStorage.getItem('ed_songs_archive') || '[]'); };

    function edGetAllSongs() {
      if (_archCache) return _archCache;
      // اگر هنوز DB باز نشده، از localStorage بخوان
      try { return JSON.parse(localStorage.getItem('ed_songs_archive') || '[]'); } catch(_) { return []; }
    }
    function edSetAllSongs(arr) {
      _archCache = arr;
      if (!window._archDB) {
        try { localStorage.setItem('ed_songs_archive', JSON.stringify(arr)); } catch(e) {
          if (e.name === 'QuotaExceededError') toast('❌ حافظه مرورگر پر است!');
        }
        return;
      }
      const tx = window._archDB.transaction('songs', 'readwrite');
      const store = tx.objectStore('songs');
      store.clear();
      arr.forEach(s => store.put(s));
    }

    // --- ID ---
    function archGenId() {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
      return Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 10);
    }

    // --- Migration ---
    function archMigrate(songs) {
      let changed = false; const seen = new Set();
      for (const s of songs) {
        if (!s.id || seen.has(s.id)) { s.id = archGenId(); changed = true; }
        seen.add(String(s.id));
        const defs = { schemaVersion: ARCH_SCHEMA_VERSION, deletedAt: null, favorite: false, categories: [], tags: [] };
        for (const [k,v] of Object.entries(defs)) { if (s[k] === undefined) { s[k] = v; changed = true; } }
        if (!s.createdAt) { s.createdAt = s.updatedAt || new Date().toISOString(); changed = true; }
        if (!s.updatedAt) { s.updatedAt = new Date().toISOString(); changed = true; }
        if (s.lastOpenedAt === undefined) { s.lastOpenedAt = null; changed = true; }
        if (s.importedAt === undefined) { s.importedAt = null; changed = true; }
        if (s.sourceFileName === undefined) { s.sourceFileName = ''; changed = true; }
        if (s.status === undefined) { s.status = 'active'; changed = true; }
        if (s.id !== undefined) s.id = String(s.id);
      }
      if (changed) edSetAllSongs(songs);
      return songs;
    }
    try { archMigrate(edGetAllSongs()); } catch(_) {}

    // --- Normalize ---
    function archNormalize(data, fileName) {
      const now = new Date().toISOString();
      const out = { ...data };
      out.id = String(data.id || archGenId());
      out.title = data.title || 'بدون نام';
      out.artist = data.artist || '';
      out.album = data.album || '';
      out.key = data.key || 'C';
      out.keyMode = data.keyMode || 'maj';
      out.tempo = data.tempo || parseInt(data.bpm) || 120;
      out.bpm = out.tempo;
      out.timeSignature = data.timeSignature || '4/4';
      out.genre = data.genre || '';
      out.tags = Array.isArray(data.tags) ? data.tags : [];
      out.categories = Array.isArray(data.categories) ? data.categories : [];
      out.favorite = !!data.favorite;
      out.status = 'active';
      out.createdAt = data.createdAt || now;
      out.updatedAt = data.updatedAt || now;
      out.lastOpenedAt = data.lastOpenedAt || null;
      out.importedAt = data.importedAt || now;
      out.sourceFileName = fileName || data.sourceFileName || '';
      out.schemaVersion = ARCH_SCHEMA_VERSION;
      out.deletedAt = null;
      return out;
    }

    // --- Search Text Extractor ---
    function archExtractSearchText(s) {
      const parts = [s.title, s.artist, s.album, s.key, s.genre, s.sourceFileName, s.notes, (s.tags||[]).join(' '), (s.categories||[]).join(' ')];
      if (s.lyrics) parts.push(s.lyrics);
      if (s.text) parts.push(s.text);
      if (Array.isArray(s.chords)) parts.push(s.chords.map(c => c.name || c).join(' '));
      if (Array.isArray(s.lines)) parts.push(s.lines.map(l => l.text || l.lyric || l).join(' '));
      if (Array.isArray(s.sections)) parts.push(s.sections.map(sec => (sec.text||'') + ' ' + (sec.title||'')).join(' '));
      if (s._dawSections) parts.push(s._dawSections.map(sec => sec.label || '').join(' '));
      return archNormText(parts.filter(Boolean).join(' '));
    }

    // --- Persian Normalizer ---
    function archNormText(s) {
      if (!s) return '';
      return s.replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[\u064B-\u065F\u0670]/g, '').replace(/\u200c/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    // Canonical artist alias map: all variants → one stable key
    const ARCH_ARTIST_ALIASES = Object.freeze({
      'هایده': 'hayedeh', 'هايده': 'hayedeh',
      'hayedeh': 'hayedeh', 'haydeh': 'hayedeh', 'hayede': 'hayedeh',
      'Hayedeh': 'hayedeh', 'Haydeh': 'hayedeh',
      'گوگوش': 'googoosh', 'googoosh': 'googoosh', 'googosh': 'googoosh',
      'gogoosh': 'googoosh', 'gogoush': 'googoosh',
      'Googoosh': 'googoosh', 'Googosh': 'googoosh',
      'داریوش': 'dariush', 'dariush': 'dariush', 'Dariush': 'dariush',
      'ابی': 'ebi', 'ebi': 'ebi', 'Ebi': 'ebi', 'EBI': 'ebi',
      'ابی ابراهیمی': 'ebi',
      'سیاوش قمیشی': 'siavash-ghomayshi', 'siavash-ghomayshi': 'siavash-ghomayshi',
      'قمیشی': 'siavash-ghomayshi', 'Siavash Ghomayshi': 'siavash-ghomayshi',
      'معین': 'moein', 'moein': 'moein', 'Moein': 'moein', 'کاشانی': 'moein',
      'حبیب': 'habib', 'habib': 'habib', 'Habib': 'habib', 'موحد': 'habib',
      'مهستی': 'mahasti', 'mahasti': 'mahasti', 'Mahasti': 'mahasti',
      'رضا صادقی': 'reza-sadeghi', 'reza sadeghi': 'reza-sadeghi',
      'Reza Sadeghi': 'reza-sadeghi', 'رضا_صادقی': 'reza-sadeghi'
    });

    /**
     * Canonical artist key: all spellings/translations of one artist → one key.
     * artist field keeps the original display name; artistKey is for grouping/filtering/image lookup.
     */
    function archArtistKey(value) {
      const normalized = archNormText(String(value == null ? '' : value));
      if (!normalized) return '_unknown';
      return ARCH_ARTIST_ALIASES[normalized] || normalized;
    }

    // Match a song artist name to a default artist
    function matchDefaultArtist(songArtist) {
      const key = archArtistKey(songArtist);
      if (key === '_unknown') return null;
      return DEFAULT_ARTISTS.find(a => {
        if (archArtistKey(a.normalizedName) === key) return true;
        if (archArtistKey(a.displayName) === key) return true;
        if (a.aliases && a.aliases.some(alias => archArtistKey(alias) === key)) return true;
        return false;
      }) || null;
    }

    // --- Undo ---
    function archPushUndo(desc) {
      ARCH_UNDO_STACK.push({ snapshot: JSON.parse(JSON.stringify(edGetAllSongs())), desc, time: Date.now() });
      if (ARCH_UNDO_STACK.length > 30) ARCH_UNDO_STACK.shift();
    }

    // --- Confirm ---
    function archConfirm(title, msg, okLabel, dangerMode) {
      return new Promise(resolve => {
        _archConfirmResolver = resolve;
        $('archConfirmTitle').textContent = title;
        $('archConfirmMsg').innerHTML = msg;
        const okBtn = $('archConfirmOk');
        okBtn.textContent = okLabel || 'تأیید';
        okBtn.className = dangerMode ? 'confirm-danger' : 'confirm-ok';
        $('archiveConfirmOverlay').classList.add('show');
      });
    }
    function archConfirmResolve(val) {
      $('archiveConfirmOverlay').classList.remove('show');
      if (_archConfirmResolver) { const r = _archConfirmResolver; _archConfirmResolver = null; r(val); }
    }

    // --- Shared Load Project Data ---
    async function loadProjectData(data, options = {}) {
      if (!data || typeof data !== 'object') throw new Error('داده پروژه نامعتبر است');
      pauseTransport(); stopAllVoices();
      DAW.clips = []; DAW.sections = []; DAW.selectedIds.clear(); DAW.selectedSectionIds = new Set();
      DAW.bufferCache.clear(); DAW.waveCache.clear();
      DAW.loopEnabled = false; DAW.loopA = 0; DAW.loopB = 10;
      isRecordingChords = false; currentRecordingClipId = null;
      edCur = JSON.parse(JSON.stringify(data));
      if (!edCur.styles) edCur.styles = {};
      const defaults = { tSize:38,tColor:'#0fa966',tFont:'Vazirmatn',tBold:true,align:'center', cSize:38,cColor:'#e6aa28',cFont:'JetBrains Mono' };
      Object.keys(defaults).forEach(k => { if (edCur.styles[k] === undefined) edCur.styles[k] = defaults[k]; });
      if (!edCur.timeSignature) edCur.timeSignature = '4/4';
      if (!edCur.tempo) edCur.tempo = 120;
      if (edCur.transpose == null) edCur.transpose = 0;
      // Fix key format: 'Am' → key='A', keyMode='min'
      if (edCur.key && edCur.key.endsWith('m') && edCur.keyMode !== 'min') {
        const cleanKey = edCur.key.replace(/m$/, '');
        if (typeof etIsValidNote === 'function' && etIsValidNote(cleanKey)) {
          edCur.key = cleanKey;
          edCur.keyMode = 'min';
        }
      }
      // Store original key if not set yet
      if (!edCur.originalKey) { edCur.originalKey = edCur.key; edCur.originalKeyMode = edCur.keyMode || 'maj'; }
      // Initialize baseChordNames if not set (original chord NAMES only, no positions)
      if (!edCur.baseChordNames || !edCur.baseChordNames.length) {
        edCur.baseChordNames = (edCur.chords || []).map(ch => ch.name || '');
      }
      // Tracks
      if (edCur._dawTracks) { DAW.tracks = JSON.parse(JSON.stringify(edCur._dawTracks)); }
      else {
        DAW.tracks = [
          { id:'t0',name:'Chord Line',icon:'♫',type:'chord' },
          { id:'t0s',name:'Section',icon:'🏷',type:'section' },
          { id:'t1',name:'Vocals',icon:'🎤',type:'audio',muted:false,solo:false,vol:0.8,pan:0,transpose:0 },
          { id:'t2',name:'Guitar',icon:'🎸',type:'audio',muted:false,solo:false,vol:0.8,pan:0,transpose:0 },
          { id:'t3',name:'Bass',icon:'🎵',type:'audio',muted:false,solo:false,vol:0.8,pan:0,transpose:0 },
          { id:'t4',name:'Keys',icon:'🎹',type:'audio',muted:false,solo:false,vol:0.8,pan:0,transpose:0 },
          { id:'t5',name:'Drums',icon:'🥁',type:'audio',muted:false,solo:false,vol:0.8,pan:0,transpose:0 }
        ];
      }
      if (edCur._dawClips) DAW.clips = JSON.parse(JSON.stringify(edCur._dawClips));
      if (edCur._dawSections) DAW.sections = JSON.parse(JSON.stringify(edCur._dawSections)); else DAW.sections = [];
      updateNextIdFromClips();
      const _oldS = DAW.clips.filter(c => c.type === 'section');
      if (_oldS.length > 0) { _oldS.forEach(c => { DAW.sections.push({ id:c.id,trackId:c.trackId,label:c.name,start:c.start,duration:c.duration,color:c.color }); }); DAW.clips = DAW.clips.filter(c => c.type !== 'section'); }
      if (edCur._dawLoop) { DAW.loopEnabled = !!edCur._dawLoop.loopEnabled; DAW.loopA = edCur._dawLoop.loopA||0; DAW.loopB = edCur._dawLoop.loopB||10; }
      ensureAudioCtx();
      DAW.tracks.forEach(t => { if (t.type === 'audio') { if (t.transpose===undefined) t.transpose=0; t._pannerNode=DAW.audioCtx.createStereoPanner(); t._gainNode=DAW.audioCtx.createGain(); t._pannerNode.connect(t._gainNode); t._gainNode.connect(DAW.masterGain); updateTrackMix(t.id); } });
      // Audio from IndexedDB (only embedded)
      try {
        await loadAudioBlobsForProject(edCur.id);
        DAW.clips.forEach(c => { if (c.type!=='chord'&&c.bufferKey&&DAW.bufferCache.has(c.bufferKey)) { const b=DAW.bufferCache.get(c.bufferKey); c.sourceDuration=b.duration; c._peaks=peaksFromBuffer(b,2000); refreshClipWaveImage(c); } });
      } catch(e) { console.warn('IndexedDB load error:', e); }
      // Audio from file paths and directory (linked files)
      const missingAudio = DAW.clips.filter(c => c.type!=='chord'&&c.bufferKey&&!DAW.bufferCache.has(c.bufferKey));
      if (missingAudio.length > 0 && edCur._audioPaths?.length > 0) {
        // اول از filePath (Electron) لود کن
        if (isElectron && window.electronAPI) {
          for (const ap of edCur._audioPaths) {
            if (!ap.filePath) continue;
            const clip = DAW.clips.find(c => c.type!=='chord' && c.bufferKey === ap.bufferKey);
            if (!clip || DAW.bufferCache.has(clip.bufferKey)) continue;
            try {
              console.log('[LINK] Loading from path:', ap.filePath);
              const audioBuffer = await loadAudioFromHardDrive(ap.filePath);
              DAW.bufferCache.set(clip.bufferKey, audioBuffer);
              clip.sourceDuration = audioBuffer.duration;
              clip._peaks = peaksFromBuffer(audioBuffer, 2000);
              clip._filePath = ap.filePath;
              refreshClipWaveImage(clip);
            } catch (e) {
              console.warn('[LINK] File not found:', ap.filePath, e.message);
            }
          }
        }
        // لود از FileHandle ذخیره‌شده در IndexedDB
        const stillAfterPath2 = DAW.clips.filter(c => c.type!=='chord'&&c.bufferKey&&!DAW.bufferCache.has(c.bufferKey));
        if (stillAfterPath2.length > 0) {
          for (const clip of stillAfterPath2) {
            try {
              const handle = await getFileHandle(clip.bufferKey);
              if (!handle) continue;
              const perm = await handle.requestPermission({ mode: 'read' });
              if (perm !== 'granted') continue;
              const file = await handle.getFile();
              const { buffer } = await decodeFileToBuffer(file);
              DAW.bufferCache.set(clip.bufferKey, buffer);
              clip.sourceDuration = buffer.duration;
              clip._peaks = peaksFromBuffer(buffer, 2000);
              refreshClipWaveImage(clip);
              console.log('[HANDLE] Auto-reloaded (loadProjectData):', clip.fileName);
            } catch(e) { console.warn('[HANDLE] Auto-reload failed:', clip.bufferKey); }
          }
        }
        // بعد از پوشه ذخیره‌شده لود کن
        const stillMissing = DAW.clips.filter(c => c.type!=='chord'&&c.bufferKey&&!DAW.bufferCache.has(c.bufferKey));
        if (stillMissing.length > 0) {
          let dh = _audioDirHandle;
          if (!dh) { try { await loadDirHandle(); dh = _audioDirHandle; } catch(_){} }
          if (!dh) { try { dh = await window.showDirectoryPicker({mode:'read'}); await saveDirHandle(dh); } catch(_){} }
          if (dh) { try { const perm = await dh.requestPermission({mode:'read'}); if (perm==='granted') { for (const ap of edCur._audioPaths) { const clip = DAW.clips.find(c=>c.type!=='chord'&&c.bufferKey===ap.bufferKey); if (!clip||DAW.bufferCache.has(clip.bufferKey)) continue; for (const n of [ap.fileName,ap.fileName?ap.fileName.replace(/\.[^.]+$/,''):'']) { if (!n) continue; try { const fh=await dh.getFileHandle(n); const f=await fh.getFile(); const {buffer}=await decodeFileToBuffer(f); DAW.bufferCache.set(clip.bufferKey,buffer); clip.sourceDuration=buffer.duration; clip._peaks=peaksFromBuffer(buffer,2000); refreshClipWaveImage(clip); break; } catch(_){} } } } } catch(_){} }
        }
      }
      undoStack=[]; undoIndex=-1; PERF.lastSerializedState='';
      edSyncToolbar(); edRenderEditor(true); renderAll(); saveState();
      const loopBtn=$('loopToggleBtn'); if (loopBtn) loopBtn.classList.toggle('loop-active',DAW.loopEnabled);
      initHighlightEffect();
      // === Performance Architecture v2: sync SongDocument ===
      if (typeof rebuildSongDocumentFromEdCur === 'function') rebuildSongDocumentFromEdCur();
      // === Performance Architecture v2: sync per-view settings ===
      if (typeof syncViewStylesFromEdCur === 'function') syncViewStylesFromEdCur();
    }

    // --- Save To Archive ---
    async function edSaveToArchive() {
      if (!edCur) return;
      edCur.artist = $('edArtist')?.value || '';
      edCur.artistKey = archArtistKey(edCur.artist);
      edCur.title = $('edTitle')?.value || '';
      edCur.timeSignature = $('edTimeSig')?.value || '4/4';
      edCur.tempo = parseInt($('edTempo')?.value) || 120;
      edCur.genre = $('edGenre')?.value || '';
      edCur.key = $('edKey')?.value || edCur.key || 'C';
      edCur.keyMode = $('edKeyMode')?.value || edCur.keyMode || 'maj';
      edCur._dawTracks = DAW.tracks.map(t => ({ id:t.id,name:t.name,icon:t.icon,muted:t.muted,solo:t.solo,vol:t.vol,pan:t.pan,type:t.type,transpose:t.transpose||0 }));
      edCur._dawClips = DAW.clips.map(c => { const cp={...c}; delete cp._peaks; delete cp.waveUrl; delete cp._fileHandle; delete cp._originalBlob; return cp; });
      edCur._dawSections = (DAW.sections||[]).map(s=>({...s}));
      edCur._dawLoop = { loopEnabled:DAW.loopEnabled, loopA:DAW.loopA, loopB:DAW.loopB };
      if (typeof saveCurrentVersion==='function') saveCurrentVersion();
      edCur._audioPaths = [];
      for (const clip of DAW.clips) {
        if (clip.type==='chord'||!clip.name) continue;
        edCur._audioPaths.push({
          bufferKey:clip.bufferKey,
          fileName:clip.fileName||clip.name,
          trackId:clip.trackId,
          filePath: clip._filePath || null
        });
      }
      edCur.updatedAt = new Date().toISOString();
      const songs = edGetAllSongs(); const idx = songs.findIndex(s=>String(s.id)===String(edCur.id));
      const data = JSON.parse(JSON.stringify(edCur));
      if (idx>-1) songs[idx]=data; else songs.unshift(data);
      edSetAllSongs(songs);
      try { await saveAudioBlobsForProject(edCur.id); } catch(e) { console.warn('Audio archive save error:',e); }
      // === Performance Architecture v2: sync after archive save ===
      if (typeof rebuildSongDocumentFromEdCur === 'function') rebuildSongDocumentFromEdCur();
    }

    // --- Save Archive to Folder ---
    function edSaveArchiveToFolder() {
      const songs = edGetAllSongs().filter(s=>!s.deletedAt);
      if (!songs.length) { toast('آرشیو خالی است'); return; }
      const data = JSON.stringify(songs.map(s=>{const d=JSON.parse(JSON.stringify(s));delete d._audioPaths;delete d._audioBlobs;return d;}),null,2);
      if (window.showSaveFilePicker) {
        window.showSaveFilePicker({ suggestedName:'archive_all_'+new Date().toISOString().slice(0,10)+'.json', types:[{description:'JSON',accept:{'application/json':['.json']}}] }).then(async fh => {
          try { const w=await fh.createWritable(); await w.write(data); await w.close(); toast(songs.length+' ترانه ذخیره شد'); } catch(e) { if (e.name!=='AbortError') toast('خطا: '+e.message); }
        }).catch(()=>{});
      } else {
        const blob=new Blob([data],{type:'application/json'}); const url=URL.createObjectURL(blob);
        const a=document.createElement('a'); a.href=url; a.download='archive_all_'+new Date().toISOString().slice(0,10)+'.json'; a.click(); URL.revokeObjectURL(url);
        toast(songs.length+' ترانه دانلود شد');
      }
    }

    // --- Ensure rawText is parsed into lyrics+chords ---
    function ensureSongParsed(song) {
      if (song.rawText && (!song.lyrics || !song.lyrics.trim()) && (!song.chords || !song.chords.length)) {
        try {
          const parsed = parseRawSongToEdCur(song);
          if (parsed.lyrics) song.lyrics = parsed.lyrics;
          if (parsed.chords && parsed.chords.length) song.chords = parsed.chords;
          // Also sync key/keyMode from parsed result
          if (parsed.key) song.key = parsed.key;
          if (parsed.keyMode) song.keyMode = parsed.keyMode;
          if (parsed.timeSignature) song.timeSignature = parsed.timeSignature;
        } catch(e) { console.warn('[PARSE] ensureSongParsed failed:', e.message, song.title); }
      }
      // Fix key format: 'Am' → key='A', keyMode='min'
      if (song.key && song.key.endsWith('m') && song.keyMode !== 'min') {
        const cleanKey = song.key.replace(/m$/, '');
        if (typeof etIsValidNote === 'function' && etIsValidNote(cleanKey)) {
          song.key = cleanKey;
          song.keyMode = 'min';
        }
      }
      if (!song.timeSignature && song.rhythm) song.timeSignature = song.rhythm;
      if (song.transpose == null) song.transpose = 0;
      return song;
    }

    // --- Import Songs (Multi) ---
    async function archImportFiles() {
      const input = document.createElement('input');
      input.type='file'; input.accept='.json'; input.multiple=true;
      input.onchange = async (e) => {
        const files = e.target.files;
        if (!files||!files.length) return;
        const existing = edGetAllSongs();
        let added=0, updated=0, errors=0;
        for (const file of files) {
          try {
            const text = await file.text();
            let data; try { data=JSON.parse(text); } catch(_) { errors++; continue; }
            if (!data||typeof data!=='object') { errors++; continue; }
            ensureSongParsed(data);
            const dup = existing.find(es=>String(es.id)===String(data.id)) || existing.find(es=>es.artist===data.artist&&es.title===data.title&&es.title);
            if (dup) { Object.assign(dup, archNormalize(data,file.name)); dup.updatedAt=new Date().toISOString(); updated++; }
            else { const song=archNormalize(data,file.name); if (!song.id) song.id=archGenId(); existing.unshift(song); added++; }
          } catch(_) { errors++; }
        }
        edSetAllSongs(existing);
        _archSearchIndex = null; _archArtistCache = null;
        if ($('archiveModal').classList.contains('show')) { archRender(); archRenderArtists(); }
        else { archRender(); edOpenArchive(); }
        toast(added+' وارد شد'+(updated?'، '+updated+' به‌روزرسانی':'')+(errors?'، '+errors+' خطا':''));
      };
      input.click();
    }
    function edImportArchiveFromJson() { archImportFiles(); }

    // --- Import from Folder (recursive: reads subfolders too) ---
    async function archImportFolder() {
      if (!window.showDirectoryPicker) {
        toast('مرورگر شما از انتخاب پوشه پشتیبانی نمی‌کند');
        return;
      }
      let dirHandle;
      try {
        dirHandle = await window.showDirectoryPicker({ mode: 'read' });
      } catch(e) { if (e.name !== 'AbortError') toast('خطا در انتخاب پوشه'); return; }

      toast('در حال خواندن فایل‌ها از پوشه...');
      const jsonFiles = [];

      async function readDirRecursive(handle, path) {
        let entries;
        try { entries = handle.entries(); } catch(_) { return; }
        for await (const [name, child] of entries) {
          const childPath = path ? path + '/' + name : name;
          try {
            if (child.kind === 'file' && name.endsWith('.json')) {
              jsonFiles.push({ handle: child, path: childPath });
            } else if (child.kind === 'directory') {
              await readDirRecursive(child, childPath);
            }
          } catch(_) { /* رد کردن فایل/پوشه خراب */ }
        }
      }

      try {
        await readDirRecursive(dirHandle, '');
      } catch(e) {
        toast('خطا در خواندن پوشه: ' + e.message);
        return;
      }

      if (!jsonFiles.length) { toast('هیچ فایل JSON در پوشه پیدا نشد'); return; }

      const existing = edGetAllSongs();
      let added = 0, updated = 0, errors = 0;

      for (const { handle: fileHandle, path: filePath } of jsonFiles) {
        try {
          const file = await fileHandle.getFile();
          const text = await file.text();
          let data; try { data = JSON.parse(text); } catch(_) { errors++; continue; }
          if (!data || typeof data !== 'object') { errors++; continue; }
          ensureSongParsed(data);
          const dup = existing.find(es => String(es.id) === String(data.id)) || existing.find(es => es.artist === data.artist && es.title === data.title && es.title);
          if (dup) { Object.assign(dup, archNormalize(data, filePath)); dup.updatedAt = new Date().toISOString(); updated++; }
          else { const song = archNormalize(data, filePath); if (!song.id) song.id = archGenId(); existing.unshift(song); added++; }
        } catch(_) { errors++; }
      }

      edSetAllSongs(existing);
      _archSearchIndex = null; _archArtistCache = null;
      if ($('archiveModal').classList.contains('show')) { archRender(); archRenderArtists(); }
      else { archRender(); edOpenArchive(); }
      toast(`${added} وارد شد${updated ? '، ' + updated + ' به‌روزرسانی' : ''}${errors ? '، ' + errors + ' خطا' : ''} (از ${jsonFiles.length} فایل)`);
    }

    // --- Import Full Archive ---
    async function archImportFullArchive() {
      const input = document.createElement('input');
      input.type='file'; input.accept='.json';
      input.onchange = async (e) => {
        const file = e.target.files[0]; if (!file) return;
        try {
          const text = await file.text();
          let imported; try { imported=JSON.parse(text); } catch(_) { toast('فرمت JSON نامعتبر'); return; }
          if (!Array.isArray(imported)) { imported = imported.songs || imported.archive || [imported]; }
          if (!Array.isArray(imported)) { toast('ساختار فایل آرشیو نامعتبر'); return; }
          const count = imported.length;
          const ok = await archConfirm('ورودی آرشیو', `فایل حاوی ${count} ترانه است. آیا با آرشیو فعلی ادغام شود؟`, 'ادغام');
          if (!ok) return;
          const existing = edGetAllSongs();
          let added=0, updated=0;
          for (const song of imported) {
            if (!song||typeof song!=='object') continue;
            ensureSongParsed(song);
            const dup = existing.find(es=>String(es.id)===String(song.id)) || existing.find(es=>es.artist===song.artist&&es.title===song.title&&es.title);
            if (dup) { Object.assign(dup, archNormalize(song,'')); dup.updatedAt=new Date().toISOString(); updated++; }
            else { const normalized=archNormalize(song,''); existing.unshift(normalized); added++; }
          }
          edSetAllSongs(existing); _archSearchIndex=null; _archArtistCache=null;
          archRender(); archRenderArtists();
          toast(added+' اضافه شد، '+updated+' به‌روزرسانی');
        } catch(err) { toast('خطا در خواندن فایل: '+err.message); }
      };
      input.click();
    }

    // --- Export ---
    function archExportSong(id) {
      const songs=edGetAllSongs(); const s=songs.find(x=>x.id===id); if (!s) return;
      const data=JSON.parse(JSON.stringify(s)); delete data._audioPaths; delete data._audioBlobs;
      const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
      const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url;
      a.download=(s.title||'song').replace(/[\/\\?%*:|"<>]/g,'_')+'.json'; a.click(); URL.revokeObjectURL(url);
    }
    function archExportAll() { edSaveArchiveToFolder(); }
    async function archBulkExport() {
      const songs=edGetAllSongs(); const selected=songs.filter(s=>_archSelectedIds.has(s.id));
      if (!selected.length) { toast('ترانه‌ای انتخاب نشده'); return; }
      if (window.showDirectoryPicker) {
        try {
          const dh = await window.showDirectoryPicker({mode:'readwrite'});
          let saved=0;
          for (const s of selected) {
            const data=JSON.parse(JSON.stringify(s)); delete data._audioPaths; delete data._audioBlobs;
            const safeName=(s.title||'song').replace(/[\/\\?%*:|"<>]/g,'_')+'.json';
            try { const fh=await dh.getFileHandle(safeName,{create:true}); const w=await fh.createWritable(); await w.write(JSON.stringify(data,null,2)); await w.close(); saved++; } catch(_){}
          }
          toast(saved+' فایل ذخیره شد');
        } catch(e) { if (e.name!=='AbortError') toast('خطا: '+e.message); }
      } else {
        const data=selected.map(s=>{const d=JSON.parse(JSON.stringify(s));delete d._audioPaths;delete d._audioBlobs;return d;});
        const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
        const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url;
        a.download='archive_export_'+new Date().toISOString().slice(0,10)+'.json'; a.click(); URL.revokeObjectURL(url);
        toast(selected.length+' ترانه خروجی گرفته شد');
      }
    }

    // --- Open / Close ---
    function edOpenArchive() { archOpen(); }
    function archOpen() {
      $('archiveList').classList.toggle('table-view', _archViewMode === 'table');
      archRender();
      archRenderArtists();
      archInitArtistSection();
      $('archiveModal').classList.add('show');
      if (!_archEventsBound) {
        _archEventsBound = true;
        $('archiveSearch').addEventListener('input', () => {
          clearTimeout(_archDebounceTimer);
          _archDebounceTimer = setTimeout(archApplyFilters, 200);
          $('archiveSearchClear').classList.toggle('show', !!$('archiveSearch').value);
        });
        ['filterSig','filterGenre','filterTempo','filterKey','filterSort'].forEach(id => $(id).addEventListener('change', archApplyFilters));
        document.addEventListener('click', (e) => { if (!e.target.closest('.archive-ctx-menu')&&!e.target.closest('.btn-menu')) $('archiveCtxMenu').classList.remove('show'); });
        $('archiveModal').addEventListener('keydown', (e) => { if (e.key==='Escape') archClose(); });
        // Event delegation on archive list
        $('archiveList').addEventListener('click', archHandleListClick);
        $('archiveList').addEventListener('keydown', archHandleListKeydown);
      }
    }
    function archClose() {
      $('archiveModal').classList.remove('show');
      $('archiveCtxMenu').classList.remove('show');
      archStopAutoScroll(); // Stop auto-scroll when closing
      // Reset fullscreen
      if (_archFullscreen) {
        _archFullscreen = false;
        const dialog = document.querySelector('.archive-modal-dialog');
        if (dialog) { dialog.style.width=''; dialog.style.height=''; dialog.style.maxWidth=''; dialog.style.maxHeight=''; dialog.style.borderRadius=''; }
      }
    }

    // --- Event Delegation ---
    function archHandleListClick(e) {
      const card = e.target.closest('[data-song-id]');
      if (!card) return;
      const id = String(card.dataset.songId);
      if (e.target.closest('[data-arch-action]')) {
        e.stopPropagation();
        const action = e.target.closest('[data-arch-action]').dataset.archAction;
        archDispatchAction(action, id, e);
        return;
      }
      // Click on card body = open
      if (!e.target.closest('.archive-card-actions')&&!e.target.closest('.archive-card-check')) {
        archLoadSong(id);
      }
    }
    function archHandleListKeydown(e) {
      if (e.key!=='Enter'&&e.key!=='Delete') return;
      const card = e.target.closest('[data-song-id]');
      if (!card) return;
      const id = String(card.dataset.songId);
      if (e.key==='Enter') archLoadSong(id);
      if (e.key==='Delete') archTrashSong(id);
    }
    function archDispatchAction(action, id, e) {
      switch(action) {
        case 'open': archLoadSong(id); break;
        case 'readonly': archLoadSongReadOnly(id); break;
        case 'edit': archEditOpen(id); break;
        case 'fav': archToggleFav(id); break;
        case 'duplicate': archDuplicateSong(id); break;
        case 'export': archExportSong(id); break;
        case 'trash': archTrashSong(id); break;
        case 'restore': archRestoreSong(id); break;
        case 'permanent-delete': archPermanentDelete(id); break;
        case 'menu': archCtxShow(e, id); break;
      }
    }

    // --- View / Tab ---
    function archSetView(mode) { _archViewMode=mode; localStorage.setItem('arch_view_mode',mode); $('archViewCard').classList.toggle('active-blue',mode==='card'); $('archViewTable').classList.toggle('active-blue',mode==='table'); $('archiveList').classList.toggle('table-view',mode==='table'); archRender(); }
    function archSetTab(tab) { _archCurrentTab=tab; document.querySelectorAll('.archive-tabs .at-tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===tab)); archRender(); }

    // --- Select ---
    function archToggleSelectMode() { _archSelectMode=!_archSelectMode; _archSelectedIds.clear(); $('archSelectBtn').classList.toggle('active-blue',_archSelectMode); $('archiveBulkBar').classList.toggle('show',_archSelectMode); archRender(); }
    function archToggleSelect(id) {
      if (_archSelectedIds.has(id)) _archSelectedIds.delete(id); else _archSelectedIds.add(id);
      $('bulkCount').textContent = _archSelectedIds.size + ' انتخاب شده';
      archSyncSelectAllCheckbox(); archRender();
    }
    function archSelectAll(checked) {
      const visible = archGetVisibleSongIds();
      if (checked) visible.forEach(id => _archSelectedIds.add(id));
      else visible.forEach(id => _archSelectedIds.delete(id));
      $('bulkCount').textContent = _archSelectedIds.size + ' انتخاب شده';
      archRender();
    }
    function archSyncSelectAllCheckbox() {
      const cb = $('archiveList').querySelector('.arch-select-all-cb');
      if (!cb) return;
      const visible = archGetVisibleSongIds();
      if (!visible.length) { cb.checked=false; cb.indeterminate=false; return; }
      const count = visible.filter(id => _archSelectedIds.has(id)).length;
      cb.checked = count===visible.length;
      cb.indeterminate = count>0&&count<visible.length;
    }
    function archGetVisibleSongIds() {
      const rows = $('archiveList').querySelectorAll('[data-song-id]');
      return Array.from(rows).map(r => String(r.dataset.songId));
    }
    function archGetFilteredSongs() {
      return edGetAllSongs().filter(s => { if (_archCurrentTab==='fav') return !s.deletedAt&&s.favorite; if (_archCurrentTab==='trash') return !!s.deletedAt; return !s.deletedAt; });
    }

    // --- Filters ---
    function archApplyFilters() { archRender(); }
    function archClearFilters() { $('archiveSearch').value=''; $('archiveSearchClear').classList.remove('show'); ['filterSig','filterGenre','filterTempo','filterKey'].forEach(id=>$(id).value=''); $('filterSort').value='newest'; _archArtistFilter=null; archRenderArtists(); archRender(); archUpdateActiveFilters(); }

    // --- Main Render ---
    function archRender() {
      const allSongs = edGetAllSongs();
      const q = archNormText($('archiveSearch')?.value||'');
      const sig = $('filterSig')?.value||'';
      const genre = $('filterGenre')?.value||'';
      const tempoRange = $('filterTempo')?.value||'';
      const keyFilter = $('filterKey')?.value||'';
      const sort = $('filterSort')?.value||'newest';
      const genreMap = {sad:'غمگین',happy:'شاد',heavy:'سنگین',romantic:'عاشقانه',energetic:'انرژیک',calm:'آرام',epic:'حماسی',pop:'پاپ',rock:'راک',jazz:'جاز',classical:'کلاسیک',folk:'سنتی',electronic:'الکترونیک',hiphop:'هیپ‌هاپ',other:'سایر'};
      const activeAll = allSongs.filter(s=>!s.deletedAt);
      $('tabCountAll').textContent=activeAll.length;
      $('tabCountFav').textContent=activeAll.filter(s=>s.favorite).length;
      $('tabCountTrash').textContent=allSongs.filter(s=>s.deletedAt).length;
      $('archiveTotalCount').textContent=`(${activeAll.length} ترانه)`;
      let songs;
      if (_archCurrentTab==='fav') songs=activeAll.filter(s=>s.favorite);
      else if (_archCurrentTab==='trash') songs=allSongs.filter(s=>s.deletedAt);
      else songs=activeAll;
      songs = songs.filter(s => {
        if (q && !archExtractSearchText(s).includes(q)) return false;
        if (_archArtistFilter) {
          const rawArtist = s.artist || s.artistName || s.singer || '';
          const matched = matchDefaultArtist(rawArtist);
          const songKey = matched ? archArtistKey(matched.normalizedName) : archArtistKey(rawArtist);
          if (songKey !== _archArtistFilter) return false;
        }
        if (sig && s.timeSignature!==sig) return false;
        if (genre && s.genre!==genre) return false;
        if (keyFilter === '_maj' && s.keyMode !== 'maj') return false;
        else if (keyFilter === '_min' && s.keyMode !== 'min') return false;
        else if (keyFilter && keyFilter !== '_maj' && keyFilter !== '_min' && s.key !== keyFilter) return false;
        if (tempoRange) { const bpm=s.tempo||s.bpm||120; if (tempoRange==='slow'&&bpm>80) return false; if (tempoRange==='mid'&&(bpm<=80||bpm>120)) return false; if (tempoRange==='fast'&&(bpm<=120||bpm>160)) return false; if (tempoRange==='vfast'&&bpm<=160) return false; }
        return true;
      });
      songs.sort((a,b) => { switch(sort) { case 'newest':return (b.createdAt||'').localeCompare(a.createdAt||''); case 'oldest':return (a.createdAt||'').localeCompare(b.createdAt||''); case 'title':return (a.title||'').localeCompare(b.title||'','fa'); case 'artist':return (a.artist||'').localeCompare(b.artist||'','fa'); case 'lastEdit':return (b.updatedAt||'').localeCompare(a.updatedAt||''); case 'lastOpen':return (b.lastOpenedAt||'').localeCompare(a.lastOpenedAt||''); case 'key':return (a.key||'').localeCompare(b.key||''); case 'bpm':return (a.tempo||0)-(b.tempo||0); default:return 0; } });
      $('archiveResultCount').textContent=songs.length+' نتیجه';
      const isTrash=_archCurrentTab==='trash';
      $('archiveStatusText').textContent=isTrash?'سطل زباله':_archCurrentTab==='fav'?'علاقه‌مندی‌ها':'همه ترانه‌ها';
      $('archiveFilterBar').style.display=isTrash?'none':'';
      const list=$('archiveList'); list.innerHTML='';
      if (!songs.length) { list.innerHTML=`<div class="archive-empty"><div class="archive-empty-icon">${isTrash?'🗑':'🎵'}</div>${q?'نتیجه‌ای یافت نشد':isTrash?'سطل زباله خالی است':_archCurrentTab==='fav'?'ترانه‌ای در علاقه‌مندی نیست':'آرشیو خالی است'}</div>`; return; }
      const activeId=edCur?.id;
      if (_archViewMode==='table') {
        let headerHtml='<table class="archive-table archive-table-header"><thead><tr>';
        if (_archSelectMode) headerHtml+='<th style="width:36px;"><input type="checkbox" class="arch-select-all-cb archive-card-check" onchange="archSelectAll(this.checked)" aria-label="انتخاب همه"></th>';
        headerHtml+='<th>عنوان</th><th>خواننده</th><th>گام</th><th>BPM</th><th>میزان</th><th>تاریخ</th><th>عملیات</th></tr></thead></table>';
        let bodyHtml='<div class="archive-table-body"><table class="archive-table archive-table-body-inner"><tbody>';
        for (const s of songs) {
          const kl=s.key?s.key+((s.keyMode||'maj')==='min'?'m':''):'—';
          const ds=s.updatedAt?new Date(s.updatedAt).toLocaleDateString('fa-IR'):'—';
          bodyHtml+=`<tr class="${s.id===activeId?'active-load':''} ${_archSelectedIds.has(s.id)?'selected-row':''}" data-song-id="${s.id}" tabindex="0">`;
          if (_archSelectMode) bodyHtml+=`<td style="width:36px;"><input type="checkbox" class="archive-card-check" ${_archSelectedIds.has(s.id)?'checked':''} onclick="event.stopPropagation();archToggleSelect('${s.id}')" aria-label="انتخاب"></td>`;
          bodyHtml+=`<td style="font-weight:700;">${escH(s.title||'بدون نام')}</td><td>${escH(s.artist||'—')}</td><td style="color:#FFA500;font-weight:700;font-family:JetBrains Mono,monospace;">${kl}</td><td style="color:#FF6BA8;">${s.tempo||s.bpm||'—'}</td><td>${s.timeSignature||'—'}</td><td style="font-size:0.72rem;color:var(--text-secondary);">${ds}</td>`;
          bodyHtml+=`<td><div class="at-actions"><button data-arch-action="open" data-song-id="${s.id}" title="بازکردن" aria-label="بازکردن">▶</button> <button data-arch-action="menu" data-song-id="${s.id}" title="بیشتر" aria-label="بیشتر">⋯</button></div></td></tr>`;
        }
        bodyHtml+='</tbody></table></div>';
        list.innerHTML=headerHtml+bodyHtml;
        // Sync select all
        requestAnimationFrame(archSyncSelectAllCheckbox);
      } else {
        for (const s of songs) {
          const tags=[];
          if (s.timeSignature) tags.push(`<span class="archive-tag archive-tag-sig">${s.timeSignature}</span>`);
          if (s.tempo||s.bpm) tags.push(`<span class="archive-tag archive-tag-tempo">${s.tempo||s.bpm} BPM</span>`);
          if (s.key) { const kl=s.key+((s.keyMode||'maj')==='min'?'m':''); tags.push(`<span class="archive-tag archive-tag-key">${kl}</span>`); }
          if (s.genre&&genreMap[s.genre]) tags.push(`<span class="archive-tag archive-tag-genre">${genreMap[s.genre]}</span>`);
          if (s.categories?.length) s.categories.forEach(c=>tags.push(`<span class="archive-tag archive-tag-cat">${escH(c)}</span>`));
          const ds=s.updatedAt?new Date(s.updatedAt).toLocaleDateString('fa-IR'):'';
          const isTrashed=!!s.deletedAt;
          const div=document.createElement('div');
          div.className='archive-card'+(s.id===activeId?' active-load':'')+(s.favorite?' fav-card':'');
          div.dataset.songId=s.id; div.tabIndex=0; div.setAttribute('role','button');
          div.setAttribute('aria-label',(s.title||'بدون نام')+' '+(s.artist||''));
          let inner='';
          if (_archSelectMode) inner+=`<input type="checkbox" class="archive-card-check" ${_archSelectedIds.has(s.id)?'checked':''} onclick="event.stopPropagation();archToggleSelect('${s.id}')" aria-label="انتخاب">`;
          inner+=`<div class="archive-card-body"><div class="archive-card-top"><div class="archive-card-title">${escH(s.title||'بدون نام')}</div></div><div class="archive-card-artist">${escH(s.artist||'—')}</div>`;
          if (tags.length) inner+=`<div class="archive-card-meta">${tags.join('')}</div>`;
          if (ds) inner+=`<div class="archive-card-date">${isTrashed?'حذف شده: ':''}${ds}</div>`;
          inner+=`</div><div class="archive-card-actions">`;
          inner+=`<button data-arch-action="fav" data-song-id="${s.id}" class="btn-fav ${s.favorite?'is-fav':''}" title="${s.favorite?'حذف از علاقه‌مندی':'افزودن به علاقه‌مندی'}" aria-label="علاقه‌مندی" type="button">${s.favorite?'⭐':'☆'}</button>`;
          if (isTrashed) {
            inner+=`<button data-arch-action="restore" data-song-id="${s.id}" class="btn-load" title="بازیابی" aria-label="بازیابی" type="button">♻️</button>`;
            inner+=`<button data-arch-action="permanent-delete" data-song-id="${s.id}" class="btn-del" title="حذف دائمی" aria-label="حذف دائمی" type="button">✕</button>`;
          } else {
            inner+=`<button data-arch-action="open" data-song-id="${s.id}" class="btn-load" title="بازکردن" aria-label="بازکردن" type="button">▶</button>`;
            inner+=`<button data-arch-action="menu" data-song-id="${s.id}" class="btn-menu" title="بیشتر" aria-label="بیشتر" type="button">⋯</button>`;
          }
          inner+=`</div>`; div.innerHTML=inner; list.appendChild(div);
        }
        requestAnimationFrame(archSyncSelectAllCheckbox);
      }
    }
    function escH(s) { const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }

    // --- Load Song (Main) ---
    async function archLoadSong(id) {
      if (_archLoading) return;
      _archLoading = true;
      try {
        const songs = edGetAllSongs();
        const s = songs.find(x => String(x.id) === String(id));
        if (!s || s.deletedAt) { toast('ترانه یافت نشد'); _archLoading=false; return; }
        toast('در حال باز کردن ترانه...');
        // Parse rawText if lyrics/chords are missing (bulk import case)
        ensureSongParsed(s);
        // Check unsaved changes: undoStack.length > 1 means user made changes after loading
        if (edCur && undoStack.length > 1) {
          const ok = await archConfirm('پروژه ذخیره نشده', 'تغییرات ذخیره‌نشده‌ای وجود دارد. آیا می‌خواهید قبل از لود ذخیره کنید؟', 'ذخیره و لود', false);
          if (ok) await edSaveToArchive();
        }
        // Close archive FIRST to prevent any UI blocking
        archClose();
        // Load project
        await loadProjectData(s);
        // Update lastOpenedAt
        const all2 = edGetAllSongs();
        const idx2 = all2.findIndex(x => String(x.id) === String(edCur.id));
        if (idx2 > -1) { all2[idx2].lastOpenedAt = new Date().toISOString(); edSetAllSongs(all2); }
        toast('پروژه لود شد: ' + (edCur.title || 'بدون نام'));
      } catch(err) {
        console.error('Archive load error:', err);
        toast('خطا در لود ترانه: ' + (err.message || 'خطای ناشناخته'));
        // Do NOT close archive on error
      } finally {
        _archLoading = false;
      }
    }
    function edLoadFromArchive(id) { archLoadSong(id); }

    // --- Load Read-Only ---
    async function archLoadSongReadOnly(id) {
      if (_archLoading) return;
      _archLoading = true;
      try {
        const songs = edGetAllSongs();
        const s = songs.find(x => String(x.id) === String(id));
        if (!s || s.deletedAt) { toast('ترانه یافت نشد'); _archLoading=false; return; }
        toast('در حال باز کردن ترانه...');
        // Parse rawText if lyrics/chords are missing (bulk import case)
        ensureSongParsed(s);
        archClose();
        await loadProjectData(s);
        // Enable read-only mode
        if (typeof editorState !== 'undefined') editorState.readOnly = true;
        else window._editorReadOnly = true;
        const all2 = edGetAllSongs();
        const idx2 = all2.findIndex(x => String(x.id) === String(edCur.id));
        if (idx2 > -1) { all2[idx2].lastOpenedAt = new Date().toISOString(); edSetAllSongs(all2); }
        // Show read-only banner
        archShowReadOnlyBanner();
        toast('ترانه در حالت فقط‌خواندنی باز شد');
      } catch(err) {
        console.error('Archive readonly load error:', err);
        toast('خطا در لود ترانه: ' + (err.message || 'خطای ناشناخته'));
      } finally { _archLoading = false; }
    }
    function archShowReadOnlyBanner() {
      let banner = $('readOnlyBanner');
      if (!banner) { banner = document.createElement('div'); banner.id = 'readOnlyBanner'; banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:rgba(255,165,0,0.95);color:#000;text-align:center;padding:8px;font-weight:700;font-size:0.85rem;display:flex;justify-content:center;align-items:center;gap:12px;'; document.body.appendChild(banner); }
      banner.innerHTML = '👁 حالت فقط‌خواندنی | <button onclick="archExitReadOnly()" style="background:#000;color:#fff;border:none;padding:4px 12px;border-radius:6px;cursor:pointer;font-weight:700;" type="button">خروج از فقط‌خواندنی</button> <button onclick="archCreateEditableCopy()" style="background:#fff;color:#000;border:none;padding:4px 12px;border-radius:6px;cursor:pointer;font-weight:700;" type="button">ایجاد نسخه قابل ویرایش</button>';
      banner.style.display = 'flex';
    }
    function archExitReadOnly() {
      if (typeof editorState !== 'undefined') editorState.readOnly = false;
      else window._editorReadOnly = false;
      const b = $('readOnlyBanner'); if (b) b.remove();
      toast('حالت فقط‌خواندنی غیرفعال شد');
    }
    async function archCreateEditableCopy() {
      if (!edCur) return;
      archExitReadOnly();
      const copy = JSON.parse(JSON.stringify(edCur));
      copy.id = archGenId();
      copy.title = (copy.title || 'بدون نام') + ' (نسخه قابل ویرایش)';
      copy.createdAt = new Date().toISOString();
      copy.updatedAt = new Date().toISOString();
      const songs = edGetAllSongs(); songs.unshift(copy); edSetAllSongs(songs);
      edCur = copy;
      toast('نسخه قابل ویرایش ساخته شد');
    }

    // --- Bulk Actions ---
    async function archBulkTrash() {
      if (!_archSelectedIds.size) return;
      const ok = await archConfirm('انتقال به سطل زباله', `${_archSelectedIds.size} ترانه به سطل زباله منتقل شود؟`, 'انتقال');
      if (!ok) return;
      archPushUndo('انتقال گروهی');
      const songs = edGetAllSongs(); const now = new Date().toISOString();
      songs.forEach(s=>{if(_archSelectedIds.has(String(s.id)))s.deletedAt=now;});
      edSetAllSongs(songs); _archSelectedIds.clear(); _archSelectMode=false;
      $('archiveBulkBar').classList.remove('show'); $('archSelectBtn').classList.remove('active-blue');
      archRender(); archRenderArtists(); archUpdateActiveFilters(); toast('ترانه‌ها به سطل زباله منتقل شدند');
    }
    async function archBulkFav(add) {
      if (!_archSelectedIds.size) return;
      archPushUndo(add?'افزودن گروهی':'حذف گروهی علاقه‌مندی');
      const songs=edGetAllSongs(); songs.forEach(s=>{if(_archSelectedIds.has(String(s.id)))s.favorite=add;});
      edSetAllSongs(songs); archRender(); archRenderArtists(); archUpdateActiveFilters(); toast(add?'به علاقه‌مندی اضافه شد':'از علاقه‌مندی حذف شد');
    }

    // --- Delete / Trash / Restore ---
    async function archTrashSong(id) {
      const songs=edGetAllSongs(); const s=songs.find(x=>String(x.id)===String(id)); if (!s) return;
      const ok=await archConfirm('انتقال به سطل زباله',`ترانه «${escH(s.title||'بدون نام')}» به سطل زباله منتقل شود؟`,'انتقال');
      if (!ok) return;
      archPushUndo('انتقال به سطل زباله'); s.deletedAt=new Date().toISOString();
      edSetAllSongs(songs); archRender(); archRenderArtists(); archUpdateActiveFilters(); toast('ترانه به سطل زباله منتقل شد');
    }
    async function archRestoreSong(id) {
      archPushUndo('بازیابی'); const songs=edGetAllSongs(); const s=songs.find(x=>String(x.id)===String(id));
      if (s) { s.deletedAt=null; s.updatedAt=new Date().toISOString(); }
      edSetAllSongs(songs); archRender(); archRenderArtists(); archUpdateActiveFilters(); toast('ترانه بازیابی شد');
    }
    async function archPermanentDelete(id) {
      const songs=edGetAllSongs(); const s=songs.find(x=>String(x.id)===String(id)); if (!s) return;
      const ok=await archConfirm('حذف دائمی',`<strong>⚠️ این عمل غیرقابل بازگشت است!</strong><br>ترانه «${escH(s.title||'بدون نام')}» برای همیشه حذف خواهد شد.`,'حذف دائمی',true);
      if (!ok) return;
      archPushUndo('حذف دائمی');
      const idx=songs.findIndex(x=>String(x.id)===String(id)); if (idx>-1) songs.splice(idx,1);
      edSetAllSongs(songs); try{await deleteAudioBlobsForProject(id);}catch(_){} archRender(); archRenderArtists(); archUpdateActiveFilters(); toast('ترانه برای همیشه حذف شد');
    }
    function edDeleteFromArchive(id) { archTrashSong(id); }

    // --- Favorite ---
    function archToggleFav(id) {
      archPushUndo('تغییر علاقه‌مندی'); const songs=edGetAllSongs(); const s=songs.find(x=>String(x.id)===String(id));
      if (s) s.favorite=!s.favorite; edSetAllSongs(songs); archRender();
    }

    // --- Context Menu ---
    function archCtxShow(e, id) {
      _archCtxSongId=id; const menu=$('archiveCtxMenu');
      menu.style.left=Math.min(e.clientX,window.innerWidth-220)+'px';
      menu.style.top=Math.min(e.clientY,window.innerHeight-300)+'px';
      menu.classList.add('show'); e.stopPropagation();
    }
    async function archCtxAction(action) {
      $('archiveCtxMenu').classList.remove('show'); const id=_archCtxSongId; if (!id) return;
      archDispatchAction(action, id, {stopPropagation:()=>{}});
    }

    // --- Duplicate ---
    async function archDuplicateSong(id) {
      const songs=edGetAllSongs(); const s=songs.find(x=>String(x.id)===String(id)); if (!s) return;
      const copy=JSON.parse(JSON.stringify(s)); copy.id=archGenId();
      copy.title=(copy.title||'بدون نام')+' (کپی)';
      copy.createdAt=new Date().toISOString(); copy.updatedAt=new Date().toISOString(); copy.lastOpenedAt=null;
      songs.unshift(copy); edSetAllSongs(songs); _archSearchIndex=null; archRender(); archRenderArtists(); archUpdateActiveFilters(); toast('نسخه کپی ساخته شد');
    }

    // --- Edit Metadata ---
    function archEditOpen(id) {
      const songs=edGetAllSongs(); const s=songs.find(x=>String(x.id)===String(id)); if (!s) return;
      _archEditSongId=id;
      $('aeTitle').value=s.title||''; $('aeArtist').value=s.artist||''; $('aeAlbum').value=s.album||'';
      $('aeKey').value=s.key||'C'; $('aeKeyMode').value=s.keyMode||'maj';
      $('aeBpm').value=s.tempo||s.bpm||120; $('aeTimeSig').value=s.timeSignature||'4/4';
      $('aeGenre').value=s.genre||''; $('aeCategory').value=(s.categories||[]).join(', ');
      $('aeNotes').value=s.notes||'';
      const ks=$('aeKey'); if (ks.options.length<=1) ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'].forEach(n=>ks.add(new Option(n,n)));
      $('archiveEditOverlay').classList.add('show');
    }
    function archEditClose() { $('archiveEditOverlay').classList.remove('show'); _archEditSongId=null; }
    function archEditSave() {
      if (!_archEditSongId) return;
      archPushUndo('ویرایش مشخصات'); const songs=edGetAllSongs(); const s=songs.find(x=>String(x.id)===String(_archEditSongId));
      if (!s) return;
      s.title=$('aeTitle').value.trim()||'بدون نام'; s.artist=$('aeArtist').value.trim(); s.artistKey=archArtistKey(s.artist); s.album=$('aeAlbum').value.trim();
      s.key=$('aeKey').value; s.keyMode=$('aeKeyMode').value; s.tempo=parseInt($('aeBpm').value)||120; s.bpm=s.tempo;
      s.timeSignature=$('aeTimeSig').value; s.genre=$('aeGenre').value;
      s.categories=$('aeCategory').value.split(',').map(c=>c.trim()).filter(Boolean);
      s.notes=$('aeNotes').value.trim(); s.updatedAt=new Date().toISOString();
      edSetAllSongs(songs); _archSearchIndex=null; _archArtistCache=null; archEditClose(); archRender(); archRenderArtists(); archUpdateActiveFilters(); toast('مشخصات به‌روزرسانی شد');
    }

    // --- Refresh ---
    function archRefresh() { _archSearchIndex=null; _archArtistCache=null; archMigrate(edGetAllSongs()); archRender(); archRenderArtists(); toast('آرشیو تازه‌سازی شد'); }

    // ===== ARTIST SLIDER SYSTEM =====
    let _archArtistCache = null;
    let _archArtistFilter = null;
    let _archArtistSliderPos = 0;
    let _archArtistSectionCollapsed = localStorage.getItem('arch_artists_collapsed') === 'true';
    let _archFullscreen = false;
    let _archArtistCtxTarget = null;

    // ===== DEFAULT ARTISTS =====
const DEFAULT_ARTISTS = [
  {
    id: "hayedeh",
    displayName: "هایده",
    normalizedName: "hayedeh",
    aliases: ["هایده", "هايده", "Hayedeh", "hayedeh", "Haydeh", "haydeh", "حیدری"],
    image: { type: "bundled", src: "./assets/artists/hayedeh.jpg" },
    favorite: false
  },
  {
    id: "googoosh",
    displayName: "گوگوش",
    normalizedName: "googoosh",
    aliases: ["گوگوش", "Googoosh", "googoosh", "Googosh", "googosh", "بیژن"],
    image: { type: "bundled", src: "./assets/artists/googosh.jpg" },
    favorite: false
  },
  {
    id: "dariush",
    displayName: "داریوش",
    normalizedName: "dariush",
    aliases: ["داریوش", "Dariush", "dariush", "اقبال"],
    image: { type: "bundled", src: "./assets/artists/dariush.jpg" },
    favorite: false
  },
  {
    id: "ebi",
    displayName: "ابی",
    normalizedName: "ebi",
    aliases: ["ابی", "Ebi", "ebi", "EBI", "ابی ابراهیمی"],
    image: { type: "bundled", src: "./assets/artists/ebi.jpg" },
    favorite: false
  },
  {
    id: "siavash-ghomayshi",
    displayName: "سیاوش قمیشی",
    normalizedName: "siavash-ghomayshi",
    aliases: ["سیاوش قمیشی", "Siavash Ghomayshi", "siavash-ghomayshi", "قمیشی"],
    image: { type: "bundled", src: "./assets/artists/siavash-ghomayshi.jpg" },
    favorite: false
  },
  {
    id: "moein",
    displayName: "معین",
    normalizedName: "moein",
    aliases: ["معین", "Moein", "moein", "کاشانی"],
    image: { type: "bundled", src: "./assets/artists/moein.jpg" },
    favorite: false
  },
  {
    id: "habib",
    displayName: "حبیب",
    normalizedName: "habib",
    aliases: ["حبیب", "Habib", "habib", "موحد"],
    image: { type: "bundled", src: "./assets/artists/habib.jpg" },
    favorite: false
  },
  {
    id: "mahasti",
    displayName: "مهستی",
    normalizedName: "mahasti",
    aliases: ["هاشمی"],
    image: { type: "bundled", src: "./assets/artists/mahasti.jpg" },
    favorite: false
  },
  {
    id: "aref",
    displayName: "عارف",
    normalizedName: "aref",
    aliases: ["_avlazm"],
    image: { type: "bundled", src: "./assets/artists/aref.jpg" },
    favorite: false
  },
  {
    id: "farhamz-aslani",
    displayName: "فرامرز اصلانی",
    normalizedName: "farhamz-aslani",
    aliases: ["فرامرز", "اصلانی", "فرامرز اصلانی"],
    image: { type: "bundled", src: "./assets/artists/farhamz-aslani.jpg" },
    favorite: false
  },
  {
    id: "martik",
    displayName: "مارتیک",
    normalizedName: "martik",
    aliases: ["ترپتیان"],
    image: { type: "bundled", src: "./assets/artists/martik.jpg" },
    favorite: false
  },
  {
    id: "sheyad-ghambari",
    displayName: "شهیار قنبری",
    normalizedName: "sheyad-ghambari",
    aliases: ["قنبری"],
    image: { type: "bundled", src: "./assets/artists/sheyad-ghambari.jpg" },
    favorite: false
  },
  {
    id: "andy",
    displayName: "اندی",
    normalizedName: "andy",
    aliases: ["سیسجنگ"],
    image: { type: "bundled", src: "./assets/artists/andy.jpg" },
    favorite: false
  },
  {
    id: "leila-forouhar",
    displayName: "لیلا فروهر",
    normalizedName: "leila-forouhar",
    aliases: ["فروهر"],
    image: { type: "bundled", src: "./assets/artists/leila-forouhar.jpg" },
    favorite: false
  },
  {
    id: "sattar",
    displayName: "ستار",
    normalizedName: "sattar",
    aliases: ["صدرالدین"],
    image: { type: "bundled", src: "./assets/artists/sattar.jpg" },
    favorite: false
  },
  {
    id: "farhad",
    displayName: "فرهاد",
    normalizedName: "farhad",
    aliases: ["شکیبا"],
    image: { type: "bundled", src: "./assets/artists/farhad.jpg" },
    favorite: false
  },
  {
    id: "shohreh",
    displayName: "شهره",
    normalizedName: "shohreh",
    aliases: ["سعادتمند"],
    image: { type: "bundled", src: "./assets/artists/shohreh.jpg" },
    favorite: false
  },
  {
    id: "marjan",
    displayName: "مرجان",
    normalizedName: "marjan",
    aliases: ["سعادت‌مند"],
    image: { type: "bundled", src: "./assets/artists/marjan.jpg" },
    favorite: false
  },
  {
    id: "homaira",
    displayName: "حمیرا",
    normalizedName: "homaira",
    aliases: [],
    image: { type: "bundled", src: "./assets/artists/homaira.jpg" },
    favorite: false
  },
  {
    id: "vigen",
    displayName: "ویگن",
    normalizedName: "vigen",
    aliases: ["دردیریان"],
    image: { type: "bundled", src: "./assets/artists/vigen.jpg" },
    favorite: false
  },
  {
    id: "kourosh-yaghmaei",
    displayName: "کوروش یغمایی",
    normalizedName: "kourosh-yaghmaei",
    aliases: ["یغمایی"],
    image: { type: "bundled", src: "./assets/artists/kourosh-yaghmaei.jpg" },
    favorite: false
  }
];



    // Avatar color generator (deterministic from name)
    function archAvatarColor(name) {
      const colors = ['#E53935','#1E88E5','#43A047','#FB8C00','#8E24AA','#00ACC1','#F4511E','#3949AB','#00897B','#D81B60','#5E35B1','#039BE5','#7CB342','#FFB300','#6D4C41','#546E7A'];
      let hash = 0;
      for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
      return colors[Math.abs(hash) % colors.length];
    }

    // Get initials from name
    function archGetInitials(name) {
      if (!name || name === 'نامشخص') return '?';
      const parts = name.trim().split(/\s+/);
      if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
      return (parts[0].charAt(0) + parts[parts.length-1].charAt(0)).toUpperCase();
    }

    // ===== ARTIST IMAGE MANAGEMENT =====
    const ARCH_IMG_MAX_SIZE = 512;
    const ARCH_IMG_MAX_BYTES = 2 * 1024 * 1024; // 2MB
    const ARCH_IMG_ALLOWED_TYPES = ['image/png','image/jpeg','image/webp'];

    function archGetArtistImage(normalizedName) {
      const key = archArtistKey(normalizedName);
      // Check localStorage first (user-uploaded images)
      try {
        const userImg = localStorage.getItem('arch_artist_img_' + key);
        if (userImg) return userImg;
      } catch(_) {}
      // Check bundled images from DEFAULT_ARTISTS (match by canonical key)
      const defaultArtist = DEFAULT_ARTISTS.find(a => archArtistKey(a.normalizedName) === key);
      if (defaultArtist && defaultArtist.image && defaultArtist.image.type === 'bundled' && defaultArtist.image.src) {
        return defaultArtist.image.src;
      }
      // Fallback: match by displayName or aliases
      const byAlias = DEFAULT_ARTISTS.find(a =>
        archArtistKey(a.displayName) === key ||
        (a.aliases && a.aliases.some(alias => archArtistKey(alias) === key))
      );
      if (byAlias && byAlias.image && byAlias.image.type === 'bundled' && byAlias.image.src) {
        return byAlias.image.src;
      }
      // Backward compat: migrate old localStorage keys
      try {
        if (defaultArtist) {
          for (const oldKey of [defaultArtist.displayName, defaultArtist.id, defaultArtist.normalizedName]) {
            if (oldKey && oldKey !== key) {
              const oldImg = localStorage.getItem('arch_artist_img_' + oldKey);
              if (oldImg) {
                localStorage.setItem('arch_artist_img_' + key, oldImg);
                localStorage.removeItem('arch_artist_img_' + oldKey);
                return oldImg;
              }
            }
          }
        }
      } catch(_) {}
      return null;
    }
    function archSetArtistImage(normalizedName, dataUrl) {
      try { localStorage.setItem('arch_artist_img_' + normalizedName, dataUrl); } catch(e) {
        console.warn('Artist image save error:', e);
        toast('خطا در ذخیره تصویر: حجم تصویر بیش از حد مجاز است');
      }
    }
    function archRemoveArtistImage(normalizedName) {
      try { localStorage.removeItem('arch_artist_img_' + normalizedName); } catch(_) {}
    }

    // Resize and crop image to square 512x512
    function archProcessImage(file) {
      return new Promise((resolve, reject) => {
        if (!file) { reject(new Error('فایلی انتخاب نشد')); return; }
        if (!ARCH_IMG_ALLOWED_TYPES.includes(file.type)) { reject(new Error('فرمت فایل مجاز نیست (فقط PNG, JPG, WebP)')); return; }
        if (file.size > ARCH_IMG_MAX_BYTES) { reject(new Error('حجم فایل بیش از 2 مگابایت است')); return; }
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = ARCH_IMG_MAX_SIZE;
            canvas.height = ARCH_IMG_MAX_SIZE;
            const ctx = canvas.getContext('2d');
            // Center crop to square
            const minDim = Math.min(img.width, img.height);
            const sx = (img.width - minDim) / 2;
            const sy = (img.height - minDim) / 2;
            ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, ARCH_IMG_MAX_SIZE, ARCH_IMG_MAX_SIZE);
            // Compress to JPEG with quality
            const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
            resolve(dataUrl);
          };
          img.onerror = () => reject(new Error('خطا در بارگذاری تصویر'));
          img.src = e.target.result;
        };
        reader.onerror = () => reject(new Error('خطا در خواندن فایل'));
        reader.readAsDataURL(file);
      });
    }

    // Open file picker for artist image
    function archPickArtistImage(normalizedName, mode) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/webp';
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const dataUrl = await archProcessImage(file);
          archSetArtistImage(normalizedName, dataUrl);
          archRenderArtists();
          toast('تصویر خواننده ذخیره شد');
        } catch(err) {
          toast('خطا: ' + err.message);
        }
      };
      input.click();
    }

    // Build artist list from archive songs + defaults
    function archBuildArtistList() {
      const songs = edGetAllSongs().filter(s => !s.deletedAt);
      const map = new Map();
      // Add default artists first (by canonical key)
      for (const da of DEFAULT_ARTISTS) {
        const key = archArtistKey(da.normalizedName);
        if (!map.has(key)) {
          map.set(key, { normalizedName: key, displayName: da.displayName, count: 0, lastDate: null, favorite: !!da.favorite });
        }
      }
      // Add from songs — match to default artist by canonical key
      for (const s of songs) {
        const raw = (s.artist || s.artistName || s.singer || '').trim();
        const matchedDefault = matchDefaultArtist(raw);
        // Use the matched default artist's normalizedName if found, otherwise use canonical key
        const key = matchedDefault ? archArtistKey(matchedDefault.normalizedName) : archArtistKey(raw);
        if (!map.has(key)) {
          map.set(key, { normalizedName: key, displayName: matchedDefault ? matchedDefault.displayName : (raw || 'خواننده نامشخص'), count: 0, lastDate: null, favorite: false });
        }
        const a = map.get(key);
        a.count++;
        if (s.updatedAt && (!a.lastDate || s.updatedAt > a.lastDate)) a.lastDate = s.updatedAt;
      }
      return Array.from(map.values()).sort((a, b) => b.count - a.count);
    }

    // Render artist slider
    function archRenderArtists() {
      _archArtistCache = archBuildArtistList();
      archFilterArtists();
    }

    // Filter artists by search
    function archFilterArtists() {
      if (!_archArtistCache) _archArtistCache = archBuildArtistList();
      const q = archNormText($('artistSearchInput')?.value || '');
      $('artistSearchClear')?.classList.toggle('show', !!$('artistSearchInput')?.value);
      let filtered = _archArtistCache;
      if (q) filtered = filtered.filter(a => a.normalizedName.includes(q) || archNormText(a.displayName).includes(q) || (a.aliases && a.aliases.some(alias => archNormText(alias).includes(q))));
      const container = $('artistSliderContainer');
      if (!container) return;
      // Stop animation before rebuilding
      container.classList.remove('slider-running', 'slider-paused');
      container.innerHTML = '';
      // "All" card
      const allCard = document.createElement('div');
      allCard.className = 'artist-card' + (!_archArtistFilter ? ' active' : '');
      allCard.tabIndex = 0;
      allCard.setAttribute('role', 'option');
      allCard.setAttribute('aria-selected', !_archArtistFilter);
      const totalSongs = _archArtistCache.reduce((sum, a) => sum + a.count, 0);
      allCard.innerHTML = `<div class="artist-card-avatar" style="background:linear-gradient(135deg,#1a202c,#2d3748);"><div class="avatar-initials">♪</div></div><div class="artist-card-name">همه</div><div class="artist-card-count">${totalSongs} ترانه</div>`;
      allCard.onclick = () => {
        _archArtistFilter = null;
        container.querySelectorAll('.artist-card').forEach(c => c.classList.remove('active'));
        allCard.classList.add('active');
        archRender(); archUpdateActiveFilters();
      };
      allCard.onkeydown = (e) => { if (e.key === 'Enter') allCard.onclick(); };
      container.appendChild(allCard);
      // Artist cards
      for (const a of filtered) {
        const card = document.createElement('div');
        const artistKey = a.normalizedName; // already canonical from archBuildArtistList
        const isActive = _archArtistFilter === artistKey;
        card.className = 'artist-card' + (isActive ? ' active' : '');
        card.tabIndex = 0;
        card.setAttribute('role', 'option');
        card.setAttribute('aria-selected', isActive);
        card.setAttribute('aria-label', a.displayName + ' - ' + a.count + ' ترانه');
        card.dataset.artistKey = artistKey;
        const img = archGetArtistImage(artistKey);
        const bgColor = archAvatarColor(artistKey);
        const initials = archGetInitials(a.displayName);
        const avatarHtml = img ? `<img src="${img}" alt="${escH(a.displayName)}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=avatar-initials style=background:${bgColor}>${initials}</div>'">` : `<div class="avatar-initials" style="background:${bgColor}">${initials}</div>`;
        card.innerHTML = `<div class="artist-card-avatar">${avatarHtml}</div><span class="artist-card-tooltip">${escH(a.displayName)}</span><button class="artist-card-menu-btn" aria-label="عملیات خواننده">⋯</button>`;
        card.onmouseenter = () => { _sliderPaused = true; };
        card.onmouseleave = () => { _sliderPaused = false; };
        card.onclick = (e) => {
          if (e.target.closest('.artist-card-menu-btn')) {
            e.stopPropagation();
            archArtistCtxShow(e, artistKey);
            return;
          }
          // Click animation
          card.classList.remove('clicked');
          void card.offsetWidth;
          card.classList.add('clicked');
          setTimeout(() => card.classList.remove('clicked'), 600);
          _archArtistFilter = _archArtistFilter === artistKey ? null : artistKey;
          container.querySelectorAll('.artist-card').forEach(c => c.classList.remove('active'));
          if (_archArtistFilter) card.classList.add('active');
          else container.querySelector('.artist-card')?.classList.add('active');
          archRender(); archUpdateActiveFilters();
        };
        card.onkeydown = (e) => { if (e.key === 'Enter') card.onclick(e); };
        container.appendChild(card);
      }
      if (!filtered.length && q) {
        container.innerHTML = '<div class="artist-slider-empty">خواننده مورد نظر یافت نشد</div>';
      }
      // Position 3D carousel
      if (filtered.length > 0) {
        requestAnimationFrame(() => {
          archPositionCards3D();
          // If searching and found matches, spin to the first match
          if (q && filtered.length >= 1) {
            archStopAutoScroll();
            const cards = container.querySelectorAll('.artist-card');
            const angleStep = 360 / Math.max(cards.length, 1);
            // The matched artist is at index 1 (index 0 is "All" card)
            const targetIndex = 1;
            if (targetIndex < cards.length) {
              const targetAngle = targetIndex * angleStep;
              // Smoothly rotate to bring target to front
              const startAngle = _sliderAngle;
              const diff = targetAngle - (startAngle % 360);
              const normalizedDiff = ((diff % 360) + 540) % 360 - 180;
              _sliderAngle = startAngle + normalizedDiff;
              const c = $('artistSliderContainer');
              if (c) {
                c.style.transition = 'transform 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
                c.style.transform = `rotateY(${-_sliderAngle}deg)`;
                setTimeout(() => { c.style.transition = ''; }, 850);
              }
            }
          } else {
            archStartAutoScroll();
          }
        });
      } else {
        archStopAutoScroll();
      }
      $('artistCountLabel').textContent = `(${filtered.length} خواننده)`;
      archUpdateSliderNav();
    }

    // ===== ARTIST CONTEXT MENU =====
    function archArtistCtxShow(e, normalizedName) {
      _archArtistCtxTarget = normalizedName;
      const menu = $('artistCtxMenu');
      if (!menu) return;
      const hasImg = !!archGetArtistImage(normalizedName);
      const items = menu.querySelectorAll('.acm-item');
      if (items[0]) items[0].style.display = hasImg ? 'none' : '';
      if (items[1]) items[1].style.display = hasImg ? '' : 'none';
      if (items[2]) items[2].style.display = hasImg ? '' : 'none';
      if (items[3]) items[3].style.display = hasImg ? '' : 'none';
      if (items[4]) items[4].style.display = hasImg ? '' : 'none';
      const cx = e.clientX || e.pageX || 100;
      const cy = e.clientY || e.pageY || 100;
      menu.style.left = Math.min(cx, window.innerWidth - 200) + 'px';
      menu.style.top = Math.min(cy, window.innerHeight - 200) + 'px';
      menu.classList.add('show');
      e.preventDefault();
      e.stopPropagation();
    }
    function archArtistCtx(action) {
      $('artistCtxMenu').classList.remove('show');
      const norm = _archArtistCtxTarget;
      if (!norm) return;
      if (action === 'set-image' || action === 'change-image') {
        archPickArtistImage(norm);
      } else if (action === 'remove-image') {
        archRemoveArtistImage(norm);
        archRenderArtists();
        toast('تصویر خواننده حذف شد');
      } else if (action === 'reset-image') {
        archRemoveArtistImage(norm);
        archRenderArtists();
        toast('تصویر به حالت پیش‌فرض بازگشت');
      }
    }

    // 3D Carousel Slider
    let _sliderAngle = 0;
    let _sliderSpeed = 0.08;
    let _sliderPaused = false;
    let _sliderAnimFrame = null;
    let _sliderResumeTimeout = null;
    let _sliderCardCount = 0;
    const _sliderRadius = 460;

    function archPositionCards3D() {
      const c = $('artistSliderContainer');
      if (!c) return;
      const cards = c.querySelectorAll('.artist-card');
      _sliderCardCount = cards.length;
      if (_sliderCardCount === 0) return;
      const angleStep = 360 / _sliderCardCount;
      cards.forEach((card, i) => {
        card.style.transform = `rotateY(${angleStep * i}deg) translateZ(${_sliderRadius}px)`;
      });
    }

    function archSliderLoop() {
      const c = $('artistSliderContainer');
      if (!c || _sliderCardCount === 0) {
        _sliderAnimFrame = requestAnimationFrame(archSliderLoop);
        return;
      }
      if (!_sliderPaused) {
        _sliderAngle += _sliderSpeed;
        if (_sliderAngle >= 360) _sliderAngle -= 360;
        c.style.transform = `rotateY(${-_sliderAngle}deg)`;
      }
      _sliderAnimFrame = requestAnimationFrame(archSliderLoop);
    }

    function archArtistSlide(dir) {
      const step = 360 / Math.max(_sliderCardCount, 1);
      _sliderAngle += dir * step;
      _sliderPaused = true;
      clearTimeout(_sliderResumeTimeout);
      _sliderResumeTimeout = setTimeout(() => { _sliderPaused = false; }, 150);
    }

    function archUpdateSliderNav() {
      const p = $('artistPrevBtn'), n = $('artistNextBtn');
      if (p) p.disabled = false;
      if (n) n.disabled = false;
    }

    function archStartAutoScroll() {
      _sliderPaused = false;
      if (!_sliderAnimFrame) _sliderAnimFrame = requestAnimationFrame(archSliderLoop);
    }

    function archStopAutoScroll() {
      _sliderPaused = true;
      if (_sliderAnimFrame) { cancelAnimationFrame(_sliderAnimFrame); _sliderAnimFrame = null; }
    }

    function archResetAutoScroll() {
      _sliderAngle = 0;
      _sliderPaused = false;
      const c = $('artistSliderContainer');
      if (c) c.style.transform = 'rotateY(0deg)';
      if (_sliderAnimFrame) { cancelAnimationFrame(_sliderAnimFrame); _sliderAnimFrame = null; }
      archPositionCards3D();
      _sliderAnimFrame = requestAnimationFrame(archSliderLoop);
    }

    function archHandleWheel(e) {
      if (Math.abs(e.deltaY) < 1) return;
      e.preventDefault();
      const step = 360 / Math.max(_sliderCardCount, 1);
      _sliderAngle += (e.deltaY > 0 ? 1 : -1) * step * 0.3;
      const c = $('artistSliderContainer');
      if (c) c.style.transform = `rotateY(${-_sliderAngle}deg)`;
      _sliderPaused = true;
      clearTimeout(_sliderResumeTimeout);
      _sliderResumeTimeout = setTimeout(() => { _sliderPaused = false; }, 150);
    }

    // Toggle artist section
    function archToggleArtistSection() {
      _archArtistSectionCollapsed = !_archArtistSectionCollapsed;
      localStorage.setItem('arch_artists_collapsed', _archArtistSectionCollapsed);
      const section = $('artistSliderSection');
      if (section) section.classList.toggle('collapsed', _archArtistSectionCollapsed);
    }

    // Toggle fullscreen
    function archToggleFullscreen() {
      _archFullscreen = !_archFullscreen;
      const dialog = document.querySelector('.archive-modal-dialog');
      if (!dialog) return;
      if (_archFullscreen) {
        dialog.style.width = '100vw';
        dialog.style.height = '100vh';
        dialog.style.maxWidth = '100vw';
        dialog.style.maxHeight = '100vh';
        dialog.style.borderRadius = '0';
      } else {
        dialog.style.width = 'min(96vw,1600px)';
        dialog.style.height = 'min(92vh,1000px)';
        dialog.style.maxWidth = '';
        dialog.style.maxHeight = 'min(92vh,1000px)';
        dialog.style.borderRadius = '';
      }
    }



function getArtistDisplayName(artistKey) {
  if (!artistKey) return '';

  const normalizedKey = String(artistKey).trim().toLowerCase();

  if (Array.isArray(DEFAULT_ARTISTS)) {
    const artist = DEFAULT_ARTISTS.find((item) => {
      if (String(item.id || '').trim().toLowerCase() === normalizedKey) return true;
      if (String(item.normalizedName || '').trim().toLowerCase() === normalizedKey) return true;
      return Array.isArray(item.aliases) && item.aliases.some((alias) =>
        String(alias || '').trim().toLowerCase() === normalizedKey
      );
    });

    if (artist?.displayName) return artist.displayName;
  }

  const manualMap = {
    hayedeh: 'هایده',
    googoosh: 'گوگوش',
    dariush: 'داریوش',
    ebi: 'ابی',
    'siavash-ghomayshi': 'سیاوش قمیشی',
    moein: 'معین',
    habib: 'حبیب',
    mahasti: 'مهستی',
    aref: 'عارف',
    'farhamz-aslani': 'فرامز اصلانی',
    martik: 'مارتیک',
    'sheyad-ghambari': 'شهیار قنبری',
    andy: 'اندی',
    'leila-forouhar': 'لیلا فروهر',
    sattar: 'ستار',
    farhad: 'فرهاد',
    shohreh: 'شهره',
    marjan: 'مرجان',
    homaira: 'حمیرا',
    vigen: 'ویگن',
    'kourosh-yaghmaei': 'کوروش یغمایی',
  };

  return manualMap[normalizedKey] || artistKey;
}

// --- ۲. تنها نسخه تابع رندر فیلتر (مطمئن شو نسخه دیگری در فایل نباشد) ---
function archUpdateActiveFilters() {
  const container = $('archiveActiveFilters');
  if (!container) return;

  container.innerHTML = '';

  if (_archArtistFilter) {
    const chip = document.createElement('span');
    chip.className = 'aaf-chip';

    const displayName = getArtistDisplayName(_archArtistFilter);

    chip.innerHTML = `خواننده: ${escH(displayName)} <button onclick="_archArtistFilter=null;archRenderArtists();archRender();archUpdateActiveFilters();">✕</button>`;
    container.appendChild(chip);
  }
}




    // Initialize artist section on open
    function archInitArtistSection() {
      const section = $('artistSliderSection');
      if (section) section.classList.toggle('collapsed', _archArtistSectionCollapsed);
      if ($('artistSearchInput') && !$('artistSearchInput')._archBound) {
        $('artistSearchInput')._archBound = true;
        let artistDebounce = null;
        $('artistSearchInput').addEventListener('input', () => {
          clearTimeout(artistDebounce);
          artistDebounce = setTimeout(archFilterArtists, 200);
        });
        // Wheel on track
        const track = document.querySelector('.artist-slider-track');
        if (track) {
          track.addEventListener('wheel', archHandleWheel, { passive: false });
          track.addEventListener('mouseenter', () => { _sliderPaused = true; });
          track.addEventListener('mouseleave', () => { _sliderPaused = false; });
        }
        // Keyboard on container
        const container = $('artistSliderContainer');
        if (container) {
          container.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowRight') { archArtistSlide(1); e.preventDefault(); }
            if (e.key === 'ArrowLeft') { archArtistSlide(-1); e.preventDefault(); }
          });
        }
        // Close artist context menu on click outside
        document.addEventListener('click', (e) => { if (!e.target.closest('.artist-ctx-menu') && !e.target.closest('.artist-card-menu-btn')) $('artistCtxMenu').classList.remove('show'); });
        // Resizable divider for artist section
        const divider = $('artistResizeDivider');
        if (divider && !divider._archBound) {
          divider._archBound = true;
          let isResizing = false, startY, startHeight;
          divider.addEventListener('mousedown', (e) => {
            isResizing = true;
            startY = e.clientY;
            const section = $('artistSliderSection');
            startHeight = section ? section.offsetHeight : 200;
            divider.classList.add('active');
            document.body.style.cursor = 'ns-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
          });
          document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const diff = e.clientY - startY;
            const newHeight = Math.max(80, Math.min(500, startHeight + diff));
            const section = $('artistSliderSection');
            if (section) {
              section.style.maxHeight = newHeight + 'px';
              section.style.height = newHeight + 'px';
              const body = $('artistSliderBody');
              if (body) body.style.maxHeight = (newHeight - 44) + 'px';
            }
          });
          document.addEventListener('mouseup', () => {
            if (!isResizing) return;
            isResizing = false;
            divider.classList.remove('active');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
          });
        }
      }
      // Start animation every time modal opens
      archResetAutoScroll();
    }
    async function edNewSong() {
      if (edCur && undoStack.length > 1) {
        if (confirm(t('saveSong') + '?')) await edSaveToArchive();
      }
      pauseTransport();
stopAllVoices();

edCur = edBlankSong();

undoStack = [];
undoIndex = -1;
PERF.lastSerializedState = '';

DAW.clips = [];
DAW.sections = [];
DAW.selectedIds.clear();
DAW.selectedSectionIds = new Set();
DAW.bufferCache.clear();
DAW.waveCache.clear();
DAW.loopEnabled = false;
DAW.loopA = 0;
DAW.loopB = 10;
isRecordingChords = false;
currentRecordingClipId = null;

// Reset tracks to defaults
DAW.tracks = [
  { id: 't0', name: 'Chord Line', icon: '♫', type: 'chord' },
  { id: 't1', name: 'Vocals', icon: '🎤', type: 'audio', muted: false, solo: false, vol: 0.8, pan: 0, transpose: 0 },
  { id: 't2', name: 'Guitar', icon: '🎸', type: 'audio', muted: false, solo: false, vol: 0.8, pan: 0, transpose: 0 },
  { id: 't3', name: 'Bass', icon: '🎵', type: 'audio', muted: false, solo: false, vol: 0.8, pan: 0, transpose: 0 },
  { id: 't4', name: 'Keys', icon: '🎹', type: 'audio', muted: false, solo: false, vol: 0.8, pan: 0, transpose: 0 },
  { id: 't5', name: 'Drums', icon: '🥁', type: 'audio', muted: false, solo: false, vol: 0.8, pan: 0, transpose: 0 }
];
ensureAudioCtx();
DAW.tracks.forEach(t => {
  if (t.type === 'audio') {
    t._pannerNode = DAW.audioCtx.createStereoPanner();
    t._gainNode = DAW.audioCtx.createGain();
    t._pannerNode.connect(t._gainNode);
    t._gainNode.connect(DAW.masterGain);
  }
});
DAW.timelineDuration = 120;
DAW.pxPerSecond = 70;

if ($('edArtist')) $('edArtist').value = '';
if ($('edTitle')) $('edTitle').value = '';
localStorage.removeItem('ed_current_song');

edSyncToolbar();
edRenderEditor(true);
renderAll();
saveState();

      // Update loop toggle button state
      const loopBtn2 = $('loopToggleBtn');
      if (loopBtn2) loopBtn2.classList.remove('loop-active');

      // Apply highlight effect (default)
      initHighlightEffect();

    }
    // ===== Audio Directory Handle for auto-loading =====
    let _audioDirHandle = null;
    let _audioDirDB = null;
    async function getAudioDirDB() {
      if (_audioDirDB) return _audioDirDB;
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('AchordDirDB', 1);
        req.onupgradeneeded = e => { const db = e.target.result; if (!db.objectStoreNames.contains('dirHandles')) db.createObjectStore('dirHandles'); };
        req.onsuccess = e => { _audioDirDB = e.target.result; resolve(_audioDirDB); };
        req.onerror = () => reject(req.error);
      });
    }
    async function saveDirHandle(handle) {
      const db = await getAudioDirDB();
      const tx = db.transaction('dirHandles', 'readwrite');
      tx.objectStore('dirHandles').put(handle, 'audioDir');
      _audioDirHandle = handle;
    }
    async function loadDirHandle() {
      try {
        const db = await getAudioDirDB();
        const tx = db.transaction('dirHandles', 'readonly');
        const req = tx.objectStore('dirHandles').get('audioDir');
        return new Promise(resolve => { req.onsuccess = () => { _audioDirHandle = req.result || null; resolve(_audioDirHandle); }; req.onerror = () => resolve(null); });
      } catch (_) { return null; }
    }

    async function edExportProject() {
      if (!edCur) { toast('ترانه‌ای باز نیست'); return; }
      try {
      edCur.artist = $('edArtist')?.value || '';
      edCur.title = $('edTitle')?.value || '';
      edCur.timeSignature = $('edTimeSig')?.value || '4/4';
      edCur.tempo = parseInt($('edTempo')?.value) || 120;
      edCur.genre = $('edGenre')?.value || '';
      edCur.key = $('edKey')?.value || edCur.key || 'C';
      edCur.keyMode = $('edKeyMode')?.value || edCur.keyMode || 'maj';
      edCur._dawTracks = DAW.tracks.map(tr => ({
        id: tr.id, name: tr.name, icon: tr.icon, muted: tr.muted,
        solo: tr.solo, vol: tr.vol, pan: tr.pan, type: tr.type, transpose: tr.transpose || 0, laneHeight: tr.laneHeight || null
      }));
      edCur._dawClips = DAW.clips.map(c => {
        const cp = { ...c }; delete cp._peaks; delete cp.waveUrl; delete cp._fileHandle; delete cp._originalBlob; return cp;
      });
      edCur._dawSections = (DAW.sections || []).map(s => ({ ...s }));
      edCur._dawLoop = { loopEnabled: DAW.loopEnabled, loopA: DAW.loopA, loopB: DAW.loopB };

      // فقط کلیپ‌های کپی‌شده رمزگذاری بشن
      const audioData = {};
      const audioClips = DAW.clips.filter(c => c.type !== 'chord' && c.bufferKey && c._embedded);
      if (audioClips.length > 0) {
        let idx = 0;
        for (const clip of audioClips) {
          const buffer = DAW.bufferCache.get(clip.bufferKey);
          if (!buffer) continue;
          idx++;
          toast(`رمزگذاری صدا ${idx}/${audioClips.length}...`);
          try {
            const encoded = await encodeAudioToWebM(buffer, 128000);
            audioData[clip.bufferKey] = { format: 'wav', data: uint8ToBase64(encoded) };
          } catch(e) {
            try {
              const channels = [];
              for (let i = 0; i < buffer.numberOfChannels; i++) {
                channels.push(uint8ToBase64(new Uint8Array(buffer.getChannelData(i).buffer)));
              }
              audioData[clip.bufferKey] = { format: 'float32-b64', sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels, length: buffer.length, data: channels };
            } catch(e2) {}
          }
        }
      }
      edCur._embeddedAudio = audioData;

      const linkedCount = DAW.clips.filter(c => c.type !== 'chord' && c.bufferKey && !c._embedded).length;
      const defaultName = (edCur.title || 'ترانه جدید') + '.json';
      const data = JSON.stringify(edCur);
      const blob = new Blob([data], { type: 'application/json' });
      const sizeMB = (blob.size / (1024*1024)).toFixed(1);
      const audioCount = Object.keys(audioData).length;

      if (window.showSaveFilePicker) {
        try {
          const handle = await window.showSaveFilePicker({ suggestedName: defaultName, types: [{ description: 'فایل پروژه', accept: { 'application/json': ['.json'] } }] });
          const writable = await handle.createWritable(); await writable.write(blob); await writable.close();
          toast(`خروجی ذخیره شد (${sizeMB} MB, ${audioCount} صدا)`);
          return;
        } catch (e) { if (e.name === 'AbortError') { toast('لغو شد'); return; } }
      }
      if (!confirm(`دانلود فایل: ${defaultName}\nحجم: ${sizeMB} MB\nصدا: ${audioCount} فایل`)) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = defaultName; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast(`خروجی ذخیره شد (${sizeMB} MB, ${audioCount} صدا)`);
      } catch(e) { console.error('Export error:', e); toast('خطا در خروجی: ' + e.message); }
    }

    async function edExportXML() {
      if (!edCur) { toast('ترانه‌ای باز نیست'); return; }
      edCur.artist = $('edArtist')?.value || '';
      edCur.title = $('edTitle')?.value || '';
      edCur.timeSignature = $('edTimeSig')?.value || '4/4';
      edCur.tempo = parseInt($('edTempo')?.value) || 120;
      edCur.genre = $('edGenre')?.value || '';

      const esc = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
      xml += '<song>\n';
      xml += `  <title>${esc(edCur.title)}</title>\n`;
      xml += `  <artist>${esc(edCur.artist)}</artist>\n`;
      xml += `  <key>${esc(edCur.key)}${edCur.keyMode === 'min' ? 'm' : ''}</key>\n`;
      xml += `  <timeSignature>${esc(edCur.timeSignature)}</timeSignature>\n`;
      xml += `  <tempo>${edCur.tempo || 120}</tempo>\n`;
      xml += `  <genre>${esc(edCur.genre)}</genre>\n`;
      xml += `  <transpose>${edCur.transpose || 0}</transpose>\n`;

      // Chords
      xml += '  <chords>\n';
      (edCur.chords || []).forEach(ch => {
        xml += `    <chord name="${esc(ch.name)}" line="${ch.lineIndex}" char="${ch.charIndex}" anchor="${esc(ch.anchorType)}" />\n`;
      });
      xml += '  </chords>\n';

      // Lyrics line by line
      xml += '  <lyrics>\n';
      (edCur.lyrics || '').split('\n').forEach((line, i) => {
        xml += `    <line index="${i}">${esc(line)}</line>\n`;
      });
      xml += '  </lyrics>\n';

      // Styles
      const st = edCur.styles || {};
      xml += '  <styles>\n';
      xml += `    <text size="${st.tSize||23}" color="${esc(st.tColor||'#0fa966')}" font="${esc(st.tFont||'Vazirmatn')}" bold="${st.tBold?'true':'false'}" align="${esc(st.align||'center')}" />\n`;
      xml += `    <chord size="${st.cSize||23}" color="${esc(st.cColor||'#e6aa28')}" font="${esc(st.cFont||'JetBrains Mono')}" />\n`;
      xml += '  </styles>\n';

      xml += '</song>';

      const defaultName = (edCur.title || 'ترانه جدید') + '.xml';
      const blob = new Blob([xml], { type: 'application/xml' });

      if (window.showSaveFilePicker) {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: defaultName,
            types: [{ description: 'فایل XML', accept: { 'application/xml': ['.xml'] } }]
          });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          toast('خروجی XML ذخیره شد');
          return;
        } catch (e) { if (e.name === 'AbortError') return; }
      }
      // Fallback
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = defaultName; a.click(); URL.revokeObjectURL(url);
      toast('خروجی XML ذخیره شد');
    }

    // Import — loads metadata, then asks user to select audio files
    function edImportProject() {
      const input = $('import-file-input');
      input.value = '';
      input.onchange = async (e) => {
        const files = e.target.files;
        if (!files || !files.length) return;
        if (files.length === 1) {
          // Single file: load as current project (existing behavior)
          const file = files[0];
          try {
            toast('در حال لود پروژه...');
            const text = await file.text();
            const data = JSON.parse(text);
            if (!data || typeof data !== 'object') throw new Error('Invalid');
            pauseTransport(); stopAllVoices();
            DAW.clips = []; DAW.sections = []; DAW.selectedIds.clear(); DAW.selectedSectionIds = new Set(); DAW.bufferCache.clear(); DAW.waveCache.clear();
            DAW.loopEnabled = false; DAW.loopA = 0; DAW.loopB = 10;
            edCur = data;
            if (!edCur.styles) edCur.styles = {};
            const defaults = { tSize:38,tColor:'#0fa966',tFont:'Vazirmatn',tBold:true,align:'center', cSize:38,cColor:'#e6aa28',cFont:'JetBrains Mono' };
            Object.keys(defaults).forEach(k => { if (edCur.styles[k] === undefined) edCur.styles[k] = defaults[k]; });
            if (!edCur.timeSignature) edCur.timeSignature = '4/4';
            if (!edCur.tempo) edCur.tempo = 120;
            if (!edCur.genre) edCur.genre = '';

            // Auto-import raw format: has rawText but no lyrics/chords → parse it
            if (edCur.rawText && !edCur.lyrics) {
              _importParsed = edCur;
              $('importText').value = edCur.rawText;
              $('importUrl').value = edCur.url || '';
              applyImportChords();
              _importParsed = null;
            }

            if (edCur._dawTracks) DAW.tracks = JSON.parse(JSON.stringify(edCur._dawTracks));
            if (edCur._dawClips) DAW.clips = JSON.parse(JSON.stringify(edCur._dawClips));
            if (edCur._dawSections) DAW.sections = JSON.parse(JSON.stringify(edCur._dawSections)); else DAW.sections = [];
            updateNextIdFromClips();
            // Migrate any old section clips from DAW.clips to DAW.sections
            const _impOldSections = DAW.clips.filter(c => c.type === 'section');
            if (_impOldSections.length > 0) {
              _impOldSections.forEach(c => { DAW.sections.push({ id: c.id, trackId: c.trackId, label: c.name, start: c.start, duration: c.duration, color: c.color }); });
              DAW.clips = DAW.clips.filter(c => c.type !== 'section');
            }
            if (edCur._dawLoop) { DAW.loopEnabled = !!edCur._dawLoop.loopEnabled; DAW.loopA = edCur._dawLoop.loopA||0; DAW.loopB = edCur._dawLoop.loopB||10; }
            ensureAudioCtx();
            DAW.tracks.forEach(tr => {
              if (tr.type === 'audio') {
                if (tr.transpose === undefined) tr.transpose = 0;
                tr._pannerNode = DAW.audioCtx.createStereoPanner(); tr._gainNode = DAW.audioCtx.createGain();
                tr._pannerNode.connect(tr._gainNode); tr._gainNode.connect(DAW.masterGain); updateTrackMix(tr.id);
              }
            });
            undoStack = []; undoIndex = -1; PERF.lastSerializedState = '';
            edSyncToolbar(); edRenderEditor(true);
            initHighlightEffect();
            const loopBtn = $('loopToggleBtn');
            if (loopBtn) loopBtn.classList.toggle('loop-active', DAW.loopEnabled);

            // First: try loading audio from IndexedDB (same browser/session)
            const audioClips = DAW.clips.filter(c => c.type !== 'chord');
            if (audioClips.length > 0) {
              try {
                await loadAudioBlobsForProject(edCur.id);
              } catch(e) {}

              // Re-create waveforms for clips that have buffers
              DAW.clips.forEach(c => {
                if (c.type !== 'chord' && c.bufferKey && DAW.bufferCache.has(c.bufferKey)) {
                  const buffer = DAW.bufferCache.get(c.bufferKey);
                  c.sourceDuration = buffer.duration;
                  c._peaks = peaksFromBuffer(buffer, 2000);
                  refreshClipWaveImage(c);
                }
              });

              // Second: restore from embedded audio in backup file
              const stillMissing = audioClips.filter(c => c.bufferKey && !DAW.bufferCache.has(c.bufferKey));
              if (stillMissing.length > 0 && edCur._embeddedAudio && Object.keys(edCur._embeddedAudio).length > 0) {
                ensureAudioCtx();
                let restored = 0;
                for (const clip of stillMissing) {
                  const embedded = edCur._embeddedAudio[clip.bufferKey];
                  if (!embedded) continue;
                  try {
                    let buf;
                    if (embedded.format === 'wav' || embedded.format === 'webm-opus') {
                      const audioData = base64ToUint8(embedded.data);
                      buf = await decodeWebMToBuffer(audioData);
                    } else if (embedded.format === 'float32-b64') {
                      const numCh = embedded.channels || 1;
                      buf = DAW.audioCtx.createBuffer(numCh, embedded.length, embedded.sampleRate);
                      for (let i = 0; i < numCh; i++) {
                        const chBytes = base64ToUint8(embedded.data[i]);
                        buf.getChannelData(i).set(new Float32Array(chBytes.buffer));
                      }
                    } else if (embedded.format === 'opus-b64') {
                      const compressed = base64ToUint8(embedded.data);
                      const decompressed = await decompressBytes(compressed);
                      const int16 = new Int16Array(decompressed.buffer);
                      const float32 = new Float32Array(int16.length);
                      for (let j = 0; j < int16.length; j++) float32[j] = int16[j] < 0 ? int16[j] / 0x8000 : int16[j] / 0x7FFF;
                      const upsampled = resampleFloat32(float32, embedded.sampleRate, embedded.originalSampleRate || embedded.sampleRate);
                      const ch = embedded.originalChannels || 1;
                      buf = DAW.audioCtx.createBuffer(ch, upsampled.length, embedded.originalSampleRate || embedded.sampleRate);
                      for (let c = 0; c < ch; c++) buf.getChannelData(c).set(upsampled);
                    } else if (embedded.format === 'int16b64') {
                      const channels = Array.isArray(embedded.data) ? embedded.data : [embedded.data];
                      buf = DAW.audioCtx.createBuffer(channels.length, embedded.length, embedded.sampleRate);
                      channels.forEach((chB64, i) => {
                        if (i < buf.numberOfChannels) {
                          const bytes = base64ToUint8(chB64);
                          const int16 = new Int16Array(bytes.buffer);
                          const float32 = new Float32Array(int16.length);
                          for (let j = 0; j < int16.length; j++) float32[j] = int16[j] < 0 ? int16[j] / 0x8000 : int16[j] / 0x7FFF;
                          buf.getChannelData(i).set(float32);
                        }
                      });
                    } else {
                      const chData = Array.isArray(embedded.data) ? embedded.data : [embedded.data];
                      buf = DAW.audioCtx.createBuffer(chData.length, embedded.length, embedded.sampleRate);
                      chData.forEach((ch, i) => { if (i < buf.numberOfChannels && ch) buf.getChannelData(i).set(new Float32Array(ch)); });
                    }
                    DAW.bufferCache.set(clip.bufferKey, buf);
                    clip.sourceDuration = buf.duration;
                    clip._peaks = peaksFromBuffer(buf, 2000);
                    refreshClipWaveImage(clip);
                    restored++;
                  } catch(_) {}
                }
                if (restored > 0) toast(`بازیابی صدا: ${restored} فایل از بکآپ`);
                saveAudioBlobsForProject(edCur.id).catch(() => {});
              }

              // Third: if still missing, try loading from file paths then directory
              const stillMissing2 = audioClips.filter(c => c.bufferKey && !DAW.bufferCache.has(c.bufferKey));
              if (stillMissing2.length > 0 && edCur._audioPaths && edCur._audioPaths.length > 0) {
                // اول از filePath (Electron) لود کن
                if (isElectron && window.electronAPI) {
                  for (const ap of edCur._audioPaths) {
                    if (!ap.filePath) continue;
                    const clip = DAW.clips.find(c => c.type !== 'chord' && c.bufferKey === ap.bufferKey);
                    if (!clip || DAW.bufferCache.has(clip.bufferKey)) continue;
                    try {
                      console.log('[LINK] Import: Loading from path:', ap.filePath);
                      const audioBuffer = await loadAudioFromHardDrive(ap.filePath);
                      DAW.bufferCache.set(clip.bufferKey, audioBuffer);
                      clip.sourceDuration = audioBuffer.duration;
                      clip._peaks = peaksFromBuffer(audioBuffer, 2000);
                      clip._filePath = ap.filePath;
                      refreshClipWaveImage(clip);
                    } catch (e) {
                      console.warn('[LINK] Import: File not found:', ap.filePath, e.message);
                    }
                  }
                }
                // لود از FileHandle ذخیره‌شده در IndexedDB
                const stillAfterPath3 = audioClips.filter(c => c.bufferKey && !DAW.bufferCache.has(c.bufferKey));
                if (stillAfterPath3.length > 0) {
                  for (const clip of stillAfterPath3) {
                    try {
                      const handle = await getFileHandle(clip.bufferKey);
                      if (!handle) continue;
                      const perm = await handle.requestPermission({ mode: 'read' });
                      if (perm !== 'granted') continue;
                      const file = await handle.getFile();
                      const { buffer } = await decodeFileToBuffer(file);
                      DAW.bufferCache.set(clip.bufferKey, buffer);
                      clip.sourceDuration = buffer.duration;
                      clip._peaks = peaksFromBuffer(buffer, 2000);
                      refreshClipWaveImage(clip);
                      console.log('[HANDLE] Auto-reloaded (import):', clip.fileName);
                    } catch(e) { console.warn('[HANDLE] Auto-reload failed:', clip.bufferKey); }
                  }
                }
                // بعد از پوشه لود کن
                const stillMissing3 = audioClips.filter(c => c.bufferKey && !DAW.bufferCache.has(c.bufferKey));
                if (stillMissing3.length > 0) {
                  let dirHandle = _audioDirHandle;
                  if (!dirHandle) { try { await loadDirHandle(); dirHandle = _audioDirHandle; } catch(_){} }
                  if (!dirHandle) {
                    try {
                      dirHandle = await window.showDirectoryPicker({ mode: 'read' });
                      await saveDirHandle(dirHandle);
                    } catch(_) {}
                  }
                  if (dirHandle) {
                    const perm = await dirHandle.requestPermission({ mode: 'read' });
                    if (perm === 'granted') {
                      const notFound = [];
                      for (const ap of edCur._audioPaths) {
                        const clip = DAW.clips.find(c => c.type !== 'chord' && c.bufferKey === ap.bufferKey);
                        if (!clip || DAW.bufferCache.has(clip.bufferKey)) continue;
                        const candidates = [ap.fileName, ap.fileName ? ap.fileName.replace(/\.[^.]+$/, '') : ''];
                        let loaded = false;
                        for (const name of candidates) {
                          if (!name) continue;
                          try {
                            const fileHandle = await dirHandle.getFileHandle(name);
                            const file = await fileHandle.getFile();
                            const { buffer } = await decodeFileToBuffer(file);
                            DAW.bufferCache.set(clip.bufferKey, buffer);
                            clip.sourceDuration = buffer.duration;
                            clip._peaks = peaksFromBuffer(buffer, 2000);
                            refreshClipWaveImage(clip);
                            loaded = true;
                            break;
                          } catch(_) {}
                        }
                        if (!loaded) notFound.push(ap.fileName || ap.name || 'نام‌ناشناخته');
                      }
                      if (notFound.length > 0) {
                        toast('فایل‌های صوتی پیدا نشد: ' + notFound.join(', '));
                      }
                    }
                  }
                }
              }
            }

            // Re-create waveforms for all clips that have buffers
            DAW.clips.forEach(c => {
              if (c.type !== 'chord' && c.bufferKey && DAW.bufferCache.has(c.bufferKey) && !c._peaks) {
                const buffer = DAW.bufferCache.get(c.bufferKey);
                c.sourceDuration = buffer.duration;
                c._peaks = peaksFromBuffer(buffer, 2000);
                refreshClipWaveImage(c);
              }
            });

            await saveAudioBlobsForProject(edCur.id).catch(e => console.warn('Audio save error:', e));
            saveState();
            edSaveSong();
            renderAll();
            toast('پروژه لود شد: ' + file.name);
          } catch (err) { console.error(err); toast('خطا در لود فایل!'); }
        } else {
          // Multiple files: import all into archive, load last one as current project
          const existing = edGetAllSongs();
          let added = 0, updated = 0, errors = 0;
          for (const file of files) {
            try {
              const text = await file.text();
              let data;
              try { data = JSON.parse(text); } catch(_) { errors++; continue; }
              if (!data || typeof data !== 'object') { errors++; continue; }
              // Duplicate check: by id or title+artist
              const dupById = existing.find(es => es.id === data.id && data.id);
              const dupByMeta = existing.find(es => es.artist === data.artist && es.title === data.title && es.title);
              if (dupById || dupByMeta) {
                const target = dupById || dupByMeta;
                Object.assign(target, archNormalize(data, file.name));
                target.updatedAt = new Date().toISOString();
                updated++;
              } else {
                const song = archNormalize(data, file.name);
                if (!song.id) song.id = archGenId();
                existing.unshift(song);
                added++;
              }
            } catch(_) { errors++; }
          }
          edSetAllSongs(existing);
          // Load the last file as current project
          const lastFile = files[files.length - 1];
          try {
            const text = await lastFile.text();
            const data = JSON.parse(text);
            if (data && typeof data === 'object') {
              await loadProjectData(data);
              edSaveSong();
            }
          } catch(err) { console.error('Load last file error:', err); }
          toast(`${added} وارد شد، ${updated} به‌روزرسانی` + (errors ? `، ${errors} خطا` : ''));
          edOpenArchive();
        }
      };
      input.click();
    }

    // Auto-load audio from saved directory handle
    async function autoLoadFromDir(clips) {
      try {
        const perm = await _audioDirHandle.requestPermission({ mode: 'read' });
        if (perm !== 'granted') return false;
        let anyLoaded = false;
        for (const clip of clips) {
          const name = clip.name || '';
          if (!name) continue;
          try {
            const fileHandle = await _audioDirHandle.getFileHandle(name);
            const file = await fileHandle.getFile();
            const { buffer } = await decodeFileToBuffer(file);
            const bufKey = 'dir_' + name;
            DAW.bufferCache.set(bufKey, buffer);
            clip.bufferKey = bufKey;
            clip.sourceDuration = buffer.duration;
            clip._peaks = peaksFromBuffer(buffer, 2000);
            refreshClipWaveImage(clip);
            anyLoaded = true;
          } catch (_) {}
        }
        return anyLoaded;
      } catch (_) { return false; }
    }

    function edSyncToolbar() {
      if (!edCur) return;
      const st = edCur.styles;
      if ($('edArtist')) $('edArtist').value = edCur.artist;
      if ($('edTitle')) $('edTitle').value = edCur.title;
      refreshKeyUI();
      if ($('edTextSize')) $('edTextSize').value = st.tSize;
      if ($('edTextColor')) $('edTextColor').value = st.tColor;
      if ($('edTextFont')) $('edTextFont').value = st.tFont;
      if ($('edTextBold')) $('edTextBold').classList.toggle('active', st.tBold);
      if ($('edChordSize')) $('edChordSize').value = st.cSize;
      if ($('edChordColor')) $('edChordColor').value = st.cColor;
      if ($('edChordFont')) $('edChordFont').value = st.cFont;
      ['edAlignRight','edAlignCenter','edAlignLeft'].forEach(b => {
        if ($(b)) $(b).classList.toggle('active', ({right:'edAlignRight',center:'edAlignCenter',left:'edAlignLeft'})[st.align] === b);
      });
      if ($('edTimeSig')) $('edTimeSig').value = edCur.timeSignature || '4/4';
      if ($('edTempo')) $('edTempo').value = edCur.tempo || 120;
      if ($('edGenre')) $('edGenre').value = edCur.genre || '';
    }

    function edRenderEditor(rebuildContent) {
  if (!edCur) return;
  const ed = $('editor');
  if (!ed) return;

  const st = edCur.styles || {};
  if (!edCur.lineColors) edCur.lineColors = [];

  ed.style.fontSize = st.tSize + 'px';
  ed.style.color = st.tColor;
  ed.style.fontFamily = st.tFont;
  ed.style.fontWeight = st.tBold ? 'bold' : 'normal';
  ed.style.textAlign = st.align || 'center';

  const displayKey = edCur.transpose ? (edTransposeKeyName(edCur.originalKey || edCur.key, edCur.transpose) || edCur.key) : edCur.key;
  const keyStr = displayKey + (edCur.keyMode === 'min' ? 'm' : '');
  const sub = [
    edCur.artist,
    edCur.key ? (currentLang === 'fa' ? 'گام: ' : 'Key: ') + keyStr : null,
    edCur.transpose
      ? ((currentLang === 'fa' ? 'ترنسپوز ' : 'Transpose ') +
         (edCur.transpose > 0 ? '+' : '') + edCur.transpose)
      : null
  ].filter(Boolean).join('  ·  ');

  if ($('edPrintTitle')) $('edPrintTitle').textContent = edCur.title || t('untitled');
  if ($('edPrintSub')) $('edPrintSub').textContent = sub;

  if (rebuildContent !== false) {
    const frag = document.createDocumentFragment();

    edCur.lyrics.split('\n').forEach((line, li) => {
      const d = document.createElement('div');
      d.className = 'eline';
      d.dir = 'auto';
      d.dataset.lineIndex = li;
      const lineColor = edCur.lineColors[li];
      d.style.fontSize = st.tSize + 'px';
      d.style.color = lineColor || st.tColor;
      d.style.fontFamily = st.tFont;
      d.style.fontWeight = st.tBold ? 'bold' : 'normal';
      d.style.textAlign = st.align || 'center';
      d.textContent = line || '\u200B';
      frag.appendChild(d);
    });

    ed.innerHTML = '';
    ed.appendChild(frag);
  } else {
    ed.querySelectorAll('.eline').forEach((el, li) => {
      const lineColor = edCur.lineColors[li];
      el.style.fontSize = st.tSize + 'px';
      el.style.color = lineColor || st.tColor;
      el.style.fontFamily = st.tFont;
      el.style.fontWeight = st.tBold ? 'bold' : 'normal';
      el.style.textAlign = st.align || 'center';
    });
  }

  edRenderChords();
  // Update song stats panel
  if (edCur) {
    const chordCount = (edCur.chords || []).filter(c => c.name).length;
    const lineCount = (edCur.lyrics || '').split('\n').length;
    if ($('statChordCount')) $('statChordCount').textContent = chordCount;
    if ($('statLineCount')) $('statLineCount').textContent = lineCount;
  }
}


    // -- Chord Rendering --
    function anchorRectIn(editorEl, ch) {
      const lineEl = editorEl.children[ch.lineIndex]; if (!lineEl) return null;
      const segs = []; let total = 0, node;
      const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT);
      while (node = walker.nextNode()) { segs.push({ node, start: total, len: node.textContent.length }); total += node.textContent.length; }
      if (!segs.length) return null;
      const len = total; const r = document.createRange();
      if (ch.anchorType === 'LineStart') { const s = segs[0]; r.setStart(s.node,0); r.setEnd(s.node,Math.min(1,s.len)); }
      else if (ch.anchorType === 'LineEnd') { const s = segs[segs.length-1]; const p = Math.max(0,s.len-1); r.setStart(s.node,p); r.setEnd(s.node,Math.min(p+1,s.len)); }
      else { const i = Math.min(ch.charIndex, Math.max(0, len-1)); const s = segs.find(sg => i >= sg.start && i < sg.start+sg.len) || segs[segs.length-1]; const local = Math.max(0, i-s.start); r.setStart(s.node, Math.min(local,s.len)); r.setEnd(s.node, Math.min(local+1,s.len)); }
      return { rect: r.getBoundingClientRect(), lineRect: lineEl.getBoundingClientRect(), type: ch.anchorType };
    }
    function anchorRect(ch) { return anchorRectIn($('editor'), ch); }

    function resolveAccidentalPreference() {
      if (typeof ED_ACCIDENTAL_PREF !== 'undefined') {
        if (ED_ACCIDENTAL_PREF === 'sharp') return true;
        if (ED_ACCIDENTAL_PREF === 'flat') return false;
      }
      return null; // auto
    }

    // ===== دیز/بمل/خودکار selector =====
    // Persist accidental preference and inject a small dropdown into the header.
    function initAccidentalSelector() {
      try {
        const saved = localStorage.getItem('ed_accidental_pref');
        if (saved === 'sharp' || saved === 'flat' || saved === 'auto') ED_ACCIDENTAL_PREF = saved;
      } catch(_) {}
      const host = document.getElementById('headerCenterControls');
      if (!host || document.getElementById('edAccidentalSel')) return;
      const wrap = document.createElement('div');
      wrap.className = 'ed-grp';
      wrap.style.cssText = 'display:inline-flex;align-items:center;gap:4px;';
      const label = document.createElement('span');
      label.textContent = 'نت:';
      label.style.cssText = 'font-size:0.7rem;color:var(--text-secondary);';
      const sel = document.createElement('select');
      sel.id = 'edAccidentalSel';
      sel.style.cssText = 'background:#0D1117;color:#E2E8F0;border:1px solid #30363D;border-radius:6px;padding:2px 6px;font-size:0.75rem;cursor:pointer;';
      const opts = [['auto','خودکار'],['sharp','دیز ♯'],['flat','بمل ♭']];
      opts.forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); });
      sel.value = ED_ACCIDENTAL_PREF;
      sel.addEventListener('change', () => {
        ED_ACCIDENTAL_PREF = sel.value;
        try { localStorage.setItem('ed_accidental_pref', ED_ACCIDENTAL_PREF); } catch(_) {}
        // Re-apply current transpose/key so display updates immediately
        if (edCur) {
          if (edCur.transpose) applyTranspose(edCur.transpose);
          else { refreshKeyUI(); renderAllChordsAndText(); }
        }
        toast('نمایش نت: ' + (ED_ACCIDENTAL_PREF === 'sharp' ? 'دیز ♯' : ED_ACCIDENTAL_PREF === 'flat' ? 'بمل ♭' : 'خودکار'));
      });
      wrap.appendChild(label);
      wrap.appendChild(sel);
      header.appendChild(wrap);
    }

    function edShiftNote(n, semi) {
      if (!n) return n;
      if (typeof window.SharedEngine === 'object' && window.SharedEngine) {
        return window.SharedEngine.transposeNote(n, semi, resolveAccidentalPreference());
      }
      // fallback (legacy) — never reachable if sharedEngine loaded first
      const map = NOTE_SEMITONE || {'C':0,'C#':1,'Db':1,'D':2,'D#':3,'Eb':3,'E':4,'F':5,'F#':6,'Gb':6,'G':7,'G#':8,'Ab':8,'A':9,'A#':10,'Bb':10,'B':11};
      if (!(n in map)) return n;
      const sharp = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
      const idx = (map[n] + semi%12 + 12) % 12;
      const pref = resolveAccidentalPreference();
      if (pref === false) {
        const flat = ED_FLAT_MAP || {1:'Db',3:'Eb',6:'Gb',8:'Ab',10:'Bb'};
        return flat[idx] || sharp[idx];
      }
      if (n.includes('b') && pref !== true) {
        const flat = ED_FLAT_MAP || {1:'Db',3:'Eb',6:'Gb',8:'Ab',10:'Bb'};
        return flat[idx] || sharp[idx];
      }
      return sharp[idx];
    }
    function edTransposeChord(name, semi) {
      if (!semi || !name) return name;
      if (typeof window.SharedEngine === 'object' && window.SharedEngine) {
        return window.SharedEngine.transposeChordName(name, semi, resolveAccidentalPreference());
      }
      // fallback (legacy)
      return name.split('/').map(part => part.replace(/^([A-G][b#]?)/, (_,root) => edShiftNote(root,semi))).join('/');
    }

    let edRenderChordsToken = 0;

function edRenderChords(immediate) {
  const token = ++edRenderChordsToken;

  const run = () => {
    // اگر در این فاصله یک render جدید‌تر درخواست شده، این یکی را نادیده بگیر
    if (token !== edRenderChordsToken) return;

    if (!edCur) return;
    const ed = $('editor');
    const layer = $('chordLayer');
    const wrap = $('editorWrap');
    if (!ed || !layer || !wrap) return;

    layer.innerHTML = '';

    // Chord visibility toggle
    if (!edChordsVisible) {
      layer.style.display = 'none';
      return;
    }
    layer.style.display = '';

    const wrapRect = wrap.getBoundingClientRect();
    const scrollTop = wrap.scrollTop;
    const st = edCur.styles || {};
    const cSize = st.cSize || 23;
    const GAP = Math.max(10, cSize * 0.6);
    const cColor = st.cColor || '#e6aa28';
    const isRTL = window.getComputedStyle(ed).direction === 'rtl';
    const MARGIN = 5;

    edCur.chords.forEach((ch, idx) => {
      const a = anchorRectIn(ed, ch);
      if (!a) return;

      const el = document.createElement('span');
      el.className = 'chord';
      el.dataset.idx = idx;
      if (edSelectedChords && edSelectedChords.includes(idx)) {
        el.classList.add('selected');
      }

      let txt = ch.name;

      if (!txt && edSeqChordingActive) {
        const seqIdx = idx - (edCur.chords.length - edSeqPoints.length);
        if (seqIdx >= 0 && seqIdx < edSeqPoints.length) {
          txt = (seqIdx === edSeqCursor) ? '...' : String(seqIdx + 1);
          if (seqIdx === edSeqCursor) el.classList.add('selected');
        }
      }

      if (!txt && !edSeqChordingActive) return;

      el.textContent = txt;
      const chColor = ch.color || cColor;
      el.style.cssText =
        `font-size:${cSize}px;color:${chColor};font-family:${st.cFont || 'JetBrains Mono'};`;

      let x;
      if (ch.anchorType === 'LineStart') {
        x = isRTL ? a.rect.right + MARGIN : a.rect.left - MARGIN;
      } else if (ch.anchorType === 'LineEnd') {
        x = isRTL ? a.rect.left - MARGIN : a.rect.right + MARGIN;
      } else if (ch.anchorType === 'BetweenCharacters') {
        x = a.rect.right;
      } else {
        x = (a.rect.left + a.rect.right) / 2;
      }

      layer.appendChild(el);

      const top =
        a.rect.top - wrapRect.top +
        scrollTop - cSize - GAP;

      el.style.top = top + 'px';
      el.style.left =
        (x - wrapRect.left - el.offsetWidth / 2) + 'px';

      const line = document.createElement('div');
      line.className = 'chord-anchor-line';
      line.style.cssText =
        `background:${cColor};opacity:.6;left:${x - wrapRect.left}px;` +
        `top:${top + cSize}px;height:${Math.max(4, GAP)}px;`;

      layer.appendChild(line);
      edAttachChordDrag(el, idx);
    });

    if (edSeqModeActive) {
      edSeqPoints.forEach((p, idx) => {
        const a = anchorRectIn(ed, p);
        if (!a) return;

        const el = document.createElement('span');
        el.className = 'chord';
        el.textContent = String(idx + 1);
        el.style.cssText =
          `font-size:${cSize}px;color:#999;font-family:${st.cFont || 'JetBrains Mono'};`;

        let x;
        if (p.anchorType === 'LineStart') {
          x = isRTL ? a.rect.right + MARGIN : a.rect.left - MARGIN;
        } else if (p.anchorType === 'LineEnd') {
          x = isRTL ? a.rect.left - MARGIN : a.rect.right + MARGIN;
        } else {
          x = (a.rect.left + a.rect.right) / 2;
        }

        layer.appendChild(el);

        const top =
          a.rect.top - wrapRect.top +
          scrollTop - cSize - GAP;

        el.style.top = top + 'px';
        el.style.left =
          (x - wrapRect.left - el.offsetWidth / 2) + 'px';
      });
    }
  };

  if (immediate) {
    run();
  } else if (document.fonts && document.fonts.ready) {
    document.fonts.ready
      .then(() => requestAnimationFrame(() => requestAnimationFrame(run)))
      .catch(() => requestAnimationFrame(() => requestAnimationFrame(run)));
  } else {
    requestAnimationFrame(() => requestAnimationFrame(run));
  }
  // Sync detached popup if open
  if (_lyricPopup && !_lyricPopup.closed) { setTimeout(() => syncLyricPopup(), 100); }
}



    // -- caret/anchor from mouse position (from file 2) --
    function caretFromPoint(x, y) { if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y); if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); if (p) { const r = document.createRange(); r.setStart(p.offsetNode, p.offset); r.collapse(true); return r; } } return null; }

    function anchorFromPoint(x, y) {
      let r = caretFromPoint(x, y);
      if (!r) r = caretFromPoint(x, y + 15);
      if (!r) r = caretFromPoint(x, y + 30);
      let lineEl = null;
      if (r) { let node = r.startContainer; lineEl = (node.nodeType === 3 ? node.parentElement : node)?.closest?.('.eline'); }
      else { const el = document.elementFromPoint(x, y); lineEl = el?.closest?.('.eline'); }
      if (!lineEl) return null;
      const editor = lineEl.closest('#editor');
      if (!editor || editor !== $('editor')) return null;
      const lineIndex = [...editor.children].indexOf(lineEl);
      const text = lineEl.textContent.replace(/\u200B/g,'');
      const isRTL = window.getComputedStyle(lineEl).direction === 'rtl';
      const lineRect = lineEl.getBoundingClientRect();
      if (!text.length) return { lineIndex, charIndex: 0, anchorType: 'LineStart' };
      const firstCharRect = anchorRectIn($('editor'), { lineIndex, charIndex: 0, anchorType: 'OnCharacter' })?.rect;
      const lastCharRect = anchorRectIn($('editor'), { lineIndex, charIndex: text.length-1, anchorType: 'OnCharacter' })?.rect;
      const textLeft = isRTL ? lastCharRect.left : firstCharRect.left;
      const textRight = isRTL ? firstCharRect.right : lastCharRect.right;
      if (x >= textRight && x <= lineRect.right) { return isRTL ? { lineIndex, charIndex: 0, anchorType: 'LineStart' } : { lineIndex, charIndex: text.length, anchorType: 'LineEnd' }; }
      else if (x <= textLeft && x >= lineRect.left) { return isRTL ? { lineIndex, charIndex: text.length, anchorType: 'LineEnd' } : { lineIndex, charIndex: 0, anchorType: 'LineStart' }; }
      else if (x > lineRect.right) { return isRTL ? { lineIndex, charIndex: 0, anchorType: 'LineStart' } : { lineIndex, charIndex: text.length, anchorType: 'LineEnd' }; }
      else if (x < lineRect.left) { return isRTL ? { lineIndex, charIndex: text.length, anchorType: 'LineEnd' } : { lineIndex, charIndex: 0, anchorType: 'LineStart' }; }
      if (!r) return null;
      let node = r.startContainer;
      let charIndex = 0, found = false;
      const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT);
      let tn;
      while (tn = walker.nextNode()) { if (tn === node) { charIndex += Math.min(r.startOffset, tn.textContent.length); found = true; break; } charIndex += tn.textContent.length; }
      if (!found) charIndex = text.length;
      let anchorType = 'OnCharacter'; if (charIndex <= 0) anchorType = 'LineStart'; else if (charIndex >= text.length) { anchorType = 'LineEnd'; charIndex = text.length; }
      return { lineIndex, charIndex: Math.max(0, Math.min(charIndex, text.length)), anchorType };
    }

    // -- Editor Input --
    function edGetLyricsFromDOM() { return $('editor')?.innerText?.replace(/\u200B/g,'').replace(/\r\n?/g,'\n') || ''; }

    function edRemapAnchors(oldText, newText) {
      if (oldText === newText || !edCur) return;
      function lineCharToAbs(text, li, ci) { const lines = text.split('\n'); let abs = 0; for (let i=0; i<li && i<lines.length; i++) abs += lines[i].length + 1; return abs + Math.min(ci, (lines[li]||'').length); }
      function absToLineChar(text, abs) { const lines = text.split('\n'); let pos = abs; for (let i=0;i<lines.length;i++) { if (pos <= lines[i].length) return {lineIndex:i,charIndex:pos}; pos -= lines[i].length+1; } return {lineIndex:lines.length-1,charIndex:(lines[lines.length-1]||'').length}; }
      function remapItem(item) {
        if (item.anchorType === 'LineStart') { const nl = newText.split('\n'); item.lineIndex = Math.min(item.lineIndex, nl.length-1); item.charIndex = 0; return; }
        if (item.anchorType === 'LineEnd') { const nl = newText.split('\n'); item.lineIndex = Math.min(item.lineIndex, nl.length-1); item.charIndex = (nl[item.lineIndex]||'').length; return; }
        const abs = lineCharToAbs(oldText, item.lineIndex, item.charIndex);
        const anchorChar = oldText[abs];
        if (!anchorChar || anchorChar === '\n') { const cl = absToLineChar(newText, Math.min(abs, newText.length)); item.lineIndex = cl.lineIndex; item.charIndex = cl.charIndex; item.anchorType = 'OnCharacter'; return; }
        let best = -1, bestD = Infinity, sf = 0;
        while (sf < newText.length) { const f = newText.indexOf(anchorChar, sf); if (f === -1) break; const d = Math.abs(f-abs); if (d < bestD) { bestD = d; best = f; } if (f >= abs) break; sf = f+1; }
        if (best === -1) { const cl = absToLineChar(newText, Math.min(abs, newText.length)); item.lineIndex = cl.lineIndex; item.charIndex = cl.charIndex; item.anchorType = 'OnCharacter'; return; }
        const pos = absToLineChar(newText, best); item.lineIndex = pos.lineIndex; item.charIndex = pos.charIndex; item.anchorType = 'OnCharacter';
      }
      edCur.chords.forEach(ch => remapItem(ch));
      edCur.chords = edCur.chords.filter(ch => ch.lineIndex >= 0);
    }

    if ($('editor')) {
      $('editor').addEventListener('input', () => {
  if (!edCur) return;

  const oldText = edCur.lyrics;
  const newText = edGetLyricsFromDOM();
  if (oldText === newText) return;

  edCur.lyrics = newText;

  // Remap anchors and sequence points immediately
  edRemapAnchors(oldText, newText);
  edRemapSeqPoints(oldText, newText);

  // Debounced editor refresh
  edScheduleEditorRefresh();

  // Debounced commit for undo stack
  clearTimeout(edCommitTimer);
  edCommitTimer = setTimeout(() => {
    edCommit();
  }, 300);

  // Debounced save
  edScheduleSave();
});

;
      $('editor').addEventListener('paste', e => {
        e.preventDefault();
        let text = (e.clipboardData||window.clipboardData).getData('text/plain');
        // Remove ALL empty lines
        text = text.split('\n').filter(line => line.trim() !== '').join('\n');
        document.execCommand('insertText', false, text);
      });
    }
    function edClearChordSelection() {
      edSelectedChords = [];
      document.querySelectorAll('.chord')
      .forEach(el => el.classList.remove('selected'));
}

    // -- Chord Selection --
    function edSelectChord(idx, isShift) {
      if (isShift) { const i = edSelectedChords.indexOf(idx); if (i > -1) edSelectedChords.splice(i, 1); else edSelectedChords.push(idx); }
      else { edSelectedChords = [idx]; }
      document.querySelectorAll('.chord').forEach(el => { const cIdx = parseInt(el.dataset.idx); el.classList.toggle('selected', edSelectedChords.includes(cIdx)); });
    }
    // Clear selection when clicking empty area
if ($('editorWrap')) {
  $('editorWrap').addEventListener('mousedown', e => {
    if (!edCur) return;

    clearSelection();

    if (!e.altKey &&
        !edAltDown &&
        !e.target.closest('.chord')) {
      edClearChordSelection();
    }
  }, true);
}



    // Redraw chords on scroll — immediate render for smooth sync
    if ($('editorWrap')) {
      let _edScrollRaf = null;
      $('editorWrap').addEventListener('scroll', () => {
        if (!edCur || edChordDragActive) return;
        if (_edScrollRaf) cancelAnimationFrame(_edScrollRaf);
        _edScrollRaf = requestAnimationFrame(() => { _edScrollRaf = null; edRenderChords(true); });
      });
    }

    // -- Chord Drag --
function edAttachChordDrag(el, idx) {
  el.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    if (edCur && edCur.editorLocked) return;

    window.getSelection()?.removeAllRanges();
    // Blur editor so space bar can play
    if ($('editor')) $('editor').blur();

    e.stopPropagation();
    e.preventDefault();

    if (e.detail === 2) {
      if (edCur && edCur.editorLocked) { toast('ویرایشگر قفل است'); return; }
      edOpenChordModal(idx);
      return;
    }

    if (!edSelectedChords.includes(idx))
      edSelectChord(idx, e.shiftKey);

    const isCopy = e.altKey;

        const ch = edCur.chords[idx]; if (!ch) return;
        const startX = e.clientX;
        const snapshots = [];
        edSelectedChords.forEach(i => { const cEl = document.querySelector(`.chord[data-idx="${i}"]`); if (cEl) snapshots.push({ idx: i, el: cEl, origLeft: cEl.offsetLeft }); });
        let dragging = false, rafId = null, pendingDx = 0;
        const move = ev => {
          if (!dragging && Math.abs(ev.clientX - startX) > 3) { dragging = true; edChordDragActive = true; snapshots.forEach(s => { s.el.style.zIndex='10'; s.el.style.opacity='.85'; s.el.style.pointerEvents='none'; }); }
          if (dragging) { pendingDx = ev.clientX - startX; if (!rafId) rafId = requestAnimationFrame(() => { const dx=pendingDx; rafId=null; snapshots.forEach(s => { s.el.style.left=(s.origLeft+dx)+'px'; }); }); }
        };
        const up = ev => {
          document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
          if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
          const wasDrag = dragging; dragging = false; edChordDragActive = false;
          snapshots.forEach(s => { s.el.style.zIndex=''; s.el.style.opacity=''; s.el.style.pointerEvents=''; });
          if (!wasDrag) return;
          const wrapRect = $('editorWrap').getBoundingClientRect();
          if (ev.clientX < wrapRect.left || ev.clientX > wrapRect.right || ev.clientY < wrapRect.top || ev.clientY > wrapRect.bottom) {
            edSelectedChords.sort((a,b)=>b-a).forEach(i => edCur.chords.splice(i,1)); edSelectedChords = [];
          } else {
            function findNearestChar(lineEl, mouseX) {
              const text = lineEl.textContent.replace(/\u200B/g,''); if (!text.length) return 0;
              let bestChar = 0, bestDist = Infinity, charCount = 0;
              const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT); let node;
              while (node = walker.nextNode()) { for (let j = 0; j < node.textContent.length; j++) { try { const r = document.createRange(); r.setStart(node,j); r.setEnd(node,j+1); const rect = r.getBoundingClientRect(); if (rect.width===0) continue; const dist = Math.abs(mouseX-(rect.left+rect.width/2)); if (dist<bestDist) { bestDist=dist; bestChar=charCount; } } catch(ex) {} charCount++; } }
              return Math.max(0, Math.min(bestChar, text.length));
            }
            let anchorIdx=0, anchorDist=Infinity;
            edSelectedChords.forEach((i,si) => { const c=edCur.chords[i]; if(!c)return; const le=$('editor').children[c.lineIndex]; if(!le)return; const lr=le.getBoundingClientRect(); const midX=lr.left+c.charIndex*(lr.width/Math.max(le.textContent.replace(/\u200B/g,'').length,1)); const d=Math.abs(ev.clientX-midX); if(d<anchorDist){anchorDist=d;anchorIdx=si;} });
            const anchorOrig=edCur.chords[edSelectedChords[anchorIdx]];
            const anchorLine=$('editor').children[anchorOrig.lineIndex];
            const anchorNewChar=findNearestChar(anchorLine, ev.clientX);
            const charDelta=anchorNewChar-anchorOrig.charIndex;
            edSelectedChords.forEach(i => { const c=edCur.chords[i]; if(!c)return; const lineEl=$('editor').children[c.lineIndex]; const textLen=lineEl?lineEl.textContent.replace(/\u200B/g,'').length:0; let newChar=c.charIndex+charDelta; newChar=Math.max(0,Math.min(newChar,textLen)); if(isCopy){edCur.chords.push({lineIndex:c.lineIndex,charIndex:newChar,anchorType:newChar<=0?'LineStart':newChar>=textLen?'LineEnd':'OnCharacter',name:c.name});}else{c.charIndex=newChar;c.anchorType=newChar<=0?'LineStart':newChar>=textLen?'LineEnd':'OnCharacter';} });
          }
          edRenderChords();
          edCommit();

        };
        document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
      });
    }
    // Redraw chords on window resize
    window.addEventListener('resize', () => { if (edCur) edRenderChords(); });

    // -- Global Alt key tracker --
    let edAltDown = false;
    window.addEventListener('keydown', e => { if (e.key === 'Alt') edAltDown = true; });
    window.addEventListener('keyup', e => { if (e.key === 'Alt') edAltDown = false; });
    window.addEventListener('blur', () => { edAltDown = false; });

    // -- Mousedown on editorWrap: Alt+Click = add chord --
    if ($('editorWrap')) {
      $('editorWrap').addEventListener('mousedown', e => {
        if (!edCur) return;
        if (edCur.editorLocked && !e.target.closest('.chord')) {
          toast('🔒 ویرایشگر قفل است');
          const btn = $('edEditorLockBtn');
          if (btn) { btn.classList.add('editor-lock-blink'); setTimeout(() => btn.classList.remove('editor-lock-blink'), 2000); }
          return;
        }
        const altHeld = e.altKey || edAltDown;
        if (altHeld) {
          if (edCur.editorLocked) { toast('🔒 ویرایشگر قفل است'); return; }
          e.preventDefault(); e.stopPropagation();
          const anchor = anchorFromPoint(e.clientX, e.clientY);
          if (!anchor) return;
          edPendingAnchor = anchor; edChordIdx = null; edOpenChordModal(null);
          return;
        }
      });
    }

    // -- Arrow keys to move selected chord (from file 2) --
    // Added in the main keyboard handler below

    // -- Scroll to reposition chords (handled above with rAF) --

    // -- Commit & Undo/Redo --
    function edCommit() {
  if (!edCur || isApplyingHistory) return;

  edCur.artist = $('edArtist')?.value || '';
  edCur.title = $('edTitle')?.value || '';
  edCur.key = $('edKey')?.value || 'C';
  edCur.keyMode = $('edKeyMode')?.value || 'maj';
  edCur.seqPoints = edSeqPoints;

  saveState();
  // === Performance Architecture v2: sync key/transpose ===
  if (typeof rebuildSongDocumentFromEdCur === 'function') rebuildSongDocumentFromEdCur();
}

function edRestoreSelectionState(state) {
  if (!state) return;

  const editor = $('editor');
  const sel = document.getSelection();
  if (!editor || !sel) return;

  const range = createRangeFromEditorOffsets(editor, state.start, state.end);
  if (!range) return;

  sel.removeAllRanges();
  sel.addRange(range);

  editor.focus();
}




    function edRestore(stateStr) {
  applyState(stateStr);
}


    if ($('edUndoBtn')) {
  $('edUndoBtn').onclick = () => {
    undo();
  };
}


if ($('edRedoBtn')) {
  $('edRedoBtn').onclick = () => {
    redo();
  };
}


    if ($('edRedoBtn')) {
  $('edRedoBtn').onclick = () => {
    redo();
  };
}

if ($('edRemoveAsterisks')) {
  $('edRemoveAsterisks').onclick = () => {
    if (!edCur || edCur.editorLocked) return;
    const lines = edCur.lyrics.split('\n');
    if (!lines.some(l => l.includes('*'))) {
      toast('ستاره‌ای در متن وجود ندارد');
      return;
    }
    // Adjust chord charIndex: for each line, count asterisks before each chord's position
    lines.forEach((line, li) => {
      if (!line.includes('*')) return;
      edCur.chords.forEach(ch => {
        if (ch.lineIndex !== li) return;
        let shift = 0;
        for (let ci = 0; ci < line.length && ci < ch.charIndex; ci++) {
          if (line[ci] === '*') shift++;
        }
        ch.charIndex = Math.max(0, ch.charIndex - shift);
      });
    });
    // Remove asterisks from lyrics
    edCur.lyrics = lines.map(l => l.replace(/\*/g, '')).join('\n');
    edRenderEditor(true);
    edSaveSong();
    toast('تمام ستاره‌ها حذف شدند');
  };
}

if ($('edReverseChords')) {
  $('edReverseChords').onclick = () => {
    // ⚠️ این دکمه فقط برای موارد خاص است که آکوردها عمداً برعکس وارد شده‌اند
    // در حالت عادی نباید از این دکمه استفاده کرد چون ترتیب موسیقایی را برعکس می‌کند
    if (!edCur || edCur.editorLocked || !edCur.chords.length) {
      toast('آکوردی وجود ندارد');
      return;
    }
    if (!confirm('⚠️ آیا مطمئن هستید؟ این کار ترتیب موسیقایی آکوردها را در هر خط برعکس می‌کند و فقط برای موارد خاص کاربرد دارد.')) {
      return;
    }
    // Group chords by line, sort by charIndex, reverse positions
    const byLine = {};
    edCur.chords.forEach((ch, i) => {
      (byLine[ch.lineIndex] = byLine[ch.lineIndex] || []).push({ idx: i, ch });
    });
    Object.values(byLine).forEach(group => {
      if (group.length < 2) return;
      group.sort((a, b) => a.ch.charIndex - b.ch.charIndex);
      // Save target values first (reversed[i].ch are the same objects!)
      const targets = group.map((g, i) => ({
        charIndex: group[group.length - 1 - i].ch.charIndex,
        anchorType: group[group.length - 1 - i].ch.anchorType
      }));
      group.forEach((g, i) => {
        g.ch.charIndex = targets[i].charIndex;
        g.ch.anchorType = targets[i].anchorType;
      });
    });
    edRenderEditor(true);
    edSaveSong();
    toast('ترتیب آکورد هر خط برعکس شد (فقط برای موارد خاص)');
  };
}

if ($('edDoBoth')) {
  $('edDoBoth').onclick = () => {
    if (!edCur || edCur.editorLocked) return;
    // Step 1: Remove asterisks
    const lines = edCur.lyrics.split('\n');
    if (lines.some(l => l.includes('*'))) {
      lines.forEach((line, li) => {
        if (!line.includes('*')) return;
        edCur.chords.forEach(ch => {
          if (ch.lineIndex !== li) return;
          let shift = 0;
          for (let ci = 0; ci < line.length && ci < ch.charIndex; ci++) {
            if (line[ci] === '*') shift++;
          }
          ch.charIndex = Math.max(0, ch.charIndex - shift);
        });
      });
      edCur.lyrics = lines.map(l => l.replace(/\*/g, '')).join('\n');
    }
    // Step 2: Reverse chords
    if (edCur.chords.length) {
      const byLine = {};
      edCur.chords.forEach((ch, i) => {
        (byLine[ch.lineIndex] = byLine[ch.lineIndex] || []).push({ idx: i, ch });
      });
      Object.values(byLine).forEach(group => {
        if (group.length < 2) return;
        group.sort((a, b) => a.ch.charIndex - b.ch.charIndex);
        const targets = group.map((g, i) => ({
          charIndex: group[group.length - 1 - i].ch.charIndex,
          anchorType: group[group.length - 1 - i].ch.anchorType
        }));
        group.forEach((g, i) => {
          g.ch.charIndex = targets[i].charIndex;
          g.ch.anchorType = targets[i].anchorType;
        });
      });
    }
    edRenderEditor(true);
    edSaveSong();
    toast('ستاره‌ها حذف و آکوردها برعکس شدند');
  };
}


    // -- Chord Version System --
    function ensureChordVersionsInit() {
      if (!edCur) return;
      if (!edCur.chordVersions) edCur.chordVersions = [];
      if (edCur.activeChordVersion === undefined) edCur.activeChordVersion = 0;
      // Auto-save current chords+clips to V1 if no versions exist yet
      if (edCur.chordVersions.length === 0) {
        const chordTrack = DAW.tracks.find(t => t.type === 'chord');
        const clips = chordTrack ? DAW.clips.filter(c => c.type === 'chord' && c.trackId === chordTrack.id) : [];
        edCur.chordVersions.push({
          name: 'V1',
          chords: JSON.parse(JSON.stringify(edCur.chords)),
          clips: JSON.parse(JSON.stringify(clips.map(c => ({ start: c.start, duration: c.duration, color: c.color })))),
          transpose: edCur.transpose || 0,
          key: edCur.key || 'C',
          keyMode: edCur.keyMode || 'maj'
        });
        edCur.activeChordVersion = 0;
      }
    }

    function saveCurrentVersion() {
      if (!edCur || !edCur.chordVersions) return;
      const curVer = edCur.activeChordVersion || 0;
      if (!edCur.chordVersions[curVer]) return;
      edCur.chordVersions[curVer].chords = JSON.parse(JSON.stringify(edCur.chords));
      // ذخیره ترنسپوز و گام به‌صورت مستقل برای هر ورژن
      edCur.chordVersions[curVer].transpose = edCur.transpose || 0;
      edCur.chordVersions[curVer].key = edCur.key || 'C';
      edCur.chordVersions[curVer].keyMode = edCur.keyMode || 'maj';
      // Also save timeline clip positions
      const chordTrack = DAW.tracks.find(t => t.type === 'chord');
      if (chordTrack) {
        const clips = DAW.clips.filter(c => c.type === 'chord' && c.trackId === chordTrack.id);
        edCur.chordVersions[curVer].clips = JSON.parse(JSON.stringify(clips.map(c => ({ start: c.start, duration: c.duration, color: c.color, name: c.name }))));
      }
    }

    function loadVersionToTimeline(verIdx) {
      if (!edCur || !edCur.chordVersions[verIdx]) return;
      const ver = edCur.chordVersions[verIdx];
      const chordTrack = DAW.tracks.find(t => t.type === 'chord');
      if (!chordTrack) return;
      // Remove existing chord clips
      DAW.clips = DAW.clips.filter(c => !(c.type === 'chord' && c.trackId === chordTrack.id));
      // Add clips from version snapshot (هر کلیپ نام خودش را دارد)
      const savedClips = Array.isArray(ver.clips) ? ver.clips : [];
      savedClips.forEach((saved, i) => {
        const name = (saved && saved.name) || (ver.chords && ver.chords[i] && ver.chords[i].name) || '';
        if (!name) return;
        const start = saved && saved.start != null ? saved.start : roundMs(i * 2);
        const duration = saved && saved.duration ? saved.duration : 2;
        const color = saved && saved.color ? saved.color : '#9F7AEA';
        DAW.clips.push({ id: uid('c'), type: 'chord', trackId: chordTrack.id, name, start, duration, color });
      });
    }

    function switchChordVersion(dir) {
      if (!edCur) return;
      ensureChordVersionsInit();
      // Save current state first
      saveCurrentVersion();
      // Switch version
      const curVer = edCur.activeChordVersion || 0;
      let newVer = curVer + dir;
      if (newVer < 0) newVer = 0;
      if (newVer >= edCur.chordVersions.length) newVer = edCur.chordVersions.length - 1;
      if (newVer === curVer) { toast('ورژن ' + (curVer + 1) + ' (آخرین)'); return; }
      // Load target version
      const ver = edCur.chordVersions[newVer];
      edCur.activeChordVersion = newVer;
      edCur.chords = JSON.parse(JSON.stringify(ver.chords || []));
      // بازیابی ترنسپوز و گام مختص همین ورژن
      edCur.transpose = ver.transpose !== undefined ? ver.transpose : 0;
      if (ver.key) edCur.key = ver.key;
      if (ver.keyMode) edCur.keyMode = ver.keyMode;
      // Rebuild editor + timeline
      edRenderEditor(true);
      loadVersionToTimeline(newVer);
      saveState();
      renderTracks();
      renderClips();
      if (typeof refreshKeyUI === 'function') refreshKeyUI();
      toast('ورژن: ' + (ver.name || 'V' + (newVer + 1)));
    }

    function addChordVersion() {
      if (!edCur) return;
      ensureChordVersionsInit();
      if (edCur.chordVersions.length >= 10) { toast('حداکثر ۱۰ ورژن'); return; }
      // Save current state
      saveCurrentVersion();
      // Create new empty version
      const newVer = edCur.chordVersions.length;
      edCur.chordVersions.push({ name: 'V' + (newVer + 1), chords: [], clips: [], transpose: edCur.transpose || 0, key: edCur.key || 'C', keyMode: edCur.keyMode || 'maj' });
      edCur.activeChordVersion = newVer;
      edCur.chords = [];
      // Clear timeline chord clips
      const chordTrack = DAW.tracks.find(t => t.type === 'chord');
      if (chordTrack) DAW.clips = DAW.clips.filter(c => !(c.type === 'chord' && c.trackId === chordTrack.id));
      edRenderEditor(true);
      saveState();
      renderTracks();
      renderClips();
      toast('ورژن جدید: V' + (newVer + 1));
    }

    async function renameChordVersion() {
      if (!edCur || !edCur.chordVersions) return;
      const curVer = edCur.activeChordVersion || 0;
      const ver = edCur.chordVersions[curVer];
      if (!ver) return;
      const newName = await customPrompt('نام ورژن:', ver.name || 'V' + (curVer + 1));
      if (newName !== null && newName.trim()) {
        ver.name = newName.trim();
        saveState();
        renderTracks();
        toast('نام ورژن: ' + ver.name);
      }
    }

    // -- Sync transpose/key changes to timeline chord clips --
    function syncTransposeToTimelineChords() {
      if (!edCur) return;
      const chordTrack = DAW.tracks.find(t => t.type === 'chord');
      if (!chordTrack) return;
      // Only update existing timeline chord clips in place (never add/remove)
      const existingClips = DAW.clips.filter(c => c.type === 'chord' && c.trackId === chordTrack.id);
      // آکوردها در edCur.chords به ترتیب موسیقایی ذخیره شده‌اند (از بیت اول تا آخر)
      // Chord Line فقط جهت نمایش LTR دارد — ترتیب موسیقایی باید حفظ شود
      existingClips.forEach((clip, i) => {
        if (i < edCur.chords.length && edCur.chords[i].name) {
          clip.name = edCur.chords[i].name;
        }
      });
      saveState();
      renderClips();
    }
    function edFillCol(el, items, cb) { el.innerHTML = ''; items.forEach(v => { const d = document.createElement('div'); d.className = 'chord-item'; d.textContent = v === '' ? '—' : v; d.onclick = () => { [...el.children].forEach(c => c.classList.remove('active')); d.classList.add('active'); cb(v); updateChordPreview(); }; el.appendChild(d); }); }

    function edOpenChordModal(idx) {
      if (!edCur) return;
      edChordIdx = idx;
      edChordModalMode = 'editor';
      // Set currentChord from existing chord
      if (idx !== null && edCur.chords[idx]) {
        const m = edCur.chords[idx].name.match(/^([A-G][#b]?)(maj|m(?:in)?|dim|aug|sus2|sus4)?(M7|7|9|b9|#9|11|#11|13|6)?(?:\/([A-G][#b]?))?$/);
        if (m) { let tp = m[2] || 'None'; if (tp === 'm') tp = 'min'; currentChord = { root: m[1] || 'None', type: tp, tension: m[3] || '', bass: m[4] || 'None' }; }
        else currentChord = { root: 'None', type: 'None', tension: '', bass: 'None' };
      } else {
        currentChord = { root: 'None', type: 'None', tension: '', bass: 'None' };
      }
      // Update title and buttons for editor mode
      $('chordModalTitle').textContent = t('editSongChord');
      $('chordModalConfirmBtn').textContent = t('confirmBtn');
      // Update preview and manual input
      const currentChordName = (idx !== null && edCur.chords[idx]) ? edCur.chords[idx].name : '';
      $('chord-preview').textContent = currentChordName || 'None';
      $('chordManual').value = currentChordName;
      $('chord-modal').classList.add('show');
      buildChordEditor();
      // اضافه کردن هندلر کیبورد برای دکمه ESC
      const chordModal = $('chord-modal');
      if (chordModal) {
        // حذف هندلر قبلی اگر وجود دارد
        if (chordModal._escHandlerEd) chordModal.removeEventListener('keydown', chordModal._escHandlerEd);
        chordModal._escHandlerEd = (e) => {
          if (e.key === 'Escape' && edChordModalMode === 'editor') {
            e.preventDefault();
            edCloseChordModal();
          }
        };
        chordModal.addEventListener('keydown', chordModal._escHandlerEd);
        // فوکوس روی مودال برای اینکه ESC بدون کلیک کار کند
        chordModal.focus();
      }
    }

    function edCloseChordModal() { $('chord-modal').classList.remove('show'); edPendingAnchor = null; edChordIdx = null; edChordModalMode = null; }
    function edConfirmChord() {
      if (!edCur || edChordModalMode !== 'editor') return;
      let name = ($('chordManual')?.value || '').trim();
      name = name.replace(/^([A-G][#b]?)maj$/, '$1');
      name = name.replace(/^([A-G][#b]?)min/i, '$1m');
      if (!name) { edCloseChordModal(); return; }
      if (edChordIdx !== null && edCur.chords[edChordIdx]) {
        edCur.chords[edChordIdx].name = name;
      } else if (edPendingAnchor) {
        edCur.chords.push({ ...edPendingAnchor, name });
      }
      // Keep baseChordNames in sync with chord edits
      if (!edCur.baseChordNames) edCur.baseChordNames = [];
      if (edChordIdx !== null && edCur.chords[edChordIdx]) {
        edCur.baseChordNames[edChordIdx] = name;
      } else if (edPendingAnchor) {
        edCur.baseChordNames.push(name);
      }
      edPendingAnchor = null; edChordIdx = null;
      edCloseChordModal(); edRenderChords(); edCommit();
      // Sequential chording: advance cursor
      if (edSeqChordingActive) {
        if (edSeqCursor < edSeqPoints.length - 1) {
          edSeqCursor++;
          edRenderChords();
        } else {
          const seqStart = edCur.chords.length - edSeqPoints.length;
          edCur.chords = edCur.chords.filter((c, i) => i < seqStart || c.name);
          edSeqChordingActive = false;
          edSeqPoints = []; edCur.seqPoints = [];
          edCommit(); edRenderChords();
          toast(t('chordDone'));
        }
      }
    }
    function edDeleteChord() {
      if (edChordIdx !== null && edCur) {
        edCur.chords.splice(edChordIdx, 1);
        if (edCur.baseChordNames) edCur.baseChordNames.splice(edChordIdx, 1);
      }
      edCloseChordModal(); edRenderChords(); edCommit();
    }

    // -- Transposition --
    let _edSyncingKey = false; // flag to prevent onchange during programmatic key update
    function edTransposeKeyName(key, semitones) {
      if (!key || !semitones) return key;
      if (typeof window.SharedEngine === 'object' && window.SharedEngine) {
        return window.SharedEngine.transposeKeyName(key, semitones, resolveAccidentalPreference());
      }
      // fallback (legacy)
      const idx = ED_SEMITONE[key];
      if (idx == null) return key;
      const newIdx = ((idx + semitones) % 12 + 12) % 12;
      const pref = resolveAccidentalPreference();
      if (pref === false) {
        return ED_FLAT_NOTES[newIdx] || ED_NOTES[newIdx];
      }
      if (key.includes('b') && pref !== true) {
        return ED_FLAT_NOTES[newIdx] || ED_NOTES[newIdx];
      }
      return ED_NOTES[newIdx];
    }

    // ===== Convert Accidental Spelling (دیز/بمل toggle) =====
    // Toggles the accidental spelling of ALL current chords WITHOUT changing the key.
    // If chords currently use sharps → convert to flats; if flats → convert to sharps.
    function edToggleAccidental() {
      if (!edCur || edCur.editorLocked) { toast('🔒 ویرایشگر قفل است'); return; }
      const cc = typeof window.SharedEngine === 'object' && window.SharedEngine &&
        typeof window.SharedEngine.convertAccidentals === 'function'
        ? window.SharedEngine.convertAccidentals
        : null;
      if (!cc) { toast('موتور آکورد در دسترس نیست'); return; }

      // Determine current dominant spelling by looking at first accidental chord
      let toFlat = true; // default: convert sharps → flats
      const withAcc = (edCur.chords || []).map(c => c.name || '').filter(n => /[#♯]|[b♭]/.test(n));
      if (withAcc.length && withAcc.every(n => /[b♭]/.test(n))) toFlat = false; // currently flats → to sharp

      let converted = 0;
      (edCur.chords || []).forEach(ch => {
        if (!ch.name) return;
        const newName = cc(ch.name, toFlat);
        if (newName !== ch.name) { ch.name = newName; converted++; }
      });
      // Also convert baseChordNames so future transpose stays consistent
      if (edCur.baseChordNames && edCur.baseChordNames.length) {
        edCur.baseChordNames = edCur.baseChordNames.map(n => n ? cc(n, toFlat) : n);
      }
      if (converted === 0) { toast('آکوردی برای تبدیل یافت نشد'); return; }
      edRenderChords(true);
      edRenderEditor(false);
      syncTransposeToTimelineChords();
      edSaveSong();
      if (typeof rebuildSongDocumentFromEdCur === 'function') rebuildSongDocumentFromEdCur();
      toast(toFlat ? 'آکوردها به بمل ♭ تبدیل شدند (' + converted + ')' : 'آکوردها به دیز ♯ تبدیل شدند (' + converted + ')');
    }

    // ===== CENTRAL KEY/TRANSPOSE FUNCTIONS =====
    function keyToSemi(key) { return ED_SEMITONE[key] != null ? ED_SEMITONE[key] : -1; }
    function keyDelta(fromKey, toKey) {
      if (typeof window.SharedEngine === 'object' && window.SharedEngine) {
        return window.SharedEngine.keyDelta(fromKey, toKey);
      }
      return ((keyToSemi(toKey) - keyToSemi(fromKey)) % 12 + 12) % 12;
    }

    // Only modify ch.name in place — preserves position, spacing, alignment, everything
    function transposeChordNamesInPlace(chords, semitones) {
      if (!chords || !chords.length || !semitones) return;
      for (const ch of chords) {
        if (ch.name) ch.name = edTransposeChord(ch.name, semitones);
      }
    }

    // Central refresh: update all UI from state
    function refreshKeyUI() {
      _edSyncingKey = true;
      if (edCur) {
        if ($('edKey')) $('edKey').value = edCur.key || 'C';
        if ($('edKeyMode')) $('edKeyMode').value = edCur.keyMode || 'maj';
      }
      _edSyncingKey = false;
      // Original key label
      const origLabel = $('edOrigKeyLabel');
      if (origLabel && edCur) {
        const origKey = edCur.originalKey || edCur.key;
        const origMode = edCur.originalKeyMode || edCur.keyMode;
        origLabel.textContent = '🎵 ' + origKey + (origMode === 'min' ? 'm' : '');
        origLabel.title = 'گام اورجینال: ' + origKey + (origMode === 'min' ? 'm' : '') + ' | کلیک=تغییر | Alt+کلیک=ریست';
      }
      // Transpose display
      const v = edCur?.transpose || 0;
      if ($('edTransVal')) $('edTransVal').textContent = (v > 0 ? '+' : '') + v;
    }

    function renderAllChordsAndText() {
      edRenderChords(true);
      edRenderEditor(false);
      syncTransposeToTimelineChords();
    }

    // TRANSPOSE: always compute from baseChordNames (never from already-transposed chords)
    function applyTranspose(newTranspose) {
      if (!edCur || edCur.editorLocked) return;
      const names = edCur.baseChordNames || [];
      edCur.chords.forEach((ch, i) => {
        const baseName = (i < names.length) ? names[i] : ch.name;
        if (baseName) ch.name = edTransposeChord(baseName, newTranspose);
      });
      edCur.transpose = newTranspose;
      edCur.key = edTransposeKeyName(edCur.originalKey || edCur.key, newTranspose) || edCur.key;
      edCur.keyMode = edCur.keyMode || 'maj';
      // همگام‌سازی ترنسپز با ورژن فعال فعلی
      if (typeof saveCurrentVersion === 'function') saveCurrentVersion();
      refreshKeyUI();
      renderAllChordsAndText();
      edSaveSong();
      // === Performance Architecture v2: sync transpose immediately ===
      if (typeof rebuildSongDocumentFromEdCur === 'function') rebuildSongDocumentFromEdCur();
    }

    // KEY CHANGE: only modify chord names in current state (from baseChordNames)
    function applyKeyChange(newKey, newMode) {
      if (!edCur || edCur.editorLocked) return;
      const origKey = edCur.originalKey || edCur.key;
      const delta = keyDelta(origKey, newKey);
      // Restore original names first, then apply new key
      const names = edCur.baseChordNames || [];
      edCur.chords.forEach((ch, i) => {
        const baseName = (i < names.length) ? names[i] : ch.name;
        if (baseName) ch.name = edTransposeChord(baseName, delta);
      });
      edCur.key = newKey;
      edCur.keyMode = newMode;
      edCur.transpose = 0;
      refreshKeyUI();
      renderAllChordsAndText();
      edSaveSong();
      // === Performance Architecture v2: sync key change ===
      if (typeof rebuildSongDocumentFromEdCur === 'function') rebuildSongDocumentFromEdCur();
    }

    // ORIGINAL KEY CHANGE: update baseChordNames and apply
    function applyOriginalKeyChange(newKey, newMode) {
      if (!edCur) return;
      const oldOrigKey = edCur.originalKey || edCur.key;
      const delta = keyDelta(oldOrigKey, newKey);
      // Update baseChordNames
      if (delta && edCur.baseChordNames.length) {
        edCur.baseChordNames = edCur.baseChordNames.map(name => name ? edTransposeChord(name, delta) : name);
      }
      // Apply to current chords
      if (delta) transposeChordNamesInPlace(edCur.chords, delta);
      edCur.originalKey = newKey;
      edCur.originalKeyMode = newMode;
      edCur.key = newKey;
      edCur.keyMode = newMode;
      edCur.transpose = 0;
      refreshKeyUI();
      renderAllChordsAndText();
      edSaveSong();
    }

    // RESET TO ORIGINAL: restore chord names from baseChordNames, preserve positions
    function resetToOriginalKey() {
      if (!edCur) return;
      const names = edCur.baseChordNames || [];
      edCur.chords.forEach((ch, i) => {
        if (i < names.length && names[i]) ch.name = names[i];
      });
      edCur.key = edCur.originalKey || edCur.key;
      edCur.keyMode = edCur.originalKeyMode || edCur.keyMode || 'maj';
      edCur.transpose = 0;
      refreshKeyUI();
      renderAllChordsAndText();
      edSaveSong();
    }
    if ($('edTransUp')) $('edTransUp').onclick = () => { if (edCur && edCur.editorLocked) { toast('🔒 ویرایشگر قفل است'); return; } if (edCur) applyTranspose((edCur.transpose || 0) + 1); };
    if ($('edTransDown')) $('edTransDown').onclick = () => { if (edCur && edCur.editorLocked) { toast('🔒 ویرایشگر قفل است'); return; } if (edCur) applyTranspose((edCur.transpose || 0) - 1); };
    if ($('edTransVal')) $('edTransVal').addEventListener('dblclick', () => { if (edCur) applyTranspose(0); });
    // Toggle دیز/بمل برای همه آکوردها (بدون تغییر گام)
    if ($('edToggleAccidental')) $('edToggleAccidental').onclick = () => edToggleAccidental();

    // Click on original key label → change or reset
    if ($('edOrigKeyLabel')) $('edOrigKeyLabel').addEventListener('click', (e) => {
      if (!edCur) return;

      // Alt+Click → FULL RESET to saved original key
      if (e.altKey) {
        resetToOriginalKey();
        toast('گام به حالت اورجینال برگشت: ' + (edCur.originalKey || '') + ((edCur.originalKeyMode || '') === 'min' ? 'm' : ''));
        return;
      }

      // Normal click → change original key
      const curOrigKey = edCur.originalKey || edCur.key;
      const curOrigMode = edCur.originalKeyMode || edCur.keyMode || 'maj';
      const curOrigStr = curOrigKey + (curOrigMode === 'min' ? 'm' : '');
      const newOrig = prompt('گام اورجینال آهنگ رو مشخص کنید:', curOrigStr);
      if (!newOrig || newOrig.trim() === '' || newOrig.trim() === curOrigStr) return;
      const val = newOrig.trim();
      let newKey, newMode;
      if (val.endsWith('m') && val.length > 1) {
        newKey = val.replace(/m$/, '');
        newMode = 'min';
      } else {
        newKey = val;
        newMode = 'maj';
      }
      if (typeof etIsValidNote === 'function' && !etIsValidNote(newKey)) {
        toast('گام نامعتبر: ' + newKey);
        return;
      }
      applyOriginalKeyChange(newKey, newMode);
      toast('گام اورجینال ذخیره و اعمال شد: ' + newKey + (newMode === 'min' ? 'm' : ''));
    });

    // -- Style Bindings --
    function edBindStyle(id, key, isColor) {
      const el = $(id); if (!el) return;
      const handler = () => { if (!edCur || edCur.editorLocked) return; edCur.styles[key] = isColor ? el.value : (el.type==='number' ? +el.value : el.value); edRenderEditor(false); setTimeout(() => edRenderChords(true), 0); edSaveSong(); };
      if (el.tagName === 'SELECT') el.onchange = handler; else el.oninput = handler;
    }
    edBindStyle('edTextSize','tSize'); edBindStyle('edTextFont','tFont');
    edBindStyle('edChordSize','cSize'); edBindStyle('edChordFont','cFont');

    // Hook up size lock sync to size inputs
    if ($('edTextSize')) $('edTextSize').addEventListener('input', () => syncSizeLocked('edTextSize'));
    if ($('edChordSize')) $('edChordSize').addEventListener('input', () => syncSizeLocked('edChordSize'));
    // ===== SIZE LOCK: sync text and chord sizes =====
    let _sizeLocked = false;

    function toggleSizeLock() {
      _sizeLocked = !_sizeLocked;
      const btn = $('edSizeLockBtn');
      if (btn) {
        // Locked: closed lock icon; Unlocked: open lock icon
        btn.innerHTML = _sizeLocked
          ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>'
          : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
        btn.classList.toggle('active', _sizeLocked);
      }
      toast(_sizeLocked ? '🔗 قفل اندازه فعال — متن و آکورد همزمان تغییر می‌کنند' : '🔓 قفل اندازه غیرفعال');
    }

    // Sync text size to chord size and vice versa when locked
    function syncSizeLocked(changedId) {
      if (!_sizeLocked || !edCur || edCur.editorLocked) return;
      const val = parseInt($(changedId).value) || 23;
      if (changedId === 'edTextSize') {
        edCur.styles.cSize = val;
        if ($('edChordSize')) $('edChordSize').value = val;
      } else {
        edCur.styles.tSize = val;
        if ($('edTextSize')) $('edTextSize').value = val;
      }
    }

    // ===== RANDOM LINE COLORS =====
    const LINE_COLOR_PALETTE = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
      '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
      '#F1948A', '#82E0AA', '#F8C471', '#AED6F1', '#D7BDE2',
      '#A3E4D7', '#FAD7A0', '#A9CCE3', '#D5DBDB', '#E8DAEF',
      '#FF9FF3', '#54A0FF', '#5F27CD', '#01A3A4', '#F368E0',
      '#FF6348', '#7BED9F', '#70A1FF', '#FFA502', '#2ED573'
    ];

    function _shufflePalette() {
      const p = [...LINE_COLOR_PALETTE];
      for (let i = p.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
      return p;
    }

    function handleLineColorClick(e, type) {
      if (e.altKey) { resetLineColor(type); return; }
      randomizeLineColor(type);
    }

    function randomizeLineColor(type) {
      if (!edCur || edCur.editorLocked) return;
      const lines = edCur.lyrics.split('\n');
      if (lines.length === 0) return;
      const shuffled = _shufflePalette();

      if (type === 'text') {
        if (!edCur.lineColors) edCur.lineColors = [];
        for (let i = 0; i < lines.length; i++) {
          edCur.lineColors[i] = shuffled[i % shuffled.length];
        }
        edRenderEditor(false);
        toast('🎨 رنگ متن رندوم شد');
      } else {
        edCur.chords.forEach(ch => {
          ch.color = shuffled[ch.lineIndex % shuffled.length];
        });
        edRenderChords();
        toast('🎨 رنگ آکوردها رندوم شد');
      }
      edSaveSong();
    }

    function resetLineColor(type) {
      if (!edCur) return;
      const defaultTextColor = '#0fa966';
      const defaultChordColor = '#e6aa28';
      if (type === 'text') {
        edCur.lineColors = [];
        edCur.styles.tColor = defaultTextColor;
        edRenderEditor(false);
        toast('🔄 رنگ متن ریست شد');
      } else {
        edCur.chords.forEach(ch => { ch.color = defaultChordColor; });
        edCur.styles.cColor = defaultChordColor;
        edRenderChords();
        toast('🔄 رنگ آکوردها ریست شد');
      }
      edSaveSong();
    }

    // Editor lock replaces old size lock
    function toggleEditorLock() {
      if (!edCur) return;
      edCur.editorLocked = !edCur.editorLocked;
      const btn = $('edEditorLockBtn');
      if (btn) {
        btn.innerHTML = edCur.editorLocked ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>';
        btn.classList.toggle('editor-lock-blink', edCur.editorLocked);
      }
      const editor = $('editor');
      if (editor) editor.contentEditable = edCur.editorLocked ? 'false' : 'true';
      const controls = ['edTextSize', 'edChordSize', 'edTextFont', 'edChordFont', 'edTextBold',
        'edAlignRight', 'edAlignCenter', 'edAlignLeft', 'edRemoveAsterisks', 'edReverseChords', 'edDoBoth'];
      controls.forEach(id => { if ($(id)) $(id).disabled = edCur.editorLocked; });
      toast(edCur.editorLocked ? '🔒 ویرایشگر قفل شد' : '🔓 ویرایشگر باز شد');
    }
    // Size lock is now part of editor lock — remove old sync behavior
    if ($('edTextBold')) $('edTextBold').onclick = () => { if (!edCur || edCur.editorLocked) return; edCur.styles.tBold = !edCur.styles.tBold; $('edTextBold').classList.toggle('active', edCur.styles.tBold); edRenderEditor(false); edSaveSong(); };
    [['edAlignRight','right'],['edAlignCenter','center'],['edAlignLeft','left']].forEach(([id,v]) => { if ($(id)) $(id).onclick = () => { if (!edCur || edCur.editorLocked) return; edCur.styles.align = v; edSyncToolbar(); edRenderEditor(false); edSaveSong(); }; });

    // -- Toolbar Input Handlers --
    if ($('edArtist')) $('edArtist').oninput = () => { if (edCur) { edCur.artist = $('edArtist').value; edCur.artistKey = archArtistKey(edCur.artist); edRenderEditor(false); edSaveSong(); } };
    if ($('edTitle')) $('edTitle').oninput = () => { if (edCur) { edCur.title = $('edTitle').value; edRenderEditor(false); edSaveSong(); } };
    if ($('edKey')) $('edKey').onchange = () => { if (_edSyncingKey) return; if (!edCur) return; if (edCur.editorLocked) { toast('🔒 ویرایشگر قفل است'); $('edKey').value = edCur.key; return; } applyKeyChange($('edKey').value, $('edKeyMode')?.value || edCur.keyMode || 'maj'); };
    if ($('edKeyMode')) $('edKeyMode').onchange = () => { if (_edSyncingKey) return; if (edCur) { applyKeyChange(edCur.key, $('edKeyMode').value); } };
    if ($('edTimeSig')) $('edTimeSig').onchange = () => { if (edCur) { edCur.timeSignature = $('edTimeSig').value; edSaveSong(); } };
    if ($('edTempo')) $('edTempo').oninput = () => { if (edCur) { edCur.tempo = parseInt($('edTempo').value) || 120; edSaveSong(); } };
    if ($('edGenre')) $('edGenre').onchange = () => { if (edCur) { edCur.genre = $('edGenre').value; edSaveSong(); } };

    // Populate key select (both sharp and flat options)
    ED_ALL_NOTE_NAMES.forEach(n => { if ($('edKey')) $('edKey').add(new Option(n, n)); });

    // -- Mouse wheel on toolbar inputs (number + select) --
    document.querySelector('.header-center-controls')?.addEventListener('wheel', e => {
      const el = e.target;
      if (el.type === 'number') {
        e.preventDefault();
        const step = e.shiftKey ? 5 : 1;
        const min = parseFloat(el.min) || -Infinity;
        const max = parseFloat(el.max) || Infinity;
        const val = parseFloat(el.value) || 0;
        el.value = Math.max(min, Math.min(max, val + (e.deltaY < 0 ? step : -step)));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      if (el.tagName === 'SELECT') {
        e.preventDefault();
        const opts = el.options; if (!opts.length) return;
        el.selectedIndex = (el.selectedIndex + (e.deltaY < 0 ? -1 : 1) + opts.length) % opts.length;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
    }, { passive: false });

    // -- Keyboard Shortcuts for Editor (chord modal + chord movement) --
    window.addEventListener('keydown', e => {
      const isInput = e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA' || e.target?.tagName === 'SELECT';
      const isEditing = e.target?.isContentEditable;

      if (e.key === 'Escape' && edChordModalMode === 'editor' && $('chord-modal')?.classList.contains('show')) { edCloseChordModal(); return; }
      if (e.code === 'Enter' && edChordModalMode === 'editor' && $('chord-modal')?.classList.contains('show')) { e.preventDefault(); edConfirmChord(); return; }

      // TAP TEMPO shortcut (T key, not in input/editor)
      if (e.key === 't' && !isInput && !isEditing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); tapTempo(); return; }

      // Chord-line tap: عدد ۰ هر بار یک نقطه روی تایم لاین می‌گذارد (فقط وقتی ⏺ فعال است)
      if ((e.code === 'Digit0' || e.code === 'Numpad0') && edClTapActive && !isInput && !isEditing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        edClTap();
        return;
      }

      // Sequential chording: Enter opens chord modal for current position
      if (edSeqChordingActive && e.code === 'Enter' && !isInput && !isEditing && !($('chord-modal')?.classList.contains('show') && edChordModalMode === 'editor')) {
        e.preventDefault();
        const seqIdx = edCur.chords.length - edSeqPoints.length + edSeqCursor;
        edOpenChordModal(seqIdx);
        return;
      }

      // When chord modal is open, ArrowLeft/Right navigate between chords
      if ($('chord-modal')?.classList.contains('show') && edChordModalMode === 'editor' && typeof edChordIdx !== 'undefined' && edChordIdx !== null) {
        if (e.code === 'ArrowRight') { e.preventDefault(); edNavigateChord(1); return; }
        if (e.code === 'ArrowLeft') { e.preventDefault(); edNavigateChord(-1); return; }
      }

      // Arrow keys to move selected chords
if (
  edSelectedChords.length > 0 &&
  (e.code === 'ArrowLeft' || e.code === 'ArrowRight') &&
  !($('chord-modal')?.classList.contains('show') &&
    edChordModalMode === 'editor') &&
  !isInput &&
  !(edCur && edCur.editorLocked)
) {
  e.preventDefault();

  edSelectedChords.forEach(idx => {
    const ch = edCur.chords[idx];
    if (!ch) return;

    const lineEl = $('editor')?.children[ch.lineIndex];
    if (!lineEl) return;

    const textLen = lineEl.textContent.replace(/\u200B/g,'').length;
    const isRTL = window.getComputedStyle(lineEl).direction === 'rtl';

    if (e.code === 'ArrowRight') {
      ch.charIndex = isRTL
        ? Math.max(0, ch.charIndex - 1)
        : Math.min(textLen, ch.charIndex + 1);
    } else {
      ch.charIndex = isRTL
        ? Math.min(textLen, ch.charIndex + 1)
        : Math.max(0, ch.charIndex - 1);
    }

    if (ch.charIndex <= 0) ch.anchorType = 'LineStart';
    else if (ch.charIndex >= textLen) ch.anchorType = 'LineEnd';
    else ch.anchorType = 'OnCharacter';
  });

  edRenderChords();
  edCommit();
}


      // Delete selected chords — only when not locked
if (
  (e.code === 'Delete' || e.code === 'Backspace') &&
  edSelectedChords.length > 0 &&
  !($('chord-modal')?.classList.contains('show') &&
    edChordModalMode === 'editor') &&
  !(edCur && edCur.editorLocked)
) {
  e.preventDefault();

  edSelectedChords
    .sort((a,b) => b-a)
    .forEach(i => edCur.chords.splice(i,1));

  edSelectedChords = [];
  edRenderChords();
  edCommit();
}

    });

    // Navigate between chords in modal
    function edNavigateChord(dir) {
      if (edChordIdx === null || !edCur) return;
      const newName = $('chordManual')?.value?.trim();
      if (newName && edCur.chords[edChordIdx]) edCur.chords[edChordIdx].name = newName;
      const newIdx = edChordIdx + dir;
      if (newIdx >= 0 && newIdx < edCur.chords.length) {
        edChordIdx = newIdx;
        $('chordManual').value = edCur.chords[newIdx].name;
        if ($('chord-preview')) $('chord-preview').textContent = edCur.chords[newIdx].name;
      }
    }

    // ===== COLOR TOOL (Context-Aware Paint Brush) =====
    const COLOR_PALETTE = [
      '#FF2E93','#FF6B6B','#FFA726','#FFD54F','#AED581','#4DB6AC','#4FC3F7','#7986CB',
      '#BA68C8','#F06292','#E57373','#FF8A65','#FFB74D','#FFF176','#81C784','#4DD0E1',
      '#64B5F6','#9575CD','#E91E63','#F44336','#FF9800','#FFEB3B','#8BC34A','#009688',
      '#2196F3','#3F51B5','#9C27B0','#795548','#607D8B','#000000','#424242','#757575',
      '#9E9E9E','#BDBDBD','#E0E0E0','#FFFFFF','#3FB8AF','#3182CE','#D69E2E','#9F7AEA',
      '#ED64A6','#48BB78','#ED8936','#00B5D8','#E53E3E','#38A169','#FF69B4','#805AD5',
    ];
    const QUICK_COLORS = ['#FF2E93','#FF6B6B','#FFA726','#FFD54F','#4DB6AC','#4FC3F7','#7986CB','#9F7AEA'];

    let colorToolMode = null;
    let currentColor = '#3FB8AF';

    function isColorToolActive() { return colorToolMode === 'brush' || colorToolMode === 'eyedropper'; }

    function initQuickBar() {
      const bar = $('colorQuickBar');
      if (!bar) return;
      bar.innerHTML = '';
      QUICK_COLORS.forEach(c => {
        const sw = document.createElement('div');
        sw.className = 'color-quick-swatch' + (c === currentColor ? ' active' : '');
        sw.style.background = c;
        sw.title = c;
        sw.onclick = (e) => { e.stopPropagation(); selectColor(c); };
        bar.appendChild(sw);
      });
    }

    function selectColor(color) {
      currentColor = color;
      const picker = $('colorPickerInput');
      if (picker) picker.value = color;
      document.querySelectorAll('.color-quick-swatch').forEach(el => {
        el.classList.toggle('active', el.style.background === color || rgbToHex(el.style.background) === color);
      });
    }

    function rgbToHex(rgb) {
      if (!rgb || rgb.startsWith('#')) return rgb;
      const m = rgb.match(/(\d+)/g);
      if (!m || m.length < 3) return rgb;
      return '#' + m.slice(0,3).map(x => (+x).toString(16).padStart(2,'0')).join('');
    }

    function toggleColorTool(mode) {
      if (colorToolMode === mode) { deactivateColorTool(); return; }
      colorToolMode = mode;
      const bar = $('colorQuickBar');
      if (mode === 'brush') {
        $('colorBrushBtn').classList.add('active');
        $('colorBrushBtn').classList.remove('active-eyedropper');
        $('colorEyedropperBtn').classList.remove('active', 'active-eyedropper');
        document.body.classList.add('color-tool-brush');
        document.body.classList.remove('color-tool-eyedropper');
      } else {
        $('colorEyedropperBtn').classList.add('active-eyedropper');
        $('colorEyedropperBtn').classList.remove('active');
        $('colorBrushBtn').classList.remove('active', 'active-eyedropper');
        document.body.classList.add('color-tool-eyedropper');
        document.body.classList.remove('color-tool-brush');
      }
      if (bar) { bar.classList.add('show'); initQuickBar(); }
    }

    function deactivateColorTool() {
      colorToolMode = null;
      $('colorBrushBtn')?.classList.remove('active', 'active-eyedropper');
      $('colorEyedropperBtn')?.classList.remove('active', 'active-eyedropper');
      document.body.classList.remove('color-tool-brush', 'color-tool-eyedropper');
      const bar = $('colorQuickBar');
      if (bar) bar.classList.remove('show');
    }

    function applyColorToClip(clip, color) {
      clip.color = color;
      const el = document.querySelector(`.clip[data-clip-id="${clip.id}"]`);
      if (el) {
        if (clip.type === 'chord') {
          el.style.background = `linear-gradient(180deg, ${color}cc, ${color}77)`;
          el.style.borderColor = color;
        } else {
          el.style.background = `linear-gradient(180deg, ${color}bb, ${color}88)`;
        }
      }
    }

    function applyColorToSection(sec, color) {
      sec.color = color;
      const el = document.querySelector(`.section-tag[data-section-id="${sec.id}"]`);
      if (el) {
        el.style.background = `rgba(${parseInt(color.slice(1,3),16)},${parseInt(color.slice(3,5),16)},${parseInt(color.slice(5,7),16)},0.35)`;
        el.style.borderColor = color;
      }
    }

    // Context-Aware: detect what was clicked and paint/pick it
    // Shift+click = paint ALL items of same type (global)
    // Regular click = paint ONLY this item (per-item)
    function paintContextAware(e) {
      const isGlobal = e.shiftKey;

      if (colorToolMode === 'brush') {
        // 0. Section tag (decoupled from clips)
        const secTagEl = e.target.closest('.section-tag');
        if (secTagEl) {
          const sec = (DAW.sections || []).find(s => s.id === secTagEl.dataset.sectionId);
          if (!sec) return false;
          if (isGlobal) {
            (DAW.sections || []).forEach(s => applyColorToSection(s, currentColor));
            saveState(); renderClips();
            toast('همه بخش‌ها رنگ شد');
          } else {
            applyColorToSection(sec, currentColor); saveState();
            toast('رنگ بخش: ' + currentColor);
          }
          return true;
        }
        // 1. Timeline chord clip
        const clipEl = e.target.closest('.clip');
        if (clipEl) {
          const clip = getClip(clipEl.dataset.clipId);
          if (!clip) return false;
          if (isGlobal) {
            DAW.clips.forEach(c => { if (c.type === clip.type) applyColorToClip(c, currentColor); });
            saveState(); renderClips();
            toast('همه ' + (clip.type === 'chord' ? 'آکوردهای تایم‌لاین' : 'کلیپ‌ها') + ' رنگ شد');
          } else {
            applyColorToClip(clip, currentColor); saveState();
            toast('رنگ کلیپ: ' + currentColor);
          }
          return true;
        }
        // 2. Editor text line (check BEFORE chord — chords overlay text via z-index)
        const eline = e.target.closest('.eline');
        if (eline && edCur) {
          const li = parseInt(eline.dataset.lineIndex);
          if (!edCur.lineColors) edCur.lineColors = [];
          if (isGlobal) {
            edCur.styles.tColor = currentColor;
            edCur.lineColors = [];
            // Apply to ALL eline elements directly
            document.querySelectorAll('#editor .eline').forEach(el => { el.style.color = currentColor; });
            saveState(); edSaveSong();
            toast('رنگ همه متن: ' + currentColor);
          } else if (li >= 0) {
            edCur.lineColors[li] = currentColor;
            // Apply color directly — do NOT call edRenderEditor which may interfere
            eline.style.color = currentColor;
            saveState(); edSaveSong();
            toast('رنگ خط ' + (li + 1) + ': ' + currentColor);
          }
          return true;
        }
        // 3. Editor chord (after text line — so text always gets colored)
        const chordEl = e.target.closest('.chord');
        if (chordEl && edCur) {
          const ci = parseInt(chordEl.dataset.idx);
          if (isGlobal) {
            edCur.styles.cColor = currentColor;
            edCur.chords.forEach(ch => delete ch.color);
            saveState(); edRenderChords(); edSaveSong();
            toast('رنگ همه آکوردها: ' + currentColor);
          } else if (ci >= 0 && edCur.chords[ci]) {
            edCur.chords[ci].color = currentColor;
            saveState(); edRenderChords(); edSaveSong();
            toast('رنگ آکورد: ' + currentColor);
          }
          return true;
        }
        // 4. Editor general area (not on specific element)
        if (e.target.closest('#editor') && edCur) {
          if (isGlobal) {
            edCur.styles.tColor = currentColor;
            edCur.lineColors = [];
            document.querySelectorAll('#editor .eline').forEach(el => { el.style.color = currentColor; });
            saveState(); edSaveSong();
            toast('رنگ همه متن: ' + currentColor);
          }
          return true;
        }
        // 5. Track lane empty area → color all clips on track
        const lane = e.target.closest('.track-lane');
        if (lane) {
          const trackClips = DAW.clips.filter(c => c.trackId === lane.dataset.trackId);
          trackClips.forEach(c => applyColorToClip(c, currentColor));
          saveState(); renderClips();
          toast(trackClips.length + ' کلیپ رنگ شد'); return true;
        }
        return false;
      } else if (colorToolMode === 'eyedropper') {
        // 0. Section tag → sample color (decoupled)
        const secTagEl = e.target.closest('.section-tag');
        if (secTagEl) {
          const sec = (DAW.sections || []).find(s => s.id === secTagEl.dataset.sectionId);
          if (sec) { selectColor(sec.color || '#3FB8AF'); toast('رنگ نمونه بخش: ' + currentColor); deactivateColorTool(); return true; }
        }
        // 1. Timeline clip → sample
        const clipEl = e.target.closest('.clip');
        if (clipEl) {
          const clip = getClip(clipEl.dataset.clipId);
          if (clip) { selectColor(clip.color); toast('رنگ نمونه: ' + currentColor); deactivateColorTool(); return true; }
        }
        // 2. Editor text line → sample per-line or global (check before chord)
        const eline = e.target.closest('.eline');
        if (eline && edCur) {
          const li = parseInt(eline.dataset.lineIndex);
          const lineColors = edCur.lineColors || [];
          selectColor(lineColors[li] || edCur.styles.tColor || '#0fa966');
          toast('رنگ نمونه: ' + currentColor); deactivateColorTool(); return true;
        }
        // 3. Editor chord → sample per-chord or global
        const chordEl = e.target.closest('.chord');
        if (chordEl && edCur) {
          const ci = parseInt(chordEl.dataset.idx);
          const ch = ci >= 0 ? edCur.chords[ci] : null;
          selectColor(ch?.color || edCur.styles.cColor || '#e6aa28');
          toast('رنگ نمونه: ' + currentColor); deactivateColorTool(); return true;
        }
        if (e.target.closest('#editor') && edCur) {
          selectColor(edCur.styles.tColor || '#0fa966');
          toast('رنگ نمونه: ' + currentColor); deactivateColorTool(); return true;
        }
        // 4. Track lane → sample first clip color
        const lane = e.target.closest('.track-lane');
        if (lane) {
          const first = DAW.clips.find(c => c.trackId === lane.dataset.trackId && c.color);
          if (first) { selectColor(first.color); toast('رنگ نمونه: ' + currentColor); deactivateColorTool(); return true; }
        }
        return false;
      }
    }

    // Patch onClipMouseDown for timeline clips
    (function patchClipMouse() {
      const origHandler = onClipMouseDown;
      onClipMouseDown = function(e) {
        if (isColorToolActive() && e.button === 0) {
          const clipId = e.currentTarget?.dataset?.clipId;
          if (clipId) {
            const clip = getClip(clipId);
            if (clip && colorToolMode === 'brush') {
              applyColorToClip(clip, currentColor); saveState();
              e.stopPropagation(); e.preventDefault();
              toast('رنگ کلیپ: ' + currentColor); return;
            } else if (clip && colorToolMode === 'eyedropper') {
              selectColor(clip.color);
              toast('رنگ نمونه: ' + currentColor); deactivateColorTool();
              e.stopPropagation(); e.preventDefault(); return;
            }
          }
        }
        origHandler.call(this, e);
      };
    })();

    // Patch section tag mousedown for color tool
    (function patchSectionTagMouse() {
      const lanes = document.getElementById('lanes-container');
      if (!lanes) return;
      lanes.addEventListener('mousedown', (e) => {
        if (!isColorToolActive() || e.button !== 0) return;
        const secTagEl = e.target.closest('.section-tag');
        if (!secTagEl) return;
        const sec = (DAW.sections || []).find(s => s.id === secTagEl.dataset.sectionId);
        if (!sec) return;
        if (colorToolMode === 'brush') {
          if (e.shiftKey) {
            (DAW.sections || []).forEach(s => applyColorToSection(s, currentColor));
            toast('همه بخش‌ها رنگ شد');
          } else {
            applyColorToSection(sec, currentColor);
            toast('رنگ بخش: ' + currentColor);
          }
          saveState(); e.preventDefault(); e.stopPropagation();
        } else if (colorToolMode === 'eyedropper') {
          selectColor(sec.color || '#3FB8AF');
          toast('رنگ نمونه: ' + currentColor); deactivateColorTool();
          e.preventDefault(); e.stopPropagation();
        }
      }, true);
    })();

    // Patch editorWrap for text/chord coloring
    (function patchEditorWrap() {
      const ew = $('editorWrap');
      if (!ew) return;
      ew.addEventListener('mousedown', (e) => {
        if (!isColorToolActive() || e.button !== 0) return;
        if (paintContextAware(e)) { e.preventDefault(); e.stopPropagation(); }
      }, true);
    })();

    // Patch track lane mousedown for empty-area coloring
    (function patchLaneMouse() {
      const lanes = document.getElementById('lanes-container');
      if (!lanes) return;
      lanes.addEventListener('mousedown', (e) => {
        if (!isColorToolActive() || e.button !== 0) return;
        if (e.target.closest('.clip') || e.target.closest('.section-tag')) return;
        if (paintContextAware(e)) { e.preventDefault(); e.stopPropagation(); }
      }, true);
    })();

    // Keyboard shortcut: C for brush, Alt+C for eyedropper
    document.addEventListener('keydown', (e) => {
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA' || e.target?.isContentEditable) return;
      if (e.key === 'c' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); toggleColorTool('brush'); }
      if (e.key === 'c' && e.altKey) { e.preventDefault(); toggleColorTool('eyedropper'); }
      if (e.key === 'Escape' && isColorToolActive()) { deactivateColorTool(); }
      // Escape cancels mapping mode
      if (e.key === 'Escape' && _mappingTarget) { cancelMapping(); }
      // Escape closes perf mode
      if (e.key === 'Escape' && perfModeActive) { perfStop(); return; }
      // Panel visibility toggles: Shift+Ctrl+Arrow
      if (e.shiftKey && (e.ctrlKey || e.metaKey)) {
        if (e.key === 'ArrowLeft') { e.preventDefault(); togglePanel('inspector'); }
        if (e.key === 'ArrowRight') { e.preventDefault(); togglePanel('sidebar'); }
        if (e.key === 'ArrowDown') { e.preventDefault(); togglePanel('timeline'); }
      }
      // Performance mode shortcuts (space handled in capture phase)
      if (perfModeActive) {
        if (e.key === 'ArrowRight' && !e.ctrlKey) { e.preventDefault(); perfNextSong(); }
        if (e.key === 'ArrowLeft' && !e.ctrlKey) { e.preventDefault(); perfPrevSong(); }
        if (e.key === 'r' || e.key === 'R') { e.preventDefault(); perfRestartSong(); }
        if (e.key === 'F11') { e.preventDefault(); perfToggleStageMode(); }
        if (e.key === '+' || e.key === '=') { e.preventDefault(); perfTranspose(1); }
        if (e.key === '-') { e.preventDefault(); perfTranspose(-1); }
        if (e.key === 'n' || e.key === 'N') { e.preventDefault(); perfTogglePauseMode(); }
      }
    });

    // ===== BUTTON MAPPING (Ctrl+Shift+Alt + Click) =====
    let _mappingTarget = null; // function id being mapped
    let _mappingEl = null; // the button element being mapped

    // Action -> function mapping
    const ACTION_FUNCTIONS = {
      'play': togglePlay, 'pause': pauseTransport, 'stop': stopTransport,
      'goStart': transportToStart, 'goEnd': transportToEnd,
      'returnToStart': toggleReturnToStart,
      'loop': toggleLoop, 'loopA': setLoopA, 'loopB': setLoopB,
      'setLoopFromSel': setLoopFromSelection,
      'undo': undo, 'redo': redo,
      'fullscreen': () => { if (!DAW.isPlaying) { ensureAudioCtx(); if (DAW.playhead <= 0) seekTransport(0, false); startTransport(); } openLyricOnlyPopup(); setTimeout(openLyricPopup, 300); },
      'singerView': openLyricOnlyPopup,
      'playerView': (typeof openPlayerView === 'function') ? openPlayerView : openLyricPopup,
      'split': splitSelectedAtPlayhead, 'copy': copySelected, 'cut': cutSelected, 'paste': pasteClipboard,
    };

    // Detect Ctrl+Shift+Alt + Click on any button with data-action
    document.addEventListener('mousedown', (e) => {
      if (!e.ctrlKey || !e.shiftKey || !e.altKey) return;
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      e.preventDefault(); e.stopPropagation();
      startMapping(btn.dataset.action, btn);
    }, true);

    function startMapping(actionId, el) {
      // Deactivate any active tools
      if (isColorToolActive()) deactivateColorTool();
      _mappingTarget = actionId;
      _mappingEl = el;
      el.classList.add('mapping-active');
      // Show toast
      let toastEl = document.querySelector('.mapping-toast');
      if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'mapping-toast'; document.body.appendChild(toastEl); }
      const label = SHORTCUT_DEFAULTS.find(s => s.id === actionId)?.label || actionId;
      toastEl.textContent = '🎹 «' + label + '» — کلید یا نت MIDI را بزنید...';
      toastEl.style.display = 'block';
      // Listen for next key or MIDI
      document.addEventListener('keydown', onMappingKeyHandler, true);
      document.addEventListener('mousedown', onMappingMidiHandler, true);
    }

    function onMappingKeyHandler(e) {
      if (!_mappingTarget) return;
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { cancelMapping(); return; }
      if (e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta') return;
      // Save keyboard mapping
      SHORTCUTS[_mappingTarget] = { code: e.code, ctrl: !!e.ctrlKey, shift: !!e.shiftKey };
      saveShortcuts();
      finishMapping('کلید: ' + formatKeyName(e.code) + (e.ctrlKey ? '+Ctrl' : '') + (e.shiftKey ? '+Shift' : ''));
    }

    function onMappingMidiHandler(e) {
      if (!_mappingTarget) return;
      // Check if click is NOT on the mapped button itself (to allow normal clicks)
      if (e.target.closest('[data-action]') === _mappingEl) return;
    }

    function cancelMapping() {
      if (_mappingEl) _mappingEl.classList.remove('mapping-active');
      _mappingTarget = null; _mappingEl = null;
      document.removeEventListener('keydown', onMappingKeyHandler, true);
      const toastEl = document.querySelector('.mapping-toast');
      if (toastEl) toastEl.style.display = 'none';
    }

    function finishMapping(info) {
      if (_mappingEl) _mappingEl.classList.remove('mapping-active');
      const toastEl = document.querySelector('.mapping-toast');
      if (toastEl) { toastEl.textContent = '✅ ذخیره شد: ' + info; setTimeout(() => toastEl.style.display = 'none', 1500); }
      _mappingTarget = null; _mappingEl = null;
      document.removeEventListener('keydown', onMappingKeyHandler, true);
    }

    // Execute MIDI mapped functions on Note On
    function executeMidiMappedFunction(funcId) {
      const fn = ACTION_FUNCTIONS[funcId];
      if (fn) fn();
    }

    // ======== تابع ایمن برای کپی آکوردها ========
    function safeMirrorTimeline() {
      try {
        if (!_lyricPopup || _lyricPopup.closed) return;
        const targetDiv = _lyricPopup.document.getElementById('playerChordMirror');
        if (!targetDiv) return;

        const sourceTimeline = document.querySelector('.track-lane.chord-lane');
        if (!sourceTimeline || sourceTimeline.children.length === 0) return;

        // ۱. کپی برداری بدون حذف هیچ المانی (برای حفظ یکپارچگی ایندکس‌ها)
        const clone = sourceTimeline.cloneNode(true);

        targetDiv.innerHTML = '';
        targetDiv.appendChild(clone);

        // استایل کانتینر — ثابت، بدون اسکرول، پلی‌هد وسطش می‌ماند
        targetDiv.style.direction = 'ltr';
        targetDiv.style.overflow = 'hidden';
        targetDiv.style.position = 'relative';
        targetDiv.style.backgroundColor = '#0D1017';

        const mirrorH = targetDiv.clientHeight || 90;
        const RULER_H = 18;
        clone.style.direction = 'ltr';
        clone.style.position = 'absolute';
        clone.style.top = RULER_H + 'px';
        clone.style.left = '0';
        clone.style.width = sourceTimeline.scrollWidth + 'px';
        clone.style.height = (mirrorH - RULER_H) + 'px';
        clone.style.display = 'block';
        clone.style.backgroundColor = 'transparent';

        // ── خط کشی بالا (شماره میزان) مثل تایم لاین اصلی ──
        let mirrorRuler = targetDiv.querySelector('.mirror-ruler');
        if (!mirrorRuler) {
          mirrorRuler = _lyricPopup.document.createElement('div');
          mirrorRuler.className = 'mirror-ruler';
          mirrorRuler.style.cssText = 'position:absolute;top:0;left:0;height:' + RULER_H + 'px;width:100%;overflow:hidden;z-index:5;pointer-events:none;background:rgba(13,16,23,0.95);border-bottom:1px solid rgba(255,255,255,0.1);';
          targetDiv.appendChild(mirrorRuler);
        }
        let rulerInner = mirrorRuler.querySelector('.mirror-ruler-inner');
        if (!rulerInner) {
          rulerInner = _lyricPopup.document.createElement('div');
          rulerInner.className = 'mirror-ruler-inner';
          rulerInner.style.cssText = 'position:absolute;top:0;height:100%;white-space:nowrap;font-size:8px;color:rgba(255,255,255,0.5);font-family:JetBrains Mono,monospace;line-height:' + RULER_H + 'px;';
          mirrorRuler.appendChild(rulerInner);
        }
        rulerInner.innerHTML = '';
        rulerInner.style.width = sourceTimeline.scrollWidth + 'px';

        // ── اعداد و پارامترهای گرید ──
        const _glen = getProjectEnd();
        const _gbpm = edCur?.tempo || 120;
        const _gsig = edCur?.timeSignature || '4/4';
        const _gbeatsPerBar = parseInt(_gsig.split('/')[0]);
        const _gbeatDur = 60 / _gbpm;
        const _gbarDur = _gbeatDur * _gbeatsPerBar;
        const _gpxPerSec = DAW.pxPerSecond;
        const _gpxPerBar = _gbarDur * _gpxPerSec;
        let _gbarStep = 1;
        if (_gpxPerBar > 120) _gbarStep = 1;
        else if (_gpxPerBar > 60) _gbarStep = 2;
        else if (_gpxPerBar > 30) _gbarStep = 4;
        else if (_gpxPerBar > 15) _gbarStep = 8;
        else if (_gpxPerBar > 8) _gbarStep = 16;
        else _gbarStep = 32;

        // شماره میزان‌ها روی رولر
        for (let _bar = 1; _bar * _gbarDur <= _glen; _bar++) {
          if ((_bar - 1) % _gbarStep !== 0) continue;
          const _x = timeToX((_bar - 1) * _gbarDur);
          const _span = _lyricPopup.document.createElement('span');
          _span.className = 'mirror-ruler-label';
          _span.style.cssText = 'position:absolute;left:' + _x + 'px;top:0;padding-left:2px;';
          _span.textContent = _bar;
          rulerInner.appendChild(_span);
        }

        // ── رسم خطوط گرید روی کانواس داخل کلون (مثل drawLaneGrid) ──
        let gridCanvas = clone.querySelector('canvas.lane-grid');
        if (!gridCanvas) {
          gridCanvas = _lyricPopup.document.createElement('canvas');
          gridCanvas.className = 'lane-grid';
          clone.insertBefore(gridCanvas, clone.firstChild);
        }
        gridCanvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:0;display:block;';
        gridCanvas.width = Math.min(Math.ceil(sourceTimeline.scrollWidth), 20000);
        gridCanvas.height = (mirrorH - RULER_H);
        gridCanvas.style.width = gridCanvas.width + 'px';
        gridCanvas.style.height = (mirrorH - RULER_H) + 'px';

        const _gctx = gridCanvas.getContext('2d');
        _gctx.clearRect(0, 0, gridCanvas.width, gridCanvas.height);
        // خطوط میزان (پررنگ‌تر)
        _gctx.strokeStyle = 'rgba(255,255,255,0.12)';
        _gctx.lineWidth = 1;
        let _gBarCount = 0;
        for (let _bar = 1; _bar * _gbarDur <= _glen && _gBarCount < 500; _bar++) {
          const _x = Math.round((_bar * _gbarDur) * _gpxPerSec) + 0.5;
          if (_x > gridCanvas.width) break;
          _gctx.beginPath(); _gctx.moveTo(_x, 0); _gctx.lineTo(_x, gridCanvas.height); _gctx.stroke();
          _gBarCount++;
        }
        // خطوط ضرب (کمرنگ‌تر)
        if (_gpxPerSec > 10) {
          _gctx.strokeStyle = 'rgba(255,255,255,0.04)';
          let _gBeatCount = 0;
          for (let _beat = 0; _beat * _gbeatDur <= _glen && _gBeatCount < 500; _beat++) {
            if (_beat % _gbeatsPerBar === 0) continue;
            const _x = Math.round((_beat * _gbeatDur) * _gpxPerSec) + 0.5;
            if (_x > gridCanvas.width) break;
            _gctx.beginPath(); _gctx.moveTo(_x, 0); _gctx.lineTo(_x, gridCanvas.height); _gctx.stroke();
            _gBeatCount++;
          }
        }
        // ساب ضرب (زمانی که زوم خیلی زیاد است)
        if (_gpxPerSec > 40) {
          const _gSubBeatDur = _gbeatDur / 4;
          _gctx.strokeStyle = 'rgba(255,255,255,0.02)';
          let _gSubCount = 0;
          for (let _sub = 0; _sub * _gSubBeatDur <= _glen && _gSubCount < 500; _sub++) {
            if (_sub % 4 === 0) continue;
            const _x = Math.round((_sub * _gSubBeatDur) * _gpxPerSec) + 0.5;
            if (_x > gridCanvas.width) break;
            _gctx.beginPath(); _gctx.moveTo(_x, 0); _gctx.lineTo(_x, gridCanvas.height); _gctx.stroke();
            _gSubCount++;
          }
        }

        // ۲. ساخت پلی‌هد — ثابت در وسط کانتینر
        let mirrorPlayhead = targetDiv.querySelector('.mirror-playhead');
        if (!mirrorPlayhead) {
            mirrorPlayhead = _lyricPopup.document.createElement('div');
            mirrorPlayhead.className = 'mirror-playhead';
            mirrorPlayhead.style.cssText = 'position: absolute; top: 0; bottom: 0; width: 2px; background: #00F2FE; z-index: 100; box-shadow: 0 0 10px rgba(0,242,254,0.8); pointer-events: none; left: 50%;';
            targetDiv.appendChild(mirrorPlayhead);
        } else {
            // اگر از قبل وجود دارد، مطمئن شو در کانتینر باشد نه در کلون
            mirrorPlayhead.style.left = '50%';
        }

        const sourceClips = sourceTimeline.children;
        const cloneClips = clone.children;

        for (let i = 0; i < cloneClips.length; i++) {
            let clip = cloneClips[i];
            let sourceClip = sourceClips[i]; // تطابق دقیق یک به یک

            if (clip.classList.contains('mirror-playhead')) continue;

            // کانواس گرید را مخفی نکن
            if (clip.tagName === 'CANVAS') continue;

            // مخفی کردن دستگیره‌ها به جای حذف کردن
            if (clip.classList.contains('lane-resize-handle')) {
                clip.style.display = 'none';
                continue;
            }

            let text = clip.textContent || "";
            text = text.trim();

            if (text === '') {
                clip.style.display = 'none';
                continue;
            }

            // ۳. کپی مستقیم موقعیت و سایز از المان اصلی (حل مشکل شیفت میزان)
            if (sourceClip) {
                let cs = window.getComputedStyle(sourceClip);
                clip.style.left = cs.left !== 'auto' ? cs.left : '0px';
                clip.style.right = cs.right !== 'auto' ? cs.right : 'auto';
                clip.style.width = cs.width;
                clip.style.transform = cs.transform;
            }

            // استایل‌دهی بصری — دقیقاً مثل لاین آکورد تایم‌لاین
            clip.style.position = 'absolute';
            clip.style.display = 'flex';
            clip.style.alignItems = 'center';
            clip.style.justifyContent = 'center';
            clip.style.boxSizing = 'border-box';
            clip.style.direction = 'ltr';
            clip.style.opacity = '1';
            clip.style.visibility = 'visible';
            clip.style.background = 'linear-gradient(180deg, #4a2b5e, #2d1b3a)';
            clip.style.color = '#fff';
            clip.style.border = '1px solid #9F7AEA';
            clip.style.borderRadius = '7px';
            clip.style.padding = '0 10px';
            clip.style.fontSize = '18px';
            clip.style.fontWeight = '800';
            clip.style.fontFamily = "'JetBrains Mono', monospace";
            clip.style.height = Math.max(28, mirrorH - 24) + 'px';
            clip.style.top = Math.max(6, (mirrorH - parseInt(clip.style.height)) / 2) + 'px';
            clip.style.boxShadow = '0 2px 8px rgba(0,0,0,0.35)';
            clip.style.pointerEvents = 'none';
            clip.style.overflow = 'hidden';

            let innerSpan = clip.querySelector('span, div');
            if (innerSpan) {
                innerSpan.style.direction = 'ltr';
                innerSpan.style.color = '#fff';
                innerSpan.style.fontSize = '18px';
                innerSpan.style.fontWeight = '800';
                innerSpan.style.fontFamily = "'JetBrains Mono', monospace";
                innerSpan.style.display = 'inline';
            }
        }

        targetDiv.scrollLeft = 0;
        startMirrorSync();

      } catch (e) {
        console.error("Mirror Error:", e);
      }
    }

    // ======== موتور همگام‌سازی زنده پلی‌هد و اسکرول ========
    let _mirrorSyncRAF = null;

    function startMirrorSync() {
        if (_mirrorSyncRAF) cancelAnimationFrame(_mirrorSyncRAF);

        function loop() {
            try {
                if (!_lyricPopup || _lyricPopup.closed) return;

                const targetDiv = _lyricPopup.document.getElementById('playerChordMirror');
                if (!targetDiv) return;

                const mainLane = document.querySelector('.track-lane.chord-lane');
                const mainPlayhead = document.querySelector('.playhead, .timeline-playhead, .daw-playhead, #main-playhead');
                const mirrorPlayhead = targetDiv.querySelector('.mirror-playhead');
                const clone = targetDiv.querySelector('.track-lane, [class*="chord"]');

                if (mainLane && mainPlayhead && mirrorPlayhead) {
                    // محاسبه موقعیت پلی‌هد اصلی نسبت به صفحه
                    const mainRect = mainLane.getBoundingClientRect();
                    const phRect = mainPlayhead.getBoundingClientRect();
                    // موقعیت پلی‌هد نسبت به شروع تایم‌لاین (بدون در نظر گرفتن اسکرول)
                    const phLeftInLane = phRect.left - mainRect.left + mainLane.parentElement.scrollLeft;
                    // وسط کانتینر پلیر
                    const containerCenter = targetDiv.clientWidth / 2;
                    // اسکرول کلون تا پلی‌هد وسط بماند
                    if (clone) {
                        clone.style.left = (containerCenter - phLeftInLane) + 'px';
                    }
                    // هماهنگ کردن رولر بالا با حرکت لاین
                    const rulerInner = targetDiv.querySelector('.mirror-ruler-inner');
                    if (rulerInner) {
                        rulerInner.style.left = (containerCenter - phLeftInLane) + 'px';
                    }
                }

            } catch (e) {}

            _mirrorSyncRAF = requestAnimationFrame(loop);
        }

        _mirrorSyncRAF = requestAnimationFrame(loop);
    }

    // Init DAW (may fail if no AudioContext)
    try { init(); } catch(ex) { console.warn('DAW init error:', ex); }
    // Always init song editor
    edInitSong();
    // Init دیز/بمل/خودکار selector
    initAccidentalSelector();
    // Apply language
    applyI18n();
    // Init highlight effect
    initHighlightEffect();
    // Auto-check storage and show warning if needed
    setTimeout(() => {
      refreshStorageInfo();
    }, 3000);
  
    /**
     * exportAllPlaylistsToFile — خروجی کامل همه پلی‌لیست‌ها در یک فایل JSON
     */
    async function exportAllPlaylistsToFile() {
      if (!arrangers || arrangers.length === 0) {
        toast('⚠ هیچ پلی‌لیستی برای خروجی وجود ندارد');
        return;
      }

      const allSongs = edGetAllSongs();
      
      const exportData = {
        format: 'achord-playlists-backup',
        version: 1,
        exportType: 'all',
        exportedAt: new Date().toISOString(),
        activePlaylistId: editingArr ? editingArr.id : null,
        settings: { repeatMode: 'none' },
        playlists: arrangers.map(arr => ({
          id: arr.id,
          name: arr.name || 'پلی‌لیست',
          createdAt: arr.createdAt || new Date().toISOString(),
          updatedAt: arr.updatedAt || new Date().toISOString(),
          items: Array.isArray(arr.items) ? arr.items.map(it => (typeof it === 'string' ? it : it.songId)) : [],
          crossfade: arr.crossfade || 0,
          pauseBetween: !!arr.pauseBetween,
          _itemSettings: arr._itemSettings || {}
        }))
      };

      const fileName = `achord-playlists-backup-${new Date().toISOString().slice(0, 10)}.json`;

      if (window.showSaveFilePicker) {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: fileName,
            types: [{ description: 'JSON Playlists Backup', accept: { 'application/json': ['.json'] } }]
          });
          const writable = await handle.createWritable();
          await writable.write(JSON.stringify(exportData, null, 2));
          await writable.close();
          toast(`✅ خروجی کامل گرفته شد: ${fileName}`);
        } catch (e) {
          if (e.name !== 'AbortError') toast('خطا در خروجی: ' + e.message);
        }
      } else {
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = fileName; a.click();
        URL.revokeObjectURL(url);
        toast(`✅ خروجی کامل گرفته شد: ${fileName}`);
      }
    }

    /**
     * importAllPlaylistsFromFile — ورود کامل همه پلی‌لیست‌ها از فایل پشتیبان
     */
    async function importAllPlaylistsFromFile() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          const data = JSON.parse(text);

          if (!data || data.format !== 'achord-playlists-backup' || !Array.isArray(data.playlists)) {
            toast('❌ فایل معتبر نیست — فرمت پشتیبان پلی‌لیست نیست');
            return;
          }

          const supportedVersions = [1, '1.0', 2, '2.0'];
          if (data.version && !supportedVersions.includes(data.version)) {
            toast(`❌ نسخه فایل (${data.version}) پشتیبانی نمی‌شود.`);
            return;
          }

          for (let i = 0; i < data.playlists.length; i++) {
            const pl = data.playlists[i];
            if (!pl || !pl.name || !pl.name.trim()) {
              toast(`❌ پلی‌لیست شماره ${i + 1} نام معتبر ندارد.`);
              return;
            }
            if (!Array.isArray(pl.items)) {
              toast(`❌ پلی‌لیست «${pl.name}» آرایه items معتبر ندارد.`);
              return;
            }
          }

          const normalizePlaylistName = (name) => String(name || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('fa-IR');
          const existingNames = new Set(arrangers.map(a => normalizePlaylistName(a.name)));
          const importedNames = new Set();
          const duplicateNames = [];

          for (const pl of data.playlists) {
            const normalizedName = normalizePlaylistName(pl.name);
            if (importedNames.has(normalizedName)) {
              duplicateNames.push(pl.name);
            } else {
              importedNames.add(normalizedName);
            }
            if (existingNames.has(normalizedName) && !duplicateNames.includes(pl.name)) {
              duplicateNames.push(pl.name);
            }
          }

          if (duplicateNames.length > 0) {
            toast(`ورود کامل انجام نشد. پلی‌لیست‌های زیر دارای نام تکراری هستند:\n«${duplicateNames.join('»، «')}»`);
            return;
          }

          let importedSongsCount = 0;
          const allSongs = edGetAllSongs();
          if (data.songs && typeof data.songs === 'object') {
            for (const [id, song] of Object.entries(data.songs)) {
              if (song && song.title && !allSongs.find(s => s.id === id)) {
                allSongs.push(song);
                importedSongsCount++;
              }
            }
            if (importedSongsCount > 0) edSetAllSongs(allSongs);
          }

          const newPlaylists = data.playlists.map(pl => ({
            id: 'playlist_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
            name: pl.name,
            items: pl.items.map(it => (typeof it === 'string' ? it : it.songId)),
            crossfade: pl.crossfade || 0,
            pauseBetween: !!pl.pauseBetween,
            _itemSettings: pl._itemSettings || {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }));

          arrangers.unshift(...newPlaylists);
          saveArrangers();
          renderArrangerManager();

          toast(`✅ ${newPlaylists.length} پلی‌لیست وارد شد${importedSongsCount > 0 ? `، ${importedSongsCount} آهنگ جدید` : ''}`);
        } catch (e) {
          console.error('[Import All] Error:', e);
          toast('❌ خطا در بارگذاری فایل: ' + e.message);
        }
      };
      input.click();
    }

/**
 * دریافت مسیر فایل صوتی برای یک کلیپ (بدون لود کردن)
 */
function getClipFilePath(clip, projectFilePath = null) {
  let filePath = null;
  
  // بررسی حالت‌های مختلف ذخیره‌سازی
  if (clip.storage && clip.storage.mode === 'copy') {
    const projRoot = projectFilePath ? pathDirname(projectFilePath) : DAW.projectRoot;
    if (!projRoot || !clip.storage.projectPath) {
      return null;
    }
    filePath = (window.electronAPI?.resolvePath)
               ? window.electronAPI.resolvePath(projRoot, clip.storage.projectPath)
               : pathJoin(projRoot, clip.storage.projectPath);
  } else if (clip.storage && clip.storage.mode === 'reference') {
    filePath = clip.storage.externalPath;
  } else if (clip.relativePath) {
    const projRoot = projectFilePath ? pathDirname(projectFilePath) : DAW.projectRoot;
    if (projRoot) {
      filePath = (window.electronAPI?.resolvePath)
                 ? window.electronAPI.resolvePath(projRoot, clip.relativePath)
                 : pathJoin(projRoot, clip.relativePath);
    }
  } else if (clip._filePath) {
    filePath = clip._filePath;
  } else if (clip.filePath) {
    filePath = clip.filePath;
  }
  
  return filePath;
}

// اطمینان از اینکه تابع getClipFilePath در global scope قابل دسترسی هست
if (typeof window !== 'undefined') {
  window.getClipFilePath = getClipFilePath;
}

// ==========================================
// PART: Print Song (چاپ دقیق با آکوردها)
// ==========================================
/**
 * printSong — چاپ ترانه با آکوردها دقیقاً در همان جایگاه ادیتور
 *
 * روش کار:
 * 1. یک iframe مخفی ساخته می‌شود
 * 2. متن ترانه با همان استایل‌های ادیتور (فونت، اندازه، رنگ، تراز) داخل iframe رندر می‌شود
 * 3. آکوردها با همان الگوریتم موقعیت‌یابی (anchorRectIn) ولی داخل خود iframe
 *    رندر می‌شوند تا مختصات دقیقاً با چاپ هماهنگ باشد
 * 4. iframe.contentWindow.print() فراخوانی می‌شود و iframe بعد از چاپ حذف می‌شود
 */
function printSong() {
  if (!edCur) { toast('ابتدا یک ترانه باز کنید'); return; }

  // جلوگیری از چند چاپ هم‌زمان
  if (printSong._active) return;
  printSong._active = true;

  const st = edCur.styles || {};
  const cSize = st.cSize || 23;
  const GAP = Math.max(10, cSize * 0.6);

  try {
    // ─── ساخت کانتینر چاپ در سند اصلی ───
    // این روش در Electron قطعاً کار می‌کند چون محتوا در DOM اصلی رندر می‌شود
    // و window.print() محتوای رندر شده را چاپ می‌کند
    let printContainer = document.getElementById('printContainer');
    if (!printContainer) {
      printContainer = document.createElement('div');
      printContainer.id = 'printContainer';
      document.body.appendChild(printContainer);
    }
    printContainer.innerHTML = '';

    // ─── هدر چاپ ───
    const header = document.createElement('div');
    header.className = 'print-header';
    const titleEl = document.createElement('div');
    titleEl.className = 'title';
    const subEl = document.createElement('div');
    subEl.className = 'sub';
    header.appendChild(titleEl);
    header.appendChild(subEl);
    printContainer.appendChild(header);

    // ─── محتوای چاپ ───
    const wrap = document.createElement('div');
    wrap.id = 'printWrap';
    const content = document.createElement('div');
    content.id = 'lyricContent';
    const overlay = document.createElement('div');
    overlay.id = 'chordOverlay';
    wrap.appendChild(content);
    wrap.appendChild(overlay);
    printContainer.appendChild(wrap);

    // ─── داده‌های آکوردها (با اعمال ترنسپوز) ───
    const chordData = (edCur.chords || []).map(ch => {
      let name = ch.name || '';
      if (name && edCur.transpose && edCur.originalKey) {
        name = edTransposeChord(name, edCur.transpose);
      }
      return {
        lineIndex: ch.lineIndex,
        charIndex: ch.charIndex,
        anchorType: ch.anchorType,
        name: name,
        color: ch.color || st.cColor || '#e6aa28'
      };
    }).filter(c => c.name && c.name.trim());

    // ─── هدر ───
    const displayKey = edCur.transpose ? (edTransposeKeyName(edCur.originalKey || edCur.key, edCur.transpose) || edCur.key) : edCur.key;
    const keyStr = displayKey + (edCur.keyMode === 'min' ? 'm' : '');
    const subParts = [];
    if (edCur.artist) subParts.push(edCur.artist);
    if (edCur.key) subParts.push((currentLang === 'fa' ? 'گام: ' : 'Key: ') + keyStr);
    if (edCur.transpose) subParts.push((currentLang === 'fa' ? 'ترنسپوز ' : 'Transpose ') + (edCur.transpose > 0 ? '+' : '') + edCur.transpose);
    titleEl.textContent = edCur.title || t('untitled');
    subEl.textContent = subParts.join('  •  ');

    // ─── رندر متن ───
    const tFont = st.tFont || 'Vazirmatn';
    const tSize = st.tSize || 23;
    const tColor = st.tColor || '#0fa966';
    const tBold = st.tBold ? 'bold' : 'normal';
    const align = st.align || 'center';
    const lineColors = edCur.lineColors || [];

    const lines = (edCur.lyrics || '').split('\n');
    lines.forEach(function(ln, li) {
      const d = document.createElement('div');
      d.className = 'eline';
      d.setAttribute('data-line', String(li));
      d.style.unicodeBidi = 'plaintext';
      d.style.fontSize = tSize + 'px';
      d.style.color = lineColors[li] || tColor;
      d.style.fontFamily = tFont;
      d.style.fontWeight = tBold;
      d.style.textAlign = align;
      d.style.lineHeight = '2.2';
      d.textContent = ln || '\u200B';
      content.appendChild(d);
    });

    // ─── موقعیت‌یابی آکوردها ───
    const drawChords = () => {
      overlay.innerHTML = '';

      const isRTL = document.documentElement.dir === 'rtl';
      const MARGIN = 5;

      chordData.forEach(function(ch, idx) {
        const lineEl = content.children[ch.lineIndex];
        if (!lineEl) return;

        // محاسبه rect کاراکتر مورد نظر — همان منطق anchorRectIn
        let rect = null;
        const segs = [];
        let total = 0;
        const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT);
        let node;
        while (node = walker.nextNode()) {
          segs.push({ node: node, start: total, len: node.textContent.length });
          total += node.textContent.length;
        }
        if (segs.length) {
          const len = total;
          const r = document.createRange();
          if (ch.anchorType === 'LineStart') {
            const s = segs[0];
            r.setStart(s.node, 0); r.setEnd(s.node, Math.min(1, s.len));
            rect = r.getBoundingClientRect();
          } else if (ch.anchorType === 'LineEnd') {
            const s = segs[segs.length - 1];
            const rp = Math.max(0, s.len - 1);
            r.setStart(s.node, rp); r.setEnd(s.node, Math.min(rp + 1, s.len));
            rect = r.getBoundingClientRect();
          } else {
            const ci = Math.min(ch.charIndex, Math.max(0, len - 1));
            let s3 = null;
            for (let k = 0; k < segs.length; k++) {
              if (ci >= segs[k].start && ci < segs[k].start + segs[k].len) { s3 = segs[k]; break; }
            }
            if (!s3) s3 = segs[segs.length - 1];
            const local = Math.max(0, ci - s3.start);
            r.setStart(s3.node, Math.min(local, s3.len));
            r.setEnd(s3.node, Math.min(local + 1, s3.len));
            rect = r.getBoundingClientRect();
          }
        }
        if (!rect) return;

        const wrapRect = wrap.getBoundingClientRect();
        const el = document.createElement('span');
        el.className = 'chord-print';
        el.textContent = ch.name;
        el.style.fontSize = cSize + 'px';
        el.style.color = ch.color || st.cColor || '#e6aa28';
        el.style.fontFamily = st.cFont || 'JetBrains Mono';
        el.style.fontWeight = 'bold';

        overlay.appendChild(el);
        const elW = el.offsetWidth;
        const elH = el.offsetHeight;

        let x;
        if (ch.anchorType === 'LineStart') {
          x = isRTL ? rect.right + MARGIN : rect.left - MARGIN;
        } else if (ch.anchorType === 'LineEnd') {
          x = isRTL ? rect.left - MARGIN : rect.right + MARGIN;
        } else if (ch.anchorType === 'BetweenCharacters') {
          x = rect.right;
        } else {
          x = (rect.left + rect.right) / 2;
        }

        const top = rect.top - wrapRect.top - cSize - GAP;

        el.style.top = top + 'px';
        el.style.left = (x - wrapRect.left - elW / 2) + 'px';

        // خط اتصال آکورد به متن
        const line = document.createElement('div');
        line.className = 'chord-print-anchor';
        line.style.left = (x - wrapRect.left) + 'px';
        line.style.top = (top + elH) + 'px';
        line.style.width = '2px';
        line.style.height = Math.max(4, GAP) + 'px';
        line.style.background = (ch.color || st.cColor || '#e6aa28');
        overlay.appendChild(line);
      });

      // جلوگیری از هم‌پوشانی افقی آکوردهای یک خط
      const lineGroups = {};
      chordData.forEach(function(ch, i) {
        if (!lineGroups[ch.lineIndex]) lineGroups[ch.lineIndex] = [];
        const chordEls = overlay.querySelectorAll('.chord-print');
        if (chordEls[i]) {
          lineGroups[ch.lineIndex].push(chordEls[i]);
        }
      });
      Object.keys(lineGroups).forEach(function(li) {
        const els = lineGroups[li];
        els.sort(function(a, b) { return parseFloat(a.style.left) - parseFloat(b.style.left); });
        for (let i = 1; i < els.length; i++) {
          const prev = els[i - 1];
          const curr = els[i];
          const prevRight = parseFloat(prev.style.left) + prev.offsetWidth;
          const currLeft = parseFloat(curr.style.left);
          if (currLeft < prevRight + 8) {
            curr.style.left = (prevRight + 8) + 'px';
          }
        }
      });
    };

    drawChords();

    // اگر فونت‌ها بعداً لود شدند، دوباره رسم کن
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function() {
        requestAnimationFrame(function() { requestAnimationFrame(drawChords); });
      });
    }

    // ─── چاپ ───
    // کمی صبر کن تا فونت‌ها لود شوند و بعد چاپ کن
    setTimeout(function() {
      try {
        // در محیط Electron از پنجره چاپ جداگانه استفاده کن
        if (isElectron && window.electronAPI && window.electronAPI.printHtml) {
          // ساخت HTML کامل برای پنجره چاپ
          const printHtmlContent = `<!DOCTYPE html>
<html dir="rtl" lang="fa">
<head>
<meta charset="UTF-8">
<title>${(edCur.title || t('untitled')).replace(/</g, '<').replace(/>/g, '>')}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Vazirmatn', 'Tahoma', sans-serif;
    background: #fff;
    color: #000;
    padding: 20px;
    direction: rtl;
  }
  .print-header {
    text-align: center;
    margin-bottom: 20px;
    padding-bottom: 12px;
    border-bottom: 2px solid #333;
  }
  .print-header .title {
    font-size: 26px;
    font-weight: 900;
    color: #000;
  }
  .print-header .sub {
    font-size: 13px;
    color: #555;
    margin-top: 4px;
    font-weight: 400;
  }
  #printWrap {
    position: relative;
  }
  #lyricContent {
    line-height: 2.2;
    white-space: pre-wrap;
  }
  #chordOverlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    pointer-events: none;
    z-index: 10;
  }
  .eline {
    white-space: pre-wrap;
    word-break: break-word;
  }
  .chord-print {
    position: absolute;
    font-weight: 700;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .chord-print-anchor {
    position: absolute;
    height: 2px;
    opacity: 0.5;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  @media print {
    body { padding: 0; }
  }
</style>
</head>
<body>
${printContainer.innerHTML}
</body>
</html>`;

          window.electronAPI.printHtml(printHtmlContent).then(function(res) {
            if (!res || !res.success) {
              console.error('[Print] Electron print error:', res);
              toast('خطا در چاپ');
            }
          }).catch(function(err) {
            console.error('[Print] Electron print error:', err);
            toast('خطا در چاپ');
          }).finally(function() {
            if (printContainer && printContainer.parentNode) {
              printContainer.parentNode.removeChild(printContainer);
            }
            printSong._active = false;
          });
        } else {
          // در مرورگر معمولی از window.print استفاده کن
          window.focus();
          window.print();
          // بعد از چاپ، کانتینر را پاک کن
          setTimeout(function() {
            if (printContainer && printContainer.parentNode) {
              printContainer.parentNode.removeChild(printContainer);
            }
            printSong._active = false;
          }, 1000);
        }
      } catch (e) {
        console.error('[Print] Error:', e);
        toast('خطا در چاپ');
        if (printContainer && printContainer.parentNode) {
          printContainer.parentNode.removeChild(printContainer);
        }
        printSong._active = false;
      }
    }, 300);
  } catch (e) {
    console.error('[Print] Error building content:', e);
    toast('خطا در آماده‌سازی چاپ');
    const pc = document.getElementById('printContainer');
    if (pc && pc.parentNode) pc.parentNode.removeChild(pc);
    printSong._active = false;
  }
}

// expose to global scope
window.printSong = printSong;
window.syncChordLineFromLyrics = syncChordLineFromLyrics;

// ===== Quick Search Panel Functions =====
let _quickSearchDragging = false;
let _quickSearchDragOffset = { x: 0, y: 0 };

function openQuickSearchPanel() {
  const panel = document.getElementById('quickSearchPanel');
  if (!panel) return;
  
  // Show panel
  panel.style.display = 'flex';
  // Force reflow
  panel.offsetHeight;
  panel.classList.add('show');
  
  // Focus input
  setTimeout(() => {
    const input = document.getElementById('quickSearchInput');
    if (input) input.focus();
  }, 50);
  
  // Render initial list
  quickSearchFilter();
  
  // Setup drag functionality
  setupQuickSearchDrag();
}

function closeQuickSearchPanel() {
  const panel = document.getElementById('quickSearchPanel');
  if (!panel) return;
  panel.classList.remove('show');
  setTimeout(() => {
    panel.style.display = 'none';
  }, 150);
}

function setupQuickSearchDrag() {
  const header = document.getElementById('quickSearchHeader');
  const panel = document.getElementById('quickSearchPanel');
  if (!header || !panel) return;
  
  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('.qsp-close')) return;
    _quickSearchDragging = true;
    const rect = panel.getBoundingClientRect();
    _quickSearchDragOffset.x = e.clientX - rect.left;
    _quickSearchDragOffset.y = e.clientY - rect.top;
    panel.style.transition = 'none';
    e.preventDefault();
  });
  
  document.addEventListener('mousemove', (e) => {
    if (!_quickSearchDragging) return;
    const x = e.clientX - _quickSearchDragOffset.x;
    const y = e.clientY - _quickSearchDragOffset.y;
    
    // Boundary checks
    const maxX = window.innerWidth - panel.offsetWidth;
    const maxY = window.innerHeight - panel.offsetHeight;
    
    panel.style.left = Math.max(0, Math.min(x, maxX)) + 'px';
    panel.style.top = Math.max(0, Math.min(y, maxY)) + 'px';
    panel.style.right = 'auto';
  });
  
  document.addEventListener('mouseup', () => {
    if (_quickSearchDragging) {
      _quickSearchDragging = false;
      panel.style.transition = '';
    }
  });
}

function quickSearchFilter() {
  const input = document.getElementById('quickSearchInput');
  const list = document.getElementById('quickSearchList');
  const clearBtn = document.getElementById('quickSearchClear');
  if (!input || !list) return;
  
  const query = input.value.trim().toLowerCase();
  
  // Show/hide clear button
  if (clearBtn) {
    clearBtn.style.display = query ? 'block' : 'none';
  }
  
  // Get filter values
  const sig = document.getElementById('qspFilterSig')?.value || '';
  const genre = document.getElementById('qspFilterGenre')?.value || '';
  const tempoRange = document.getElementById('qspFilterTempo')?.value || '';
  const keyFilter = document.getElementById('qspFilterKey')?.value || '';
  
  const songs = edGetAllSongs().filter(s => !s.deletedAt);
  
  if (!query && !sig && !genre && !tempoRange && !keyFilter) {
    // Show recent/opened songs or all
    const recent = [...songs].sort((a, b) => {
      const aTime = a.lastOpenedAt ? new Date(a.lastOpenedAt).getTime() : 0;
      const bTime = b.lastOpenedAt ? new Date(b.lastOpenedAt).getTime() : 0;
      return bTime - aTime;
    }).slice(0, 20);
    
    renderQuickSearchList(recent, list);
    return;
  }
  
  // Filter songs
  const filtered = songs.filter(s => {
    // Text search
    if (query) {
      const title = (s.title || '').toLowerCase();
      const artist = (s.artist || '').toLowerCase();
      const rawText = (s.rawText || '').toLowerCase();
      if (!title.includes(query) && !artist.includes(query) && !rawText.includes(query)) return false;
    }
    // Signature filter
    if (sig && s.timeSignature !== sig) return false;
    // Genre filter
    if (genre && s.genre !== genre) return false;
    // Key filter
    if (keyFilter === '_maj' && s.keyMode !== 'maj') return false;
    else if (keyFilter === '_min' && s.keyMode !== 'min') return false;
    else if (keyFilter && keyFilter !== '_maj' && keyFilter !== '_min' && s.key !== keyFilter) return false;
    // Tempo filter
    if (tempoRange) {
      const bpm = s.tempo || s.bpm || 120;
      if (tempoRange === 'slow' && bpm > 80) return false;
      if (tempoRange === 'mid' && (bpm <= 80 || bpm > 120)) return false;
      if (tempoRange === 'fast' && (bpm <= 120 || bpm > 160)) return false;
      if (tempoRange === 'vfast' && bpm <= 160) return false;
    }
    return true;
  }).slice(0, 50);
  
  renderQuickSearchList(filtered, list);
}

function quickSearchClearFilters() {
  const input = document.getElementById('quickSearchInput');
  ['qspFilterSig','qspFilterGenre','qspFilterTempo','qspFilterKey'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  if (input) input.value = '';
  quickSearchFilter();
}

function renderQuickSearchList(songs, container) {
  if (!container) return;
  
  if (songs.length === 0) {
    container.innerHTML = '<div class="qsp-empty">ترانه‌ای یافت نشد</div>';
    return;
  }
  
  container.innerHTML = songs.map(s => `
    <button class="qsp-item" data-song-id="${s.id}" onclick="quickSearchLoadSong('${s.id}')">
      <div class="qsp-item-title">${escapeHtml(s.title || 'بدون نام')}</div>
      <div class="qsp-item-artist">${escapeHtml(s.artist || '')}</div>
    </button>
  `).join('');
}

function quickSearchLoadSong(id) {
  // Use the existing archLoadSong function but close panel instead of archive modal
  const songs = edGetAllSongs();
  const s = songs.find(x => String(x.id) === String(id));
  if (!s || s.deletedAt) {
    toast('ترانه یافت نشد');
    return;
  }
  
  closeQuickSearchPanel();
  archLoadSong(id);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
