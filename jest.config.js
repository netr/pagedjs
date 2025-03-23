export default {
	testMatch: [
		"**/?(*.)(test).js",
		"**/?(*.)(test).ts",
	],
	testEnvironment: "jsdom",
	transform: {
		"\\.js$": ["babel-jest", { configFile: "./babel-jest.config.json" }],
		"\\.ts$": ["babel-jest", { configFile: "./babel-jest.config.json" }],
	},
};
