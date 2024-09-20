const path = require("path");

module.exports = {
  entry: "./src/index.js",
  output: {
    filename: "index.js",
    path: path.resolve(__dirname, "dist"),
    libraryTarget: "commonjs2",
  },
  target: "node",
  mode: "production",
};
