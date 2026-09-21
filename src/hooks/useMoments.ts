import { useCallback, useContext, useEffect, useState } from 'react';
import { AuthContext } from '@/contexts/AuthContext';
import {
  createMoment,
  deleteMoment,
  fetchMoments,
  type Moment,
  type MomentInput,
} from '@/lib/moments';

interface UseMomentsReturn {
  moments: Moment[];
  isLoading: boolean;
  error: Error | null;
  save: (input: MomentInput) => Promise<Moment | null>;
  remove: (id: string) => Promise<void>;
  refetch: () => Promise<void>;
}

export const useMoments = (): UseMomentsReturn => {
  const auth = useContext(AuthContext);
  const userId = auth?.user?.id ?? null;
  const [moments, setMoments] = useState<Moment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    if (!userId) {
      setMoments([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      setMoments(await fetchMoments(userId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Could not load your moments'));
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async (input: MomentInput) => {
    if (!userId) return null;
    const moment = await createMoment(userId, input);
    setMoments((prev) => [moment, ...prev]);
    return moment;
  }, [userId]);

  const remove = useCallback(async (id: string) => {
    await deleteMoment(id);
    setMoments((prev) => prev.filter((m) => m.id !== id));
  }, []);

  return { moments, isLoading, error, save, remove, refetch: load };
};

export default useMoments;
