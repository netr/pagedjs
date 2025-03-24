export default {
	testMatch: ["**/?(*.)(spec).js?(x)"],
	globalSetup: "./jest_helpers/setup.js",
	globalTeardown: "./jest_helpers/teardown.js",
	testEnvironment: "./jest_helpers/puppeteer_environment.js",
	setupFilesAfterEnv: ["./jest_helpers/setup_tests.js"],
	transform: {
		"\\.js$": ["babel-jest", { configFile: "./babel-jest.config.json" }]
	},
	transformIgnorePatterns: [
		// TODO: babel is inserting require functions into ES modules.
		"specs/jest_helpers/(setup|teardown|puppeteer_environment)\\.js$",
		// TODO: Why does playwright's serialize function end up with an undefined used of _typeof2?
		// Seems to be something that's in babel's runtime library.
		"node_modules/playwright-core/.*",
	],
};
