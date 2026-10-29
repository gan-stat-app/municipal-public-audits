/* Same-origin SVG navigation shared by the screening and DPC maps. */
window.createMapView = function (svg, controls) {
  let home, view, drag, moved = false;
  const buttons = controls.querySelectorAll('[data-map-zoom]');
  const write = () => {
    svg.setAttribute('viewBox', view.join(' '));
    const zoom = home[2] / view[2];
    svg.classList.toggle('map-zoomed', zoom > 1.01);
    controls.querySelector('[data-map-scale]').textContent = `${zoom.toFixed(1)}倍`;
    buttons.forEach(button => {
      button.disabled = button.dataset.mapZoom === 'in' ? zoom >= 7.99 : button.dataset.mapZoom === 'out' ? zoom <= 1.01 : false;
    });
  };
  const fit = (element = svg) => {
    const b = element.getBBox();
    if (!b.width || !b.height) return;
    const pad = Math.max(b.width, b.height) * .035;
    view = [b.x - pad, b.y - pad, b.width + 2 * pad, b.height + 2 * pad];
    if (element === svg) home = [...view];
    write();
  };
  controls.addEventListener('click', event => {
    const action = event.target.closest('[data-map-zoom]')?.dataset.mapZoom;
    if (!action || !home) return;
    if (action === 'reset') view = [...home];
    else {
      const old = home[2] / view[2], next = Math.min(8, Math.max(1, old * (action === 'in' ? 1.5 : 1 / 1.5)));
      const factor = old / next;
      view = [view[0] + view[2] * (1-factor)/2, view[1] + view[3] * (1-factor)/2, view[2]*factor, view[3]*factor];
    }
    write();
  });
  svg.addEventListener('pointerdown', event => {
    moved = false;
    if (!home || home[2] / view[2] <= 1.01 || event.button !== 0) return;
    const matrix = svg.getScreenCTM().inverse();
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, point, matrix, view: [...view] };
  });
  svg.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    if (!moved && Math.hypot(event.clientX-drag.x, event.clientY-drag.y) < 5) return;
    moved = true;
    svg.setPointerCapture(event.pointerId);
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(drag.matrix);
    view = [drag.view[0] + drag.point.x-point.x, drag.view[1] + drag.point.y-point.y, ...drag.view.slice(2)];
    write();
  });
  const end = () => { drag = null; };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  svg.addEventListener('lostpointercapture', end);
  svg.addEventListener('click', event => { if (moved) { event.preventDefault(); event.stopImmediatePropagation(); moved = false; } }, true);
  return { fit, reset: () => { if (home) { view = [...home]; write(); } } };
};
