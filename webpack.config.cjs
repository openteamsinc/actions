const path = require("path");

module.exports = {
  entry: "./src/index.mjs",
  output: {
    filename: "index.cjs",
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
