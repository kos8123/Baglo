(() => {
  const english = {
    enter: "Enter platform ↗", eyebrow: "Trading, guided by a strategy.",
    headline: 'Less emotion.<br>More <span class="accent">strategy.</span>',
    intro: "Let AI plan. Let backtests verify.<br>Step by step toward fully automated trading.",
    ideaLink: "Our idea ↓", guest: "Browse as a guest. Sign in to save your paper account.",
    paper: "Paper trading", illustration: "Markets move. Keep your discipline.",
    ideaLabel: "Our idea", ideaTitle: "Let code help you<br>follow the plan.",
    ideaBody: "Emotions can derail a trading plan.<br>Baglo started with this frustration, bringing AI, data, and rules into the decision.",
    flowTitle: "A reason behind every step.", flowCaption: "Paper validation today. Full automation is the goal.",
    step1: "AI selection", step2: "Backtesting", step3: "Risk checks", step4: "Paper trades",
    startLabel: "Start with your next idea", closing: "Validate. Then move forward.",
    dataTitle: "Sign-in and data use",
    google: "Google sign-in is optional; email registration is available. We request only openid, email, and profile to identify and sign in to your account. We do not access Gmail or Drive, sell this data, or use it for advertising.",
    ai: "AI uses public market data for text research. Google account identifiers are not sent to the model or used for training. Watchlists, virtual positions, and orders are stored in your paper account. No broker connection or deposits are provided.",
    privacyMore: "Full Privacy Policy ↗", privacy: "Privacy Policy", terms: "Terms of Service", contact: "Contact",
    disclaimer: "Simulated trading only. No broker connection. No guarantee of profit.", opening: "Opening the platform…"
  };
  const nodes = [...document.querySelectorAll("[data-i18n]")];
  const chinese = new Map(nodes.map(node => [node, node.innerHTML]));
  let lang = "zh-TW";
  try { lang = localStorage.getItem("baglo_language") || lang; } catch {}
  const apply = () => {
    document.documentElement.lang = lang === "en" ? "en" : "zh-Hant-TW";
    nodes.forEach(node => { node.innerHTML = lang === "en" ? english[node.dataset.i18n] || chinese.get(node) : chinese.get(node); });
    document.querySelector("#language").textContent = lang === "en" ? "繁中" : "EN";
    document.title = lang === "en" ? "Baglo — Taiwan Stock Paper Trading" : "Baglo — 台股模擬交易";
  };
  apply();
  document.querySelector("#language").addEventListener("click", () => { lang = lang === "en" ? "zh-TW" : "en"; try { localStorage.setItem("baglo_language", lang); } catch {} apply(); });
  let entering = false;
  document.querySelectorAll("[data-enter]").forEach(link => link.addEventListener("click", event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); if (entering) return; entering = true;
    document.querySelector("#entry-transition").hidden = false;
    setTimeout(() => location.assign(link.href), matchMedia("(prefers-reduced-motion: reduce)").matches ? 150 : 2400);
  }));
  addEventListener("pageshow", () => { entering = false; document.querySelector("#entry-transition").hidden = true; });
})();
