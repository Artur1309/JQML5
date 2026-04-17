class CompilerError extends Error {
  constructor(message, location = null, filename = null) {
    const where = filename && location
      ? `${filename}:${location.line}:${location.column}`
      : filename
        ? filename
        : null;
    super(where ? `${where} - ${message}` : message);
    this.name = 'CompilerError';
    this.location = location;
    this.filename = filename;
  }
}

module.exports = {
  CompilerError,
};
