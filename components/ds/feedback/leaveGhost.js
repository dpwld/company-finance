/* 닫힘 애니메이션 — 모달·드로어가 닫히는 순간 화면에 보이던 DOM을 복제해 짧게 페이드아웃시킨다.
   React 트리는 즉시 정리되므로(닫힐 때 데이터를 비우는 화면도 안전) 상태와 무관한 시각 효과만 남는다.
   예전엔 열릴 때만 애니메이션이 있고 닫힐 때 툭 사라져 부자연스러웠다 (2026-10-15 UX QA). */
export function leaveGhost(el, leavingClass, ms = 170) {
  if (!el || typeof document === 'undefined') return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ghost = el.cloneNode(true);
  ghost.classList.add(leavingClass);
  ghost.setAttribute('aria-hidden', 'true');
  ghost.removeAttribute('id');
  ghost.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
  ghost.style.pointerEvents = 'none';
  document.body.appendChild(ghost);
  // 복제본은 스크롤 위치를 잃으므로 원본의 스크롤을 옮겨 내용이 튀지 않게 한다.
  const src = el.querySelectorAll('*');
  const dst = ghost.querySelectorAll('*');
  for (let i = 0; i < src.length; i++) {
    if (src[i].scrollTop) dst[i].scrollTop = src[i].scrollTop;
    // 입력값은 속성이 아니라 프로퍼티라 복제되지 않는다 — 사라지는 동안 빈칸으로 깜빡이지 않게 옮긴다.
    const tag = src[i].tagName;
    if ((tag === 'INPUT' && src[i].type !== 'file') || tag === 'TEXTAREA' || tag === 'SELECT') dst[i].value = src[i].value;
  }
  window.setTimeout(() => ghost.remove(), ms);
}
