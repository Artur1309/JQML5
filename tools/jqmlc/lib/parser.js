const path = require('node:path');
const fs = require('node:fs');
const { Tokenizer } = require('./tokenizer');
const { CompilerError } = require('./errors');

function parseQml(source, filename = '<inline>') {
  const tokenizer = new Tokenizer(source, filename);
  const ast = {
    kind: 'QmlDocument',
    filename,
    imports: [],
    rootObject: null,
  };

  while (!tokenizer.eof()) {
    tokenizer.skipWhitespaceAndComments({ preserveNewlines: false });
    if (tokenizer.eof()) {
      break;
    }

    if (tokenizer.source.slice(tokenizer.index, tokenizer.index + 6) === 'import') {
      const imported = parseImport(tokenizer);
      ast.imports.push(imported);
      continue;
    }

    ast.rootObject = parseObject(tokenizer);
    break;
  }

  if (!ast.rootObject) {
    throw new CompilerError('Expected root object declaration.', { line: 1, column: 1 }, filename);
  }

  tokenizer.skipWhitespaceAndComments({ preserveNewlines: false });
  if (!tokenizer.eof()) {
    tokenizer.error('Unexpected trailing content after root object.');
  }

  return ast;
}

function parseImport(tokenizer) {
  const start = tokenizer.location();
  tokenizer.expect('import', "Expected 'import'.");
  tokenizer.skipWhitespaceAndComments();

  let source;
  let version = null;
  let alias = null;
  let isLocal = false;

  if (tokenizer.current() === '"' || tokenizer.current() === "'") {
    const str = tokenizer.readString();
    source = str.value;
    isLocal = true;
  } else {
    const moduleName = tokenizer.readIdentifierPath();
    source = moduleName.value;

    tokenizer.skipWhitespaceAndComments();
    if (/[0-9]/.test(tokenizer.current())) {
      let versionRaw = '';
      while (!tokenizer.eof() && /[0-9.]/.test(tokenizer.current())) {
        versionRaw += tokenizer.current();
        tokenizer.advance();
      }
      version = versionRaw;
    }
  }

  tokenizer.skipWhitespaceAndComments();
  if (tokenizer.source.slice(tokenizer.index, tokenizer.index + 2) === 'as') {
    tokenizer.expect('as');
    tokenizer.skipWhitespaceAndComments();
    alias = tokenizer.readIdentifier().value;
  }

  while (!tokenizer.eof() && tokenizer.current() !== '\n' && tokenizer.current() !== ';') {
    if (tokenizer.current().trim() === '') {
      tokenizer.advance();
      continue;
    }
    break;
  }

  if (tokenizer.current() === ';') {
    tokenizer.advance();
  }
  tokenizer.skipWhitespaceAndComments({ preserveNewlines: false });

  return {
    kind: 'Import',
    source,
    version,
    alias,
    isLocal: Boolean(isLocal),
    location: start,
  };
}

function parseObject(tokenizer) {
  tokenizer.skipWhitespaceAndComments();
  const type = tokenizer.readIdentifierPath();
  tokenizer.skipWhitespaceAndComments();
  tokenizer.expect('{', `Expected '{' after type '${type.value}'.`);

  const objectNode = {
    kind: 'ObjectDeclaration',
    typeName: type.value,
    location: type.location,
    id: null,
    properties: [],
    propertyDefinitions: [],
    signalHandlers: [],
    children: [],
  };

  while (!tokenizer.eof()) {
    tokenizer.skipWhitespaceAndComments({ preserveNewlines: false });

    if (tokenizer.current() === '}') {
      tokenizer.advance();
      break;
    }

    const itemLocation = tokenizer.location();
    const token = tokenizer.readIdentifier();

    if (token.value === 'property') {
      const propertyDefinition = parsePropertyDefinition(tokenizer, itemLocation);
      objectNode.propertyDefinitions.push(propertyDefinition);
      consumeTerminator(tokenizer);
      continue;
    }

    tokenizer.skipWhitespaceAndComments();

    if (tokenizer.current() === '{') {
      tokenizer.index = token.location.index;
      tokenizer.line = token.location.line;
      tokenizer.column = token.location.column;
      objectNode.children.push(parseObject(tokenizer));
      continue;
    }

    if (tokenizer.current() !== ':' && tokenizer.current() !== '.') {
      tokenizer.error(`Expected ':' or nested object block after '${token.value}'.`, itemLocation);
    }

    tokenizer.index = token.location.index;
    tokenizer.line = token.location.line;
    tokenizer.column = token.location.column;

    const namePath = tokenizer.readIdentifierPath();
    tokenizer.skipWhitespaceAndComments();
    tokenizer.expect(':', `Expected ':' after '${namePath.value}'.`);
    tokenizer.skipWhitespaceAndComments();

    const value = parseValue(tokenizer, namePath.value);

    if (namePath.value === 'id' && value.kind === 'IdentifierValue') {
      objectNode.id = value.name;
    } else if (namePath.value.startsWith('on') && /^[A-Z]/.test(namePath.value.slice(2))) {
      objectNode.signalHandlers.push({
        kind: 'SignalHandler',
        name: namePath.value,
        value,
        location: namePath.location,
      });
    } else {
      objectNode.properties.push({
        kind: 'PropertyAssignment',
        name: namePath.value,
        value,
        location: namePath.location,
      });
    }

    consumeTerminator(tokenizer);
  }

  return objectNode;
}

