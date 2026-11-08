/**
 * Reads a CSV the way a spreadsheet wrote it: quoted fields, doubled quotes
 * inside them, and either line ending.
 *
 * Hand-written rather than pulled from a package because the whole grammar is
 * four states, and a dependency here would have to be audited for the same
 * four.
 */
export function parseCsv(text: string): string[][] {
  // Excel writes a byte-order mark, which would otherwise become part of the
  // first header and stop it from being recognised.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const char = input[i];

    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      quoted = true;
      i += 1;
      continue;
    }
    if (char === ',') {
      endField();
      i += 1;
      continue;
    }
    if (char === '\r') {
      i += 1;
      continue;
    }
    if (char === '\n') {
      endRow();
      i += 1;
      continue;
    }

    field += char;
    i += 1;
  }

  // A file that does not end in a newline still has a last row.
  if (field.length > 0 || row.length > 0) endRow();

  return rows.filter((line) => line.some((cell) => cell.trim().length > 0));
}

/** Header spelling is forgiving; header meaning is not. */
export const headerKey = (raw: string) =>
  raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
