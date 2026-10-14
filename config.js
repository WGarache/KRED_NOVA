// Datos de su proyecto Supabase: Project Settings → API (o "API Keys").
// La llave "anon" / "publishable" es PÚBLICA por diseño: sin una sesión válida no da acceso a ningún dato
// gracias a las reglas de seguridad (RLS) de la base de datos.
// ⚠️ NUNCA ponga aquí la llave "service_role" ni la "secret": esa sí da acceso total.
window.KRED_CONFIG = {
  SUPABASE_URL: 'https://vgntyafnfgycbgqpwdib.supabase.co/rest/v1/',
  SUPABASE_ANON_KEY: 'sb_publishable_qE5qp4l5_SNuqEGy0gbZjw_Gfafo-rs',
  MINUTOS_INACTIVIDAD: 30   // cierra la sesión tras este tiempo sin uso
};
