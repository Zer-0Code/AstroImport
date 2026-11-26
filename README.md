# ASTRO IMPORT — Fases 1–3 (identidad, login, dashboard, productos, proveedores, calculadora, ventas, finanzas)

## Instalar
npm install
cp .env.example .env   # ya apunta a tu proyecto Supabase
npm run dev

## Desplegar en Netlify (equipo ZYTEK)
1. Sube la carpeta a un repositorio de GitHub.
2. Netlify → Add new site → Import from Git → elige el repo (build: `npm run build`, publish: `dist`; ya está en netlify.toml).
3. Site settings → Environment variables: VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY (valores en .env.example).
4. Supabase → Authentication → URL Configuration: pon la URL de Netlify en "Site URL" y "Redirect URLs".

## Uso
1. El primer propietario crea cuenta, confirma el correo y crea el negocio.
2. Lo invita desde el panel (por correo). El segundo propietario crea su cuenta con ESE correo, lo confirma y entra: queda unido con reparto 50/50.

## Reglas de cálculo (base de datos)
- Ingresos = ventas completadas + otros ingresos. Pendientes/canceladas/reembolsadas no cuentan.
- Ganancia neta = ventas − costo de lo vendido + otros ingresos − gastos operativos.
- Las compras de inventario cuentan en egresos y flujo de caja, pero no restan de la ganancia (evita duplicar costos).
