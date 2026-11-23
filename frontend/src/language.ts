export type Language = "zh-TW" | "en";
export function readLanguage(): Language {
  try { return localStorage.getItem("baglo_language") === "en" ? "en" : "zh-TW"; } catch { return "zh-TW"; }
}
const labels: Record<string, string> = {
  "交易工作台": "Trading desk", "我的自選股": "My watchlist", "個股研究": "Stock research",
  "我的持倉": "My portfolio", "委託紀錄": "Order history", "AI 自動交易": "AI paper trading",
  "交易終端": "Trading terminal", "載入中": "Loading", "登入／建立帳戶": "Sign in / Register",
  "加入自選": "Add to watchlist", "移除自選": "Remove from watchlist", "管理自選股": "Manage watchlist",
  "更新參考價": "Refresh price", "更新中…": "Updating…", "日 K": "Daily", "週 K": "Weekly", "月 K": "Monthly",
  "張": "lots", "開": "O", "高": "H", "低": "L", "收": "C", "量": "Vol",
  "未還原價格 · 紅漲綠跌": "Unadjusted · red up / green down",
};
export function tr(text: string, language = readLanguage()) { return language === "en" ? labels[text] || text : text; }
