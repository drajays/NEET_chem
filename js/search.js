/**
 * NeetSearch — a small, fast, relevance-ranked search engine for MCQs.
 *
 * Supports:
 *   - multi-word AND matching ("krebs cycle" → both words must appear)
 *   - exact phrases in quotes ("electron transport chain")
 *   - field weighting (question text > topic > options > explanation …)
 *   - whole-word and prefix bonuses
 *   - <mark> highlighting of the matched terms
 *
 * Pure functions, no DOM/network.
 */
(function (global) {
  // Field → weight. Higher weight = a hit there matters more for ranking.
  const FIELDS = [
    { key: 'question',    weight: 10 },
    { key: 'topic',       weight: 8 },
    { key: 'subtopic',    weight: 5 },
    { key: 'tags',        weight: 5 },
    { key: 'options',     weight: 4 },
    { key: 'explanation', weight: 3 },
    { key: 'subject',     weight: 2 }
  ];

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Strip $ ... $ LaTeX delimiters so search sees plain text, not LaTeX syntax. */
  function stripLatex(text) {
    return String(text ?? '').replace(/\$\s*([\s\S]+?)\s*\$/g, '$1');
  }

  function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /** Split a raw query into quoted phrases and bare terms (lowercased). */
  function parseQuery(raw) {
    const text = String(raw || '').trim();
    const phrases = [];
    const terms = [];
    const phraseRe = /"([^"]+)"/g;
    let match;
    let rest = text;
    while ((match = phraseRe.exec(text)) !== null) {
      const phrase = match[1].trim().toLowerCase();
      if (phrase) phrases.push(phrase);
    }
    rest = text.replace(phraseRe, ' ');
    rest.split(/\s+/).forEach(word => {
      const w = word.trim().toLowerCase();
      if (w.length >= 1) terms.push(w);
    });
    return { raw: text, terms, phrases, tokens: [...phrases, ...terms], isEmpty: !phrases.length && !terms.length };
  }

  /** Build a per-question searchable field map (lowercased text per field). */
  function fieldText(question, key) {
    if (key === 'tags') return stripLatex((question.tags || []).join(' '));
    if (key === 'options') return stripLatex((question.options || []).join(' '));
    return stripLatex(question[key] || '');
  }

  /**
   * Score a question against a parsed query.
   * Returns a number (0 = no match / fails AND requirement).
   */
  function scoreQuestion(question, parsed) {
    const lowered = FIELDS.map(f => ({ ...f, text: String(fieldText(question, f.key)).toLowerCase() }));
    const combined = lowered.map(f => f.text).join('  ');
    let score = 0;

    // Every token (phrase or term) must appear somewhere — strict AND.
    for (const token of parsed.tokens) {
      if (!combined.includes(token)) return 0;
    }

    const scoreToken = (token, phraseBonus) => {
      let best = 0;
      let fieldsHit = 0;
      for (const f of lowered) {
        if (!f.text.includes(token)) continue;
        fieldsHit += 1;
        let w = f.weight;
        // whole-word match is worth more than a substring hit
        const wordRe = new RegExp(`\\b${escapeRegex(token)}\\b`);
        if (wordRe.test(f.text)) w += f.weight * 0.6;
        // a term at the very start of the question text is a strong signal
        if (f.key === 'question' && f.text.startsWith(token)) w += 6;
        best = Math.max(best, w);
      }
      return best + (fieldsHit - 1) * 1.5 + phraseBonus;
    };

    parsed.phrases.forEach(p => { score += scoreToken(p, 8); });   // phrases ranked highest
    parsed.terms.forEach(t => { score += scoreToken(t, 0); });

    // Tighter questions that match are usually more relevant.
    const len = (question.question || '').length || 1;
    score += Math.max(0, 3 - len / 400);
    return score;
  }

  function searchQuestions(questions, raw, options = {}) {
    const parsed = parseQuery(raw);
    if (parsed.isEmpty) return { parsed, results: [], total: 0 };
    const limit = options.limit || 40;

    const scored = [];
    for (const question of questions) {
      const score = scoreQuestion(question, parsed);
      if (score > 0) scored.push({ question, score });
    }
    scored.sort((a, b) =>
      b.score - a.score ||
      (a.question.question || '').length - (b.question.question || '').length
    );

    return { parsed, total: scored.length, results: scored.slice(0, limit) };
  }

  /** True if a question matches the parsed query (for filter integration). */
  function matches(question, parsed) {
    if (parsed.isEmpty) return true;
    return scoreQuestion(question, parsed) > 0;
  }

  /** Escape text (LaTeX stripped), then wrap matched tokens in <mark>. */
  function highlight(text, parsed) {
    const safe = escapeHtml(stripLatex(text));
    if (!parsed || !parsed.tokens.length) return safe;
    const tokens = [...parsed.tokens]
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)   // longer first so phrases win
      .map(escapeRegex);
    if (!tokens.length) return safe;
    const re = new RegExp(`(${tokens.join('|')})`, 'gi');
    return safe.replace(re, '<mark>$1</mark>');
  }

  /** A short highlighted snippet around the first matching token. */
  function snippet(question, parsed, max = 160) {
    const rawSource = question.explanation && parsed.tokens.some(t => stripLatex(question.explanation || '').toLowerCase().includes(t))
      ? question.explanation
      : question.question || '';
    const source = stripLatex(rawSource);
    const lower = source.toLowerCase();
    let idx = -1;
    for (const t of parsed.tokens) {
      const at = lower.indexOf(t);
      if (at !== -1 && (idx === -1 || at < idx)) idx = at;
    }
    let start = 0;
    if (idx > 60) start = idx - 50;
    let slice = source.slice(start, start + max);
    if (start > 0) slice = '…' + slice;
    if (start + max < source.length) slice = slice + '…';
    return highlight(slice, parsed);
  }

  global.NeetSearch = { parseQuery, searchQuestions, matches, highlight, snippet, scoreQuestion };
})(window);
