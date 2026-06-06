#!/usr/bin/env python3
"""
Parse chemistry MCQs from Wiley's Objective Chemistry for NEET (K. Singh)
markdown file and generate bank.json for NEET practice app.

The 32 chapters correspond to 32 '#### Practice Exercises' sections in the file.
"""

import re
import json
import time
import hashlib
from html.parser import HTMLParser
from collections import defaultdict

INPUT_MD = "/Users/dr.ajayshukla/NEET_chemistry/wileyx27s-objective-chemistry-for-neet-k-singh_compress.pdf_by_PaddleOCR-VL-1.6.md"
OUTPUT_JSON = "/Users/dr.ajayshukla/NEET_chemistry/bank.json"
EXISTING_BANK = "/Users/dr.ajayshukla/NEET_chemistry/bank.json"

# The 32 NEET chemistry chapters in order
CHAPTER_LIST = [
    "1. Some Basic Concepts of Chemistry",
    "2. Structure of Atom",
    "3. States of Matter",
    "4. Thermodynamics",
    "5. Chemical Equilibrium",
    "6. Ionic Equilibrium",
    "7. Redox Reactions",
    "8. Solid State",
    "9. Solutions",
    "10. Electrochemistry",
    "11. Chemical Kinetics",
    "12. Surface Chemistry",
    "13. Classification of Elements and Periodicity in Properties",
    "14. Chemical Bonding and Molecular Structure",
    "15. Hydrogen",
    "16. The s-Block Elements",
    "17. The p-Block Elements",
    "18. General Principles and Processes of Isolation of Elements",
    "19. The d- and f-Block Elements",
    "20. Coordination Compounds",
    "21. Environmental Chemistry",
    "22. Organic Chemistry - Some Basic Principles and Techniques",
    "23. Aliphatic Hydrocarbons",
    "24. Aromatic Hydrocarbons",
    "25. Organic Compounds Containing Halogens",
    "26. Alcohols, Phenols and Ethers",
    "27. Aldehydes and Ketones",
    "28. Carboxylic Acids and its Derivatives",
    "29. Organic Compounds Containing Nitrogen",
    "30. Polymers",
    "31. Biomolecules",
    "32. Chemistry in Everyday Life",
]


def make_slug(text):
    """Convert chapter name to a simple slug."""
    text = text.lower()
    text = re.sub(r'[^a-z0-9\s]', '', text)
    text = re.sub(r'\s+', '_', text.strip())
    return text[:40]


def make_hash(text):
    """Return 8-char hex hash of text."""
    return hashlib.md5(text.encode('utf-8')).hexdigest()[:8]


def clean_text(text):
    """Strip markdown/heading prefixes and normalize whitespace."""
    text = re.sub(r'^#{1,6}\s+', '', text)
    text = text.strip()
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


# ── Section markers ─────────────────────────────────────────────────────────

LEVEL1_PAT   = re.compile(r'^#{1,6}\s+Level I\s*$', re.IGNORECASE)
LEVEL2_PAT   = re.compile(r'^#{1,6}\s+Level II\s*$', re.IGNORECASE)
PREVYR_PAT   = re.compile(r'^#{1,6}\s+Previous Years', re.IGNORECASE)
ANSKEY_PAT   = re.compile(r'^#{1,6}\s+Answer Key\s*$', re.IGNORECASE)
HINTS_PAT    = re.compile(r'^#{1,6}\s+Hints and Explanations\s*$', re.IGNORECASE)
PRACTEX_PAT  = re.compile(r'^#{1,6}\s+Practice Exercises\s*$', re.IGNORECASE)


# ── HTML answer table parser ─────────────────────────────────────────────────

class AnswerTableParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_td = False
        self.current_text = []
        self.entries = []       # (current_section_at_parse_time, cell_text)
        self.current_section = None

    def handle_starttag(self, tag, attrs):
        if tag == 'td':
            # Check for colspan attr (section separator rows)
            attr_dict = dict(attrs)
            self._current_colspan = int(attr_dict.get('colspan', 1))
            self.in_td = True
            self.current_text = []

    def handle_endtag(self, tag):
        if tag == 'td' and self.in_td:
            text = ''.join(self.current_text).strip()
            self.in_td = False
            self.current_text = []
            if text:
                # Detect section headers in colspan cells
                low = text.lower()
                if 'previous years' in low or "previous years'" in low:
                    self.current_section = 'Previous Years NEET'
                elif 'level ii' in low:
                    self.current_section = 'Level II'
                elif 'level i' in low:
                    self.current_section = 'Level I'
                else:
                    self.entries.append((self.current_section, text))

    def handle_data(self, data):
        if self.in_td:
            self.current_text.append(data)


OPT_MAP = {'1': 'A', '2': 'B', '3': 'C', '4': 'D'}

# Matches "1. (3)", "1.(3)", "7 (2)", "1．(3)" etc.
ANS_ENTRY_RE = re.compile(
    r'(\d+)\s*[.．]?\s*[（(]([1-4])[）)]'
)


def parse_answer_html_table(html_text, default_section='Level I'):
    """
    Parse one HTML table from the answer key section.
    Returns dict: { section_name: {qnum: letter} }
    default_section: used when the table has no internal section-separator colspan rows
    """
    parser = AnswerTableParser()
    parser.feed(html_text)

    result = defaultdict(dict)
    for section, cell in parser.entries:
        sec = section if section else default_section
        m = ANS_ENTRY_RE.match(cell.strip())
        if m:
            qnum = int(m.group(1))
            result[sec][qnum] = OPT_MAP.get(m.group(2), '')

    return dict(result)


def parse_answer_plain_text(text):
    """
    Parse plain-text answer lines like '1. (3) 2. (4) 3. (1) ...'
    Returns dict {qnum: letter}
    """
    result = {}
    for m in ANS_ENTRY_RE.finditer(text):
        qnum = int(m.group(1))
        result[qnum] = OPT_MAP.get(m.group(2), '')
    return result


def extract_answer_key_from_block(block_lines):
    """
    Find the answer key section in a chapter block and extract answers.
    Returns dict: { 'Level I': {qnum: letter}, 'Level II': {...}, 'Previous Years NEET': {...} }

    Handles two formats:
    1. Separate tables per section (separated by #### Level I / #### Level II headers)
    2. One combined table with colspan section-separator rows (may be a standalone table
       with "Answer Key" embedded in it, without a preceding markdown heading)
    3. Plain text answer lines (Japanese-style fullwidth parens too)
    """
    # Locate answer key start and hints start
    ak_start = None
    hints_start = None
    for i, line in enumerate(block_lines):
        s = line.strip()
        if ak_start is None and ANSKEY_PAT.match(s):
            ak_start = i
        # Also detect standalone answer key tables (Answer Key inside colspan cell)
        if ak_start is None and '<table' in line.lower() and 'Answer Key' in line:
            ak_start = i
        if hints_start is None and HINTS_PAT.match(s):
            if ak_start is not None:
                hints_start = i
                break

    if ak_start is None:
        return {}

    end = hints_start if hints_start else len(block_lines)
    ak_lines = block_lines[ak_start:end]

    result = defaultdict(dict)
    current_section = 'Level I'

    i = 0
    while i < len(ak_lines):
        line = ak_lines[i]
        s = line.strip()

        # Detect section labels
        if LEVEL1_PAT.match(s):
            current_section = 'Level I'
        elif LEVEL2_PAT.match(s):
            current_section = 'Level II'
        elif PREVYR_PAT.match(s):
            current_section = 'Previous Years NEET'

        # HTML table
        elif '<table' in line.lower():
            table_text = line
            while '</table>' not in table_text.lower() and i + 1 < len(ak_lines):
                i += 1
                table_text += '\n' + ak_lines[i]
            # Pass current_section as fallback so tables without internal headers
            # are assigned to the correct section (Level I / Level II / Prev Years)
            parsed = parse_answer_html_table(table_text, default_section=current_section)
            for sec, answers in parsed.items():
                result[sec].update(answers)
        else:
            # Plain text answer lines
            plain = parse_answer_plain_text(s)
            for qnum, ans in plain.items():
                if qnum > 0 and ans:
                    result[current_section][qnum] = ans

        i += 1

    return dict(result)


