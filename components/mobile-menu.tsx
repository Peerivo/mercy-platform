"use client";

import Link from "next/link";
import { AuthEntry } from "@/components/auth-entry";
import { useCallback, useEffect, useRef } from "react";

type NavigationItem = {
  href: string;
  label: string;
};

export function MobileMenu({ items }: { items: readonly NavigationItem[] }) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  const closeMenu = useCallback(() => {
    detailsRef.current?.removeAttribute("open");
  }, []);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const details = detailsRef.current;

      if (!details?.open) {
        return;
      }

      if (!details.contains(event.target as Node)) {
        closeMenu();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      const details = detailsRef.current;

      if (!details?.open) {
        return;
      }

      closeMenu();
      details.querySelector<HTMLElement>("summary")?.focus();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeMenu]);

  return (
    <details className="mobile-menu" ref={detailsRef}>
      <summary aria-label="Открыть меню">
        <span className="mobile-menu-icon" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span>Меню</span>
      </summary>

      <nav className="mobile-menu-panel" aria-label="Мобильная навигация">
        {items.map((item) => (
          <Link href={item.href} key={item.href} onClick={closeMenu}>
            {item.label}
          </Link>
        ))}
        <AuthEntry onNavigate={closeMenu} />
      </nav>
    </details>
  );
}
