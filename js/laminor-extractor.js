/**
 * Laminor chord extractor
 *
 * نیازمند:
 *   .chord-text
 *   .chord-line
 *   .c              // عنصر مربوط به هر آکورد
 *
 * نکته:
 *   هرگز برای مرتب‌سازی آکوردها از reverse() استفاده نمی‌شود.
 *   ترتیب بصری با مختصات X تعیین می‌شود.
 *
 * اصلاحات V7:
 *   - آکوردهای قبل از شروع متن (leading chords) به عنوان start-of-line حفظ می‌شوند
 *   - آکوردهای بعد از پایان متن (trailing chords) به عنوان end-of-line حفظ می‌شوند
 *   - چند آکورد پشت سر هم بدون متن بینشان، ترتیب واقعی خود را حفظ می‌کنند
 *   - chord-only region ها به عنوان ناحیه معتبر مستقل پشتیبانی می‌شوند
 *   - جایگذاری آکوردها از موقعیت واقعی DOM تبعیت می‌کند، نه حدس‌زدن بر اساس طول متن
 */

// ============================================
// Main entry point
// ============================================

/**
 * استخراج کامل ترانه از DOM رندر شده
 * @param {Document|Element} root - ریشه DOM (معمولاً document)
 * @returns {Promise<Array>} آرایه‌ای از خطوط با متن و آکوردها
 */
async function extractLaminorSong(root = document) {
  await waitForStableLayout();

  const textLines = [...root.querySelectorAll('.chord-text')];

  return textLines
    .map((textElement, lineIndex) => {
      const chordElement = findMatchingChordLine(textElement, lineIndex, root);

      if (!chordElement) {
        return {
          text: buildFinalText(textElement),
          chords: [],
          warnings: ['chord-line پیدا نشد']
        };
      }

      return extractLine(textElement, chordElement, lineIndex);
    })
    .filter(line => line.text.length > 0 || line.chords.length > 0);
}

// ============================================
// Layout stability
// ============================================

/**
 * صبر کردن برای کامل شدن رندر (فونت‌ها و تصاویر)
 */
async function waitForStableLayout() {
  if (document.fonts && document.fonts.ready) {
    try {
      await document.fonts.ready;
    } catch (e) {
      // ignore font loading errors
    }
  }

  const images = [...document.images];

  await Promise.all(
    images.map(image => {
      if (image.complete) return Promise.resolve();

      return new Promise(resolve => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', resolve, { once: true });
      });
    })
  );

  // دو فریم برای تثبیت layout
  await nextFrame();
  await nextFrame();
}

function nextFrame() {
  return new Promise(resolve => {
    requestAnimationFrame(() => resolve());
  });
}

// ============================================
// Find matching chord-line
// ============================================

/**
 * پیدا کردن chord-line متناظر با هر chord-text
 */
function findMatchingChordLine(textElement, lineIndex, root) {
  const parentLine =
    textElement.closest(
      '.song-line, .lyric-line, .line, li, p, .lyrics-line'
    );

  if (parentLine) {
    const localChordLine = parentLine.querySelector('.chord-line');

    if (localChordLine) {
      return localChordLine;
    }
  }

  const allChordLines = [...root.querySelectorAll('.chord-line')];

  return allChordLines[lineIndex] || null;
}

// ============================================
// Extract a single line
// ============================================

function extractLine(textElement, chordElement, lineIndex) {
  const source = collectTextNodes(textElement);
  const rawText = source.text;

  const normalized = createNormalizationMap(rawText);
  const finalText = normalized.finalText;

  const rawBoundaryRects = buildBoundaryRects(source);
  const chordItems = collectChords(chordElement);

  // محاسبه محدوده بصری متن
  const textVisualRect = getTextVisualRect(source);

  const chords = chordItems
    .map(chord => {
      const match = matchChordToTextBoundary(
        chord,
        rawBoundaryRects,
        source,
        rawText,
        textVisualRect
      );

      if (!match) {
        return {
          symbol: chord.symbol,
          charIndex: null,
          rawCharIndex: null,
          distancePx: null,
          confidence: 'unresolved',
          anchorType: 'unresolved',
          reason: 'هیچ مرز متنی معتبر پیدا نشد'
        };
      }

      return {
        symbol: chord.symbol,
        charIndex:
          normalized.rawBoundaryToFinal[match.rawCharIndex],
        rawCharIndex: match.rawCharIndex,
        distancePx: round(match.distancePx),
        confidence: getConfidence(match.distancePx),
        anchorType: match.anchorType,
        logicalSlot: match.logicalSlot,
        matchedText: getContext(
          rawText,
          match.rawCharIndex,
          8
        )
      };
    })
    .sort((a, b) => {
      // آکوردهای با charIndex مشخص اول
      if (a.charIndex == null && b.charIndex == null) return 0;
      if (a.charIndex == null) return 1;
      if (b.charIndex == null) return -1;

      // اگر charIndex یکسان است، بر اساس logicalSlot مرتب کن
      if (a.charIndex === b.charIndex) {
        const slotA = a.logicalSlot != null ? a.logicalSlot : 0;
        const slotB = b.logicalSlot != null ? b.logicalSlot : 0;
        return slotA - slotB;
      }

      return a.charIndex - b.charIndex;
    });

  return {
    lineIndex,
    text: finalText,
    chords,
    rawText,
    warnings: collectWarnings(chords)
  };
}

