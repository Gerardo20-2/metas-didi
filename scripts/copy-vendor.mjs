/* Copia React y ReactDOM (UMD de producción) a js/vendor para servirlos desde el mismo
   origen: sin CDN la app abre offline y el Service Worker puede precachearlos. */
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('js/vendor', { recursive: true });
copyFileSync('node_modules/react/umd/react.production.min.js', 'js/vendor/react.production.min.js');
copyFileSync('node_modules/react-dom/umd/react-dom.production.min.js', 'js/vendor/react-dom.production.min.js');
console.log('vendor: react 18.3.1 y react-dom 18.3.1 copiados a js/vendor/');
