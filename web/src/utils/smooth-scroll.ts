const activeScrollAnimations = new WeakMap<HTMLElement, number>();

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

export function cancelSmoothScroll(element: HTMLElement | null | undefined) {
  if (!element) {
    return;
  }
  const frame = activeScrollAnimations.get(element);
  if (frame !== undefined) {
    window.cancelAnimationFrame(frame);
    activeScrollAnimations.delete(element);
  }
}

export function smoothScrollTo(
  element: HTMLElement,
  targetTop: number,
  options?: {
    durationMs?: number;
    reducedMotion?: boolean;
  },
) {
  cancelSmoothScroll(element);

  if (options?.reducedMotion) {
    element.scrollTop = targetTop;
    return;
  }

  const startTop = element.scrollTop;
  const distance = targetTop - startTop;
  if (Math.abs(distance) < 1) {
    element.scrollTop = targetTop;
    return;
  }

  const durationMs =
    options?.durationMs ?? Math.min(560, Math.max(260, Math.abs(distance) * 0.45));
  const startTime = performance.now();

  const animate = (timestamp: number) => {
    const elapsed = timestamp - startTime;
    const progress = Math.min(1, elapsed / durationMs);
    element.scrollTop = startTop + distance * easeOutCubic(progress);

    if (progress < 1) {
      const frame = window.requestAnimationFrame(animate);
      activeScrollAnimations.set(element, frame);
      return;
    }

    element.scrollTop = targetTop;
    activeScrollAnimations.delete(element);
  };

  const initialFrame = window.requestAnimationFrame(animate);
  activeScrollAnimations.set(element, initialFrame);
}