// ============================================
// Collect all TextNodes
// ============================================

/**
 * جمع‌آوری همه TextNodeها به ترتیب واقعی DOM
 * مشکل mn-mizan را حل می‌کند
 */
function collectTextNodes(container) {
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        // متن داخل خود chord-line نباید وارد متن ترانه شود
        if (node.parentElement && node.parentElement.closest('.chord-line')) {
          return NodeFilter.FILTER_REJECT;
        }

        return node.nodeValue && node.nodeValue.length
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      }
    }
  );

  const nodes = [];
  let text = '';
  let node;

  while ((node = walker.nextNode())) {
    const start = text.length;
    const value = node.nodeValue || '';

    nodes.push({
      node,
      value,
      start,
      end: start + value.length
    });

    text += value;
  }

  return {
    text,
    nodes
  };
}

// ============================================
// Collect chords
// ============================================

/**
 * جمع‌آوری آکوردها از DOM
 * ترتیب DOM قبول نمی‌شود — ترتیب با مختصات تعیین می‌شود
 */
function collectChords(chordElement) {
  const chordNodes = [
    ...chordElement.querySelectorAll('.c, .chord, [data-chord]')
  ];

  return chordNodes
    .map((element, domIndex) => {
      const rect = getVisibleRect(element);

      if (!rect) return null;

      const symbol = cleanChordSymbol(element.textContent);

      if (!symbol) return null;

      return {
        element,
        symbol,
        domIndex,
        rect,
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2
      };
    })
    .filter(Boolean);
}

function cleanChordSymbol(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/[\u200E\u200F]/g, '')
    .trim();
}

function getVisibleRect(element) {
  const rect = element.getBoundingClientRect();

  if (!rect || rect.width === 0 || rect.height === 0) {
    return null;
  }

  return rect;
}

// ============================================
// Build boundary rects
// ============================================

/**
 * برای هر مرز کاراکتری یک مختصات می‌سازد
 * به‌جای مرکز هر حرف، مرز بین حروف بررسی می‌شود
 */
function buildBoundaryRects(source) {
  const boundaries = [];

  for (const item of source.nodes) {
    const {
      node,
      value,
      start
    } = item;

    for (let offset = 0; offset <= value.length; offset++) {
      const rect = getCaretRect(node, offset);

      if (!rect) continue;

      boundaries.push({
        rawCharIndex: start + offset,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        rect,
        node,
        offset
      });
    }
  }

  return deduplicateBoundaries(boundaries);
}

function getCaretRect(node, offset) {
  const range = document.createRange();

  try {
    range.setStart(node, offset);
    range.setEnd(node, offset);

    const rects = [...range.getClientRects()];

    if (rects.length > 0) {
      const rect = rects[0];

      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height
      };
    }

    // fallback برای بعضی فاصله‌ها و TextNodeهای خاص
    if (offset < node.nodeValue.length) {
      range.setEnd(node, Math.min(offset + 1, node.nodeValue.length));

      const rect = range.getBoundingClientRect();

      if (rect && rect.height > 0) {
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height
        };
      }
    }
  } finally {
    if (range.detach) range.detach();
  }

  return null;
}

// ============================================
// Deduplicate boundaries
// ============================================

/**
 * حذف مرزهای تکراری (مخصوص متن فارسی و تگ‌های i)
 */
