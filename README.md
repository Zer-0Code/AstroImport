# ASTRO IMPORT

Gestión comercial para dos propietarios: panel, productos, combos, proveedores, calculadora de precios, ventas, finanzas, mensajes de entrega, tareas y reportes (CSV/PDF).
Stack: React + Vite + TypeScript + Tailwind · Supabase (PostgreSQL, Auth, Realtime, RLS, Storage) · Netlify.

## 1. Probar en local
    npm install
    cp .env.example .env
    npm run dev

`.env` solo lleva la URL y la clave **pública** (publishable) de Supabase. Nunca pongas la `service_role` en el frontend.

## 2. Configurar Supabase (una vez)
Authentication → Sign In / Providers → Email: deja activada la **confirmación de correo** (el sistema de invitaciones la exige).
Authentication → URL Configuration: pon la URL de Netlify en *Site URL* y en *Redirect URLs* (y `http://localhost:5173` para pruebas).
**Cuando los dos propietarios ya tengan cuenta**, desactiva "Allow new users to sign up" para que nadie más pueda registrarse.

## 3. Subir a GitHub
    git init && git add . && git commit -m "ASTRO IMPORT"
    git branch -M main
    git remote add origin https://github.com/Zer-0Code/AstroImport.git
    git push -u origin main

## 4. Desplegar en Netlify
1. Add new site → Import from Git → elige el repositorio (usa `netlify.toml`: build `npm run build`, publish `dist`).
2. Site settings → Environment variables: `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` (valores en `.env.example`).
3. Deploy. `netlify.toml` ya añade cabeceras de seguridad (CSP, X-Frame-Options, etc.).

## 5. Primer uso
1. Propietario 1: crea cuenta → confirma correo → crea el negocio → invita al propietario 2 desde el Panel.
2. Propietario 2: crea cuenta con ESE correo → confirma → entra (queda unido, reparto 50/50).
3. Registra proveedores, productos y empieza a vender.

## Reglas de negocio
- Ingresos = ventas **completadas** + otros ingresos. Pendientes, canceladas y reembolsadas no cuentan.
- Ganancia neta = ventas − costo vendido + otros ingresos − gastos operativos. Las compras de inventario cuentan en egresos y caja, pero no restan de la ganancia (evita duplicar el costo).
- Modelo bajo encargo: los productos marcados "bajo encargo" (por defecto) se compran al proveedor cuando el cliente paga, así que no llevan control de stock ni alertas. Los productos con stock propio sí: baja al completar o reembolsar una venta, se repone al cancelarla o eliminarla y nunca queda negativo.
- Ventas reembolsadas: su costo ya se pagó al proveedor, por eso se descuenta de la ganancia neta como pérdida.
- Ganancia por cobrar: ganancia de las ventas pendientes; no cuenta como ganada hasta completarlas.
- Cambiar el reparto entre propietarios requiere que el otro lo apruebe (función `decide_split_change`).

## Seguridad
- RLS en todas las tablas: solo los miembros del negocio leen o escriben sus datos.
- Contraseñas y credenciales de clientes **no se guardan** en ninguna tabla: viven solo en pantalla.
- El historial de actividad y de precios solo lo escriben triggers de la base; los usuarios no pueden alterarlo.
- Comprobantes en bucket privado, accesibles solo con enlace temporal y para miembros del negocio.

## Base de datos y copias de seguridad
El esquema ya está aplicado en el proyecto Supabase `astro-import`. Para exportarlo como migraciones SQL versionadas:
    npx supabase login
    npx supabase link --project-ref lgjxepbusburabzqkgwt
    npx supabase db pull
Copia de datos: `npx supabase db dump -f respaldo.sql`, o los reportes CSV de la app. Los respaldos automáticos dependen del plan de Supabase.

## Pendiente (no implementado todavía)
Buscador global, panel de configuración, alertas por correo/push, integración automática con proveedores (solo cotizaciones manuales).
