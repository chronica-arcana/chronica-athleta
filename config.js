// Öffentliche Konfiguration (nichts Geheimes!). Der Supabase "anon key" ist für den Browser gedacht;
// der Schutz der Daten erfolgt über Row Level Security (siehe supabase/migrations).
// Leer lassen = Demo-Modus ohne Konto (Daten nur lokal im Browser, keine KI/Garmin-Funktionen).
window.TT_CONFIG = {
  supabaseUrl: "",      // z. B. "https://abcdxyz.supabase.co"
  supabaseAnonKey: "",  // Projekt-Einstellungen → API → anon public key
  apiBase: ""           // "" = gleiche Domain (Vercel). Nur ändern, wenn die API woanders läuft.
};
