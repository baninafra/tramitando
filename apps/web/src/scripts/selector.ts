// Selector propio sobre un <select> nativo (patrón "select-only combobox" de WAI-ARIA).
// El <select> sigue en el DOM: es el que envía el formulario y el que se ve sin JS. Si el código cambia
// su valor u opciones, avisa con `refrescarSelector(select)`.

const EVENTO_REFRESCO = 'selector:refrescar';
let contador = 0;

export function refrescarSelector(select: HTMLSelectElement) {
  select.dispatchEvent(new Event(EVENTO_REFRESCO));
}

const visibles = (select: HTMLSelectElement) =>
  [...select.options].filter((o) => !o.disabled && !(o.parentElement instanceof HTMLOptGroupElement && (o.parentElement.disabled || o.parentElement.hidden)));

function mejorar(select: HTMLSelectElement) {
  if (select.dataset.mejorado) return;
  select.dataset.mejorado = '1';
  const n = ++contador;
  const label = document.querySelector<HTMLLabelElement>(`label[for="${select.id}"]`);
  if (label && !label.id) label.id = `${select.id}-etiqueta`;

  const caja = document.createElement('div');
  caja.className = 'selector';
  select.parentNode!.insertBefore(caja, select);
  caja.appendChild(select);
  select.classList.add('selector-nativo');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');

  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'selector-boton';
  boton.id = `${select.id}-combo`;
  boton.setAttribute('role', 'combobox');
  boton.setAttribute('aria-haspopup', 'listbox');
  boton.setAttribute('aria-expanded', 'false');
  boton.setAttribute('aria-controls', `selector-lista-${n}`);
  if (label) {
    boton.setAttribute('aria-labelledby', `${label.id} ${boton.id}`);
    label.htmlFor = boton.id;
  }
  boton.innerHTML = '<span class="selector-valor"></span><svg class="icono selector-flecha" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  const valor = boton.querySelector<HTMLElement>('.selector-valor')!;

  const lista = document.createElement('div');
  lista.className = 'selector-lista';
  lista.id = `selector-lista-${n}`;
  lista.setAttribute('role', 'listbox');
  if (label) lista.setAttribute('aria-labelledby', label.id);
  lista.hidden = true;
  caja.append(boton, lista);
  // Que tocar la barra de desplazamiento no le saque el foco al botón.
  lista.addEventListener('mousedown', (e) => e.preventDefault());

  let opciones: HTMLElement[] = [];
  let activa = -1;
  let tipeo = '';
  let reloj = 0;

  const pintarValor = () => {
    const o = select.selectedOptions[0];
    valor.textContent = o?.text ?? '';
    boton.classList.toggle('vacio', !o || o.value === '');
    boton.disabled = select.disabled;
  };

  const construir = () => {
    lista.innerHTML = '';
    opciones = [];
    let grupoActual: HTMLElement = lista;
    let grupoNativo: Element | null = null;
    for (const o of visibles(select)) {
      const padre = o.parentElement;
      if (padre instanceof HTMLOptGroupElement && padre !== grupoNativo) {
        grupoNativo = padre;
        grupoActual = document.createElement('div');
        grupoActual.setAttribute('role', 'group');
        grupoActual.setAttribute('aria-label', padre.label);
        const titulo = document.createElement('div');
        titulo.className = 'selector-grupo';
        titulo.setAttribute('aria-hidden', 'true');
        titulo.textContent = padre.label;
        grupoActual.appendChild(titulo);
        lista.appendChild(grupoActual);
      } else if (!(padre instanceof HTMLOptGroupElement)) {
        grupoNativo = null;
        grupoActual = lista;
      }
      const el = document.createElement('div');
      el.className = 'selector-opcion';
      el.id = `${lista.id}-${opciones.length}`;
      el.setAttribute('role', 'option');
      el.dataset.valor = o.value;
      el.setAttribute('aria-selected', String(o.selected));
      el.innerHTML = '<span></span><svg class="icono selector-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
      el.querySelector('span')!.textContent = o.text;
      el.addEventListener('pointerdown', (e) => e.preventDefault());
      el.addEventListener('click', () => elegir(opciones.indexOf(el)));
      el.addEventListener('pointermove', () => marcar(opciones.indexOf(el), false));
      grupoActual.appendChild(el);
      opciones.push(el);
    }
  };

  const marcar = (i: number, desplazar = true) => {
    if (!opciones.length) return;
    activa = Math.max(0, Math.min(opciones.length - 1, i));
    opciones.forEach((o, j) => o.classList.toggle('activa', j === activa));
    boton.setAttribute('aria-activedescendant', opciones[activa].id);
    if (desplazar) opciones[activa].scrollIntoView({ block: 'nearest' });
  };

  const abrir = () => {
    if (select.disabled || !lista.hidden) return;
    construir();
    lista.hidden = false;
    boton.setAttribute('aria-expanded', 'true');
    caja.classList.add('abierto');
    // Abrir hacia arriba si no entra abajo.
    const r = boton.getBoundingClientRect();
    caja.classList.toggle('hacia-arriba', innerHeight - r.bottom < 300 && r.top > innerHeight - r.bottom);
    marcar(Math.max(0, opciones.findIndex((o) => o.getAttribute('aria-selected') === 'true')));
  };

  const cerrar = () => {
    if (lista.hidden) return;
    lista.hidden = true;
    boton.setAttribute('aria-expanded', 'false');
    boton.removeAttribute('aria-activedescendant');
    caja.classList.remove('abierto');
  };

  const elegir = (i: number) => {
    const el = opciones[i];
    if (!el) return;
    const cambio = select.value !== el.dataset.valor;
    select.value = el.dataset.valor!;
    pintarValor();
    cerrar();
    boton.focus();
    if (cambio) select.dispatchEvent(new Event('change', { bubbles: true }));
  };

  boton.addEventListener('click', () => (lista.hidden ? abrir() : cerrar()));
  boton.addEventListener('blur', () => cerrar());
  boton.addEventListener('keydown', (e) => {
    const cerrada = lista.hidden;
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); cerrada ? abrir() : marcar(activa + 1); return;
      case 'ArrowUp': e.preventDefault(); cerrada ? abrir() : marcar(activa - 1); return;
      case 'Home': if (!cerrada) { e.preventDefault(); marcar(0); } return;
      case 'End': if (!cerrada) { e.preventDefault(); marcar(opciones.length - 1); } return;
      case 'PageDown': if (!cerrada) { e.preventDefault(); marcar(activa + 8); } return;
      case 'PageUp': if (!cerrada) { e.preventDefault(); marcar(activa - 8); } return;
      case 'Enter': case ' ':
        if (e.key === ' ' && tipeo) break;
        e.preventDefault(); cerrada ? abrir() : elegir(activa); return;
      case 'Escape': if (!cerrada) { e.preventDefault(); e.stopPropagation(); cerrar(); } return;
      case 'Tab': if (!cerrada) elegir(activa); return;
    }
    // Búsqueda tipeando: "sa" salta a Salta, "san l" a San Luis. Sin tildes.
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (cerrada) abrir();
      clearTimeout(reloj);
      tipeo += e.key.toLowerCase();
      reloj = window.setTimeout(() => (tipeo = ''), 700);
      const limpio = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const i = opciones.findIndex((o) => limpio(o.textContent ?? '').startsWith(limpio(tipeo)));
      if (i >= 0) marcar(i);
    }
  });

  select.addEventListener('change', pintarValor);
  select.addEventListener(EVENTO_REFRESCO, () => { pintarValor(); if (!lista.hidden) construir(); });
  select.form?.addEventListener('reset', () => setTimeout(pintarValor));
  pintarValor();
}

export function mejorarSelectores(raiz: ParentNode = document) {
  raiz.querySelectorAll<HTMLSelectElement>('select[data-selector]').forEach(mejorar);
}
