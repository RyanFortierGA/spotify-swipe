import { beginLogin, hasClientId } from '../lib/auth'

export function Login() {
  const configured = hasClientId()

  return (
    <section className="login">
      <div className="login-glow" aria-hidden />
      <div className="login-content">
        <p className="brand">Swipe</p>
        <h1>Sort your Spotify with your thumb.</h1>
        <p className="lede">
          Keep, cut, or discover — swipe through playlists, liked songs, or fresh tracks that match
          your vibe.
        </p>
        {configured ? (
          <button type="button" className="cta" onClick={() => void beginLogin()}>
            Continue with Spotify
          </button>
        ) : (
          <div className="setup">
            <p>
              Add your Spotify Client ID to <code>.env</code> (see <code>.env.example</code>), then
              restart the dev server.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
