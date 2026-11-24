document.documentElement.classList.add("js");
document.addEventListener("DOMContentLoaded", () => {
  // Traditional Chinese is the page's own markup; other languages override by key.
  const languages = [
    { code: "zh-TW", label: "繁體中文", short: "繁中", html: "zh-Hant-TW", title: "Baglo — 台股 AI 模擬交易" },
    { code: "en", label: "English", short: "EN", html: "en", title: "Baglo — Taiwan Stock AI Paper Trading" },
    { code: "zh-CN", label: "简体中文", short: "简中", html: "zh-Hans-CN", title: "Baglo — 台股 AI 模拟交易" },
    { code: "ja", label: "日本語", short: "日本語", html: "ja", title: "Baglo — 台湾株 AI ペーパートレード" },
    { code: "ko", label: "한국어", short: "한국어", html: "ko", title: "Baglo — 대만 주식 AI 모의투자" },
  ];
  const text = {
    en: {
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
      readPrivacy: "Read the Privacy Policy", closing: "Test your next idea with a strategy.",
      privacy: "Privacy Policy", terms: "Terms of Service", apiDocs: "API docs", contact: "Contact", opening: "Opening the platform…"
    },
    "zh-CN": {
      navFlow: "运作流程", navTrust: "数据与隐私", enter: "进入平台",
      headline: "少一点冲动，<br>多一点<em>依据。</em>",
      lead: "让 AI 规划策略、用回测检验，再用模拟交易执行。不用登录，就能先看盘。",
      more: "为什么做 Baglo", tsmc: "台积电", virtual: "模拟本金",
      ideaTitle: "交易时，你也有这些时刻吗？",
      p1: "止损时犹豫", p2: "追高时心急", p3: "情绪左右判断",
      statement: "所以，让 AI 规划策略，<br><em>让规则来执行。</em>",
      flowTitle: "从数据到交易，一步接一步。",
      s1t: "市场数据", s2t: "AI 选股与策略", s3t: "回测与风控", s4t: "模拟委托", s5t: "回顾调整",
      roadTitle: "目标是全自动交易。",
      r1: "模拟验证", r2: "自动下单、自动止损止盈", r3: "全自动交易",
      trustTitle: "清楚的界线。",
      t1t: "纯模拟交易", t1: "资金、持仓和委托都是虚拟的，不连接券商，也不收任何钱。",
      t2t: "Google 登录只用来识别你", t2: "只用 openid、email、profile，不读取 Gmail 或云端硬盘，也不拿去卖或打广告。",
      t3t: "AI 只看公开行情", t3: "Gemini 只写文字分析。你的账户数据不会交给 AI，也不会拿去训练。",
      readPrivacy: "阅读隐私政策", closing: "用策略，验证你的下一个想法。",
      privacy: "隐私政策", terms: "服务条款", apiDocs: "API 文档", contact: "联系我们", opening: "正在进入平台…"
    },
    ja: {
      navFlow: "仕組み", navTrust: "データとプライバシー", enter: "プラットフォームへ",
      headline: "衝動は少なく、<br><em>根拠</em>を多く。",
      lead: "AI が戦略を立て、バックテストで検証し、ペーパートレードで実行します。ログインなしでチャートを見られます。",
      more: "Baglo をつくった理由", tsmc: "TSMC", virtual: "仮想資金",
      ideaTitle: "取引中、こんな瞬間はありませんか？",
      p1: "損切りでためらう", p2: "高値を追ってしまう", p3: "感情で判断がぶれる",
      statement: "だから、戦略は AI に、<br><em>実行はルールに。</em>",
      flowTitle: "データから取引まで、一歩ずつ。",
      s1t: "市場データ", s2t: "AI の銘柄選択と戦略", s3t: "バックテストとリスク管理", s4t: "仮想注文", s5t: "振り返りと調整",
      roadTitle: "目標は完全自動売買。",
      r1: "ペーパーで検証", r2: "自動発注と自動損切り", r3: "完全自動売買",
      trustTitle: "はっきりした線引き。",
      t1t: "ペーパートレードのみ", t1: "資金・保有・注文はすべて仮想です。証券会社には接続せず、お金も一切受け取りません。",
      t2t: "Google ログインは本人確認のみ", t2: "openid・email・profile だけを使います。Gmail やドライブは読まず、販売や広告にも使いません。",
      t3t: "AI は公開の相場データだけを見る", t3: "Gemini はテキスト分析のみを行います。アカウント情報を AI に渡したり、学習に使ったりしません。",
      readPrivacy: "プライバシーポリシーを読む", closing: "次のアイデアを、戦略で確かめよう。",
      privacy: "プライバシーポリシー", terms: "利用規約", apiDocs: "API ドキュメント", contact: "お問い合わせ", opening: "プラットフォームを開いています…"
    },
    ko: {
      navFlow: "작동 방식", navTrust: "데이터와 개인정보", enter: "플랫폼 입장",
      headline: "충동은 줄이고,<br><em>근거</em>는 늘리고.",
      lead: "AI가 전략을 세우고, 백테스트로 검증한 뒤, 모의투자로 실행합니다. 로그인 없이도 차트를 볼 수 있습니다.",
      more: "Baglo를 만든 이유", tsmc: "TSMC", virtual: "모의 자금",
      ideaTitle: "매매할 때 이런 순간이 있나요?",
      p1: "손절 앞에서 망설임", p2: "급등주를 쫓아감", p3: "감정에 흔들리는 판단",
      statement: "그래서 전략은 AI에게,<br><em>실행은 규칙에게.</em>",
      flowTitle: "데이터부터 매매까지, 한 단계씩.",
      s1t: "시장 데이터", s2t: "AI 종목 선정과 전략", s3t: "백테스트와 리스크 관리", s4t: "모의 주문", s5t: "복기와 조정",
      roadTitle: "목표는 완전 자동매매입니다.",
      r1: "모의투자로 검증", r2: "자동 주문과 자동 손절", r3: "완전 자동매매",
      trustTitle: "분명한 경계.",
      t1t: "모의투자 전용", t1: "자금, 보유 종목, 주문은 모두 가상입니다. 증권사와 연결하지 않으며 돈을 받지 않습니다.",
      t2t: "Google 로그인은 본인 확인용", t2: "openid, email, profile만 사용합니다. Gmail이나 드라이브를 읽지 않고, 판매하거나 광고에 쓰지 않습니다.",
      t3t: "AI는 공개 시세만 봅니다", t3: "Gemini는 텍스트 분석만 작성합니다. 계정 정보는 AI에 전달되거나 학습에 쓰이지 않습니다.",
      readPrivacy: "개인정보처리방침 읽기", closing: "다음 아이디어를 전략으로 검증해 보세요.",
      privacy: "개인정보처리방침", terms: "서비스 약관", apiDocs: "API 문서", contact: "문의하기", opening: "플랫폼을 여는 중…"
    },
  };
  const nodes = [...document.querySelectorAll("[data-i18n]")];
  const original = new Map(nodes.map(node => [node, node.innerHTML]));
  const toggle = document.querySelector("#language");
  const menu = document.querySelector("#language-menu");
  const current = document.querySelector("#language-current");
  const find = code => languages.find(item => item.code === code) || languages[0];
  let lang = "zh-TW";
  try { lang = find(localStorage.getItem("baglo_language")).code; } catch {}
  menu.innerHTML = languages.map(item => `<li role="none"><button type="button" role="menuitemradio" data-lang="${item.code}" lang="${item.html}">${item.label}</button></li>`).join("");
  const options = [...menu.querySelectorAll("button")];
  const apply = () => {
    const info = find(lang), dict = text[lang] || {};
    document.documentElement.lang = info.html;
    nodes.forEach(node => { node.innerHTML = dict[node.dataset.i18n] || original.get(node); });
    current.textContent = info.short;
    options.forEach(option => option.setAttribute("aria-checked", String(option.dataset.lang === lang)));
    document.title = info.title;
  };
  const close = (focus) => { menu.hidden = true; toggle.setAttribute("aria-expanded", "false"); if (focus) toggle.focus(); };
  const open = () => { menu.hidden = false; toggle.setAttribute("aria-expanded", "true"); (options.find(o => o.dataset.lang === lang) || options[0]).focus(); };
  apply();
  toggle.addEventListener("click", () => (menu.hidden ? open() : close(false)));
  menu.addEventListener("click", event => {
    const option = event.target.closest("[data-lang]");
    if (!option) return;
    lang = option.dataset.lang;
    try { localStorage.setItem("baglo_language", lang); } catch {}
    apply();
    close(true);
  });
  menu.addEventListener("keydown", event => {
    const index = options.indexOf(document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      options[(index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length].focus();
    }
  });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !menu.hidden) close(true); });
  document.addEventListener("click", event => { if (!menu.hidden && !event.target.closest(".lang-menu")) close(false); });

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