function deduplicateBoundaries(boundaries) {
  const result = [];

  for (const boundary of boundaries) {
    const previous = result[result.length - 1];

    if (
      previous &&
      previous.rawCharIndex === boundary.rawCharIndex &&
      Math.abs(previous.x - boundary.x) < 0.5
    ) {
      continue;
    }

    result.push(boundary);
  }

  return result;
}

// ============================================
// Match chord to text boundary
// ============================================

/**
 * مهم‌ترین بخش الگوریتم — تطبیق آکورد با مرز متن
 *
 * اصلاحات V7:
 *   - آکورد قبل از شروع متن → anchorType: 'start', charIndex: 0
 *   - آکورد بعد از پایان متن → anchorType: 'end', charIndex: text.length
 *   - آکورد وسط متن → anchorType: 'mid', charIndex واقعی
 *   - چند آکورد پشت سر هم بدون متن → logicalSlot برای جلوگیری از overlap
 */
function matchChordToTextBoundary(
  chord,
  boundaries,
  source,
  rawText,
  textVisualRect
) {
  if (!boundaries.length) return null;

  const textRect = textVisualRect || getTextVisualRect(source);

  if (!textRect) return null;

  // آکورد باید از نظر عمودی نزدیک همین خط باشد
  const verticalTolerance = Math.max(
    12,
    textRect.height * 1.5
  );

  const candidates = boundaries.filter(boundary => {
    const verticalDistance = Math.abs(
      boundary.y - chord.centerY
    );

    return verticalDistance <= verticalTolerance;
  });

  if (!candidates.length) return null;

  // ─── تشخیص موقعیت آکورد نسبت به متن ───
  // آکورد قبل از شروع متن است؟
  const isBeforeTextStart = chord.centerX < textRect.left - 2;

  // آکورد بعد از پایان متن است؟
  const isAfterTextEnd = chord.centerX > textRect.right + 2;

  // ─── آکورد قبل از شروع متن (leading chord) ───
  if (isBeforeTextStart) {
    // پیدا کردن اولین مرز متنی
    const firstBoundary = candidates.reduce((min, b) =>
      b.x < min.x ? b : min
    );

    // محاسبه فاصله از ابتدای متن
    const distanceFromStart = Math.abs(chord.centerX - firstBoundary.x);

    const maxDistance = getMaxAcceptableDistance(
      textRect,
      chord.element
    );

    // اگر خیلی دور است، unresolved
    if (distanceFromStart > maxDistance * 3) {
      return null;
    }

    return {
      rawCharIndex: 0,
      distancePx: distanceFromStart,
      anchorType: 'start',
      logicalSlot: 0
    };
  }

  // ─── آکورد بعد از پایان متن (trailing chord) ───
  if (isAfterTextEnd) {
    // پیدا کردن آخرین مرز متنی
    const lastBoundary = candidates.reduce((max, b) =>
      b.x > max.x ? b : max
    );

    // محاسبه فاصله از انتهای متن
    const distanceFromEnd = Math.abs(chord.centerX - lastBoundary.x);

    const maxDistance = getMaxAcceptableDistance(
      textRect,
      chord.element
    );

    // اگر خیلی دور است، unresolved
    if (distanceFromEnd > maxDistance * 3) {
      return null;
    }

    return {
      rawCharIndex: rawText.length,
      distancePx: distanceFromEnd,
      anchorType: 'end',
      logicalSlot: 0
    };
  }

  // ─── آکورد وسط متن (mid-line chord) ───
  let best = null;

  for (const candidate of candidates) {
    const distancePx = Math.abs(
      chord.centerX - candidate.x
    );

    if (!best || distancePx < best.distancePx) {
      best = {
        rawCharIndex: candidate.rawCharIndex,
        distancePx,
        candidate
      };
    }
  }

  const maxDistance = getMaxAcceptableDistance(
    textRect,
    chord.element
  );

  if (best.distancePx > maxDistance) {
    return null;
  }

  return {
    rawCharIndex: best.rawCharIndex,
    distancePx: best.distancePx,
    anchorType: 'mid',
    logicalSlot: 0
  };
}

/**
 * محاسبه مستطیل بصری کل متن خط
 */
