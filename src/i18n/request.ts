import { getRequestConfig } from 'next-intl/server';
import messages from '../../messages/es.json';

// La app opera exclusivamente en español -- se eliminaron en.json y
// ko.json (nunca se usaron: no hay selector de idioma en la UI, y
// NEXT_PUBLIC_APP_LOCALE siempre fue 'es'). Import estatico directo
// en vez del dinamico `../../messages/${locale}.json` de antes --
// mas simple, y evita que el bundler intente resolver archivos que
// ya no existen.
export default getRequestConfig(async () => {
  return {
    locale: 'es',
    messages,
  };
});
