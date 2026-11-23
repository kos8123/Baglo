(() => {
  const english = {
    features: "Features", privacyNav: "Data & privacy", enter: "Enter platform ↗", eyebrow: "A workspace for curious investors",
    headline: "Study the market.<br>Practice your judgment.", intro: "Follow Taiwan stocks, keep a watchlist, and explore AI research. Test your ideas with paper trading and build a process of your own.",
    start: "Enter platform ↗", explore: "Explore the features ↓", guest: "Browse market data without signing in. Sign in to save your watchlist and paper portfolio.", sample: "Illustration · not live data", observe: "Observe. Understand. Then act.", virtual: "Starting virtual balance", paper: "Paper trading only",
    featureTitle: "From an idea to a trading exercise.", f1title: "See the market clearly", f1: "Search Taiwan stocks by code or name. Explore daily, weekly, and monthly candlesticks and save stocks to your watchlist.", f2title: "Ask one more question with AI", f2: "Review technical, fundamental, and institutional data. Examine strategy reasoning and risks, then test with historical backtests.", f3title: "Build experience through practice", f3: "Place simulated board-lot and odd-lot orders. Review your virtual cash, positions, and order history.",
    trustTitle: "Your account. Clear boundaries.", trustIntro: "Baglo is a Taiwan stock research and paper-trading app. All balances, positions, and orders are virtual. No brokerage connection or deposits.", googleTitle: "Google sign-in and your data", google: "Google sign-in is optional; email registration is also available. We request only openid, email, and profile to identify and sign in to your account. We do not access Gmail or Drive, sell this data, or use it for advertising.", aiTitle: "AI research uses public market data", ai: "Gemini generates text-based stock research. Google account identifiers are not sent to the model or used to train AI. Market data may be delayed. AI analysis and backtests do not guarantee profits.", readPrivacy: "Read our Privacy Policy ↗", closing: "Your next idea starts here.", privacy: "Privacy Policy", terms: "Terms of Service", contact: "Contact", disclaimer: "For education, research, and simulated practice. Not investment advice.", opening: "Opening the platform…"
  };
  Object.assign(english, {
    eyebrow: "From emotional decisions to testable strategies",
    headline: 'Less impulse.<br>More <span class="accent">evidence.</span>',
    intro: "Hesitating at a stop-loss. Rushing into a rally. Baglo explores another approach: let AI propose a strategy, test it against history, and practice execution with paper trades.",
    explore: "Why I built Baglo ↓",
    originLabel: "01 / The idea behind Baglo",
    originTitle: "When emotions affect judgment,<br>keep a record of the reasoning.",
    originBody: "Baglo began with a personal trading frustration: a stop-loss or profit target can be easy to plan and hard to follow. Could AI help propose strategies, while code checks the rules and simulates execution?",
    originBody2: "This is an ongoing experiment. AI proposes ideas, historical data tests them, and risk controls decide whether a paper order can be created. Results and reasoning stay on record to inform the next adjustment.",
    featureTitle: "From observation to decisions you can review.",
    f1title: "Research first. Build your watchlist.",
    f1: "Explore daily, weekly, and monthly Taiwan stock charts. Track your watchlist and data dates, then review blind spots in your list and holdings.",
    f2title: "AI proposes. Backtests challenge.",
    f2: "Use technical, fundamental, and institutional data to develop strategies. Examine historical performance and trading costs, and keep uncertainty visible when data is incomplete.",
    f3title: "Simulate by rules. Keep the record.",
    f3: "Paper orders require data, confidence, and risk checks. Practice board-lot and odd-lot trading manually or with scheduled workflows, then review the results.",
    step1: "Market data", step2: "AI strategy", step3: "Backtest & risk checks", step4: "Paper orders", step5: "Review & adjust",
    closingLabel: "Every decision deserves another question",
    closing: "Put your next idea to the test."
  });
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
