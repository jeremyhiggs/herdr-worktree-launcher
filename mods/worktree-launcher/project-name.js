// Bounded reads run beside the checkout; hex keeps binary data out of NUL records.
export const projectFilesScript = String.raw`
set -o pipefail
for file in package.json pyproject.toml; do
  data=
  if [[ -f "$1/$file" && -r "$1/$file" ]]; then
    data=$(/usr/bin/head -c 65537 "$1/$file" 2>/dev/null | /usr/bin/od -An -v -tx1 | /usr/bin/tr -d ' \n') || data=
  fi
  printf '%s\0' "$data" || exit $?
done
`;

function decode(hex) {
  if (typeof hex !== 'string' || hex.length > 131072 || !/^(?:[\da-f]{2})*$/i.test(hex)) return '';
  try { return decodeURIComponent(hex.replace(/../g, byte => `%${byte}`)).replace(/^\uFEFF/, ''); }
  catch { return ''; }
}

function usable(name, scoped = false) {
  if (typeof name !== 'string') return null;
  const match = (scoped ? /^(?:@[A-Za-z0-9][A-Za-z0-9._-]*\/)?([A-Za-z0-9][A-Za-z0-9._-]*)$/ : /^([A-Za-z0-9][A-Za-z0-9._-]*)$/).exec(name);
  return match && match[1].length <= 255 ? match[1] : null;
}

// Read static string names, masking all strings and comments before finding tables.
// Unsupported values are left to the folder fallback; no build backend is executed.
function pythonName(text) {
  if (!text || text.includes('\0')) return null;
  const strings = []; let masked = '';
  for (let i = 0; i < text.length;) {
    const quote = text[i];
    if (quote === '#') { const end = text.indexOf('\n', i); i = end < 0 ? text.length : end; continue; }
    if (quote !== '"' && quote !== "'") { masked += text[i++]; continue; }
    const delimiter = text.startsWith(quote.repeat(3), i) ? quote.repeat(3) : quote;
    let end = i + delimiter.length;
    for (; end < text.length && !text.startsWith(delimiter, end); end++) {
      if (delimiter.length === 1 && /[\r\n]/.test(text[end])) return null;
      if (quote === '"' && text[end] === '\\') {
        if (delimiter.length === 1 && /[\r\n]/.test(text[end + 1] ?? '')) return null;
        end++;
      }
    }
    if (end >= text.length) return null;
    masked += `\0${strings.length}\0`;
    strings.push(text.slice(i, end + delimiter.length)); i = end + delimiter.length;
  }
  function value(token) {
    const literal = strings[Number(token.slice(1, -1))];
    if (!literal) throw new Error('Invalid string');
    const width = literal.startsWith(literal[0].repeat(3)) ? 3 : 1;
    let body = literal.slice(width, -width);
    if (width === 3) body = body.replace(/^\r?\n/, '');
    if (literal[0] === "'") return body;
    body = body.replace(/\\\r?\n\s*/g, '').replace(/\\U([\da-fA-F]{8})/g, (_all, hex) => String.fromCodePoint(parseInt(hex, 16)));
    return JSON.parse(`"${body.replace(/\r?\n/g, '\\n')}"`);
  }
  const key = text => text.split('.').map(part => {
    part = part.trim();
    if (/^\0\d+\0$/.test(part)) return value(part);
    if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new Error('Invalid key');
    return part;
  });
  let section = [], depth = 0; const names = new Map();
  try {
    for (const raw of masked.split(/\r?\n/)) {
      const line = raw.trim();
      if (!depth) {
        const table = /^\[([^\[\]]+)\]$/.exec(line);
        if (table) { section = key(table[1]); continue; }
        if (/^\[\[.*\]\]$/.test(line)) { section = null; continue; }
        const field = /^([^=]+)=\s*(\0\d+\0)\s*$/.exec(line);
        if (field && section) {
          const parts = [...section, ...key(field[1])];
          const path = parts.length === 2 && parts[0] === 'project' && parts[1] === 'name' ? 'project.name'
            : parts.length === 3 && parts[0] === 'tool' && parts[1] === 'poetry' && parts[2] === 'name' ? 'tool.poetry.name' : null;
          if (path) {
            if (names.has(path)) return null;
            names.set(path, usable(value(field[2])));
          }
        }
      }
      for (const char of line) { if ('[{'.includes(char)) depth++; else if (']}'.includes(char)) depth--; }
      if (depth < 0) return null;
    }
    return !depth ? names.get('project.name') ?? names.get('tool.poetry.name') ?? null : null;
  } catch { return null; }
}

export function projectFileName(packageHex = '', pythonHex = '') {
  try { const name = usable(JSON.parse(decode(packageHex)).name, true); if (name) return name; }
  catch { /* An absent or unusable package file leaves Python metadata available. */ }
  return pythonName(decode(pythonHex));
}
