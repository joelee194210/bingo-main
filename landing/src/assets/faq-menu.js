(function () {
  var toggle = document.getElementById('menuToggle');
  var drawer = document.getElementById('menuDrawer');
  var overlay = document.getElementById('menuOverlay');
  if (!toggle || !drawer || !overlay) return;

  var FOCUSABLE_SELECTOR = 'summary, a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function getFocusable() {
    return Array.prototype.slice.call(drawer.querySelectorAll(FOCUSABLE_SELECTOR));
  }

  function isOpen() {
    return drawer.getAttribute('aria-hidden') === 'false';
  }

  function setOpen(open) {
    toggle.setAttribute('aria-expanded', String(open));
    drawer.setAttribute('aria-hidden', String(!open));
    drawer.classList.toggle('open', open);
    overlay.classList.toggle('open', open);
    document.body.style.overflow = open ? 'hidden' : '';

    if (open) {
      // WCAG 2.1 SC 2.4.3 — mover el foco al primer elemento enfocable del drawer.
      var first = getFocusable()[0];
      if (first && typeof first.focus === 'function') {
        // requestAnimationFrame para que la transición de entrada no interfiera.
        requestAnimationFrame(function () { first.focus(); });
      }
    } else {
      // Restaurar foco al botón toggle al cerrar.
      if (typeof toggle.focus === 'function') toggle.focus();
    }
  }

  toggle.addEventListener('click', function () {
    setOpen(!isOpen());
  });
  overlay.addEventListener('click', function () { setOpen(false); });

  document.addEventListener('keydown', function (e) {
    if (!isOpen()) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      return;
    }

    // WCAG 2.1 SC 2.1.2 (variante de focus trap) — retener Tab dentro del drawer.
    if (e.key === 'Tab') {
      var focusable = getFocusable();
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      var active = document.activeElement;

      if (e.shiftKey) {
        if (active === first || !drawer.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !drawer.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  });
})();
