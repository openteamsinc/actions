const path = require("path");

module.exports = {
  entry: "./src/index.js",
  output: {
    filename: "index.js",
    // eslint-disable-next-line no-undef
    path: path.resolve(__dirname, "dist"),
    libraryTarget: "commonjs2",
  },
  target: "node",
  mode: "production",
  optimization: {
    minimize: false,
  },
};
