/*!
 * crm-form.js — formulario del CRM para pegar en cualquier web. Sin dependencias.
 *
 *   <div data-crm-form data-empresa="rga" data-formulario="presupuesto"
 *        data-endpoint="https://forms.inronda.es"
 *        data-telefono="+34 600 000 000" data-email="info@empresa.es"></div>
 *   <script src="/crm-form.js" defer></script>
 *
 * Carga el script en TODAS las páginas: además de pintar el formulario, guarda de dónde llegó
 * la visita (utm_* y referrer) para cuando se envíe el formulario más adelante.
 * data-telefono / data-email (opcionales): si el formulario no carga o no se puede enviar (p. ej. un bloqueo
 * de las IPs de Cloudflare), se ofrecen como alternativa.
 */
(() => {
  "use strict";

  // ---------- Origen de la visita (primer contacto de la sesión) ----------
  const CLAVE_ORIGEN = "crm_origen";
  function origenVisita() {
    try {
      const guardado = sessionStorage.getItem(CLAVE_ORIGEN);
      if (guardado) return JSON.parse(guardado);
    } catch (_) {}
    const p = new URLSearchParams(location.search);
    let ref = "directo";
    try {
      const r = new URL(document.referrer);
      if (r.hostname && r.hostname !== location.hostname) ref = r.hostname.replace(/^www\./, "");
    } catch (_) {}
    const origen = {
      utm_fuente: (p.get("utm_source") || "").slice(0, 100),
      utm_medio: (p.get("utm_medium") || "").slice(0, 100),
      utm_campana: (p.get("utm_campaign") || "").slice(0, 100),
      pagina_procedencia: ref,
    };
    try { sessionStorage.setItem(CLAVE_ORIGEN, JSON.stringify(origen)); } catch (_) {}
    return origen;
  }

  // ---------- Fotos: reducir en el navegador antes de subir ----------
  const MAX_LADO = 1600, CALIDAD = 0.8, MAX_ORIGINAL = 8 * 1024 * 1024;
  async function reducirImagen(file) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      const k = Math.min(1, MAX_LADO / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * k);
      c.height = Math.round(bmp.height * k);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((ok) => c.toBlob(ok, "image/jpeg", CALIDAD));
      if (!blob) throw new Error("sin blob");
      return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
    } catch (_) {
      // El navegador no pudo leerla (p. ej. HEIC): se envía tal cual solo si el servidor la admitirá
      if (/^image\/(jpeg|png|webp)$/.test(file.type) && file.size <= MAX_ORIGINAL) return file;
      throw new Error("formato");
    }
  }

  // ---------- Utilidades de DOM ----------
  // Plan B cuando el formulario falla: «Si no funciona, llámanos al … o escríbenos a …» (o null si no hay datos)
  function contactoAlternativo(contenedor) {
    const tel = (contenedor.dataset.telefono || "").trim(), correo = (contenedor.dataset.email || "").trim();
    if (!tel && !correo) return null;
    const partes = [];
    if (tel) partes.push("llámanos al ", el("a", { href: "tel:" + tel.replace(/[^\d+]/g, ""), text: tel }));
    if (correo) partes.push(tel ? " o escríbenos a " : "escríbenos a ", el("a", { href: "mailto:" + correo, text: correo }));
    return el("p", { class: "crmf-plan-b" }, "Si no funciona, ", partes, ".");
  }

  function el(tag, props = {}, ...hijos) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
    }
    hijos.flat().forEach((h) => h && e.append(h));
    return e;
  }

  const CSS = `
.crmf{--crmf-color:#1f6feb;--crmf-radio:8px;font:16px/1.4 system-ui,sans-serif;max-width:560px}
.crmf *{box-sizing:border-box}
.crmf-campo{margin:0 0 14px}
.crmf label{display:block;font-weight:600;margin-bottom:4px}
.crmf input:not([type=checkbox]),.crmf select,.crmf textarea{width:100%;padding:12px;font:inherit;border:1px solid #888;border-radius:var(--crmf-radio);background:#fff;color:#111}
.crmf textarea{min-height:110px}
.crmf .crmf-casilla label{font-weight:400;display:flex;gap:8px;align-items:flex-start}
.crmf [aria-invalid=true]{border-color:#c0392b}
.crmf-error{color:#c0392b;font-size:14px;margin-top:4px}
.crmf button{padding:14px 20px;font:inherit;font-weight:600;border:0;border-radius:var(--crmf-radio);background:var(--crmf-color);color:#fff;cursor:pointer;width:100%}
.crmf button[disabled]{opacity:.6;cursor:wait}
.crmf-fotos{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.crmf-foto{position:relative;width:72px;height:72px}
.crmf-foto img{width:100%;height:100%;object-fit:cover;border-radius:6px}
.crmf-foto button{position:absolute;top:-6px;right:-6px;width:24px;height:24px;padding:0;border-radius:50%;background:#333;line-height:24px}
.crmf-aviso{padding:12px;border-radius:var(--crmf-radio);background:#eef6ff;margin-bottom:14px}
.crmf-plan-b{margin:10px 0 0}.crmf-plan-b a{font-weight:600}
.crmf-ok{padding:16px;border-radius:var(--crmf-radio);background:#e9f8ef}
.crmf-trampa{position:absolute!important;left:-9999px;height:0;overflow:hidden}`;

  // ---------- Formulario ----------
  async function montar(contenedor) {
    const empresa = contenedor.dataset.empresa, codigo = contenedor.dataset.formulario;
    const base = (contenedor.dataset.endpoint || "").replace(/\/$/, "");
    const url = `${base}/v1/${encodeURIComponent(empresa)}/${encodeURIComponent(codigo)}`;
    const textoOk = contenedor.dataset.mensajeOk || "¡Gracias! Hemos recibido tu solicitud y te contactaremos lo antes posible.";
    contenedor.classList.add("crmf");
    contenedor.textContent = "Cargando formulario…";

    let def;
    try {
      const r = await fetch(url + "/definicion");
      if (!r.ok) throw new Error(r.status);
      def = await r.json();
    } catch (_) {
      contenedor.replaceChildren(...[el("p", { text: "No se puede cargar el formulario ahora mismo. Inténtalo de nuevo en unos minutos." }),
        contactoAlternativo(contenedor)].filter(Boolean));
      return;
    }

    const fotos = []; // File ya reducidos
    const campos = new Map(); // clave -> {def, input, error}
    const form = el("form", { novalidate: true });
    const aviso = el("div", { class: "crmf-aviso", role: "alert", hidden: true });
    form.append(aviso);

    for (const c of def.campos) {
      const id = `crmf-${empresa}-${c.clave}`;
      const error = el("div", { class: "crmf-error", id: id + "-err", "aria-live": "polite" });
      let input, bloque;
      const etiqueta = c.etiqueta + (c.obligatorio ? " *" : "");
      if (c.tipo === "textarea") input = el("textarea", { id, name: c.clave });
      else if (c.tipo === "lista") {
        input = el("select", { id, name: c.clave }, el("option", { value: "", text: "Selecciona…" }),
          c.opciones.map((o) => el("option", { value: o.valor, text: o.etiqueta })));
      } else if (c.tipo === "casilla") {
        input = el("input", { type: "checkbox", id, name: c.clave });
      } else if (c.tipo === "imagenes") {
        input = el("input", { type: "file", id, accept: "image/*", multiple: true });
      } else {
        const tipo = { telefono: "tel", correo: "email", fecha: "date" }[c.tipo] || "text";
        const auto = { telefono: "tel", correo: "email", nombre: "given-name", apellidos: "family-name" }[c.tipo === "texto" ? c.clave : c.tipo];
        input = el("input", { type: tipo, id, name: c.clave, autocomplete: auto });
      }
      if (c.tipo === "casilla") {
        const texto = c.clave === "acepta_comunicaciones" && def.texto_consentimiento ? def.texto_consentimiento : etiqueta;
        let rotulo = el("span", { text: texto });
        // Casilla de privacidad: «política de privacidad» enlaza a la página de la empresa (solo direcciones http/https)
        if (c.clave === "acepta_privacidad" && /^https?:\/\//i.test(def.url_privacidad || "")) {
          const enlace = (t) => el("a", { href: def.url_privacidad, target: "_blank", rel: "noopener", text: t });
          const m = /pol[ií]tica de privacidad/i.exec(texto);
          rotulo = m
            ? el("span", {}, texto.slice(0, m.index), enlace(m[0]), texto.slice(m.index + m[0].length))
            : el("span", {}, texto + " (", enlace("política de privacidad"), ")");
        }
        bloque = el("div", { class: "crmf-campo crmf-casilla" }, el("label", { for: id }, input, rotulo), error);
      } else if (c.tipo === "imagenes") {
        const galeria = el("div", { class: "crmf-fotos" });
        input.addEventListener("change", async () => {
          const libres = def.max_imagenes - fotos.length;
          const elegidas = [...input.files].slice(0, Math.max(0, libres));
          if (input.files.length > libres) error.textContent = `Máximo ${def.max_imagenes} fotos.`;
          else error.textContent = "";
          for (const f of elegidas) {
            try {
              const reducida = await reducirImagen(f);
              fotos.push(reducida);
            } catch (_) { error.textContent = "Alguna foto no se pudo usar (usa JPG, PNG o WEBP)."; }
          }
          input.value = "";
          pintarFotos(galeria, fotos);
        });
        bloque = el("div", { class: "crmf-campo" }, el("label", { for: id, text: `${etiqueta} (máx. ${def.max_imagenes})` }), input, galeria, error);
      } else {
        bloque = el("div", { class: "crmf-campo" }, el("label", { for: id, text: etiqueta }), input, error);
      }
      if (c.obligatorio && c.tipo !== "casilla") input.setAttribute("aria-required", "true");
      input.setAttribute("aria-describedby", id + "-err");
      campos.set(c.clave, { def: c, input, error });
      form.append(bloque);
    }

    // Trampa para bots (los humanos no la ven) y antispam de Cloudflare
    form.append(el("div", { class: "crmf-trampa", "aria-hidden": "true" },
      el("input", { type: "text", name: "website", tabindex: "-1", autocomplete: "off" })));
    const zonaTurnstile = el("div", { class: "crmf-campo" });
    const boton = el("button", { type: "submit", text: contenedor.dataset.textoBoton || "Enviar solicitud" });
    form.append(zonaTurnstile, boton);
    contenedor.replaceChildren(form);

    let widget = null;
    cargarTurnstile().then(() => {
      widget = window.turnstile.render(zonaTurnstile, { sitekey: def.turnstile_sitekey });
    }, () => {
      zonaTurnstile.replaceChildren(...[el("p", { class: "crmf-aviso", text: "No se ha podido cargar la verificación anti-spam." }),
        contactoAlternativo(contenedor)].filter(Boolean));
    });

    function limpiarErrores() {
      aviso.hidden = true;
      campos.forEach(({ input, error }) => { error.textContent = ""; input.removeAttribute("aria-invalid"); });
    }
    function marcarError(clave, msg) {
      const c = campos.get(clave);
      if (!c) { aviso.replaceChildren(...[msg, contactoAlternativo(contenedor)].filter(Boolean)); aviso.hidden = false; return null; }
      c.error.textContent = msg; c.input.setAttribute("aria-invalid", "true");
      return c.input;
    }

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      limpiarErrores();
      let primero = null;
      for (const [clave, { def: c, input }] of campos) {
        if (c.tipo === "imagenes") continue;
        const vacio = c.tipo === "casilla" ? !input.checked : !input.value.trim();
        if (c.obligatorio && vacio) { const e = marcarError(clave, "Este campo es obligatorio."); primero = primero || e; }
      }
      if (primero) { primero.focus(); return; }
      const token = widget !== null ? window.turnstile.getResponse(widget) : "";
      if (!token) { marcarError("__all__", "Confirma la verificación antes de enviar."); return; }

      const fd = new FormData();
      for (const [clave, { def: c, input }] of campos) {
        if (c.tipo === "imagenes") continue;
        if (c.tipo === "casilla") { if (input.checked) fd.append(clave, "1"); }
        else if (input.value.trim()) fd.append(clave, input.value.trim());
      }
      fotos.forEach((f) => fd.append("imagenes", f, f.name));
      for (const [k, v] of Object.entries(origenVisita())) if (v) fd.append(k, v);
      fd.append("website", form.elements.website.value);
      fd.append("cf-turnstile-response", token);

      boton.disabled = true; const textoBoton = boton.textContent; boton.textContent = "Enviando…";
      try {
        const r = await fetch(url, { method: "POST", body: fd });
        const d = await r.json().catch(() => ({}));
        if (r.ok) {
          contenedor.replaceChildren(el("div", { class: "crmf-ok", role: "status", text: textoOk }));
          contenedor.dispatchEvent(new CustomEvent("crm-form:enviado", { bubbles: true, detail: { empresa, formulario: codigo } }));
          return;
        }
        if (r.status === 400 && d.errores) {
          let foco = null;
          for (const [k, msg] of Object.entries(d.errores)) { const e = marcarError(k, msg); foco = foco || e; }
          if (foco) foco.focus();
        } else {
          marcarError("__all__", d.error || "No hemos podido enviar tu solicitud. Inténtalo de nuevo o llámanos.");
        }
      } catch (_) {
        marcarError("__all__", "No hemos podido enviar tu solicitud. Comprueba tu conexión e inténtalo de nuevo.");
      }
      if (widget !== null) window.turnstile.reset(widget);
      boton.disabled = false; boton.textContent = textoBoton;
    });
  }

  function pintarFotos(galeria, fotos) {
    galeria.replaceChildren(...fotos.map((f, i) => {
      const img = el("img", { src: URL.createObjectURL(f), alt: `Foto ${i + 1}` });
      img.onload = () => URL.revokeObjectURL(img.src);
      return el("div", { class: "crmf-foto" }, img,
        el("button", { type: "button", "aria-label": `Quitar foto ${i + 1}`, text: "×", onclick: () => { fotos.splice(i, 1); pintarFotos(galeria, fotos); } }));
    }));
  }

  let turnstileListo = null;
  function cargarTurnstile() {
    if (turnstileListo) return turnstileListo;
    turnstileListo = new Promise((ok, ko) => {
      if (window.turnstile) return ok();
      const s = el("script", { src: "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", async: true });
      const espera = setTimeout(ko, 15000);   // si está bloqueado, la conexión puede quedarse colgada sin dar error
      s.onload = () => { clearTimeout(espera); ok(); };
      s.onerror = () => { clearTimeout(espera); ko(); };
      document.head.append(s);
    });
    return turnstileListo;
  }

  function iniciar() {
    origenVisita(); // guarda el origen aunque esta página no tenga formulario
    const contenedores = document.querySelectorAll("[data-crm-form]");
    if (contenedores.length && !document.querySelector("style[data-crmf]")) {
      document.head.append(el("style", { "data-crmf": "", text: CSS }));
    }
    contenedores.forEach(montar);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();
