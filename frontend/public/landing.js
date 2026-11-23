document.documentElement.classList.add("js");
document.addEventListener("DOMContentLoaded", () => {
  const english = {
    navFlow: "How it works", navTrust: "Data & privacy", enter: "Enter platform",
    headline: 'Less impulse.<br>More <em>evidence.</em>',
    lead: "Let AI plan the strategy, test it with backtests, then execute with paper trades. No sign-in needed to browse charts.",
    more: "Why Baglo", tsmc: "TSMC", virtual: "Paper balance",
    ideaTitle: "Ever had these moments while trading?",
    p1: "Hesitating at a stop-loss", p2: "Chasing a rally", p3: "Emotions cloud judgment",
    statement: "So let AI plan the strategy,<br><em>and let rules execute.</em>",
    flowTitle: "From data to trade, one step at a time.",
    s1t: "Market data", s2t: "AI picks & strategy", s3t: "Backtest & risk", s4t: "Paper orders", s5t: "Review & adjust",
    roadTitle: "The goal: fully automated trading.",
    r1: "Paper validation", r2: "Automatic orders and stop-loss", r3: "Fully automated trading",
    trustTitle: "Clear boundaries.",
    t1t: "Paper trading only", t1: "Cash, positions and orders are all virtual. No brokerage, and we never take your money.",
    t2t: "Google sign-in only recognizes you", t2: "We use only openid, email and profile. We never read Gmail or Drive, sell your data or use it for ads.",
    t3t: "AI only reads public market data", t3: "Gemini writes text analysis only. Your account data never goes to the AI or into training.",
    readPrivacy: "Read the Privacy Policy",
    closing: "Test your next idea with a strategy.",
    privacy: "Privacy Policy", terms: "Terms of Service", contact: "Contact", opening: "Opening the platform…"
  };
  const nodes = [...document.querySelectorAll("[data-i18n]")];
  const chinese = new Map(nodes.map(node => [node, node.innerHTML]));
  const toggle = document.querySelector("#language");
  let lang = "zh-TW";
  try { lang = localStorage.getItem("baglo_language") || lang; } catch {}
  const apply = () => {
    const en = lang === "en";
    document.documentElement.lang = en ? "en" : "zh-Hant-TW";
    nodes.forEach(node => { node.innerHTML = en ? english[node.dataset.i18n] || chinese.get(node) : chinese.get(node); });
    toggle.setAttribute("aria-checked", String(en));
    document.title = en ? "Baglo — Taiwan Stock AI Paper Trading" : "Baglo — 台股 AI 模擬交易";
  };
  apply();
  toggle.addEventListener("click", () => {
    lang = lang === "en" ? "zh-TW" : "en";
    try { localStorage.setItem("baglo_language", lang); } catch {}
    apply();
  });

  requestAnimationFrame(() => document.querySelectorAll(".hero .reveal").forEach(item => item.classList.add("visible")));
  const items = document.querySelectorAll(".reveal:not(.hero .reveal)");
  if ("IntersectionObserver" in window) {
    // Replay each time a block enters from below; reset only once it has left through the bottom,
    // so scrolling back up never hides blocks the reader has already passed.
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) entry.target.classList.add("visible");
      else if (entry.boundingClientRect.top > 0) entry.target.classList.remove("visible");
    }), { threshold: 0.15, rootMargin: "0px 0px -8% 0px" });
    items.forEach(item => observer.observe(item));
  } else {
    items.forEach(item => item.classList.add("visible"));
  }

  const overlay = document.querySelector("#entry-transition");
  let entering = false;
  document.querySelectorAll("[data-enter]").forEach(link => link.addEventListener("click", event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (entering) return;
    entering = true;
    overlay.hidden = false;
    setTimeout(() => location.assign(link.href), matchMedia("(prefers-reduced-motion: reduce)").matches ? 150 : 2400);
  }));
  addEventListener("pageshow", () => { entering = false; overlay.hidden = true; });
});
