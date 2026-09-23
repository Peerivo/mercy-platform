"use client";

import Link from "next/link";
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

    void supabase.auth.getSession().then(({ data }) => {
      if (current) {
        setSignedIn(Boolean(data.session));
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
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
