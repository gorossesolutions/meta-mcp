import { useEffect, useState } from "react";

const STORAGE_KEY = "gr-adlab-dark-mode";

export function useDarkMode(): [boolean, () => void] {
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return stored === "1";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem(STORAGE_KEY, dark ? "1" : "0");
  }, [dark]);

  return [dark, () => setDark((d) => !d)];
}