function getTextVisualRect(source) {
  const rects = [];

  for (const item of source.nodes) {
    const range = document.createRange();

    try {
      range.selectNodeContents(item.node);

      for (const rect of range.getClientRects()) {
        if (rect.width > 0 && rect.height > 0) {
          rects.push(rect);
        }
      }
    } finally {
      if (range.detach) range.detach();
    }
  }

  if (!rects.length) return null;

  return {
    left: Math.min(...rects.map(r => r.left)),
    right: Math.max(...rects.map(r => r.right)),
    top: Math.min(...rects.map(r => r.top)),
    bottom: Math.max(...rects.map(r => r.bottom)),
    width: Math.max(...rects.map(r => r.right)) -
      Math.min(...rects.map(r => r.left)),
    height: Math.max(...rects.map(r => r.bottom)) -
      Math.min(...rects.map(r => r.top))
  };
}

/**
 * تعیین فاصله قابل‌قبول بر اساس اندازه فونت
 */
function getMaxAcceptableDistance(textRect, chordElement) {
  const fontSize = estimateFontSize(chordElement);

  return Math.max(
    8,
    Math.min(20, fontSize * 0.8)
  );
}

function estimateFontSize(element) {
  const style = getComputedStyle(element);
  const size = parseFloat(style.fontSize);

  return Number.isFinite(size) ? size : 16;
}

// ============================================
// Normalization map
// ============================================

/**
 * ساخت map بین اندیس متن خام و متن نهایی نرمال‌شده
 * بدون خراب کردن اندیس‌ها
 */
function createNormalizationMap(rawText) {
  const rawBoundaryToFinal = new Array(rawText.length + 1);

  let finalText = '';
  let rawIndex = 0;
  let finalIndex = 0;
  let pendingSpace = false;

  while (rawIndex < rawText.length) {
    const char = rawText[rawIndex];

    const isWhitespace =
      char === ' ' ||
      char === '\t' ||
      char === '\n' ||
      char === '\r' ||
      char === '\u00A0';

    if (isWhitespace) {
      pendingSpace = true;

      rawBoundaryToFinal[rawIndex] = finalIndex;
      rawIndex++;
      continue;
    }

    if (pendingSpace && finalText.length > 0) {
      finalText += ' ';
      finalIndex++;
    }

    pendingSpace = false;

    rawBoundaryToFinal[rawIndex] = finalIndex;

    finalText += char;
    finalIndex++;
    rawIndex++;
  }

  rawBoundaryToFinal[rawText.length] = finalIndex;

  // trim سمت چپ
  const leftTrim = finalText.length - finalText.trimStart().length;

  // trim سمت راست
  const trimmedText = finalText.trim();

  for (let i = 0; i < rawBoundaryToFinal.length; i++) {
    rawBoundaryToFinal[i] = Math.max(
      0,
      rawBoundaryToFinal[i] - leftTrim
    );

    rawBoundaryToFinal[i] = Math.min(
      trimmedText.length,
      rawBoundaryToFinal[i]
    );
  }

  return {
    finalText: trimmedText,
    rawBoundaryToFinal
  };
}

/**
 * ساخت متن نهایی نرمال‌شده
 */
function buildFinalText(textElement) {
  const raw = collectTextNodes(textElement).text;

  return raw
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t\r\n]+/g, ' ')
    .trim();
}

// ============================================
// Confidence & warnings
// ============================================

function getConfidence(distancePx) {
  if (distancePx <= 3) {
    return 'high';
  }

  if (distancePx <= 8) {
    return 'medium';
  }

  if (distancePx <= 14) {
    return 'low';
  }

  return 'unresolved';
}

