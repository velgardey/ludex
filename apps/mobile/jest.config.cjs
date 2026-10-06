module.exports = {
  preset: "jest-expo",
  testMatch: ["**/test/**/*.test.ts", "**/test/**/*.test.tsx"],
  setupFilesAfterEnv: ["<rootDir>/test/setup.ts"],
  transformIgnorePatterns: [],
};
