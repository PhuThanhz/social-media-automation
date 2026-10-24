/**
 * CardMoveableOverlay – overlay cho phép kéo/resize card tiêu đề trực tiếp trên preview.
 * Dùng react-moveable để render handle 8 góc + drag.
 * Props nhận vị trí/kích thước hiện tại (% so với preview container) và callback onChange.
 */
import { useEffect, useRef } from 'react';
import Moveable from 'react-moveable';

interface CardTransform {
  /** Offset ngang tính từ center (px trong không gian preview) */
  x: number;
  /** Offset dọc tính từ vị trí mặc định (px trong không gian preview) */
  y: number;
  /** Tỉ lệ scale, 1.0 = 100% */
  scale: number;
}

interface Props {
  /** Element cần control (card iframe wrapper) */
  targetRef: React.RefObject<HTMLElement | null>;
  /** Container preview (để snap bounds) */
  containerRef: React.RefObject<HTMLElement | null>;
  transform: CardTransform;
  onChange: (t: CardTransform) => void;
  visible: boolean;
}

export function CardMoveableOverlay({ targetRef, containerRef, transform, onChange, visible }: Props) {
  const moveableRef = useRef<InstanceType<typeof Moveable>>(null);

  // Cập nhật Moveable khi target thay đổi vị trí
  useEffect(() => {
    moveableRef.current?.updateRect();
  }, [transform]);

  if (!visible) return null;

  return (
    <Moveable
      ref={moveableRef}
      target={targetRef as React.RefObject<HTMLElement>}
      container={containerRef.current}
      draggable
      resizable
      scalable={false}
      keepRatio={false}
      snappable
      snapContainer={containerRef.current}
      bounds={{ left: 0, top: 0, right: 0, bottom: 0, position: 'css' }}
      renderDirections={['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se']}
      edge={false}
      throttleDrag={0}
      throttleResize={0}
      onDrag={({ translate }) => {
        onChange({ ...transform, x: translate[0], y: translate[1] });
      }}
      onResize={({ width, height, drag }) => {
        const el = targetRef.current;
        if (el) {
          el.style.width = `${width}px`;
          el.style.height = `${height}px`;
          el.style.transform = `translate(${drag.translate[0]}px, ${drag.translate[1]}px)`;
        }
        onChange({ ...transform, x: drag.translate[0], y: drag.translate[1] });
      }}
    />
  );
}
