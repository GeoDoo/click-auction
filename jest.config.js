module.exports = {
  testEnvironment: 'node',
  testTimeout: 15000,
  verbose: true,
  collectCoverageFrom: [
    'server.js',
    'public/**/*.js',
    '!**/node_modules/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  testMatch: ['**/tests/**/*.test.js'],
  setupFilesAfterEnv: [],
  moduleFileExtensions: ['js', 'json'],
};

