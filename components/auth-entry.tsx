"use client";

import Link from "next/link";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { browserSupabase } from "@/lib/supabase/client";

type AuthEntryProps = {
  className?: string;
  onNavigate?: () => void;
};

export function AuthEntry({ className, onNavigate }: AuthEntryProps) {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let current = true;
    const supabase = browserSupabase();

    void (async () => {
      const result = await supabase.auth.getSession();
      if (current) {
        setSignedIn(Boolean(result.data.session));
      }
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      if (current) {
        setSignedIn(Boolean(session));
      }
    });

    return () => {
      current = false;
      subscription.unsubscribe();
    };
  }, []);

  const href = signedIn ? "/cabinet" : "/auth";
  const label = signedIn ? "Кабинет" : "Вход";

  return (
    <Link className={className} href={href} onClick={onNavigate}>
      {label}
    </Link>
  );
}
