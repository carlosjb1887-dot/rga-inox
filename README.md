# Web de RGA Inox

Web estática de RGA Inox, publicada con GitHub Pages en https://rga.inronda.es (fuera de Cloudflare, para que no le afecten los bloqueos de sus IPs).

- Sin compilación: lo que hay en `main` es lo que se sirve.
- El formulario de presupuesto lo pinta `crm-form.js` (copia de `web-forms/crm-form.js` del CRM) y envía al Worker `forms.inronda.es`.
- `CNAME`: dominio de Pages. No borrarlo.
