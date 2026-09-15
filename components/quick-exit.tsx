"use client";

export function QuickExit() {
  function leave() {
    try {
      document.cookie.split(";").forEach((cookie) => {
        const name = cookie.split("=")[0].trim();

        if (name.startsWith("sb-")) {
          document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`;
        }
      });

      localStorage.clear();
      sessionStorage.clear();

      // Только для защиты от восстановления старой страницы через BFCache.
      sessionStorage.setItem("mercy_quick_exit", "1");
    } finally {
      window.location.replace("/auth");
    }
  }

  return (
    <button
      className="btn secondary"
      onClick={leave}
      aria-label="Быстро скрыть приватную страницу"
    >
      Быстрый выход
    </button>
  );
}