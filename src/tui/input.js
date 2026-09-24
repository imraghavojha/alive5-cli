// Raw stdin decoding: bracketed paste is collected whole, and a lone Escape is
// distinguished from an escape sequence by a short timeout.

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';
const ESCAPE_DELAY_MS = 30;
const PASTE_LIMIT = 8192;

/**
 * @param onKeys  receives decoded key bytes for the keypress reader
 * @param onPaste receives one complete pasted block
 * @param onEscape called when a lone Escape byte was not part of a sequence
 */
export function createDecoder({ onKeys, onPaste, onEscape }) {
  let pending = '';
  let pasting = false;
  let pasted = '';
  let timer;

  const emit = (value) => {
    if (value) onKeys(value);
  };

  function feed(chunk) {
    clearTimeout(timer);
    pending += chunk.toString('utf8');
    while (pending) {
      const marker = pasting ? PASTE_END : PASTE_START;
      const index = pending.indexOf(marker);
      if (index >= 0) {
        const value = pending.slice(0, index);
        pending = pending.slice(index + marker.length);
        if (pasting) {
          onPaste(pasted + value);
          pasted = '';
        } else emit(value);
        pasting = !pasting;
        continue;
      }
      // Hold back any prefix that could still complete a paste marker.
      let keep = 0;
      for (let n = 1; n < marker.length; n++) if (pending.endsWith(marker.slice(0, n))) keep = n;
      const value = pending.slice(0, pending.length - keep);
      pending = pending.slice(pending.length - keep);
      if (pasting) pasted = (pasted + value).slice(0, PASTE_LIMIT);
      else emit(value);
      break;
    }
    if (pending && !pasting)
      timer = setTimeout(() => {
        const value = pending;
        pending = '';
        if (value === '\x1b') onEscape();
        else emit(value);
      }, ESCAPE_DELAY_MS);
  }

  return { feed, stop: () => clearTimeout(timer) };
}
