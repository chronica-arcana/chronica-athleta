// Öffentliche Konfiguration (nichts Geheimes!). Der Supabase "anon key" ist für den Browser gedacht;
// der Schutz der Daten erfolgt über Row Level Security (siehe supabase/migrations).
// Leer lassen = Demo-Modus ohne Konto (Daten nur lokal im Browser, keine KI/Garmin-Funktionen).
window.TT_CONFIG = {
  supabaseUrl: "https://rzamveenmesnkntmbnjv.supabase.co",      // z. B. "https://abcdxyz.supabase.co"
  supabaseAnonKey: "sb_publishable_euvx4-VH9ISpOE8ekdahrw_PntmfLN2",  // Projekt-Einstellungen → API → anon public key
  apiBase: ""           // "" = gleiche Domain (Vercel). Nur ändern, wenn die API woanders läuft.
};
