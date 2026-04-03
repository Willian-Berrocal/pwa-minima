# Cochera — PWA de Gestión de Ingreso y Salida

Una aplicación web progresiva (PWA) ligera para gestionar el ingreso y salida de vehículos en una cochera, con soporte offline y sincronización en la nube.

## 🚀 Características
- **Gestión de Ingresos:** Registro de vehículos por matrícula y tipo de tarifa.
- **Cálculo de Tarifas:** Soporta múltiples categorías (autos, motos, mototaxis, etc.) con precios diferenciados para día y noche.
- **Soporte Offline:** Funciona sin conexión mediante Service Workers y almacenamiento local con Dexie.js (IndexedDB).
- **Sincronización:** Integración con Supabase para almacenamiento centralizado y autenticación.
- **Interfaz Adaptable:** Diseño minimalista optimizado para dispositivos móviles.

## 🛠️ Stack Tecnológico
- **Frontend:** HTML5, CSS3, JavaScript (Vanilla JS).
- **Base de Datos Local:** [Dexie.js](https://dexie.org/) (Wrapper de IndexedDB).
- **Backend/Nube:** [Supabase](https://supabase.com/) (PostgreSQL + Auth).
- **PWA:** Service Workers para caching y archivo `manifest.json`.

## 📁 Estructura del Proyecto
- `index.html`: Punto de entrada de la aplicación y estructura de la UI.
- `app.js`: Lógica principal (interacción con Supabase, Dexie y manejo del DOM).
- `styles.css`: Estilos visuales de la aplicación.
- `service-worker.js`: Estrategia de caching para funcionamiento offline.
- `manifest.json`: Configuración de la PWA (iconos, colores, modo de visualización).
- `icon.png`: Icono de la aplicación.

## ⚙️ Requisitos y Configuración
### Requisitos
- Navegador web moderno con soporte para Service Workers.
- Conexión a internet para la sincronización inicial y autenticación.

### Configuración de Supabase
La aplicación utiliza Supabase para el backend. Las credenciales actuales se encuentran en `app.js`:
```javascript
const SUPABASE_URL = 'https://jxyusfojvrcxsorzjtdd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_...';
```
> **Nota:** Se recomienda configurar variables de entorno o un mecanismo más seguro para producción.

### Base de Datos
La aplicación interactúa con las siguientes tablas en Supabase:
- `cobros`: Registros activos de vehículos en la cochera.
- `retiros`: Historial de vehículos que ya salieron.
- `monto`: Registro del monto total recolectado.

## 🏁 Cómo Ejecutar
Al ser una aplicación estática, puedes servirla con cualquier servidor local:

1. **Usando Python:**
   ```bash
   python3 -m http.server 8000
   ```
2. **Usando Node.js (serve):**
   ```bash
   npx serve .
   ```
3. **Abrir directamente:**
   Simplemente abre `index.html` en tu navegador (aunque algunas funciones de Service Worker requieren un origen seguro o localhost).

## 📝 Scripts y Automatización
Actualmente, el proyecto no utiliza gestores de paquetes (npm/yarn) ni scripts de construcción.
- **TODO:** Implementar un script de despliegue automatizado.
- **TODO:** Agregar pruebas unitarias para la lógica de cálculo de tarifas.

## 🔑 Variables de Entorno
No se utilizan archivos `.env` directamente. Las configuraciones están harcodeadas en `app.js`.
- **TODO:** Migrar `SUPABASE_URL` y `SUPABASE_KEY` a una configuración externa o inyectada.

## 📄 Licencia
Este proyecto no tiene una licencia especificada actualmente.
- **TODO:** Definir términos de licencia (e.g., MIT, Propia).
