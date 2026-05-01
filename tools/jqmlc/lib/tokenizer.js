const { CompilerError } = require('./errors');

class Tokenizer {
  constructor(source, filename) {
    this.source = source;
    this.filename = filename;
    this.index = 0;
    this.line = 1;
    this.column = 1;
  }

  eof() {
    return this.index >= this.source.length;
  }

  current() {
    return this.source[this.index];
  }

  peek(offset = 0) {
    const target = this.index + offset;
    if (target < 0 || target >= this.source.length) {
      return undefined;
    }
    return this.source[target];
  }

  location() {
    return {
      index: this.index,
      line: this.line,
      column: this.column,
    };
  }

  error(message, location = this.location()) {
    throw new CompilerError(message, location, this.filename);
  }

  advance(count = 1) {
    for (let i = 0; i < count; i += 1) {
      const char = this.source[this.index];
      this.index += 1;
      if (char === '\n') {
        this.line += 1;
        this.column = 1;
      } else {
        this.column += 1;
      }
    }
  }

  skipWhitespaceAndComments({ preserveNewlines = false } = {}) {
    while (!this.eof()) {
      const char = this.current();
      const next = this.peek(1);

      if (char === '/' && next === '/') {
        while (!this.eof() && this.current() !== '\n') {
          this.advance();
        }
        continue;
      }

      if (char === '/' && next === '*') {
        this.advance(2);
        while (!this.eof()) {
          if (this.current() === '*' && this.peek(1) === '/') {
            this.advance(2);
            break;
          }
          this.advance();
        }
        continue;
      }

      if (char === ' ' || char === '\t' || char === '\r' || (!preserveNewlines && char === '\n')) {
        this.advance();
        continue;
      }

      break;
    }
  }

  consumeIf(text) {
    if (this.source.slice(this.index, this.index + text.length) === text) {
      this.advance(text.length);
      return true;
    }
    return false;
  }

  expect(text, message = `Expected '${text}'.`) {
    if (!this.consumeIf(text)) {
      this.error(message);
    }
  }

  readIdentifier() {
    const start = this.location();
    const first = this.current();
    if (!first || !/[A-Za-z_]/.test(first)) {
      this.error('Expected an identifier.', start);
    }

    let value = '';
    while (!this.eof() && /[A-Za-z0-9_]/.test(this.current())) {
      value += this.current();
      this.advance();
    }

    return {
      value,
      location: start,
    };
  }

  readIdentifierPath() {
    const first = this.readIdentifier();
    const parts = [first.value];

    while (this.current() === '.') {
      this.advance();
      this.skipWhitespaceAndComments();
      parts.push(this.readIdentifier().value);
    }

    return {
      value: parts.join('.'),
      parts,
      location: first.location,
    };
  }

  readString() {
    const quote = this.current();
    if (quote !== '"' && quote !== "'") {
      this.error('Expected a string literal.');
    }

    const start = this.location();
    this.advance();

    let raw = quote;
    let value = '';
    while (!this.eof()) {
      const char = this.current();
      raw += char;

      if (char === '\\') {
        this.advance();
        if (this.eof()) {
          this.error('Unterminated string literal escape.', start);
        }
        const escaped = this.current();
        raw += escaped;
        value += decodeEscape(this, escaped);
        this.advance();
        continue;
      }

      if (char === quote) {
        this.advance();
        return {
          value,
          raw,
          location: start,
        };
      }

      value += char;
      this.advance();
    }

    this.error('Unterminated string literal.', start);
  }

  readNumber() {
    const start = this.location();
    let text = '';
    if (this.current() === '-') {
      text += '-';
      this.advance();
    }
    while (!this.eof() && /[0-9]/.test(this.current())) {
      text += this.current();
      this.advance();
    }
    if (this.current() === '.') {
      text += '.';
      this.advance();
      while (!this.eof() && /[0-9]/.test(this.current())) {
        text += this.current();
        this.advance();
      }
    }

    if (!/^[-]?[0-9]+(?:\.[0-9]+)?$/.test(text)) {
      this.error('Invalid number literal.', start);
    }

    return {
      value: Number(text),
      raw: text,
      location: start,
    };
  }