# ── Question parser ──────────────────────────────────────────────────────────

# Matches the start of a question: "23. text..." or "23.text..."
Q_START_RE = re.compile(r'^(\d+)\.\s+(.+)')

def parse_questions_from_text(section_lines):
    """
    Parse MCQ questions from lines of a section.
    Each question: number, question text, 4 options.
    Returns list of dicts: {num, question, options=[4]}
    """
    # Join into one string, then split by question-start pattern
    # We scan line by line building question blocks
    questions = []

    current_num = None
    current_lines = []
    last_accepted_num = 0

    def flush():
        nonlocal current_num, current_lines
        if current_num is not None and current_lines:
            q = extract_question_and_options(current_num, current_lines)
            if q:
                questions.append(q)
        current_num = None
        current_lines = []

    for line in section_lines:
        stripped = line.strip()

        # Skip empty lines but keep them in current block for multi-line handling
        m = Q_START_RE.match(stripped)
        if m:
            num = int(m.group(1))
            # Accept if sequential (allow gaps up to 3 for numbering jumps)
            if current_num is None:
                # First question: accept any reasonable starting number (1-5)
                if num <= 5:
                    flush()
                    current_num = num
                    current_lines = [stripped]
                    last_accepted_num = num
                else:
                    if current_num is not None:
                        current_lines.append(stripped)
            elif num == last_accepted_num + 1 or (num > last_accepted_num and num <= last_accepted_num + 3):
                flush()
                current_num = num
                current_lines = [stripped]
                last_accepted_num = num
            else:
                # Not sequential – might be a false match (like "23. (4) The reaction is...")
                if current_num is not None:
                    current_lines.append(stripped)
        else:
            if current_num is not None:
                current_lines.append(stripped)

    flush()
    return questions


def extract_question_and_options(num, raw_lines):
    """
    Given the raw lines of one question block, extract:
    - question text (before option (1))
    - 4 option texts

    Options can be:
    - "(1) text (2) text (3) text (4) text" on one line
    - "(1) text" on separate lines
    - "(1) text   (2) text" across two per line
    """
    raw = '\n'.join(raw_lines)

    # Remove the leading "N. " prefix from the question
    raw = re.sub(r'^\d+\.\s+', '', raw, count=1)

    # Find positions of all (1) (2) (3) (4) markers
    opt_re = re.compile(r'\(([1-4])\)')
    markers = [(m.start(), m.group(1)) for m in opt_re.finditer(raw)]

    if len(markers) < 4:
        return None

    # Find first (1) marker
    first_one_pos = None
    for pos, opt in markers:
        if opt == '1':
            first_one_pos = pos
            break

    if first_one_pos is None:
        return None

    # Question text is before the first (1)
    q_text = clean_text(raw[:first_one_pos])
    if not q_text:
        return None

    # Find first occurrence of each option number (1-4)
    opt_positions = {}
    for pos, opt in markers:
        if opt not in opt_positions:
            opt_positions[opt] = pos
        if len(opt_positions) == 4:
            break

    if len(opt_positions) < 4:
        return None

    # Sort by position
    sorted_opts = sorted(opt_positions.items(), key=lambda x: x[1])

    options = []
    for k, (opt_num, start_pos) in enumerate(sorted_opts):
        # Text starts after "(N)"
        text_start = start_pos + 3  # len("(N)") = 3
        if k + 1 < len(sorted_opts):
            text_end = sorted_opts[k + 1][1]
        else:
            text_end = len(raw)
        opt_text_raw = raw[text_start:text_end]
        # Strip any markdown section headings that may have bled in (e.g. "### Subsection")
        opt_text_raw = re.sub(r'#{1,6}\s+\S.*', '', opt_text_raw)
        opt_text = clean_text(opt_text_raw)
        options.append(opt_text)

    if len(options) != 4:
        return None

    # All 4 options must be non-empty
    if not all(opt.strip() for opt in options):
        return None

    return {
        'num': num,
        'question': q_text,
        'options': options,
    }