function parsePropertyDefinition(tokenizer, location) {
  tokenizer.skipWhitespaceAndComments();
  const propertyType = tokenizer.readIdentifierPath();
  tokenizer.skipWhitespaceAndComments();
  const propertyName = tokenizer.readIdentifier();
  tokenizer.skipWhitespaceAndComments();

  let value = {
    kind: 'NullValue',
    value: null,
    raw: 'null',
    location,
  };

  if (tokenizer.current() === ':') {
    tokenizer.advance();
    tokenizer.skipWhitespaceAndComments();
    value = parseValue(tokenizer, propertyName.value);
  }

  return {
    kind: 'PropertyDefinition',
    propertyType: propertyType.value,
    name: propertyName.value,
    value,
    location,
  };
}

function parseValue(tokenizer, propertyName = '') {
  const location = tokenizer.location();
  const char = tokenizer.current();

  if (char === '"' || char === "'") {
    const str = tokenizer.readString();
    return {
      kind: 'StringValue',
      value: str.value,
      raw: str.raw,
      location: str.location,
    };
  }

  if (char === '{') {
    const block = tokenizer.readBalancedBlock('{', '}');
    return {
      kind: 'JsBlockValue',
      raw: block.raw,
      location: block.location,
      propertyName,
    };
  }

  if (char === '-' || /[0-9]/.test(char)) {
    const number = tokenizer.readNumber();
    return {
      kind: 'NumberValue',
      value: number.value,
      raw: number.raw,
      location: number.location,
    };
  }

  if (/[A-Za-z_]/.test(char)) {
    const checkpoint = tokenizer.location();
    const identifierPath = tokenizer.readIdentifierPath();
    tokenizer.skipWhitespaceAndComments();

    if (tokenizer.current() === '{') {
      tokenizer.index = checkpoint.index;
      tokenizer.line = checkpoint.line;
      tokenizer.column = checkpoint.column;
      return {
        kind: 'ObjectValue',
        object: parseObject(tokenizer),
        location: checkpoint,
      };
    }

    if (identifierPath.parts.length === 1) {
      if (identifierPath.value === 'true' || identifierPath.value === 'false') {
        return {
          kind: 'BooleanValue',
          value: identifierPath.value === 'true',
          raw: identifierPath.value,
          location: identifierPath.location,
        };
      }
      if (identifierPath.value === 'null') {
        return {
          kind: 'NullValue',
          value: null,
          raw: 'null',
          location: identifierPath.location,
        };
      }
    }

    tokenizer.index = checkpoint.index;
    tokenizer.line = checkpoint.line;
    tokenizer.column = checkpoint.column;
  }

  const expression = tokenizer.readJsExpression();
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(expression.raw)) {
    return {
      kind: 'IdentifierValue',
      name: expression.raw,
      raw: expression.raw,
      location: expression.location,
    };
  }
  return {
    kind: 'JsExpressionValue',
    raw: expression.raw,
    location: expression.location,
  };
}

function consumeTerminator(tokenizer) {
  tokenizer.skipWhitespaceAndComments({ preserveNewlines: true });
  if (tokenizer.current() === ';') {
    tokenizer.advance();
  }
  tokenizer.skipWhitespaceAndComments({ preserveNewlines: false });
}

function parseQmlFile(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  return parseQml(source, path.resolve(filePath));
}

module.exports = {
  parseQml,
  parseQmlFile,
};
