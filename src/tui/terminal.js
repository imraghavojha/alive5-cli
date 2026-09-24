// Real-terminal lifecycle: alternate screen, cursor, bracketed paste, and
// row-diffed output. Separated from Screen so rendering stays testable offline.

export class Terminal {
  constructor(output = process.stdout) {
    this.output = output;
    this.previous = [];
    this.depth =
      'NO_COLOR' in process.env
        ? 0
        : process.env.COLORTERM === 'truecolor' || process.env.COLORTERM === '24bit'
          ? 24
          : 8;
    this.blocked = false;
    this.closed = false;
  }
  open() {
    this.output.write('\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[?2004h');
  }
  /** Writes only the rows that changed, wrapped in a synchronized update. */
  render(screen) {
    if (this.blocked || this.closed) return;
    const rows = screen.rows(this.depth);
    let output = '';
    rows.forEach((row, i) => {
      if (this.previous[i] !== row) output += `\x1b[${i + 1};1H${row}`;
    });
    if (!output) return;
    this.previous = rows;
    this.blocked = !this.output.write('\x1b[?2026h' + output + '\x1b[?2026l');
    if (this.blocked)
      this.output.once('drain', () => {
        this.blocked = false;
      });
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.output.write('\x1b[0m\x1b[?2004l\x1b[?7h\x1b[?25h\x1b[?1049l');
  }
}
