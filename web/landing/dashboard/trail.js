import { createAsciify } from "../vendor/asciify.js";

const output = document.getElementById("ascii-field");
if (output) {
  const field = createAsciify(
    { output },
    {
      source: "gradient",
      background: "#121a22",
      colors: ["#1b2832", "#3d5563", "#7dcec6", "#e4eef3"],
      characters: " .-+*#",
      fontFamily: '"Roboto Mono", ui-monospace, monospace',
      cellSize: 15,
      radius: 170,
      trail: 1.05,
      flow: 0.6,
      density: 0.5,
      opacity: 0.7,
      veil: 0,
      ambient: 0.1,
      glow: 0.35,
      grain: 0.08,
      click: "burst",
    },
  );
  if (!field) output.remove();
}
