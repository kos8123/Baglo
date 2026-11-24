export type Language = "zh-TW" | "en" | "zh-CN" | "ja" | "ko";
export const LANGUAGES: { code: Language; label: string; short: string; html: string }[] = [
  { code: "zh-TW", label: "繁體中文", short: "繁中", html: "zh-Hant-TW" },
  { code: "en", label: "English", short: "EN", html: "en" },
  { code: "zh-CN", label: "简体中文", short: "简中", html: "zh-Hans-CN" },
  { code: "ja", label: "日本語", short: "日本語", html: "ja" },
  { code: "ko", label: "한국어", short: "한국어", html: "ko" },
];
const codes = new Set<string>(LANGUAGES.map((item) => item.code));
export function readLanguage(): Language {
  try {
    const saved = localStorage.getItem("baglo_language") || "";
    return codes.has(saved) ? (saved as Language) : "zh-TW";
  } catch {
    return "zh-TW";
  }
}
export function htmlLang(language: Language) {
  return LANGUAGES.find((item) => item.code === language)?.html || "zh-Hant-TW";
}
// Source strings are Traditional Chinese; each column overrides them for one language.
// Columns: en, zh-CN, ja, ko.
const table: Record<string, [string, string, string, string]> = {
  "交易工作台": ["Trading desk", "交易工作台", "取引デスク", "트레이딩 데스크"],
  "我的自選股": ["My watchlist", "我的自选股", "ウォッチリスト", "관심 종목"],
  "個股研究": ["Stock research", "个股研究", "銘柄リサーチ", "종목 리서치"],
  "我的持倉": ["My portfolio", "我的持仓", "保有銘柄", "보유 종목"],
  "委託紀錄": ["Order history", "委托记录", "注文履歴", "주문 내역"],
  "AI 自動交易": ["AI paper trading", "AI 自动交易", "AI 自動売買", "AI 자동매매"],
  "交易終端": ["Trading terminal", "交易终端", "取引ターミナル", "트레이딩 터미널"],
  "載入中": ["Loading", "加载中", "読み込み中", "불러오는 중"],
  "登入／建立帳戶": ["Sign in / Register", "登录／注册", "ログイン／登録", "로그인 / 가입"],
  "加入自選": ["Add to watchlist", "加入自选", "ウォッチに追加", "관심 종목 추가"],
  "移除自選": ["Remove from watchlist", "移除自选", "ウォッチから削除", "관심 종목 삭제"],
  "管理自選股": ["Manage watchlist", "管理自选股", "ウォッチリスト管理", "관심 종목 관리"],
  "更新參考價": ["Refresh price", "更新参考价", "参考価格を更新", "참고 가격 새로고침"],
  "更新中…": ["Updating…", "更新中…", "更新中…", "업데이트 중…"],
  "日 K": ["Daily", "日 K", "日足", "일봉"],
  "週 K": ["Weekly", "周 K", "週足", "주봉"],
  "月 K": ["Monthly", "月 K", "月足", "월봉"],
  "張": ["lots", "张", "単元", "로트"],
  "開": ["O", "开", "始", "시"],
  "高": ["H", "高", "高", "고"],
  "低": ["L", "低", "安", "저"],
  "收": ["C", "收", "終", "종"],
  "量": ["Vol", "量", "出来高", "거래량"],
  "未還原價格 · 紅漲綠跌": ["Unadjusted · red up / green down", "未复权价格 · 红涨绿跌", "未調整価格・赤は上昇／緑は下落", "수정 전 가격 · 빨강 상승 / 초록 하락"],
};
const column: Partial<Record<Language, number>> = { en: 0, "zh-CN": 1, ja: 2, ko: 3 };
export function tr(text: string, language = readLanguage()) {
  const index = column[language];
  return index === undefined ? text : table[text]?.[index] || text;
}
