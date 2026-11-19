(() => {
  const canvas = document.querySelector("#trenchCanvas");
  const ctx = canvas.getContext("2d");
  const viewport = document.querySelector(".viewport");
  const timeline = document.querySelector("#timeline");
  const playButton = document.querySelector("#playButton");
  const resetButton = document.querySelector("#resetButton");
  const replayButton = document.querySelector("#replayButton");
  const fireButton = document.querySelector("#fireButton");
  const soundToggle = document.querySelector("#soundToggle");
  const reticle = document.querySelector("#reticle");
  const impactOverlay = document.querySelector("#impactOverlay");
  const chapterButtons = [...document.querySelectorAll(".chapter")];
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const duration = 68;
  const chapters = [
    { start: 0, end: 17, index: "01 / 04", label: "FINAL APPROACH", title: "THE DIVE", speaker: "WEDGE", role: "RED TWO", initials: "W2", quote: "“We’re right above you, Luke.”", hint: "Move your cursor to steer. Keep the port inside the reticle." },
    { start: 17, end: 35, index: "02 / 04", label: "PURSUIT VECTOR", title: "STAY ON TARGET", speaker: "GOLD LEADER", role: "ATTACK WING", initials: "GL", quote: "“Stay on target. We’re almost in range.”", hint: "TIE interceptors are closing fast. Keep the X-wing steady." },
    { start: 35, end: 53.5, index: "03 / 04", label: "FLIGHT SYSTEMS OFFLINE", title: "TRUST THE FORCE", speaker: "OBI-WAN", role: "GUIDANCE LINK", initials: "OW", quote: "“Use the Force, Luke. Let go.”", hint: "Targeting computer offline. Trust the line of sight—not the instruments." },
    { start: 53.5, end: 68, index: "04 / 04", label: "EXHAUST PORT ALIGNED", title: "ONE SHOT", speaker: "LUKE", role: "RED FIVE", initials: "L5", quote: "“I’m on it.”", hint: "The port is aligned. Press F to fire when the target turns green." }
  ];

  let width = 900;
  let height = 660;
  let dpr = 1;
  let time = 0;
  let previous = performance.now();
  let lastDraw = 0;
  let playing = !prefersReducedMotion;
  let chapterIndex = 0;
  let pilotX = 0;
  let pilotY = 0;
  let pointerX = 0;
  let pointerY = 0;
  let firing = false;
  let fireAt = -1;
  let completed = false;
  let soundEnabled = false;
  let audioContext = null;
  let motorOscillator = null;
  let motorGain = null;
  let lastEngineToneAt = 0;

  const stars = Array.from({ length: 88 }, (_, i) => ({
    x: (Math.sin(i * 72.31) + 1) / 2,
    y: (Math.sin(i * 43.91 + 12) + 1) / 2,
    size: i % 13 === 0 ? 1.4 : .6,
    alpha: .12 + (i % 7) * .04
  }));

  const segments = Array.from({ length: 52 }, (_, i) => ({
    z: 100 + i * 140,
    variation: Math.sin(i * 3.14) * 16,
    lights: i % 3
  }));

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, amount) {
    return a + (b - a) * amount;
  }

  function formatTime(value) {
    const seconds = Math.floor(value);
    return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function project(x, y, z) {
    const focal = Math.min(width, height) * .83;
    const cameraBank = pilotX * -13;
    const horizon = height * .34 - pilotY * 30;
    const scale = focal / Math.max(z, 25);
    return {
      x: width / 2 + (x - pilotX * 85) * scale + cameraBank,
      y: horizon + (y - pilotY * 25) * scale,
      s: scale
    };
  }

  function polygon(points, fill, stroke) {
    if (!points.length) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function drawSky(progress) {
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, "#0b1416");
    sky.addColorStop(.4, "#23302d");
    sky.addColorStop(.68, "#252d27");
    sky.addColorStop(1, "#11150f");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    for (const star of stars) {
      ctx.fillStyle = `rgba(210, 224, 211, ${star.alpha})`;
      ctx.fillRect(star.x * width, star.y * height * .45, star.size, star.size);
    }

    const glow = ctx.createRadialGradient(width * .8, height * .18, 0, width * .8, height * .18, width * .4);
    glow.addColorStop(0, "rgba(173, 211, 169, .09)");
    glow.addColorStop(1, "rgba(173, 211, 169, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height * .6);

    const haze = ctx.createLinearGradient(0, height * .2, 0, height * .6);
    haze.addColorStop(0, "rgba(146, 173, 155, 0)");
    haze.addColorStop(.7, "rgba(146, 173, 155, .11)");
    haze.addColorStop(1, "rgba(146, 173, 155, 0)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, height * .2, width, height * .4);
  }

  function getTravel() {
    return time * 425;
  }

  function segmentDepth(z) {
    return ((z - getTravel() - 80) % 7280 + 7280) % 7280 + 90;
  }

  function drawTrench(progress) {
    const floorPoints = [
      project(-355, 160, 7200),
      project(355, 160, 7200),
      project(355, 160, 60),
      project(-355, 160, 60)
    ];
    const floor = ctx.createLinearGradient(0, height * .35, 0, height);
    floor.addColorStop(0, "#252d27");
    floor.addColorStop(1, "#0f130e");
    polygon(floorPoints, floor);

    for (let z = 7300; z > 100; z -= 240) {
      const depth = ((z - getTravel()) % 7280 + 7280) % 7280 + 100;
      const near = depth;
      const far = depth + 240;
      const wobble = Math.sin((depth + getTravel()) * .002) * 14;
      if (near < 30 || near > 7300) continue;

      for (const side of [-1, 1]) {
        const x = side * (350 + wobble);
        const outer = side * (620 + wobble);
        const a = project(x, 160, near);
        const b = project(x, 160, far);
        const c = project(x, -260, far);
        const d = project(x, -260, near);
        polygon([a, b, c, d], side < 0 ? "#29322b" : "#3b453c", "rgba(169, 186, 166, .16)");

        const oa = project(outer, 100, near);
        const ob = project(outer, 100, far);
        const oc = project(outer, -430, far);
        const od = project(outer, -430, near);
        polygon([a, b, ob, oa], "#141b17", "rgba(164, 178, 156, .12)");
        polygon([d, c, oc, od], side < 0 ? "#1b241e" : "#222c25");

        const railA = project(side * 395, 90, near);
        const railB = project(side * 395, 90, far);
        ctx.strokeStyle = "rgba(201, 211, 189, .22)";
        ctx.lineWidth = Math.max(1, railA.s * 8);
        ctx.beginPath();
        ctx.moveTo(railA.x, railA.y);
        ctx.lineTo(railB.x, railB.y);
        ctx.stroke();

        const lightZ = depth + 50;
        const light = project(x - side * 12, -20 + Math.sin(z) * 40, lightZ);
        if (light.y > 0 && light.y < height && Math.abs(light.x - width / 2) < width * .62) {
          const lit = near < 950;
          ctx.fillStyle = lit ? "#ca9c55" : "rgba(190, 161, 100, .55)";
          ctx.fillRect(light.x - 1, light.y, Math.max(1, light.s * 18), Math.max(1, light.s * 4));
        }
      }

      const left = project(-150, 159, near);
      const right = project(150, 159, near);
      ctx.strokeStyle = "rgba(155, 169, 148, .22)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left.x, left.y);
      ctx.lineTo(right.x, right.y);
      ctx.stroke();
    }

    const vanishing = project(0, 160, 7200);
    ctx.strokeStyle = "rgba(207, 220, 200, .14)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(width * .5, height);
    ctx.lineTo(vanishing.x, vanishing.y);
    ctx.stroke();
  }

  function drawTower(x, z, index) {
    const y = -90 + (index % 3) * 35;
    const lower = project(x, 135, z);
    const upper = project(x, y, z);
    const towerWidth = Math.max(1.5, 18 * lower.s);
    const tower = ctx.createLinearGradient(upper.x, upper.y, lower.x, lower.y);
    tower.addColorStop(0, "#697568");
    tower.addColorStop(1, "#222c23");
    ctx.fillStyle = tower;
    ctx.fillRect(upper.x - towerWidth, upper.y, towerWidth * 2, lower.y - upper.y);
    ctx.strokeStyle = "rgba(197, 210, 190, .38)";
    ctx.strokeRect(upper.x - towerWidth, upper.y, towerWidth * 2, lower.y - upper.y);
    const capWidth = towerWidth * 1.7;
    ctx.fillStyle = "#121813";
    ctx.fillRect(upper.x - capWidth, upper.y - Math.max(2, towerWidth * .4), capWidth * 2, Math.max(2, towerWidth * .5));
  }

  function drawTowers(progress) {
    for (let i = 11; i >= 0; i--) {
      const z = ((i * 600 - getTravel()) % 7200 + 7200) % 7200 + 120;
      drawTower(-270, z, i);
      drawTower(275, z + 110, i + 1);
    }
  }

  function drawExhaustPort(progress) {
    if (progress < .06) return;
    const z = lerp(6000, 900, progress);
    const port = project(0, -72, z);
    const radius = clamp(port.s * 52, 3, 45);
    ctx.save();
    ctx.translate(port.x, port.y);
    ctx.fillStyle = "#080d09";
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = progress > .75 ? "#d9ff43" : "#a7b29e";
    ctx.lineWidth = clamp(port.s * 2, 1, 3);
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, radius * .55, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = progress > .75 ? "rgba(217, 255, 67, .65)" : "#c6d3b8";
    ctx.beginPath();
    ctx.arc(0, 0, radius * .2, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * radius * 1.1, Math.sin(a) * radius * 1.1);
      ctx.lineTo(Math.cos(a) * radius * 1.5, Math.sin(a) * radius * 1.5);
      ctx.stroke();
    }
    ctx.restore();
    const horizonPort = clamp(50 - z * .008, 36, 50);
    reticle.style.left = `${clamp((port.x / width) * 100 + pointerX * .18, 22, 78)}%`;
    reticle.style.top = `${clamp((port.y / height) * 100, 27, horizonPort)}%`;
  }

  function drawTie(x, y, z, index) {
    if (z < 80 || z > 4500) return;
    const p = project(x, y, z);
    const size = clamp(p.s * 27, 2, 20);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.fillStyle = "#101511";
    ctx.strokeStyle = "rgba(174, 184, 168, .7)";
    ctx.lineWidth = Math.max(.6, size * .05);
    ctx.beginPath();
    ctx.arc(0, 0, size * .38, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#222c24";
    ctx.beginPath();
    ctx.moveTo(-size * 1.3, -size * .65);
    ctx.lineTo(-size * .8, -size * .6);
    ctx.lineTo(-size * .8, size * .6);
    ctx.lineTo(-size * 1.3, size * .65);
    ctx.closePath();
    ctx.moveTo(size * 1.3, -size * .65);
    ctx.lineTo(size * .8, -size * .6);
    ctx.lineTo(size * .8, size * .6);
    ctx.lineTo(size * 1.3, size * .65);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = index % 2 ? "#9caf9b" : "#e55d43";
    ctx.beginPath();
    ctx.moveTo(-size * .8, 0);
    ctx.lineTo(-size * .2, 0);
    ctx.moveTo(size * .2, 0);
    ctx.lineTo(size * .8, 0);
    ctx.stroke();
    ctx.restore();
  }

  function drawPursuit(progress) {
    if (progress < .2 || progress > .98) return;
    const closing = (progress - .2) / .8;
    const baseZ = lerp(2900, 700, closing);
    drawTie(-175 + Math.sin(time * .8) * 35, -95 + Math.sin(time) * 12, baseZ, 0);
    if (progress > .31) drawTie(145 + Math.sin(time * .7) * 30, -15, baseZ + 440, 1);
  }

  function drawLaserFire(progress) {
    const rate = progress > .25 && progress < .54;
    if (!rate) return;
    const pulse = (time * 2.3) % 1;
    for (const side of [-1, 1]) {
      const start = project(side * 170, 20, lerp(350, 800, pulse));
      const end = project(side * 90, -15, lerp(450, 2600, pulse));
      ctx.strokeStyle = "rgba(255, 84, 51, .9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    }
  }

  function drawXwing() {
    const x = width / 2 + pilotX * 40;
    const y = height * .73 + pilotY * 25;
    const size = clamp(width * .085, 50, 98);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-pilotX * .07);
    ctx.fillStyle = "rgba(0, 0, 0, .4)";
    ctx.beginPath();
    ctx.ellipse(0, size * .5, size * 1.3, size * .18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#a9b2a1";
    polygon([
      { x: 0, y: -size * .45 }, { x: size * .11, y: -size * .15 },
      { x: size * .24, y: size * .15 }, { x: size * .2, y: size * .72 },
      { x: 0, y: size * .3 }, { x: -size * .2, y: size * .72 },
      { x: -size * .24, y: size * .15 }, { x: -size * .11, y: -size * .15 }
    ], "#aeb7a5", "#d3d9ce");

    for (const side of [-1, 1]) {
      polygon([
        { x: side * size * .15, y: size * .02 }, { x: side * size * 1.08, y: -size * .13 },
        { x: side * size * 1.15, y: size * .03 }, { x: side * size * .2, y: size * .33 }
      ], "#8d9788", "#ccd4c7");
      polygon([
        { x: side * size * .15, y: size * .11 }, { x: side * size * 1.08, y: size * .41 },
        { x: side * size * 1.14, y: size * .52 }, { x: side * size * .2, y: size * .34 }
      ], "#747f6f", "#b1bdac");
      ctx.fillStyle = "#303a30";
      ctx.fillRect(side * size * .83 - 2, size * .06, 7, size * .28);
      ctx.fillStyle = "#ff6945";
      ctx.fillRect(side * size * .65 - 1, size * .1, 3, size * .16);
      const glow = ctx.createRadialGradient(side * size * .86, size * .37, 0, side * size * .86, size * .37, size * .28);
      glow.addColorStop(0, "rgba(255, 174, 99, .9)");
      glow.addColorStop(.3, "rgba(255, 103, 70, .45)");
      glow.addColorStop(1, "rgba(255, 80, 40, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(side * size * .86, size * .37, size * .28, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#19241b";
    ctx.fillRect(-size * .1, -size * .4, size * .2, size * .29);
    ctx.strokeStyle = "#d8ded2";
    ctx.strokeRect(-size * .1, -size * .4, size * .2, size * .29);
    ctx.fillStyle = "#d9ff43";
    ctx.font = `600 ${Math.max(6, size * .08)}px monospace`;
    ctx.textAlign = "center";
    ctx.fillText("RED 5", 0, size * .48);
    ctx.restore();
  }

  function drawTorpedoes(progress) {
    if (fireAt < 0) return;
    const age = time - fireAt;
    if (age < 0 || age > 4.4) return;
    const t = clamp(age / 3, 0, 1);
    for (const side of [-1, 1]) {
      const p = lerp(t, 1, t);
      const z = lerp(180, 6400 * (1 - t), p);
      const point = project(side * lerp(85, 0, t), lerp(125, -72, t), Math.max(100, z));
      const radius = Math.max(1.5, point.s * 6);
      ctx.fillStyle = "#efffd2";
      ctx.shadowBlur = 20;
      ctx.shadowColor = "#d9ff43";
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  function drawImpact(progress) {
    if (fireAt < 0) return;
    const age = time - fireAt;
    if (age < 3 || age > 7) return;
    const p = clamp((age - 3) / 3, 0, 1);
    const center = project(0, -72, 950);
    const radius = Math.pow(p, .65) * Math.max(width, height) * .9;
    const glow = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius);
    glow.addColorStop(0, `rgba(255, 255, 224, ${1 - p * .3})`);
    glow.addColorStop(.12, `rgba(242, 255, 173, ${.95 - p * .4})`);
    glow.addColorStop(.35, `rgba(255, 101, 45, ${.7 - p * .65})`);
    glow.addColorStop(.8, "rgba(230, 54, 18, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
  }

  function draw(progress) {
    pilotX = lerp(pilotX, pointerX, .035);
    pilotY = lerp(pilotY, pointerY, .035);
    drawSky(progress);
    drawTrench(progress);
    drawTowers(progress);
    drawExhaustPort(progress);
    drawLaserFire(progress);
    drawPursuit(progress);
    drawXwing();
    drawTorpedoes(progress);
    drawImpact(progress);
  }

  function setChapter(index) {
    if (index === chapterIndex) return;
    chapterIndex = index;
    const data = chapters[index];
    document.querySelector("#phaseIndex").textContent = data.index;
    document.querySelector("#phaseEyebrow").textContent = data.label;
    document.querySelector("#phaseTitle").textContent = data.title;
    document.querySelector("#speaker").textContent = data.speaker;
    document.querySelector("#speakerRole").textContent = data.role;
    document.querySelector("#speakerAvatar").textContent = data.initials;
    document.querySelector("#commsQuote").textContent = data.quote;
    document.querySelector("#controlHint").textContent = data.hint;
    chapterButtons.forEach((button, i) => {
      button.classList.toggle("active", i === index);
      button.setAttribute("aria-current", i === index ? "step" : "false");
    });
    document.body.classList.toggle("force-mode", index === 2);
    if (index === 2) {
      tone(220, .18, "sine", .035);
      setTimeout(() => tone(330, .28, "sine", .025), 120);
    }
  }

  function updateUI() {
    const progress = clamp(time / duration, 0, 1);
    const currentChapter = Math.max(0, chapters.findIndex((chapter, index) => time >= chapter.start && (index === chapters.length - 1 || time < chapter.end)));
    setChapter(currentChapter);

    timeline.value = time;
    timeline.style.setProperty("--progress", `${progress * 100}%`);
    document.querySelector("#progressLabel").textContent = `${formatTime(time)} / 01:08`;
    document.querySelector("#missionClock").textContent = `T + ${formatTime(time)}.${String(Math.floor((time % 1) * 100)).padStart(2, "0")}`;
    document.querySelector("#targetRange").textContent = `${Math.max(.03, 1.8 * (1 - progress) ** 1.25).toFixed(2)} KM`;
    document.querySelector("#velocity").innerHTML = `${Math.round(927 + Math.sin(time * .7) * 24 + progress * 62)} <small>KT</small>`;
    document.querySelector("#shield").innerHTML = `${Math.round(84 - progress * 20)}<small>%</small>`;
    document.querySelector("#hullStatus").textContent = `${Math.round(93 - progress * 18)}%`;
    document.querySelector("#targetStatus").textContent = currentChapter >= 2 ? "FORCE" : "MANUAL";
    document.querySelector("#laserStatus").textContent = progress > .72 ? "LOCK" : "ARMED";

    const canFire = progress >= .76 && !completed;
    fireButton.disabled = !canFire;
    fireButton.querySelector("span").textContent = fireAt >= 0 ? "TORPEDOES AWAY" : canFire ? "FIRE PROTON TORPEDOES" : "TARGET LOCK PENDING";
    document.body.classList.toggle("danger-mode", currentChapter === 1);

    playButton.classList.toggle("paused", !playing);
    playButton.setAttribute("aria-label", playing ? "Pause mission" : "Play mission");
    reticle.style.opacity = currentChapter === 2 ? ".28" : ".85";
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (now - lastDraw < 1000 / 20) return;
    lastDraw = now;
    const delta = Math.min((now - previous) / 1000, .05);
    previous = now;
    if (playing && !completed) {
      time = Math.min(duration, time + delta);
      if (time >= duration) {
        playing = false;
      }
    }
    draw(clamp(time / duration, 0, 1));
    updateUI();
    updateEngine();
  }

  function seek(value) {
    time = clamp(value, 0, duration);
    completed = false;
    firing = false;
    fireAt = -1;
    impactOverlay.hidden = true;
    chapterIndex = -1;
    viewport.classList.remove("impact-flash");
    updateUI();
  }

  function togglePlay() {
    if (completed) seek(0);
    if (time >= duration) seek(0);
    playing = !playing;
    updateUI();
  }

  function ensureAudio() {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      motorOscillator = audioContext.createOscillator();
      motorGain = audioContext.createGain();
      motorOscillator.type = "sawtooth";
      motorOscillator.frequency.value = 55;
      motorGain.gain.value = 0;
      motorOscillator.connect(motorGain).connect(audioContext.destination);
      motorOscillator.start();
    }
    if (audioContext.state === "suspended") audioContext.resume();
  }

  function tone(frequency, length, type = "sine", volume = .04) {
    if (!soundEnabled) return;
    ensureAudio();
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const now = audioContext.currentTime;
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(.0001, now + length);
    osc.connect(gain).connect(audioContext.destination);
    osc.start(now);
    osc.stop(now + length);
  }

  function updateEngine() {
    if (!motorGain || !motorOscillator || !soundEnabled) return;
    const intensity = playing ? 1 : 0;
    const now = audioContext.currentTime;
    motorGain.gain.setTargetAtTime(.013 * intensity, now, .15);
    motorOscillator.frequency.setTargetAtTime(48 + Math.abs(pilotX) * 10 + Math.sin(time) * 4, now, .12);
  }

  function fire() {
    if (time < duration * .76 || completed || fireAt >= 0) return;
    firing = true;
    fireAt = time;
    document.querySelector("#laserStatus").textContent = "FIRING";
    document.querySelector("#controlHint").textContent = "The proton torpedoes are inbound. Hold your line.";
    tone(130, .9, "sawtooth", .05);
    tone(760, .6, "sine", .05);
    setTimeout(() => {
      if (fireAt < 0 || completed) return;
      playing = true;
      completed = true;
      playing = false;
      time = duration;
      impactOverlay.hidden = false;
      viewport.classList.add("impact-flash");
      tone(40, 2, "sawtooth", .08);
      setTimeout(() => tone(75, 1.5, "sine", .05), 180);
      updateUI();
    }, 3100);
  }

  function steer(clientX, clientY) {
    const rect = viewport.getBoundingClientRect();
    pointerX = clamp(((clientX - rect.left) / rect.width - .5) * 2, -.9, .9);
    pointerY = clamp(((clientY - rect.top) / rect.height - .5) * 2, -.65, .65);
  }

  viewport.addEventListener("pointermove", event => steer(event.clientX, event.clientY));
  viewport.addEventListener("pointerleave", () => {
    pointerX = 0;
    pointerY = 0;
  });
  viewport.addEventListener("click", event => {
    steer(event.clientX, event.clientY);
    if (time > duration * .76) fire();
  });
  timeline.addEventListener("input", () => seek(Number(timeline.value)));
  playButton.addEventListener("click", togglePlay);
  resetButton.addEventListener("click", () => seek(0));
  replayButton.addEventListener("click", () => {
    seek(0);
    playing = true;
  });
  fireButton.addEventListener("click", fire);
  soundToggle.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    soundToggle.setAttribute("aria-pressed", String(soundEnabled));
    soundToggle.setAttribute("aria-label", soundEnabled ? "Turn sound off" : "Turn sound on");
    if (soundEnabled) {
      ensureAudio();
      tone(440, .08, "sine", .025);
    } else if (motorGain && audioContext) {
      motorGain.gain.setTargetAtTime(0, audioContext.currentTime, .08);
    }
  });
  chapterButtons.forEach((button, index) => {
    button.addEventListener("click", () => {
      seek(chapters[index].start + .1);
      playing = true;
      tone(index === 2 ? 330 : 220, .12);
    });
  });
  document.addEventListener("keydown", event => {
    const actionKey = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " ", "f", "F"].includes(event.key);
    if (!actionKey) return;
    if (event.target.matches("input, button")) return;
    event.preventDefault();
    if (event.key === "ArrowLeft") pointerX = Math.max(-1, pointerX - .35);
    if (event.key === "ArrowRight") pointerX = Math.min(1, pointerX + .35);
    if (event.key === "ArrowUp") pointerY = Math.max(-1, pointerY - .35);
    if (event.key === "ArrowDown") pointerY = Math.min(1, pointerY + .35);
    if (event.key === " ") togglePlay();
    if (event.key.toLowerCase() === "f") fire();
  });

  window.addEventListener("resize", resize);
  resize();
  draw(0);
  updateUI();
  requestAnimationFrame(frame);
})();
