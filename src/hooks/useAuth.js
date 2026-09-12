import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { colorForId } from "../lib/colors";

// Ensures a `profiles` row exists for this user (name/colour used for
// attribution, cursors and avatars) and returns it.
async function ensureProfile(user) {
  const { data: existing } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (existing) return existing;

  const name = (user.email || "Anonymous").split("@")[0];
  const { data: created, error } = await supabase
    .from("profiles")
    .insert({ id: user.id, name, color: colorForId(user.id) })
    .select("*")
    .single();

  if (error) {
    // Another tab may have created it in a race — just fetch it.
    const { data: refetched } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();
    return refetched;
  }
  return created;
}

export function useAuth() {
  const [session, setSession] = useState(undefined); // undefined = loading
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setSession(data.session ?? null);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!session?.user) {
      setProfile(null);
      return;
    }
    ensureProfile(session.user).then((p) => {
      if (!cancelled) setProfile(p);
    });
    return () => {
      cancelled = true;
    };
  }, [session?.user]);

  const signInWithEmail = useCallback(async (email) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(() => supabase.auth.signOut(), []);

  const updateName = useCallback(
    async (name) => {
      if (!session?.user) return;
      const { data, error } = await supabase
        .from("profiles")
        .update({ name })
        .eq("id", session.user.id)
        .select("*")
        .single();
      if (!error) setProfile(data);
    },
    [session?.user]
  );

  return {
    loading: session === undefined || (session !== null && profile === null),
    session: session ?? null,
    user: session?.user ?? null,
    profile,
    signInWithEmail,
    signOut,
    updateName,
  };
}
