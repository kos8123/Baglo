import { useEffect, useRef, useState } from "react";
import { Check, Globe } from "lucide-react";
import { LANGUAGES, type Language } from "../language";

export function LanguageMenu({ language, onChange }: { language: Language; onChange: (language: Language) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const current = LANGUAGES.find((item) => item.code === language) || LANGUAGES[0];
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  const move = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [...(root.current?.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]") || [])];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  };
  return (
    <div className="lang-menu" ref={root}>
      <button ref={button} type="button" className="lang-button" aria-haspopup="menu" aria-expanded={open}
        aria-label="Language / 語言" onClick={() => setOpen(!open)}>
        <Globe size={17} /><span>{current.short}</span>
      </button>
      {open && (
        <ul className="lang-list" role="menu" aria-label="Language" onKeyDown={move}>
          {LANGUAGES.map((item) => (
            <li role="none" key={item.code}>
              <button type="button" role="menuitemradio" aria-checked={item.code === language} lang={item.html}
                onClick={() => { onChange(item.code); setOpen(false); button.current?.focus(); }}>
                {item.label}{item.code === language && <Check size={16} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
