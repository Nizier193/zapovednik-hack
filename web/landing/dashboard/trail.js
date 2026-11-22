import { createAsciify } from "../vendor/asciify.js";

const output = document.getElementById("ascii-field");
if (output) {
  const field = createAsciify(
    { output },
    {
      source: "gradient",
      background: "#101E19",
      colors: ["#1a3044", "#3d6a78", "#7dcec6", "#f3e2b0"],
      characters: " .:-=+*#",
      fontFamily: '"Roboto Mono", ui-monospace, monospace',
      cellSize: 15,
      radius: 160,
      trail: 1.05,
      flow: 0.55,
      density: 0.42,
      opacity: 0.8,
      veil: 0,
      ambient: 0,
      glow: 0.28,
      grain: 0.06,
      click: "burst",
    },
  );
  if (!field) output.remove();
}
