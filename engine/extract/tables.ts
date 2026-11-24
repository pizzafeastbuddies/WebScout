import { MAX_CANDIDATES_PER_SOURCE } from '../contract/internal';
import { collapseWhitespace, findAll, getAttr, isElement, textContent, type Document, type Element } from '../dom/parseHtml';
import type { Candidate } from './candidate';
import { sectionIndex } from './sections';

/**
 * Table extraction — the reason this project exists in its current shape.
 *
 * A question like "what is the peak throughput in Chile?" is not answerable from
 * prose, and a bare cell value ("640 Gbit/s") is not verifiable evidence on its
 * own: the reviewer needs to know which row and which column it was read from.
 * Every table candidate therefore carries `rowHeader` and `columnHeader` in its
 * locator, which is exactly what the assessment asks a table answer to report.
 */

interface Cell {
  text: string;
  isHeader: boolean;
  scope: string | undefined;
}

/** Direct `td`/`th` children of a row — never descendants of a nested table. */
function cellsOf(row: Element): Cell[] {
  const cells: Cell[] = [];
  for (const child of row.childNodes) {
    if (!isElement(child)) {
      continue;
    }
    const tag = child.tagName.toLowerCase();
    if (tag !== 'td' && tag !== 'th') {
      continue;
    }
    cells.push({
      text: collapseWhitespace(textContent(child)),
      isHeader: tag === 'th',
      scope: getAttr(child, 'scope'),
    });
  }
  return cells;
}

/**
 * The header row is the first row whose header cells are not row headers
 * (`scope="row"`), which distinguishes a column-header row from a body row whose
 * first cell happens to be a `<th>`.
 */
function headerRowIndex(rows: Element[]): number {
  const index = rows.findIndex((row) => cellsOf(row).some((cell) => cell.isHeader && cell.scope !== 'row'));
  return index === -1 ? 0 : index;
}

export function extractTableCandidates(doc: Document, sourceUrl: string): Candidate[] {
  const sections = sectionIndex(doc);
  const candidates: Candidate[] = [];

  for (const table of findAll(doc, 'table')) {
    const rows = findAll(table, 'tr');
    if (rows.length < 2) {
      continue;
    }

    const section = sections.get(table) ?? '';
    const headerIndex = headerRowIndex(rows);
    // Columns are aligned by cell position. This assumes the simple, overwhelmingly
    // common shape (no `colspan`/`rowspan`); merged cells are a known limitation.
    const columnHeaders = cellsOf(rows[headerIndex]).map((cell) => cell.text);

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      if (rowIndex === headerIndex) {
        continue;
      }

      const cells = cellsOf(rows[rowIndex]);
      if (cells.length === 0) {
        continue;
      }

      const rowHeader = cells.find((cell) => cell.isHeader)?.text ?? '';

      for (let columnIndex = 0; columnIndex < cells.length; columnIndex += 1) {
        const cell = cells[columnIndex];
        // Header cells are labels; the values in this row are the non-header cells.
        if (!cell || cell.isHeader || !cell.text) {
          continue;
        }

        const columnHeader = columnHeaders[columnIndex] ?? '';
        candidates.push({
          text: cell.text,
          sourceUrl,
          locator: {
            kind: 'table',
            section: section || undefined,
            rowHeader: rowHeader || undefined,
            columnHeader: columnHeader || undefined,
          },
          context: [section, rowHeader, columnHeader].filter(Boolean).join(' '),
        });
      }
    }
  }

  return candidates.slice(0, MAX_CANDIDATES_PER_SOURCE);
}
