import { createGlitch } from "./vendor/glitch.js";
import { createAsciify } from "./vendor/asciify.js";
import { createParticleReveal } from "./vendor/particle-reveal.js";

const factories = {};

const options = {
  liquid: {
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
  },
  frost: { frost: 0.8 },
  droplets: { intensity: 0.7 },
  glass: { shine: 1.8, size: 150, reflection: 1.4 },
};

function paintIntro(ctx, w, h) {
  ctx.fillStyle = "#07080c";
  ctx.fillRect(0, 0, w, h);
  const pad = w * 0.08;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#bced91";
  ctx.font = `400 ${Math.max(14, Math.round(h * 0.028))}px "Roboto Mono", monospace`;
  ctx.fillText("ЦУ", pad, h * 0.4);
  let size = Math.round(Math.min(w * 0.09, h * 0.12));
  const title = "Полевой журнал";
  ctx.font = `600 ${size}px Unbounded, sans-serif`;
  while (ctx.measureText(title).width > w - pad * 2 && size > 28) {
    size -= 2;
    ctx.font = `600 ${size}px Unbounded, sans-serif`;
  }
  ctx.fillStyle = "#f4f6f1";
  ctx.fillText(title, pad, h * 0.52);
  ctx.fillStyle = "#9aa89c";
  ctx.font = `400 ${Math.max(16, Math.round(h * 0.03))}px Inter, sans-serif`;
  ctx.fillText("Центрально-Лесной заповедник", pad, h * 0.52 + size * 0.55);
}

function paintCard(ctx, w, h) {
  ctx.fillStyle = "#10140f";
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#bced91";
  ctx.font = `400 ${Math.max(12, Math.round(h * 0.055))}px "Roboto Mono", monospace`;
  ctx.fillText("СТАНЦИЯ", w * 0.08, h * 0.4);
  let size = Math.round(h * 0.16);
  const word = "Красное";
  ctx.font = `600 ${size}px Unbounded, sans-serif`;
  while (ctx.measureText(word).width > w * 0.84 && size > 20) {
    size -= 2;
    ctx.font = `600 ${size}px Unbounded, sans-serif`;
  }
  ctx.fillStyle = "#f4f6f1";
  ctx.fillText(word, w * 0.08, h * 0.62);
}

function drive(name, fx, output) {
  if (name === "liquid" && fx.splat) {
    return setInterval(() => {
      fx.splat(
        Math.random(),
        Math.random(),
        (Math.random() - 0.5) * 140,
        (Math.random() - 0.5) * 140,
      );
    }, 700);
  }
  if (name === "frost" && fx.melt) {
    return setInterval(() => fx.melt(Math.random(), Math.random()), 900);
  }
  if (name === "force-field" && fx.impact) {
    return setInterval(() => {
      fx.impact(output.clientWidth * Math.random(), output.clientHeight * Math.random());
    }, 1100);
  }
  if (name === "ascii-sweep" && fx.sweep) {
    let to = 1;
    return setInterval(() => {
      fx.sweep(to);
      to = to === 1 ? 0 : 1;
    }, 3400);
  }
  if (name === "glitch" && fx.burst) fx.burst();
  if (name === "glass" || name === "magnify") {
    const slot = output.parentElement.querySelector(".slot");
    let t = Math.random() * 6;
    const nudge = () => {
      t += 0.18;
      const rect = output.getBoundingClientRect();
      const x = output.clientWidth * (0.5 + Math.sin(t) * 0.28);
      const y = output.clientHeight * (0.5 + Math.cos(t * 0.7) * 0.22);
      slot.dispatchEvent(
        new PointerEvent("pointermove", {
          clientX: rect.left + x,
          clientY: rect.top + y,
          bubbles: true,
        }),
      );
    };
    nudge();
    return setInterval(nudge, 90);
  }
  return 0;
}

function mount(stage) {
  if (stage._fx) return;
  const name = stage.dataset.fx;
  const view = stage.querySelector(".stage-view");
  const output = view.querySelector(".out");
  const source = view.querySelector(".src");
  const content = view.querySelector(".slot");
  let fx = null;
  try {
    const elements = { source, content, output };
    if (name === "glitch") elements.paint = paintCard;
    fx = factories[name](elements, options[name] || {});
  } catch (error) {
    console.warn(name, error);
    return;
  }
  if (!fx) return;
  stage._fx = fx;
  stage.classList.add("is-live");
  stage._timer = drive(name, fx, output);
}

function unmount(stage) {
  if (stage._timer) clearInterval(stage._timer);
  stage._timer = 0;
  if (stage._fx) stage._fx.destroy();
  stage._fx = null;
  stage.classList.remove("is-live");
}

function closeIntro(intro, glitch) {
  if (!intro || intro.dataset.closed === "1") return;
  intro.dataset.closed = "1";
  intro.classList.add("is-gone");
  window.setTimeout(() => {
    glitch?.destroy();
    intro.remove();
  }, 750);
}

async function boot() {
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  await new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });

  const intro = document.getElementById("intro");
  let introFx = null;
  try {
    introFx = createGlitch(
      {
        source: document.getElementById("intro-source"),
        content: document.getElementById("intro-content"),
        output: document.getElementById("intro-output"),
        paint: paintIntro,
      },
      {
        intensity: 0.45,
        interval: 0,
        slices: 8,
        shift: 14,
        rgbShift: 2,
        blocks: 0.16,
        noise: 0.08,
      },
    );
  } catch (error) {
    console.warn("intro", error);
  }
  if (!introFx) document.getElementById("intro-output").remove();
  intro.addEventListener("click", () => closeIntro(intro, introFx));
  window.setTimeout(() => closeIntro(intro, introFx), 1100);

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

  try {
    const field = createAsciify(
      { output: document.getElementById("ascii-field") },
      {
        source: "gradient",
        background: "#07080c",
        colors: ["#14161c", "#3a3f46", "#bced91", "#f4f6f1"],
        characters: " .-+*#",
        fontFamily: '"Roboto Mono", ui-monospace, monospace',
        cellSize: 15,
        radius: 170,
        trail: 1.05,
        flow: 0.6,
        density: 0.5,
        opacity: 0.72,
        veil: 0,
        ambient: 0.12,
        glow: 0.4,
        grain: 0.08,
        click: "burst",
      },
    );
    if (!field) document.getElementById("ascii-field").remove();
  } catch (error) {
    console.warn("asciify", error);
  }

  const stages = document.querySelectorAll(".stage");
  const watcher = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) mount(entry.target);
        else unmount(entry.target);
      }
    },
    { rootMargin: "160px" },
  );
  stages.forEach((stage) => watcher.observe(stage));
}

boot();
