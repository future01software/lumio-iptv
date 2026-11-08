import React, { useCallback, useState } from "react";
import { useProfiles, type Profile } from "@/src/store/profile-store";
import { useIPTV } from "@/src/store/iptv-store";
import { PinPad, type PinSubmitResult } from "@/src/components/profile/PinPad";

/**
 * Switch to a profile, asking for its PIN first when it has one. Render
 * `pinPad` somewhere in the tree; it's null unless a PIN prompt is open.
 */
export function useProfileSwitch() {
  const setActive = useProfiles((s) => s.setActive);
  const tryPin = useProfiles((s) => s.tryPin);
  const setIptvProfile = useIPTV((s) => s.setProfile);
  const [pending, setPending] = useState<{ profile: Profile; onDone?: () => void } | null>(null);

  const activate = useCallback(
    async (id: string) => {
      await setActive(id);
      await setIptvProfile(id);
    },
    [setActive, setIptvProfile],
  );

  const requestSwitch = useCallback(
    async (profile: Profile, onDone?: () => void) => {
      if (profile.hasPin) {
        setPending({ profile, onDone });
        return;
      }
      await activate(profile.id);
      onDone?.();
    },
    [activate],
  );

  const submit = useCallback(
    async (pin: string): Promise<PinSubmitResult> => {
      if (!pending) return null;
      const res = await tryPin(pending.profile.id, pin);
      if (res.ok) {
        const { profile, onDone } = pending;
        setPending(null);
        await activate(profile.id);
        onDone?.();
        return null;
      }
      if (res.retryAfterSec > 0) return { error: "", lockSec: res.retryAfterSec };
      return { error: `Hatalı PIN · ${res.attemptsLeft} deneme hakkın kaldı` };
    },
    [activate, pending, tryPin],
  );

  const pinPad = pending ? (
    <PinPad
      title={pending.profile.name}
      subtitle="Profil PIN'ini gir"
      avatar={pending.profile.avatar}
      color={pending.profile.color}
      length={pending.profile.pinLength}
      onSubmit={submit}
      onCancel={() => setPending(null)}
    />
  ) : null;

  return { requestSwitch, pinPad };
}
