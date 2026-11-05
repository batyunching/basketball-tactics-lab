import { useEffect, useState } from 'react';
import type { Lesson } from '@btl/shared-types';
import { LESSONS, getLesson } from '@btl/lesson-library';
import { repository } from '../storage/db';

export type CustomLesson = Lesson & { createdAt: string; sourceVideoId?: string };

/** 內建六套＋老師由影片轉換的自訂教材 */
export function useAllLessons(): { builtIn: Lesson[]; custom: CustomLesson[]; reload: () => void } {
  const [custom, setCustom] = useState<CustomLesson[]>([]);
  const [n, setN] = useState(0);
  useEffect(() => {
    repository
      .listCustomLessons()
      .then(setCustom)
      .catch(() => setCustom([]));
  }, [n]);
  return { builtIn: LESSONS, custom, reload: () => setN((x) => x + 1) };
}

/** 依 id 取得教材（內建或自訂）；undefined = 讀取中、null = 找不到 */
export function useAnyLesson(id: string): Lesson | null | undefined {
  const builtIn = getLesson(id);
  const [lesson, setLesson] = useState<Lesson | null | undefined>(builtIn ?? undefined);
  useEffect(() => {
    if (getLesson(id)) {
      setLesson(getLesson(id)!);
      return;
    }
    setLesson(undefined);
    repository
      .getCustomLesson(id)
      .then((l) => setLesson(l ?? null))
      .catch(() => setLesson(null));
  }, [id]);
  return lesson;
}
