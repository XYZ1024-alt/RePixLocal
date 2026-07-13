import { useEffect, useRef, useState } from "react";
import { useServices } from "@/services/context";
import type { WhisperModelStatus } from "@/types";

const POLL_INTERVAL_MS = 500;

export function useWhisperStatus(model: string, onError: (value: string) => void) {
  const { getWhisperModelStatus } = useServices();
  const [status, setStatus] = useState<WhisperModelStatus | null>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    let timeoutId: number | undefined;

    async function poll() {
      try {
        const next = await getWhisperModelStatus(model);
        if (generation === generationRef.current) setStatus(next);
      } catch (error) {
        if (generation === generationRef.current) onError(String(error));
      } finally {
        if (generation === generationRef.current) {
          timeoutId = window.setTimeout(() => void poll(), POLL_INTERVAL_MS);
        }
      }
    }

    setStatus(null);
    void poll();
    return () => {
      generationRef.current += 1;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [getWhisperModelStatus, model, onError]);

  return status;
}
