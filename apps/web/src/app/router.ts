import { useEffect, useState } from 'react';

/** 簡易 hash 路由：GitHub Pages 不需伺服器設定即可使用 */
export interface Route {
  path: string;
  segments: string[];
  query: URLSearchParams;
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/';
  const [path = '/', qs = ''] = raw.split('?');
  const segments = path.split('/').filter(Boolean).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
  return { path: `/${segments.join('/')}`, segments, query: new URLSearchParams(qs) };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const h = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  return route;
}

export function navigate(to: string): void {
  window.location.hash = to.startsWith('#') ? to : `#${to}`;
}

/** 學生端路由：#/s/代碼（雲端）或 #/p/教材?…（本機連結） */
export function isStudentRoute(r: Route): boolean {
  return r.segments[0] === 's' || r.segments[0] === 'p';
}
