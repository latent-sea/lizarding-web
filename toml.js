// A small TOML reader, for a stage's definition (the brief's section 9.1):
// key = value pairs, [tables], [[arrays of tables]], dotted keys, strings
// (basic, literal and multi-line), numbers, booleans, dates kept as their
// words, arrays and inline tables. Unknown keys are the caller's to ignore;
// this only reads. Words it cannot read throw a TomlError naming the line.

export class TomlError extends Error {}

export function parseToml(source) {
  const root = {};
  let table = root;
  let at = 0;
  let line = 1;
  const fail = (why) => { throw new TomlError(`line ${line}: ${why}`); };
  const peek = (n = 0) => source[at + n];
  const starts = (words) => source.startsWith(words, at);

  const blank = () => { while (peek() === " " || peek() === "\t") at++; };
  const comment = () => { if (peek() === "#") while (at < source.length && peek() !== "\n") at++; };
  const endOfLine = () => {
    blank(); comment();
    if (at >= source.length) return;
    if (peek() === "\r") at++;
    if (peek() !== "\n") fail(`unexpected ${JSON.stringify(peek())}`);
    at++; line++;
  };
  // blanks, comments and line ends, inside an array
  const space = () => {
    for (;;) {
      blank(); comment();
      if (peek() === "\r") at++;
      if (peek() === "\n") { at++; line++; continue; }
      return;
    }
  };

  const bareKey = () => {
    const from = at;
    while (at < source.length && /[A-Za-z0-9_-]/.test(peek())) at++;
    if (at === from) fail("a key was expected");
    return source.slice(from, at);
  };
  const key = () => {
    const parts = [];
    for (;;) {
      blank();
      parts.push(peek() === '"' ? basic() : peek() === "'" ? literal() : bareKey());
      blank();
      if (peek() !== ".") return parts;
      at++;
    }
  };

  const escape = () => {
    const c = source[at++];
    const simple = { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", '"': '"', "\\": "\\", e: "\x1b" };
    if (c in simple) return simple[c];
    if (c === "u" || c === "U") {
      const length = c === "u" ? 4 : 8;
      const hex = source.slice(at, at + length);
      if (!/^[0-9A-Fa-f]+$/.test(hex) || hex.length !== length) fail("a bad unicode escape");
      at += length;
      return String.fromCodePoint(parseInt(hex, 16));
    }
    return fail(`an unknown escape \\${c}`);
  };
  const basic = () => {
    if (starts('"""')) {
      at += 3;
      if (peek() === "\n") { at++; line++; } else if (starts("\r\n")) { at += 2; line++; }
      let made = "";
      for (;;) {
        if (at >= source.length) fail("a string never closed");
        if (starts('"""')) {
          // up to two quotes may stand just before the closing three
          let quotes = 3;
          while (quotes < 5 && source[at + quotes] === '"') quotes++;
          at += quotes;
          return made + '"'.repeat(quotes - 3);
        }
        const c = source[at++];
        if (c === "\n") line++;
        if (c !== "\\") { made += c; continue; }
        if (/[ \t\r\n]/.test(peek())) { while (/[ \t\r\n]/.test(peek())) { if (peek() === "\n") line++; at++; } continue; }
        made += escape();
      }
    }
    at++;
    let made = "";
    for (;;) {
      const c = source[at++];
      if (c === undefined || c === "\n") fail("a string never closed");
      if (c === '"') return made;
      made += c === "\\" ? escape() : c;
    }
  };
  const literal = () => {
    if (starts("'''")) {
      at += 3;
      if (peek() === "\n") { at++; line++; } else if (starts("\r\n")) { at += 2; line++; }
      const end = source.indexOf("'''", at);
      if (end < 0) fail("a string never closed");
      const made = source.slice(at, end);
      line += made.split("\n").length - 1;
      at = end + 3;
      return made;
    }
    at++;
    const end = source.indexOf("'", at);
    if (end < 0 || source.slice(at, end).includes("\n")) fail("a string never closed");
    const made = source.slice(at, end);
    at = end + 1;
    return made;
  };

  const value = () => {
    const c = peek();
    if (c === '"') return basic();
    if (c === "'") return literal();
    if (c === "[") {
      at++;
      const made = [];
      for (;;) {
        space();
        if (peek() === "]") { at++; return made; }
        made.push(value());
        space();
        if (peek() === ",") { at++; continue; }
        if (peek() === "]") { at++; return made; }
        fail("an array needs , or ]");
      }
    }
    if (c === "{") {
      at++;
      const made = {};
      blank();
      if (peek() === "}") { at++; return made; }
      for (;;) {
        const path = key();
        blank();
        if (peek() !== "=") fail("= was expected");
        at++; blank();
        put(made, path, value());
        blank();
        if (peek() === ",") { at++; continue; }
        if (peek() === "}") { at++; return made; }
        fail("an inline table needs , or }");
      }
    }
    const from = at;
    while (at < source.length && !/[\s,\]\}#]/.test(peek())) at++;
    // a date and a time may be parted by a space
    if (/^\d{4}-\d{2}-\d{2}$/.test(source.slice(from, at)) && peek() === " " && /\d/.test(peek(1))) {
      at++;
      while (at < source.length && !/[\s,\]\}#]/.test(peek())) at++;
    }
    const word = source.slice(from, at);
    if (word === "true") return true;
    if (word === "false") return false;
    if (/^[+-]?(inf|nan)$/.test(word)) return word.includes("nan") ? NaN : word.startsWith("-") ? -Infinity : Infinity;
    if (/^[+-]?0x[0-9A-Fa-f_]+$/.test(word)) return parseInt(word.replace(/_/g, ""), 16);
    if (/^[+-]?0o[0-7_]+$/.test(word)) return parseInt(word.replace(/_|0o/g, ""), 8) * (word.startsWith("-") ? -1 : 1);
    if (/^[+-]?0b[01_]+$/.test(word)) return parseInt(word.replace(/_|0b/g, ""), 2) * (word.startsWith("-") ? -1 : 1);
    if (/^[+-]?(\d[\d_]*)(\.\d[\d_]*)?([eE][+-]?\d[\d_]*)?$/.test(word)) return Number(word.replace(/_/g, ""));
    if (/^\d{4}-\d{2}-\d{2}|^\d{2}:\d{2}/.test(word)) return word;
    return fail(word ? `a value it cannot read: ${word}` : "a value was expected");
  };

  const put = (into, path, held) => {
    let place = into;
    for (const part of path.slice(0, -1)) {
      if (place[part] === undefined) place[part] = {};
      place = Array.isArray(place[part]) ? place[part][place[part].length - 1] : place[part];
      if (typeof place !== "object" || place === null) fail(`${path.join(".")} is already a value`);
    }
    const last = path[path.length - 1];
    if (Object.prototype.hasOwnProperty.call(place, last)) fail(`${path.join(".")} is given twice`);
    place[last] = held;
  };

  const tableAt = (path, many) => {
    let place = root;
    path.forEach((part, index) => {
      const final = index === path.length - 1;
      if (final && many) {
        if (place[part] === undefined) place[part] = [];
        if (!Array.isArray(place[part])) fail(`${path.join(".")} is not an array of tables`);
        const made = {};
        place[part].push(made);
        place = made;
        return;
      }
      if (place[part] === undefined) place[part] = {};
      place = Array.isArray(place[part]) ? place[part][place[part].length - 1] : place[part];
      if (typeof place !== "object" || place === null) fail(`${path.join(".")} is already a value`);
    });
    return place;
  };

  while (at < source.length) {
    blank();
    if (peek() === "#" || peek() === "\n" || peek() === "\r") { endOfLine(); continue; }
    if (at >= source.length) break;
    if (peek() === "[") {
      const many = starts("[[");
      at += many ? 2 : 1;
      const path = key();
      if (many ? !starts("]]") : peek() !== "]") fail("a table's name was not closed");
      at += many ? 2 : 1;
      table = tableAt(path, many);
      endOfLine();
      continue;
    }
    const path = key();
    blank();
    if (peek() !== "=") fail("= was expected");
    at++;
    blank();
    put(table, path, value());
    endOfLine();
  }
  return root;
}
