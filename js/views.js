/**
 * UI views: Dashboard, Chapters, Revision, Audit.
 */
(function (global) {
  let deps = {};

  function init(dependencies) {
    deps = dependencies;
  }

  function esc(text) {
    return deps.escapeHtml ? deps.escapeHtml(text) : String(text ?? '');
  }

  function fmtDate(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  function ring(percent, size = 56) {
    const r = (size - 8) / 2;
    const c = 2 * Math.PI * r;
    const offset = c - (percent / 100) * c;
    return `
      <svg class="progress-ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle class="ring-bg" cx="${size/2}" cy="${size/2}" r="${r}"></circle>
        <circle class="ring-fg" cx="${size/2}" cy="${size/2}" r="${r}"
          style="stroke-dasharray:${c};stroke-dashoffset:${offset}"></circle>
        <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" class="ring-label">${percent}%</text>
      </svg>
    `;
  }

  function statusBadge(status) {
    const labels = { unsolved: 'New', wrong: 'Weak', mastered: 'Strong', attempted: 'Tried' };
    return `<span class="learn-badge ${status}">${labels[status] || status}</span>`;
  }

  /** Escape, then render lightweight **bold** spans for teacher notes. */
  function fmtNote(text) {
    return esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }

  /** Tiny inline SVG sparkline for an accuracy series (0–100 values). */
  function sparkline(series, w = 132, h = 36) {
    if (!series || series.length < 2) return '<span class="spark-empty muted">Not enough data yet</span>';
    const max = 100, min = 0;
    const step = w / (series.length - 1);
    const pts = series.map((v, i) => {
      const x = i * step;
      const y = h - ((v - min) / (max - min)) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const area = `0,${h} ${pts.join(' ')} ${w},${h}`;
    return `
      <svg class="sparkline" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
        <polygon class="spark-area" points="${area}"></polygon>
        <polyline class="spark-line" points="${pts.join(' ')}"></polyline>
      </svg>`;
  }

  /** The coach (teacher) card — verdict, note, readiness meter, streak, trend. */
  function coachCardHtml(insights) {
    if (!insights || !global.NeetCoach) return '';
    const note = global.NeetCoach.getTeacherNote(insights);
    const r = insights.readiness;
    const streak = insights.streak;
    const trend = insights.trend;
    const deltaClass = trend.delta > 0 ? 'up' : trend.delta < 0 ? 'down' : 'flat';
    const deltaSign = trend.delta > 0 ? '+' : '';

    return `
      <section class="coach-card tone-${note.tone}">
        <div class="coach-main">
          <div class="coach-head">
            <span class="coach-avatar">🧑‍🏫</span>
            <div>
              <p class="eyebrow-dark">Your study coach</p>
              <h3>${esc(note.greeting)}</h3>
            </div>
          </div>
          <div class="coach-note">
            ${note.lines.map(line => `<p>${fmtNote(line)}</p>`).join('')}
          </div>
        </div>
        <aside class="coach-side">
          <div class="readiness-meter band-${r.band}">
            ${ring(r.score, 96)}
            <strong>${esc(r.label)}</strong>
            <span class="muted">Exam readiness</span>
          </div>
          <div class="coach-stats">
            <div class="coach-stat">
              <span class="coach-stat-icon">🔥</span>
              <div><strong>${streak.current}<small> day${streak.current === 1 ? '' : 's'}</small></strong><span class="muted">Streak${streak.best > streak.current ? ` · best ${streak.best}` : ''}</span></div>
            </div>
            <div class="coach-stat">
              <span class="coach-stat-icon">🎯</span>
              <div>
                <strong>${trend.recent}%</strong>
                <span class="muted">Recent ${trend.delta ? `<em class="trend-${deltaClass}">${deltaSign}${trend.delta}%</em>` : 'accuracy'}</span>
              </div>
            </div>
            <div class="coach-spark">${sparkline(trend.series)}<span class="muted">Accuracy trend</span></div>
          </div>
        </aside>
      </section>`;
  }

  /** Actionable suggestion chips that map to existing data-action handlers. */
  function suggestionsHtml(insights) {
    if (!insights || !global.NeetCoach) return '';
    const items = global.NeetCoach.getSuggestions(insights);
    if (!items.length) return '';
    return `
      <section class="panel-card suggestions-panel">
        <div class="panel-head"><h3>What to do next</h3><span class="muted">Picked for you</span></div>
        <div class="suggestion-grid">
          ${items.map(s => `
            <article class="suggestion-card tone-${s.tone}">
              <span class="suggestion-icon">${s.icon}</span>
              <div class="suggestion-body">
                <h4>${esc(s.title)}</h4>
                <p>${esc(s.detail)}</p>
              </div>
              <button type="button" class="primary-btn small"
                data-action="${s.action}"${s.data?.chapter ? ` data-chapter="${esc(s.data.chapter)}"` : ''}>
                ${esc(s.actionLabel)}
              </button>
            </article>
          `).join('')}
        </div>
      </section>`;
  }

  function renderDashboard() {
    const el = deps.el;
    if (!el.dashboardView) return;

    const studentId = deps.state.activeStudentId;
    if (!studentId) {
      el.dashboardView.innerHTML = '<div class="empty-card"><h3>Select a student</h3><p>Choose your profile from the top bar.</p></div>';
      return;
    }

    const summary = deps.summarizeStudent(studentId);
    const plan = deps.getRevisionPlan(studentId);
    const tree = deps.buildCurriculumTree(studentId);
    const student = deps.state.progress.students[studentId];
    const recent = deps.getAuditLog(student, 5);
    const insights = deps.getCoachInsights ? deps.getCoachInsights(studentId) : null;

    el.dashboardView.innerHTML = `
      ${coachCardHtml(insights)}

      <div class="stat-grid">
        <article class="stat-card accent">
          ${ring(summary.completion)}
          <div>
            <strong>${summary.mastered}</strong>
            <span>Mastered MCQs</span>
          </div>
        </article>
        <article class="stat-card">
          <strong>${summary.unsolved}</strong>
          <span>Not yet tried</span>
        </article>
        <article class="stat-card warn">
          <strong>${summary.wrong}</strong>
          <span>Need revision</span>
        </article>
        <article class="stat-card">
          <strong>${summary.chaptersStarted}/${summary.chaptersTotal}</strong>
          <span>Chapters started</span>
        </article>
        <article class="stat-card">
          <strong>${summary.accuracy}%</strong>
          <span>Accuracy</span>
        </article>
      </div>

      ${suggestionsHtml(insights)}

      <div class="split-panels">
        <section class="panel-card">
          <div class="panel-head"><h3>Revision strategy</h3></div>
          <div class="strategy-list">
            ${plan.strategy.map(item => `
              <article class="strategy-item ${item.tone}">
                <span class="strategy-step">${item.step}</span>
                <div>
                  <h4>${esc(item.title)}</h4>
                  <p>${esc(item.detail)}</p>
                </div>
                <strong>${item.count}</strong>
              </article>
            `).join('')}
          </div>
        </section>

        <section class="panel-card">
          <div class="panel-head"><h3>Recent activity</h3></div>
          <div class="audit-mini">
            ${recent.length ? recent.map(row => `
              <div class="audit-row">
                <span class="learn-badge ${row.result === 'correct' ? 'mastered' : 'wrong'}">${row.result}</span>
                <div>
                  <p>${esc((row.questionText || '').slice(0, 90))}${(row.questionText || '').length > 90 ? '…' : ''}</p>
                  <small>${esc(row.topic)} · ${fmtDate(row.at)}</small>
                </div>
              </div>
            `).join('') : '<p class="muted">No attempts yet. Start a practice session.</p>'}
          </div>
        </section>
      </div>

      <section class="panel-card">
        <div class="panel-head"><h3>Syllabus snapshot</h3><button type="button" class="text-btn" data-action="goto-chapters">View all chapters →</button></div>
        <div class="chapter-snapshot">
          ${tree.flatMap(year => year.units.flatMap(unit => unit.chapters.filter(c => c.inBank).slice(0, 2))).slice(0, 8).map(ch => `
            <button type="button" class="snapshot-chip" data-action="open-chapter" data-chapter="${esc(ch.name)}">
              <span>${esc(ch.name)}</span>
              <small>${ch.mastered}/${ch.total} · ${ch.coverage}%</small>
              <span class="mini-bar"><i style="width:${ch.progress}%"></i></span>
            </button>
          `).join('')}
        </div>
      </section>
    `;
  }

  function renderChapters() {
    const el = deps.el;
    if (!el.chaptersView) return;

    const studentId = deps.state.activeStudentId || deps.state.progressViewStudentId;
    if (!studentId) {
      el.chaptersView.innerHTML = '<div class="empty-card"><h3>Select a student</h3></div>';
      return;
    }

    const tree = deps.buildCurriculumTree(studentId);
    const selected = deps.state.selectedChapter || '';

    el.chaptersView.innerHTML = `
      <div class="view-hero compact">
        <div>
          <p class="eyebrow-dark">Syllabus architecture</p>
          <h2>Class XI & XII · NEET Chemistry</h2>
          <p class="lead">Chapters → sections (Level I, Level II, Previous Years NEET). Green = strong, amber = tried, red = weak, grey = new.</p>
        </div>
      </div>
      <div class="curriculum-tree">
        ${tree.map(year => `
          <section class="year-block">
            <header class="year-head">
              <h3>${esc(year.label)}</h3>
              <p>${esc(year.subtitle)}</p>
            </header>
            ${year.units.map(unit => `
              <div class="unit-block">
                <h4>${esc(unit.label)}</h4>
                <div class="chapter-grid">
                  ${unit.chapters.map(ch => {
                    if (!ch.inBank) {
                      return `<article class="chapter-card disabled"><h5>${esc(ch.name)}</h5><p class="muted">No MCQs in bank yet</p></article>`;
                    }
                    const active = selected === ch.name ? ' active' : '';
                    return `
                      <article class="chapter-card${active}" data-chapter="${esc(ch.name)}">
                        <div class="chapter-card-top">
                          <h5>${esc(ch.name)}</h5>
                          ${ring(ch.coverage, 48)}
                        </div>
                        <div class="chapter-metrics">
                          <span class="learn-badge mastered">${ch.mastered} strong</span>
                          <span class="learn-badge wrong">${ch.wrong} weak</span>
                          <span class="learn-badge unsolved">${ch.unsolved} new</span>
                        </div>
                        <div class="track-bar"><i style="width:${ch.progress}%"></i></div>
                        <div class="section-pills">
                          ${ch.sections.map(s => `<span title="${esc(s.label)}">${s.icon} ${s.count}</span>`).join('')}
                        </div>
                      </article>
                    `;
                  }).join('')}
                </div>
              </div>
            `).join('')}
          </section>
        `).join('')}
      </div>
    `;

    if (selected) renderChapterDetail(selected);
  }

  function renderChapterDetail(chapterName) {
    const el = deps.el.chapterDetail;
    if (!el) return;

    const studentId = deps.state.activeStudentId || deps.state.progressViewStudentId;
    const tree = deps.buildCurriculumTree(studentId);
    const found = deps.findChapter(tree, chapterName);
    if (!found) {
      el.classList.remove('open');
      el.innerHTML = '';
      return;
    }

    const ch = found.chapter;
    el.classList.add('open');
    el.innerHTML = `
      <button type="button" class="icon-btn close-detail" data-action="close-chapter">✕</button>
      <p class="eyebrow-dark">${esc(found.unit.label)}</p>
      <h3>${esc(ch.name)}</h3>
      <p class="muted">${ch.total} MCQs · ${ch.coverage}% mastered · ${ch.unsolved} new</p>
      <div class="detail-sections">
        ${ch.sections.map(section => {
          const items = section.questions.slice(0, 12).map(q => {
            const status = deps.getQuestionStatus(studentId, q.id);
            return `<li class="${status}">${statusBadge(status)} <span>${esc(q.question.slice(0, 100))}${q.question.length > 100 ? '…' : ''}</span></li>`;
          }).join('');
          return `
            <details class="section-block" open>
              <summary>${section.icon} ${esc(section.label)} <em>${section.count}</em></summary>
              <ul class="question-audit-list">${items || '<li class="muted">No questions</li>'}</ul>
              ${section.count > 12 ? `<p class="muted">+ ${section.count - 12} more</p>` : ''}
              <button type="button" class="secondary-btn small" data-action="practice-section"
                data-chapter="${esc(ch.name)}" data-section="${section.key}">Practice ${esc(section.label)}</button>
            </details>
          `;
        }).join('')}
      </div>
      <button type="button" class="primary-btn" data-action="practice-chapter" data-chapter="${esc(ch.name)}">Practice full chapter</button>
    `;
  }

  function renderRevision() {
    const el = deps.el;
    if (!el.revisionView) return;

    const studentId = deps.state.activeStudentId;
    if (!studentId) {
      el.revisionView.innerHTML = '<div class="empty-card"><h3>Select a student</h3></div>';
      return;
    }

    const plan = deps.getRevisionPlan(studentId);
    const insights = deps.getCoachInsights ? deps.getCoachInsights(studentId) : null;

    el.revisionView.innerHTML = `
      <div class="view-hero compact">
        <div>
          <p class="eyebrow-dark">Smart revision</p>
          <h2>Today's study queue</h2>
          <p class="lead">Ordered by priority: fix errors → spaced refresh → PYQs → new MCQs.</p>
        </div>
        <button type="button" class="primary-btn" data-action="start-revision">Practice queue (${plan.dailyQueue.length})</button>
      </div>

      ${suggestionsHtml(insights)}

      <div class="strategy-list">
        ${plan.strategy.map(item => `
          <article class="strategy-item ${item.tone}">
            <span class="strategy-step">${item.step}</span>
            <div><h4>${esc(item.title)}</h4><p>${esc(item.detail)}</p></div>
            <strong>${item.count}</strong>
          </article>
        `).join('')}
      </div>

      <section class="panel-card">
        <div class="panel-head"><h3>Queue preview</h3></div>
        <div class="queue-list">
          ${plan.dailyQueue.slice(0, 25).map((item, idx) => `
            <article class="queue-item">
              <span class="queue-rank">#${idx + 1}</span>
              <div>
                <p>${esc(item.question.question.slice(0, 110))}${item.question.question.length > 110 ? '…' : ''}</p>
                <small>${esc(item.question.topic)} · ${esc(item.reason)}</small>
              </div>
              ${statusBadge(item.status)}
            </article>
          `).join('') || '<p class="muted">All caught up — explore new chapters.</p>'}
        </div>
      </section>
    `;
  }

  function renderAudit() {
    const el = deps.el;
    if (!el.auditView) return;

    const studentId = deps.state.progressViewStudentId || deps.state.activeStudentId;
    if (!studentId) {
      el.auditView.innerHTML = '<div class="empty-card"><h3>Select a student</h3></div>';
      return;
    }

    const student = deps.state.progress.students[studentId];
    const summary = deps.summarizeStudent(studentId);
    const tree = deps.buildCurriculumTree(studentId);
    const audit = deps.getAuditLog(student, 300);
    const filter = deps.state.auditFilter || 'all';

    const filtered = audit.filter(row => {
      if (filter === 'correct') return row.result === 'correct';
      if (filter === 'wrong') return row.result === 'wrong';
      return true;
    });

    el.auditView.innerHTML = `
      <div class="view-hero compact">
        <div>
          <p class="eyebrow-dark">Full audit · ${esc(student?.name || studentId)}</p>
          <h2>Progress & attempt history</h2>
        </div>
        <div class="audit-filters">
          <select id="auditStudentSelect"></select>
          <select id="auditFilterSelect">
            <option value="all" ${filter === 'all' ? 'selected' : ''}>All attempts</option>
            <option value="correct" ${filter === 'correct' ? 'selected' : ''}>Correct only</option>
            <option value="wrong" ${filter === 'wrong' ? 'selected' : ''}>Wrong only</option>
          </select>
          <button type="button" class="secondary-btn" data-action="sync-progress">Sync</button>
        </div>
      </div>

      <div class="stat-grid compact">
        <article class="stat-card"><strong>${summary.attempted}</strong><span>Attempted</span></article>
        <article class="stat-card"><strong>${summary.unsolved}</strong><span>Unseen</span></article>
        <article class="stat-card"><strong>${summary.wrong}</strong><span>Weak</span></article>
        <article class="stat-card"><strong>${audit.length}</strong><span>Logged events</span></article>
      </div>

      <div class="split-panels">
        <section class="panel-card">
          <div class="panel-head"><h3>Chapter coverage</h3></div>
          <div class="coverage-table">
            ${tree.flatMap(y => y.units.flatMap(u => u.chapters.filter(c => c.inBank))).map(ch => `
              <button type="button" class="coverage-row" data-action="open-chapter" data-chapter="${esc(ch.name)}">
                <span>${esc(ch.name)}</span>
                <span class="coverage-stats">${ch.mastered}/${ch.total}</span>
                <span class="track-bar"><i style="width:${ch.coverage}%"></i></span>
              </button>
            `).join('')}
          </div>
        </section>

        <section class="panel-card">
          <div class="panel-head"><h3>Attempt log</h3><span class="muted">${filtered.length} entries</span></div>
          <div class="audit-log">
            ${filtered.map(row => `
              <article class="audit-entry ${row.result}">
                <div class="audit-entry-head">
                  ${statusBadge(row.result === 'correct' ? 'mastered' : 'wrong')}
                  <time>${fmtDate(row.at)}</time>
                </div>
                <p>${esc(row.questionText)}</p>
                <small>${esc(row.topic)}${row.subtopic ? ` · ${esc(row.subtopic)}` : ''}${row.selected ? ` · chose ${esc(row.selected)}` : ''}</small>
              </article>
            `).join('') || '<p class="muted">No attempts logged yet.</p>'}
          </div>
        </section>
      </div>
    `;

    const auditStudent = document.getElementById('auditStudentSelect');
    if (auditStudent) {
      deps.populateStudentSelect(auditStudent, studentId);
      auditStudent.value = studentId;
    }
  }

  function refreshActiveView() {
    const tab = deps.state.activeTab;
    if (tab === 'dashboard') renderDashboard();
    else if (tab === 'chapters') renderChapters();
    else if (tab === 'revision') renderRevision();
    else if (tab === 'audit') renderAudit();
  }

  global.NeetViews = {
    init,
    renderDashboard,
    renderChapters,
    renderChapterDetail,
    renderRevision,
    renderAudit,
    refreshActiveView
  };
})(window);
