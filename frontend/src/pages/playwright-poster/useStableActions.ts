import { useMemo, useRef } from 'react';

type AnyFn = (...args: any[]) => any;

// Trả về object hàm có reference cố định, mỗi hàm luôn gọi tới bản mới nhất được truyền vào.
// Dùng để truyền callback xuống component React.memo mà không làm nó render lại mỗi lần cha render.
export function useStableActions<T extends Record<string, AnyFn>>(fns: T): T {
  const ref = useRef(fns);
  ref.current = fns;
  return useMemo(() => {
    const stable = {} as Record<string, AnyFn>;
    for (const key of Object.keys(ref.current)) {
      stable[key] = (...args: any[]) => ref.current[key](...args);
    }
    return stable as T;
  }, []);
}
