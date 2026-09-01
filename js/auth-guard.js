// Include on every protected page (after supabase-client.js).
// Redirects to login.html if there's no active session.
async function requireAuth() {
  const { data } = await sb.auth.getSession();
  if (!data.session) {
    window.location.href = "login.html";
    return null;
  }
  return data.session;
}
