// Shared Supabase client — loaded after the Supabase CDN script on every page.
const SUPABASE_URL = "https://ybcowuxxzppztygildig.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InliY293dXh4enBwenR5Z2lsZGlnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyMDYzODAsImV4cCI6MjEwMzc4MjM4MH0.4Hb6C8_2dU_CrUq9HHfRiwA7dvAinhGo3JbFxBmFm3E";

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
