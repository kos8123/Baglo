document.documentElement.classList.add("js");
document.addEventListener("DOMContentLoaded", () => {
  const english = {
    navFlow: "How it works", navTrust: "Data & privacy", enter: "Enter platform",
    eyebrow: "Baglo · Taiwan stock AI paper trading",
    headline: 'Less impulse.<br>More <em>evidence.</em>',
    lead: "Let AI plan the strategy, test it with backtests, then execute with paper trades.",
    more: "Why Baglo", note: "Browse charts without signing in · Paper trading only, no real money",
    sample: "Illustration", virtual: "Virtual balance",
    ideaLabel: "Why Baglo", p1: "Hesitating at a stop-loss", p2: "Chasing a rally", p3: "Emotions cloud judgment",
    statement: "So let AI plan the strategy,<br><em>and let rules execute.</em>",
    flowLabel: "How it works", flowTitle: "From data to trade, one step at a time.",
    s1t: "Market data", s1: "Taiwan stock charts, fundamentals and flows",
    s2t: "AI picks & strategy", s2: "Gemini proposes candidates and strategies",
    s3t: "Backtest & risk", s3: "Validated on history, or no order",
    s4t: "Paper orders", s4: "Board and odd lots, virtual cash only",
    s5t: "Review & adjust", s5: "Every decision is recorded",
    roadLabel: "Direction", roadTitle: "The goal: fully automated trading.",
    r1t: "Now", r1: "Paper validation", r2t: "Next", r2: "Close the automated loop", r3t: "Goal", r3: "Fully automated trading",
    trustLabel: "Data & privacy", trustTitle: "Clear boundaries.",
    t1t: "Paper trading only", t1: "All cash, positions and orders are virtual. No brokerage connection, no deposits.",
    t2t: "Google sign-in only identifies you", t2: "We request only openid, email and profile. No Gmail or Drive access; never sold or used for ads.",
    t3t: "AI reads public market data only", t3: "Gemini writes text analysis only. Account data is never sent to the model or used for training.",
    readPrivacy: "Read the Privacy Policy",
    closing: "Test your next idea with a strategy.",
    disclaimer: "For education and simulated practice only. Not investment advice.",
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
    toggle.textContent = en ? "繁中" : "EN";
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
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("visible");
      observer.unobserve(entry.target);
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
