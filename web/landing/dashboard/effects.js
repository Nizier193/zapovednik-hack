import { createLiquid } from "../vendor/liquid.js";
import { createDroplets } from "../vendor/droplets.js";

const liquid = document.querySelector("[data-fx='liquid']");
const drops = document.querySelector("[data-fx='droplets']");

function pair(node) {
  return {
    source: node.querySelector(".src"),
    content: node.querySelector(".slot"),
    output: node.querySelector(".out"),
  };
}

if (liquid) {
  const fx = createLiquid(pair(liquid), {
    intensity: 2,
    distortion: 0.4,
    force: 1.1,
    radius: 0.3,
    curl: 1.9,
    densityDissipation: 0.96,
    blend: 5,
    velocityDissipation: 1,
    pressure: 0.8,
    pressureIterations: 4,
    simResolution: 128,
    dyeResolution: 512,
    color: [0.737, 0.929, 0.569],
    rainbow: false,
  });
  if (fx && fx.splat) {
    window.setInterval(() => {
      fx.splat(Math.random(), Math.random(), (Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80);
    }, 900);
  }
}

if (drops) {
  createDroplets(pair(drops), { intensity: 0.55 });
}
