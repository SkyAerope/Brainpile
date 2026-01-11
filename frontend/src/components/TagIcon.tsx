import React, { useEffect, useMemo, useRef } from 'react';
import lottie, { type AnimationItem } from 'lottie-web';
import type { Tag } from '../api';

function isLottieJson(mime?: string | null): boolean {
  return mime === 'application/json+lottie';
}

export const TagIcon: React.FC<{ tag: Tag; size?: number; title?: string }> = ({ tag, size = 16, title }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const animationRef = useRef<AnimationItem | null>(null);

  const style = useMemo(() => ({ width: size, height: size }), [size]);

  useEffect(() => {
    if (!isLottieJson(tag.asset_mime)) return;
    if (!tag.asset_url) return;
    if (!containerRef.current) return;

    animationRef.current?.destroy();

    animationRef.current = lottie.loadAnimation({
      container: containerRef.current,
      renderer: 'svg',
      loop: true,
      autoplay: true,
      path: tag.asset_url,
    });

    return () => {
      animationRef.current?.destroy();
      animationRef.current = null;
    };
  }, [tag.asset_mime, tag.asset_url]);

  if (tag.icon_type === 'emoji') {
    return (
      <span style={{ ...style, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} title={title}>
        {tag.icon_value}
      </span>
    );
  }

  if (tag.asset_url && tag.asset_mime) {
    if (isLottieJson(tag.asset_mime)) {
      return <div ref={containerRef} style={style} title={title} />;
    }

    if (tag.asset_mime.startsWith('image/')) {
      return <img src={tag.asset_url} style={style} alt={title ?? ''} title={title} />;
    }

    if (tag.asset_mime.startsWith('video/')) {
      return (
        <video
          src={tag.asset_url}
          style={style}
          autoPlay
          loop
          muted
          playsInline
          title={title}
        />
      );
    }
  }

  return (
    <span style={{ ...style, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} title={title}>
      {tag.icon_type === 'tmoji' ? '◇' : '?'}
    </span>
  );
};