  readBalancedBlock(openChar = '{', closeChar = '}') {
    const start = this.location();
    if (this.current() !== openChar) {
      this.error(`Expected '${openChar}'.`, start);
    }

    this.advance();
    const contentStart = this.index;
    let depth = 1;

    while (!this.eof()) {
      const char = this.current();
      const next = this.peek(1);

      if (char === '/' && next === '/') {
        while (!this.eof() && this.current() !== '\n') {
          this.advance();
        }
        continue;
      }

      if (char === '/' && next === '*') {
        this.advance(2);
        while (!this.eof()) {
          if (this.current() === '*' && this.peek(1) === '/') {
            this.advance(2);
            break;
          }
          this.advance();
        }
        continue;
      }

      if (char === '"' || char === "'" || char === '`') {
        this._skipStringLiteral(char);
        continue;
      }

      if (char === openChar) {
        depth += 1;
        this.advance();
        continue;
      }

      if (char === closeChar) {
        depth -= 1;
        if (depth === 0) {
          const end = this.index;
          this.advance();
          return {
            raw: this.source.slice(contentStart, end),
            location: start,
          };
        }
        this.advance();
        continue;
      }

      this.advance();
    }

    this.error(`Unterminated block, expected '${closeChar}'.`, start);
  }

  readJsExpression() {
    const start = this.location();
    const expressionStart = this.index;

    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;

    while (!this.eof()) {
      const char = this.current();
      const next = this.peek(1);

      if (char === '/' && next === '/') {
        while (!this.eof() && this.current() !== '\n') {
          this.advance();
        }
        continue;
      }

      if (char === '/' && next === '*') {
        this.advance(2);
        while (!this.eof()) {
          if (this.current() === '*' && this.peek(1) === '/') {
            this.advance(2);
            break;
          }
          this.advance();
        }
        continue;
      }

      if (char === '"' || char === "'" || char === '`') {
        this._skipStringLiteral(char);
        continue;
      }

      if (char === '(') {
        parenDepth += 1;
      } else if (char === ')') {
        parenDepth -= 1;
      } else if (char === '[') {
        bracketDepth += 1;
      } else if (char === ']') {
        bracketDepth -= 1;
      } else if (char === '{') {
        braceDepth += 1;
      } else if (char === '}') {
        if (braceDepth === 0 && parenDepth === 0 && bracketDepth === 0) {
          break;
        }
        braceDepth -= 1;
      } else if ((char === ';' || char === '\n') && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
        break;
      }

      this.advance();
    }

    const raw = this.source.slice(expressionStart, this.index).trim();
    if (!raw) {
      const found = this.eof() ? 'end of file' : `'${this.current()}'`;
      this.error(`Expected expression value, found ${found}.`, start);
    }

    return {
      raw,
      location: start,
    };
  }

  _skipStringLiteral(quote) {
    this.advance();
    while (!this.eof()) {
      const char = this.current();
      if (char === '\\') {
        this.advance();
        if (this.eof()) {
          break;
        }
        this.advance();
        continue;
      }
      this.advance();
      if (char === quote) {
        return;
      }
    }
    this.error('Unterminated string literal.');
  }
}

function decodeEscape(tokenizer, escaped) {
  switch (escaped) {
    case 'n': return '\n';
    case 'r': return '\r';
    case 't': return '\t';
    case 'b': return '\b';
    case 'f': return '\f';
    case 'v': return '\v';
    case '0': return '\0';
    case '\\': return '\\';
    case '"': return '"';
    case '\'': return '\'';
    case 'x': {
      const first = tokenizer.peek(1);
      const second = tokenizer.peek(2);
      if (!first || !second || !/[A-Fa-f0-9]/.test(first) || !/[A-Fa-f0-9]/.test(second)) {
        tokenizer.error('Invalid hexadecimal string escape.');
      }
      tokenizer.advance(2);
      return String.fromCharCode(parseInt(`${first}${second}`, 16));
    }
    case 'u': {
      const hex = `${tokenizer.peek(1) || ''}${tokenizer.peek(2) || ''}${tokenizer.peek(3) || ''}${tokenizer.peek(4) || ''}`;
      if (!/^[A-Fa-f0-9]{4}$/.test(hex)) {
        tokenizer.error('Invalid unicode string escape.');
      }
      tokenizer.advance(4);
      return String.fromCharCode(parseInt(hex, 16));
    }
    default:
      return escaped;
  }
}

module.exports = {
  Tokenizer,
};
