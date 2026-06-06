/**
 * NEET Chemistry curriculum — Class XI / XII chapter architecture.
 * Maps bank `topic` values to a stable syllabus tree; subtopics = question sections.
 */
(function (global) {
  const CHAPTER_ALIASES = {};

  const SECTION_TYPES = [
    { key: 'level1', label: 'Level I', icon: '📝' },
    { key: 'level2', label: 'Level II', icon: '🔬' },
    { key: 'pyq', label: 'Previous Years NEET', icon: '🎯' }
  ];

  const CURRICULUM = [
    {
      id: 'xi',
      label: 'Class XI',
      subtitle: 'Physical & Inorganic Chemistry — Part 1',
      units: [
        {
          id: 'xi-physical',
          label: 'Physical Chemistry',
          chapters: [
            '1. Some Basic Concepts of Chemistry',
            '2. Structure of Atom',
            '3. States of Matter',
            '4. Thermodynamics',
            '5. Chemical Equilibrium',
            '6. Ionic Equilibrium',
            '7. Redox Reactions'
          ]
        },
        {
          id: 'xi-inorganic',
          label: 'Inorganic Chemistry',
          chapters: [
            '13. Classification of Elements and Periodicity in Properties',
            '14. Chemical Bonding and Molecular Structure',
            '15. Hydrogen',
            '16. The s-Block Elements',
            '17. The p-Block Elements'
          ]
        },
        {
          id: 'xi-organic',
          label: 'Organic Chemistry',
          chapters: [
            '22. Organic Chemistry – Some Basic Principles and Techniques',
            '23. Aliphatic Hydrocarbons',
            '24. Aromatic Hydrocarbons',
            '21. Environmental Chemistry'
          ]
        }
      ]
    },
    {
      id: 'xii',
      label: 'Class XII',
      subtitle: 'Physical, Inorganic & Organic Chemistry — Part 2',
      units: [
        {
          id: 'xii-physical',
          label: 'Physical Chemistry',
          chapters: [
            '8. Solid State',
            '9. Solutions',
            '10. Electrochemistry',
            '11. Chemical Kinetics',
            '12. Surface Chemistry'
          ]
        },
        {
          id: 'xii-inorganic',
          label: 'Inorganic Chemistry',
          chapters: [
            '18. General Principles and Processes of Isolation of Elements',
            '19. The d- and f-Block Elements',
            '20. Coordination Compounds'
          ]
        },
        {
          id: 'xii-organic',
          label: 'Organic Chemistry',
          chapters: [
            '25. Organic Compounds Containing Halogens',
            '26. Alcohols, Phenols and Ethers',
            '27. Aldehydes and Ketones',
            '28. Carboxylic Acids and its Derivatives',
            '29. Organic Compounds Containing Nitrogen',
            '30. Polymers',
            '31. Biomolecules',
            '32. Chemistry in Everyday Life'
          ]
        }
      ]
    }
  ];

  function normalizeChapter(topic) {
    const value = (topic || '').trim();
    return CHAPTER_ALIASES[value] || value;
  }

  function normalizeSection(subtopic) {
    const raw = (subtopic || '').trim().toLowerCase();
    if (raw === 'level i' || raw === 'level 1') return 'level1';
    if (raw === 'level ii' || raw === 'level 2') return 'level2';
    if (raw.includes('previous') || raw === 'pyq') return 'pyq';
    return 'other';
  }

  function sectionLabel(sectionKey) {
    const match = SECTION_TYPES.find(item => item.key === sectionKey);
    return match ? match.label : 'Other';
  }

  function buildQuestionIndex(questions) {
    const byChapter = new Map();

    questions.forEach(question => {
      const chapter = normalizeChapter(question.topic);
      if (!byChapter.has(chapter)) {
        byChapter.set(chapter, { total: 0, sections: new Map(), questions: [] });
      }
      const bucket = byChapter.get(chapter);
      bucket.total += 1;
      bucket.questions.push(question);

      const section = normalizeSection(question.subtopic);
      bucket.sections.set(section, (bucket.sections.get(section) || 0) + 1);
    });

    return byChapter;
  }

  function buildCurriculumTree(questions, getStatus) {
    const index = buildQuestionIndex(questions);

    return CURRICULUM.map(year => ({
      ...year,
      units: year.units.map(unit => ({
        ...unit,
        chapters: unit.chapters.map(chapterName => {
          const bucket = index.get(chapterName) || { total: 0, sections: new Map(), questions: [] };
          let mastered = 0;
          let attempted = 0;
          let wrong = 0;
          let unsolved = 0;

          bucket.questions.forEach(q => {
            const status = getStatus(q.id);
            if (status === 'unsolved') unsolved += 1;
            else attempted += 1;
            if (status === 'mastered') mastered += 1;
            if (status === 'wrong') wrong += 1;
          });

          const sections = SECTION_TYPES.map(type => ({
            ...type,
            count: bucket.sections.get(type.key) || 0,
            questions: bucket.questions.filter(q => normalizeSection(q.subtopic) === type.key)
          })).filter(s => s.count > 0);

          const otherCount = bucket.sections.get('other') || 0;
          if (otherCount) {
            sections.push({
              key: 'other',
              label: 'Mixed',
              icon: '⚗️',
              count: otherCount,
              questions: bucket.questions.filter(q => normalizeSection(q.subtopic) === 'other')
            });
          }

          const coverage = bucket.total ? Math.round((mastered / bucket.total) * 100) : 0;
          const progress = bucket.total ? Math.round((attempted / bucket.total) * 100) : 0;

          return {
            id: chapterName,
            name: chapterName,
            total: bucket.total,
            attempted,
            mastered,
            wrong,
            unsolved,
            coverage,
            progress,
            sections,
            inBank: bucket.total > 0
          };
        })
      }))
    }));
  }

  function findChapter(tree, chapterName) {
    const normalized = normalizeChapter(chapterName);
    for (const year of tree) {
      for (const unit of year.units) {
        const chapter = unit.chapters.find(item => item.name === normalized);
        if (chapter) return { year, unit, chapter };
      }
    }
    return null;
  }

  global.NeetCurriculum = {
    CURRICULUM,
    SECTION_TYPES,
    normalizeChapter,
    normalizeSection,
    sectionLabel,
    buildQuestionIndex,
    buildCurriculumTree,
    findChapter
  };
})(window);