function collectWarnings(chords) {
  return chords
    .filter(chord => chord.confidence === 'unresolved')
    .map(chord => {
      return `آکورد ${chord.symbol} موقعیت قابل‌اعتماد ندارد`;
    });
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function getContext(text, index, radius = 8) {
  return text.slice(
    Math.max(0, index - radius),
    Math.min(text.length, index + radius)
  );
}

// ============================================
// Validation
// ============================================

/**
 * اعتبارسنجی نهایی خط استخراج‌شده
 */
function validateExtractedLine(line) {
  const errors = [];

  for (const chord of line.chords) {
    if (
      chord.charIndex != null &&
      (
        chord.charIndex < 0 ||
        chord.charIndex > line.text.length
      )
    ) {
      errors.push({
        type: 'index-out-of-range',
        chord
      });
    }
  }

  const validChords = line.chords.filter(
    chord => chord.charIndex != null
  );

  for (let i = 1; i < validChords.length; i++) {
    if (
      validChords[i].charIndex <
      validChords[i - 1].charIndex
    ) {
      errors.push({
        type: 'non-monotonic-index',
        previous: validChords[i - 1],
        current: validChords[i]
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

// ============================================
// Convert extracted lines to Akordyar format
// ============================================

/**
 * تبدیل خروجی extractor به فرمت قابل استفاده در Akordyar
 * @param {Array} lines - خروجی extractLaminorSong
 * @returns {Object} فرمت edCur
 */
function convertExtractedLinesToEdCur(lines) {
  const result = {
    lyrics: '',
    chords: [],
    warnings: []
  };

  const lyricLines = [];
  let lineIndex = 0;

  for (const line of lines) {
    lyricLines.push(line.text);

    for (const chord of line.chords) {
      if (chord.charIndex == null) {
        result.warnings.push({
          sourceLineIndex: lineIndex,
          code: 'UNRESOLVED_CHORD',
          message: `آکورد ${chord.symbol} موقعیت قابل‌اعتماد ندارد`
        });
        continue;
      }

      // تعیین anchorType بر اساس موقعیت آکورد
      let anchorType = chord.anchorType || 'explicit';

      // اگر anchorType مشخص نیست، بر اساس charIndex تشخیص بده
      if (anchorType === 'unresolved' || anchorType === 'mid') {
        if (chord.charIndex === 0) {
          anchorType = 'start';
        } else if (chord.charIndex >= line.text.length) {
          anchorType = 'end';
        } else {
          anchorType = 'mid';
        }
      }

      result.chords.push({
        name: chord.symbol,
        lineIndex: lineIndex,
        charIndex: chord.charIndex,
        anchorType: anchorType,
        logicalSlot: chord.logicalSlot != null ? chord.logicalSlot : 0,
        confidence: chord.confidence || 'high'
      });
    }

    lineIndex++;
  }

  result.lyrics = lyricLines.join('\n');

  return result;
}

// ============================================
// Key / Rhythm (signature) detection
// ============================================

/**
 * نرمال‌سازی گام اصلی (original key) از متن «گام اصلی: X»
 * ورودی: 'Dm' ، 'D minor' ، 'Dm (ری مینور)' ، 'DM' ، 'D#m' ، 'Eb' ...
 * خروجی استاندارد: 'Dm' ، 'C#m' ، 'Eb' ...
 * @param {string} rawText
 * @returns {string}
 */
function normalizeLaminorKey(rawText) {
  const text = String(rawText || '').trim();

  if (!text) return '';

  // حذف برچسب «گام اصلی:» (فارسی/انگلیسی)
  const withoutLabel = text
    .replace(/^گام\s*اصلی\s*[:：]?\s*/iu, '')
    .replace(/^original\s*key\s*[:：]?\s*/iu, '')
    .replace(/^key\s*[:：]?\s*/iu, '')
    .trim();

  // حذف توضیحات داخل پرانتز، مثل «(ری مینور)»
  const cleaned = withoutLabel.replace(/\s*\([^)]*\)\s*/g, ' ').trim();

  // استخراج ریشه‌ی نت به همراه علامت نیم‌پرده (♯/♭/#/b) و نوع (m ، min ، M ، maj)
  // بین ریشه و نوع ممکن است فاصله باشد: «D minor» ، «C# major»
  // نکته: alternatives باید به ترتیب باشند تا major/minor قبل از m/M چک شوند
  const m = cleaned.match(/^([A-Ha-h])([#b♯♭]?)\s*(major|minor|maj|min|m|M)?/);
  if (!m) return '';

  let root = m[1].toUpperCase();
  let accidental = (m[2] || '').replace(/[♯]/g, '#').replace(/[♭]/g, 'b');
  const type = (m[3] || '').toLowerCase();

  // نگاشت نت‌های حامل به شاهدهای رایج (مثل H -> B در سبک آلمانی، و Bb پایین)
  if (root === 'H') root = 'B';

  // نرمال‌سازی نوع مینور/ماژور به 'm' یا ''
  let suffix = '';
  if (/^(min|m)$/.test(type) || /^minor$/.test(type)) {
    suffix = 'm';
  }

  return root + accidental + suffix;
}

/**
 * استخراج ریتم/امضای زمان (signature) از صفحهٔ لامینور
 * اولویت:
 *   1) لینک <a href="...rhythms/4-4">4/4</a>
 *   2) عنصر شامل «ریتم: X»
 *   3) عنصر شامل «میزان: X»
 * @param {Document} doc
 * @returns {string}
 */
function extractLaminorRhythm(doc) {
  if (!doc) return '';

  // 1) لینک rhythms
  const rhythmLink = doc.querySelector('a[href*="rhythms/"]');
  if (rhythmLink) {
    const linkText = (rhythmLink.textContent || '').trim();
    if (linkText) return linkText;
  }

  // 2) جستجوی «ریتم:» در همه عناصر
  const rhythmEl = findElementContainingText(doc, 'ریتم');
  if (rhythmEl) {
    const m = (rhythmEl.textContent || '').match(/(\d{1,2}\s*\/\s*\d{1,2})/);
    if (m) return m[1];
  }

  // 3) جستجوی «میزان:» در همه عناصر
  const measureEl = findElementContainingText(doc, 'میزان');
  if (measureEl) {
    const m = (measureEl.textContent || '').match(/(\d{1,2}\s*\/\s*\d{1,2})/);
    if (m) return m[1];
  }

  return '';
}

/**
 * پیدا کردن اولین عنصر کوچکی که شامل متن مورد نظر است
 * (برای «ریتم:» و «میزان:» در هدر صفحهٔ لامینور)
 * @param {Document} doc
 * @param {string} text
 * @returns {Element|null}
 */
function findElementContainingText(doc, text) {
  if (!doc || !doc.querySelectorAll) return null;

  const els = doc.querySelectorAll('span, div, p, li, h6, a, b, strong, label');

  for (const el of els) {
    // فقط عنصرهای کوتاه و مستقیم بررسی می‌شوند تا هدر کل صفحه انتخاب نشود
    const content = (el.textContent || '').trim();
    if (content.length > 0 && content.length < 60 && content.includes(text) && content.includes(':')) {
      return el;
    }
  }

  return null;
}

/**
 * استخراج گام اصلی (original key) از صفحهٔ لامینور
 * اولویت:
 *   1) عنصر <span id="main-scale">گام اصلی: Dm</span>
 *   2) هر عنصر شامل متن «گام اصلی: X»
 * @param {Document} doc
 * @returns {string}
 */
function extractLaminorKey(doc) {
  if (!doc) return '';

  // 1) عنصر #main-scale
  const mainScale = doc.querySelector('#main-scale');
  if (mainScale) {
    const key = normalizeLaminorKey(mainScale.textContent);
    if (key) return key;
  }

  // 2) جستجوی متن «گام اصلی:»
  const labelEl = findElementContainingText(doc, 'گام اصلی');
  if (labelEl) {
    const key = normalizeLaminorKey(labelEl.textContent);
    if (key) return key;
  }

  return '';
}

// ============================================
// Load laminor page into hidden iframe and extract
// ============================================

/**
 * بارگذاری HTML لامینور در iframe مخفی و استخراج آکوردها
 * @param {string} html - HTML خام صفحه لامینور
 * @returns {Promise<Object>} نتیجه استخراج
 */
async function extractLaminorFromHtml(html) {
  // ایجاد iframe مخفی
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:800px;height:600px;border:none;visibility:hidden;';
  document.body.appendChild(iframe);

  try {
    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
    iframeDoc.open();
    iframeDoc.write(html);
    iframeDoc.close();

    // صبر برای رندر کامل
    await waitForStableLayout.call(iframe.contentWindow);

    // استخراج از iframe
    const lines = await extractLaminorSong.call(iframe.contentWindow, iframeDoc);

    // استخراج گام اصلی و ریتم/امضای زمان
    const key = extractLaminorKey(iframeDoc);
    const rhythm = extractLaminorRhythm(iframeDoc);

    // اعتبارسنجی
    const validation = lines.map(validateExtractedLine);

    return {
      lines,
      validation,
      hasErrors: validation.some(v => !v.valid),
      key,
      rhythm
    };
  } finally {
    // پاک‌سازی iframe
    setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }, 0);
  }
}

// ============================================
// Exports
// ============================================

// در محیط مرورگر به window اضافه می‌شود
if (typeof window !== 'undefined') {
  window.extractLaminorSong = extractLaminorSong;
  window.extractLaminorFromHtml = extractLaminorFromHtml;
  window.convertExtractedLinesToEdCur = convertExtractedLinesToEdCur;
  window.validateExtractedLine = validateExtractedLine;
  window.waitForStableLayout = waitForStableLayout;
  window.normalizeLaminorKey = normalizeLaminorKey;
  window.extractLaminorKey = extractLaminorKey;
  window.extractLaminorRhythm = extractLaminorRhythm;
  window.findElementContainingText = findElementContainingText;
}
