module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testTimeout: 15000,
  verbose: true,
  roots: ['<rootDir>/tests'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
    }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  testMatch: ['**/tests/**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    'server.ts',
    '!**/node_modules/**',
    '!**/dist/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
};
