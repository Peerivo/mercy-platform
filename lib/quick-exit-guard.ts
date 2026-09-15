export const quickExitGuard = String.raw`
(() => {
  const marker = "mercy_quick_exit";

  const marked = () => {
    try {
      return sessionStorage.getItem(marker) === "1";
    } catch {
      return false;
    }
  };

  addEventListener("pageshow", (event) => {
    if (
      event.persisted &&
      marked() &&
      location.pathname !== "/auth" &&
      location.pathname !== "/safe"
    ) {
      location.replace("/auth");
    }
  });
})();
`;