import type { PaperPatternStructure } from '@catlium/contracts';
import type { DocBlock, DocumentModel } from './export.content-blocks.js';

/* Pure, deterministic mapping from a paper pattern to an export document.
 * Kept free of NestJS/DB so the rendering is unit-testable. The pattern's
 * subject + question-type names are resolved by the caller (export service)
 * from the current institute data; unknown/removed codes render as their raw
 * code so a saved blueprint never loses information. */

export interface PaperPatternDocSource {
  title: string;
  description: string | null;
  status: string;
  version: number;
  subjectIds: string[];
  structure: PaperPatternStructure | null;
  subjectNames: Record<string, string>;
  questionTypeNames: Record<string, string>;
}

function typeName(code: string | undefined, names: Record<string, string>): string {
  if (!code) return 'Mixed';
  return names[code] ?? code;
}

function marksCell(section: PaperPatternStructure['sections'][number]): string {
  if (section.totalMarks != null) return String(section.totalMarks);
  if (section.count != null && section.marksPerQuestion != null) {
    return String(section.count * section.marksPerQuestion);
  }
  return '—';
}

function attemptCell(section: PaperPatternStructure['sections'][number]): string {
  if (section.compulsory) return 'Compulsory';
  if (section.attemptCount != null) {
    return `Attempt ${section.attemptCount} of ${section.count ?? '?'}`;
  }
  return 'Optional';
}

function difficultyCell(section: PaperPatternStructure['sections'][number]): string {
  const d = section.difficultyDistribution;
  if (!d) return '—';
  return `${d.EASY}/${d.MEDIUM}/${d.HARD} (E/M/H)`;
}

function topicsCell(section: PaperPatternStructure['sections'][number]): string {
  if (!section.topicDistribution || section.topicDistribution.length === 0) return '—';
  return section.topicDistribution
    .map((t) => `${t.name}${t.percentage != null ? ` ${t.percentage}%` : ''}`)
    .join(', ');
}

function sectionRow(
  section: PaperPatternStructure['sections'][number],
  names: Record<string, string>,
): string[] {
  return [
    section.name,
    typeName(section.questionType, names),
    section.count?.toString() ?? '—',
    section.marksPerQuestion?.toString() ?? '—',
    marksCell(section),
    attemptCell(section),
    difficultyCell(section),
    topicsCell(section),
  ];
}

/** Assemble the teacher-facing configuration document. A pattern without a
 * blueprint yet still exports a useful config reference (meta + subjects),
 * so the export button never hard-fails on an empty draft. */
export function paperPatternDoc(source: PaperPatternDocSource): DocumentModel {
  const blocks: DocBlock[] = [];
  const structure = source.structure;

  const subjects =
    source.subjectIds.length === 0
      ? 'General (any subject)'
      : source.subjectIds.map((id) => source.subjectNames[id] ?? 'Unknown subject').join(', ');

  const duration = structure ? `${structure.durationMinutes} min` : '—';
  const marks = structure ? String(structure.totalMarks) : '—';

  blocks.push({
    kind: 'paragraph',
    text: `Status: ${source.status} · Version ${source.version} · Duration: ${duration} · Total marks: ${marks}`,
  });
  blocks.push({ kind: 'paragraph', text: `Subjects: ${subjects}` });
  if (source.description) {
    blocks.push({ kind: 'paragraph', text: source.description });
  }

  if (!structure) {
    blocks.push({ kind: 'paragraph', text: 'No blueprint configured yet.' });
    return { title: source.title || 'Paper Pattern', blocks };
  }

  if (structure.instructions.length > 0) {
    blocks.push({ kind: 'heading', text: 'Instructions' });
    blocks.push({ kind: 'bullets', items: structure.instructions });
  }

  blocks.push({ kind: 'heading', text: 'Blueprint' });
  blocks.push({
    kind: 'table',
    headers: [
      'Section',
      'Question type',
      'Questions',
      'Marks/question',
      'Total marks',
      'Attempt',
      'Difficulty (E/M/H)',
      'Topics',
    ],
    rows: structure.sections.map((s) => sectionRow(s, source.questionTypeNames)),
  });

  return { title: source.title || 'Paper Pattern', blocks };
}
