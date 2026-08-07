/**
 * sharedEngine.js — موتور مشترک: parse / align / key-transform / highlight
 *
 * از `edTransposeChord` موجود در app.js برای transpose استفاده می‌کند.
 * هیچ View‌ای نباید این منطق را تکرار کند.
 */

const SharedEngine = (() => {

  /* ═══════════════════════════════════════════════
     1) Tokenizer: line text → tokens with charStart/charEnd
     ═══════════════════════════════════════════════ */

  function tokenizeLine(lineText, lineId, lineIndex) {
    const tokens = [];
    let current = '';
    let currentType = null;
    let charStart = 0;

    function pushToken(endIndex) {
      if (!current) return;
      tokens.push({
        id:        lineId + '_tok' + tokens.length,
        index:     tokens.length,
        type:      currentType || 'word',
        text:      current,
        charStart: charStart,
        charEnd:   endIndex
      });
      current = '';
      currentType = null;
    }

    for (let i = 0; i < lineText.length; i++) {
      const ch = lineText[i];
      const isSpace = /\s/.test(ch);

      if (isSpace) {
        pushToken(i);
        tokens.push({
          id:        lineId + '_tok' + tokens.length,
          index:     tokens.length,
          type:      'space',
          text:      ch,
          charStart: i,
          charEnd:   i + 1
        });
        current = '';
        currentType = null;
        charStart = i + 1;
        continue;
      }

      if (!current) {
        current = ch;
        currentType = 'word';
        charStart = i;
      } else {
        current += ch;
      }
    }

    pushToken(lineText.length);
    return tokens;
  }

  /* ═══════════════════════════════════════════════
     2) Parse: rawLyrics → lines with tokens
     ═══════════════════════════════════════════════ */

  function parseSongDocument(doc) {
    if (!doc || !Array.isArray(doc.lines)) return doc;

    doc.lines.forEach(line => {
      line.tokens = tokenizeLine(line.text || '', line.id, line.index);
    });

    // Detect section labels: [Verse 1], {Chorus}, (Bridge)
    doc.sections = [];
    doc.lines.forEach((line, i) => {
      const m = line.text.match(
        /^\s*[\[{(]\s*(مقدمه|Intro|ورس|Verse|کورس|Chorus|بریج|Bridge|آوترو|Outro|Pre-Chorus|پرکورس|Coda|Interlude)\s*\d*\s*[\]})]\s*$/i
      );
      if (m) {
        doc.sections.push({
          id:        'sec-' + i,
          name:      m[1],
          startLine: i,
          endLine:   i + 1
        });
      }
    });

    return doc;
  }

  /* ═══════════════════════════════════════════════
     3) Chord Alignment
     ═══════════════════════════════════════════════ */

  function findTokenIndexForChar(line, charIndex, anchorType) {
    if (!line.tokens || !line.tokens.length) return 0;

    const textLength = (line.text || '').length;
    const tokens = line.tokens.filter(tok => tok.type !== 'space');

    if (!tokens.length) return 0;

    // آکورد ابتدای خط — به اولین توکن غیرفضا متصل شود
    if (anchorType === 'start' || charIndex <= 0) {
      return tokens[0].index;
    }

    // آکورد انتهای خط — به آخرین توکن غیرفضا متصل شود
    if (anchorType === 'end' || (charIndex != null && charIndex >= textLength)) {
      return tokens[tokens.length - 1].index;
    }

    // آکورد وسط خط — نزدیک‌ترین توکن به charIndex
    let bestIdx = 0;
    let bestDist = Infinity;
    line.tokens.forEach((tok, idx) => {
      const mid = (tok.charStart + tok.charEnd) / 2;
      const dist = Math.abs(mid - charIndex);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = idx;
      }
    });
    return bestIdx;
  }

  function alignChords(doc) {
    if (!doc || !Array.isArray(doc.lines)) return doc;

    doc.lines.forEach(line => { line.chords = []; });

    const chords = Array.isArray(doc.rawChords) ? doc.rawChords : [];

    chords.forEach((ch, idx) => {
      const li = ch.lineIndex;
      const ci = ch.charIndex || 0;
      if (!Number.isInteger(li) || li < 0 || li >= doc.lines.length) return;

      const line = doc.lines[li];
      const anchorType = ch.anchorType || 'mid';
      const tokenIndex = findTokenIndexForChar(line, ci, anchorType);

      line.chords.push({
        id:         'ln' + li + '_ch' + idx,
        name:       ch.name || '',
        baseName:   ch.name || '',
        lineIndex:  li,
        tokenIndex: tokenIndex,
        offset:     0,
        anchorType: anchorType,
        logicalSlot: ch.logicalSlot != null ? ch.logicalSlot : 0
      });
    });

    return doc;
  }

  /* ═══════════════════════════════════════════════
     4) Key Transform
     ═══════════════════════════════════════════════ */

  function transposeChordName(name, semi) {
    if (!semi || !name) return name;
    if (typeof window !== 'undefined' && typeof window.edTransposeChord === 'function') {
      return window.edTransposeChord(name, semi);
    }
    // fallback
    const NOTE_MAP = { C:0,'C#':1,D:2,'D#':3,E:4,F:5,'F#':6,G:7,'G#':8,A:9,'A#':10,B:11 };
    const SHARP = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const FLAT = {1:'Db',3:'Eb',6:'Gb',8:'Ab',10:'Bb'};
    return name.split('/').map(part => {
      return part.replace(/^([A-G][b#]?)/, (match, root) => {
        if (!(root in NOTE_MAP)) return root;
        const idx = (NOTE_MAP[root] + ((semi % 12) + 12) % 12) % 12;
        // اگر ریشه بمل بود یا شاخص در لیست بمل‌ها بود و ریشه طبیعی بود، از بمل استفاده کن
        if (root.includes('b')) return FLAT[idx] || SHARP[idx];
        if (root.includes('#')) return SHARP[idx];
        // برای نت‌های طبیعی، اگر اندیس متناظر با بمل باشد، بمل برگردان
        return FLAT[idx] || SHARP[idx];
      });
    }).join('/');
  }

  function applyKeyTransform(doc, keyState) {
    if (!doc || !Array.isArray(doc.lines)) return doc;
    const transpose = (keyState && typeof keyState.transpose === 'number')
      ? keyState.transpose
      : (doc.transpose || 0);

    if (!transpose) return doc;

    doc.lines.forEach(line => {
      (line.chords || []).forEach(ch => {
        ch.name = transposeChordName(ch.baseName || ch.name, transpose);
      });
    });

    return doc;
  }

  /* ═══════════════════════════════════════════════
     5) Highlight Engine
     ═══════════════════════════════════════════════ */

  function computeHighlight(playbackState, doc) {
    const time = (playbackState && playbackState.time) || 0;
    const cues = Array.isArray(doc && doc.cues) ? doc.cues : [];

    let activeLineIndex = -1;
    const doneLines = new Set();

    for (let i = 0; i < cues.length; i++) {
      const c = cues[i];
      if (!c || !Number.isFinite(c.time)) continue;
      if (c.time <= time && Number.isInteger(c.lineIndex)) {
        activeLineIndex = c.lineIndex;
      } else if (c.time > time) {
        break;
      }
    }

    for (const c of cues) {
      if (
        c &&
        Number.isFinite(c.time) &&
        c.time < time &&
        Number.isInteger(c.lineIndex) &&
        c.lineIndex < activeLineIndex
      ) {
        doneLines.add(c.lineIndex);
      }
    }

    const lineCount = (doc && doc.lines) ? doc.lines.length : 0;
    if (activeLineIndex < 0 || activeLineIndex >= lineCount) {
      return { activeLineId: null, activeTokenId: null, activeChordId: null, doneLines: doneLines };
    }

    const line = doc.lines[activeLineIndex];
    return { activeLineId: line.id || null, activeTokenId: null, activeChordId: null, doneLines: doneLines };
  }

  /* ═══════════════════════════════════════════════
     Pipeline
     ═══════════════════════════════════════════════ */

  function processSong(doc) {
    if (!doc) return doc;
    doc = parseSongDocument(doc);
    doc = alignChords(doc);
    if (doc.transpose) {
      doc = applyKeyTransform(doc, { transpose: doc.transpose });
    }
    return doc;
  }

  return {
    parseSongDocument,
    alignChords,
    applyKeyTransform,
    computeHighlight,
    processSong,
    transposeChordName,
    findTokenIndexForChar
  };

})();

if (typeof window !== 'undefined') {
  window.SharedEngine = SharedEngine;
}