# ── Chapter block extraction ─────────────────────────────────────────────────

def split_into_chapter_blocks(lines):
    """
    Use 'Practice Exercises' markers as chapter delimiters.
    The N-th Practice Exercises marker belongs to chapter N.
    Each chapter block = from its Practice Exercises line to the next one (or EOF).

    Returns list of (chapter_idx, [lines])  (0-indexed chapter idx)
    """
    pe_positions = []
    for i, line in enumerate(lines):
        if i < 854:
            continue
        if PRACTEX_PAT.match(line.strip()):
            pe_positions.append(i)

    print(f"Found {len(pe_positions)} Practice Exercise sections (expected 32)")

    blocks = []
    for k, start in enumerate(pe_positions):
        if k + 1 < len(pe_positions):
            end = pe_positions[k + 1]
        else:
            end = len(lines)
        blocks.append((k, lines[start:end]))

    return blocks


def find_section_ranges(block_lines):
    """
    Within a chapter block (starting from Practice Exercises line),
    find line ranges for Level I, Level II, Previous Years sections.

    Returns dict: {'Level I': (start, end), 'Level II': ..., 'Previous Years NEET': ...}
    All relative to block_lines[0].
    """
    # Find positions of section markers
    l1_pos = []
    l2_pos = []
    py_pos = []
    ak_pos = None
    hints_pos = None

    for i, line in enumerate(block_lines):
        s = line.strip()
        if LEVEL1_PAT.match(s):
            l1_pos.append(i)
        elif LEVEL2_PAT.match(s):
            l2_pos.append(i)
        elif PREVYR_PAT.match(s):
            py_pos.append(i)
        elif ak_pos is None and ANSKEY_PAT.match(s):
            ak_pos = i

    # The end of question content = start of answer key
    end_of_questions = ak_pos if ak_pos is not None else len(block_lines)

    # Filter to those before end_of_questions
    l1_pos = [p for p in l1_pos if p < end_of_questions]
    l2_pos = [p for p in l2_pos if p < end_of_questions]
    py_pos = [p for p in py_pos if p < end_of_questions]

    ranges = {}

    if l1_pos:
        l1_start = l1_pos[0] + 1
        if l2_pos:
            l1_end = l2_pos[0]
        elif py_pos:
            l1_end = py_pos[0]
        else:
            l1_end = end_of_questions
        ranges['Level I'] = (l1_start, l1_end)

    if l2_pos:
        l2_start = l2_pos[0] + 1
        if py_pos:
            l2_end = py_pos[0]
        else:
            l2_end = end_of_questions
        ranges['Level II'] = (l2_start, l2_end)

    if py_pos:
        py_start = py_pos[0] + 1
        ranges['Previous Years NEET'] = (py_start, end_of_questions)

    return ranges


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    print(f"Reading {INPUT_MD} ...")
    with open(INPUT_MD, 'r', encoding='utf-8') as f:
        raw_lines = f.readlines()
    lines = [l.rstrip('\n') for l in raw_lines]
    print(f"Total lines: {len(lines)}")

    chapter_blocks = split_into_chapter_blocks(lines)
    if not chapter_blocks:
        print("ERROR: No chapter blocks found!")
        return

    all_questions = []
    stats = {
        'total': 0,
        'with_answer': 0,
        'without_answer': 0,
        'by_chapter': {},
    }

    for ch_idx, block_lines in chapter_blocks:
        if ch_idx >= len(CHAPTER_LIST):
            print(f"WARNING: More blocks than chapters ({ch_idx}), skipping")
            continue

        ch_name = CHAPTER_LIST[ch_idx]
        print(f"\nChapter {ch_idx+1}: {ch_name[:60]}")

        # Extract answer key
        answer_key = extract_answer_key_from_block(block_lines)
        ak_summary = {k: len(v) for k, v in answer_key.items()}
        print(f"  Answer key: {ak_summary}")

        # Find section ranges
        section_ranges = find_section_ranges(block_lines)

        if not section_ranges:
            print(f"  WARNING: No section ranges found")
            continue

        ch_slug = make_slug(ch_name)
        ch_stats = {}

        for section_name, (sec_start, sec_end) in section_ranges.items():
            if sec_start >= sec_end:
                continue

            section_lines = block_lines[sec_start:sec_end]
            questions = parse_questions_from_text(section_lines)

            # Determine subtopic/AK key
            if section_name == 'Level I':
                subtopic = 'Level I'
                ak_key = 'Level I'
                sec_slug = 'level_i'
            elif section_name == 'Level II':
                subtopic = 'Level II'
                ak_key = 'Level II'
                sec_slug = 'level_ii'
            else:
                subtopic = 'Previous Years NEET'
                ak_key = 'Previous Years NEET'
                sec_slug = 'prev_yr'

            print(f"  {section_name}: {len(questions)} questions")
            ch_stats[section_name] = len(questions)

            section_answers = answer_key.get(ak_key, {})

            for q in questions:
                q_num = q['num']
                q_text = q['question']
                options = q['options']
                answer_letter = section_answers.get(q_num, '')

                if answer_letter:
                    stats['with_answer'] += 1
                else:
                    stats['without_answer'] += 1
                stats['total'] += 1

                h = make_hash(q_text)
                q_id = f"chem_{ch_slug[:20]}_{sec_slug}_{q_num}_{h}"

                entry = {
                    "id": q_id,
                    "question": q_text,
                    "option_a": options[0],
                    "option_b": options[1],
                    "option_c": options[2],
                    "option_d": options[3],
                    "options": options,
                    "answer": answer_letter,
                    "explanation": "",
                    "why_wrong_a": "",
                    "why_wrong_b": "",
                    "why_wrong_c": "",
                    "why_wrong_d": "",
                    "subject": "Chemistry",
                    "topic": ch_name,
                    "subtopic": subtopic,
                    "tags": [subtopic],
                }
                all_questions.append(entry)

        stats['by_chapter'][ch_name] = ch_stats

    print(f"\n{'='*65}")
    print(f"Total questions parsed:   {stats['total']}")
    print(f"With answer:              {stats['with_answer']}")
    print(f"Without answer:           {stats['without_answer']}")
    if stats['total'] > 0:
        pct = stats['with_answer'] / stats['total'] * 100
        print(f"Answer match rate:        {pct:.1f}%")

    print(f"\nChapter breakdown:")
    for ch_name, sections in stats['by_chapter'].items():
        total_ch = sum(sections.values())
        print(f"  {ch_name[:50]:<52}: {total_ch:4d}  {dict(sections)}")

    # Load existing bank.json and merge
    existing_questions = []
    try:
        with open(EXISTING_BANK, 'r', encoding='utf-8') as f:
            existing_bank = json.load(f)
        existing_questions = existing_bank.get('questions', [])
        print(f"\nExisting bank: {len(existing_questions)} questions")
    except Exception as e:
        print(f"\nCould not read existing bank: {e}")

    # Drop previously generated chem_ questions to avoid duplication
    existing_non_chem = [q for q in existing_questions if not q.get('id', '').startswith('chem_')]
    print(f"Non-chemistry questions kept: {len(existing_non_chem)}")

    merged = existing_non_chem + all_questions
    output = {
        "app": "NEET MCQ Practice",
        "version": 1,
        "updatedAt": int(time.time() * 1000),
        "questionCount": len(merged),
        "questions": merged,
    }

    print(f"\nWriting {OUTPUT_JSON} with {len(merged)} total questions ...")
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print("Done!")


if __name__ == '__main__':
    main()
