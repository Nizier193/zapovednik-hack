import { createParticleReveal } from "./vendor/particle-reveal.js";
import { createAsciify } from "./vendor/asciify.js";

const trail = document.getElementById("ascii-field");
if (trail) {
  const field = createAsciify(
    { output: trail },
    {
      source: "gradient",
      background: "#07080c",
      colors: ["#163024", "#3d6b45", "#8fbf6a", "#d8f5b0"],
      characters: "01{}[]();=+#",
      fontFamily: '"Roboto Mono", ui-monospace, monospace',
      cellSize: 14,
      radius: 150,
      trail: 1.15,
      flow: 0.72,
      density: 0.4,
      opacity: 0.9,
      veil: 0,
      ambient: 0,
      glow: 0.34,
      grain: 0.04,
      click: "burst",
    },
  );
  if (!field) trail.remove();
}

async function boot() {
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  await new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });

  const photo = document.getElementById("crew-photo");
  const portrait = photo?.querySelector(".slot");
  if (photo && portrait) {
    const reveal = createParticleReveal(
      {
        source: photo.querySelector(".src"),
        content: portrait,
        output: photo.querySelector(".out"),
        paint(ctx, w, h) {
          ctx.fillStyle = "#07080c";
          ctx.fillRect(0, 0, w, h);
          if (!portrait.complete || !portrait.naturalWidth) return;
          const scale = Math.max(w / portrait.naturalWidth, h / portrait.naturalHeight);
          const dw = portrait.naturalWidth * scale;
          const dh = portrait.naturalHeight * scale;
          ctx.drawImage(portrait, (w - dw) / 2, (h - dh) / 2, dw, dh);
        },
      },
      {
        radius: 190,
        softness: 0.72,
        size: 2.2,
        scatter: 32,
        drift: 0.85,
        aberration: 22,
        bend: 42,
        fade: 0.92,
        threshold: 0.08,
        background: "#07080c",
        smoothing: 0.16,
      },
    );
    if (reveal) {
      portrait.style.opacity = "0";
      if (!portrait.complete) portrait.addEventListener("load", () => reveal.resize(), { once: true });
    }
  }
}

boot();
