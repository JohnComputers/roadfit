import { ArrowRight, CarFront, CheckCircle2, Eye, EyeOff, KeyRound, LockKeyhole, LogOut, Mail, ShieldCheck, UserRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

type AuthMode = 'login' | 'signup' | 'forgot' | 'reset';

export function AuthPage() {
  const { user, configured, signIn, signUp, signOut, sendPasswordReset, updatePassword } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedMode = searchParams.get('mode') as AuthMode | null;
  const [mode, setModeState] = useState<AuthMode>(requestedMode === 'reset' ? 'reset' : requestedMode === 'signup' ? 'signup' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { showToast } = useToast();
  const returnTo = searchParams.get('return') || '/garage';
  const authVisualStyle = { backgroundImage: `linear-gradient(0deg, rgba(6,8,12,.96), rgba(6,8,12,.16)), linear-gradient(90deg, rgba(6,8,12,.3), transparent), url("${import.meta.env.BASE_URL}assets/roadfit-hero.png")` };

  const setMode = (nextMode: AuthMode) => {
    setModeState(nextMode);
    setError(null);
    setMessage(null);
    const next = new URLSearchParams(searchParams);
    if (nextMode === 'login') next.delete('mode'); else next.set('mode', nextMode);
    setSearchParams(next, { replace: true });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (mode === 'login') {
        await signIn(email.trim(), password);
        showToast('Welcome back.', 'success');
        navigate(returnTo, { replace: true });
      } else if (mode === 'signup') {
        if (password.length < 8) throw new Error('Use at least 8 characters for your password.');
        const result = await signUp(email.trim(), password, displayName);
        if (result.needsVerification) setMessage('Check your inbox to verify your email. After verification, return here to sign in.');
        else navigate(returnTo, { replace: true });
      } else if (mode === 'forgot') {
        await sendPasswordReset(email.trim());
        setMessage('Password-reset instructions are on the way. Check your inbox and spam folder.');
      } else {
        if (password.length < 8) throw new Error('Use at least 8 characters for your password.');
        await updatePassword(password);
        showToast('Password updated.', 'success');
        navigate('/garage', { replace: true });
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Authentication failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (user && mode !== 'reset') {
    return (
      <section className="auth-page page-section">
        <div className="auth-visual" style={authVisualStyle}><div className="auth-visual-content"><CarFront aria-hidden="true" /><span className="section-kicker">RoadFit account</span><h1>Your cars, on every device.</h1><p>Saved vehicles, collections, budgets, and notes are protected by per-user database policies.</p></div></div>
        <div className="auth-form-side"><div className="auth-card signed-in-card"><span className="auth-icon"><UserRound aria-hidden="true" /></span><h2>You’re signed in</h2><p>{user.email}</p><Link className="primary-button" to="/garage">Open my garage <ArrowRight aria-hidden="true" /></Link><button className="secondary-button" type="button" onClick={() => void signOut()}><LogOut aria-hidden="true" /> Sign out</button></div></div>
      </section>
    );
  }

  const headings: Record<AuthMode, [string, string]> = {
    login: ['Welcome back', 'Sign in to sync your garage and notes.'],
    signup: ['Create your garage', 'Browsing stays free. An account is only needed to save.'],
    forgot: ['Reset your password', 'We’ll email a secure recovery link.'],
    reset: ['Choose a new password', 'Your recovery link is active.'],
  };

  return (
    <section className="auth-page page-section">
      <div className="auth-visual" style={authVisualStyle}><div className="auth-visual-content"><span className="auth-logo"><CarFront aria-hidden="true" /></span><span className="section-kicker">A garage that travels</span><h1>Build a shortlist you can come back to.</h1><p>Organize realistic options, dream cars, and notes without giving up free access to the catalog.</p><ul><li><CheckCircle2 aria-hidden="true" /> Cloud-synced favorites</li><li><CheckCircle2 aria-hidden="true" /> Private collections and notes</li><li><ShieldCheck aria-hidden="true" /> Strict per-user access controls</li></ul></div></div>
      <div className="auth-form-side">
        <div className="auth-card">
          <Link className="brand auth-brand" to="/"><span className="brand-mark"><CarFront aria-hidden="true" /></span><span>ROAD<span>FIT</span></span></Link>
          <span className="auth-icon">{mode === 'forgot' || mode === 'reset' ? <KeyRound aria-hidden="true" /> : <UserRound aria-hidden="true" />}</span>
          <h2>{headings[mode][0]}</h2><p className="auth-subtitle">{headings[mode][1]}</p>
          {!configured ? <div className="config-notice"><ShieldCheck aria-hidden="true" /><div><strong>Account setup pending</strong><p>The public catalog works now. Add the Supabase project URL and anon key to enable real accounts; no private service key belongs in the browser.</p></div></div> : null}
          {message ? <div className="form-message success"><CheckCircle2 aria-hidden="true" />{message}</div> : null}
          {error ? <div className="form-message error" role="alert">{error}</div> : null}
          <form className="auth-form" onSubmit={submit}>
            {mode === 'signup' ? <label><span>Display name</span><div className="auth-input"><UserRound aria-hidden="true" /><input autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Alex" /></div></label> : null}
            {mode !== 'reset' ? <label><span>Email address</span><div className="auth-input"><Mail aria-hidden="true" /><input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></div></label> : null}
            {mode !== 'forgot' ? <label><span>{mode === 'reset' ? 'New password' : 'Password'}</span><div className="auth-input"><LockKeyhole aria-hidden="true" /><input required minLength={8} type={showPassword ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" /><button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</button></div></label> : null}
            {mode === 'login' ? <button className="forgot-link" type="button" onClick={() => setMode('forgot')}>Forgot password?</button> : null}
            <button className="primary-button auth-submit" type="submit" disabled={busy || !configured}>{busy ? <span className="button-spinner" /> : null}{busy ? 'Working…' : mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : 'Update password'}{!busy ? <ArrowRight aria-hidden="true" /> : null}</button>
          </form>
          <div className="auth-switch">{mode === 'login' ? <>New to RoadFit? <button type="button" onClick={() => setMode('signup')}>Create an account</button></> : mode === 'signup' ? <>Already have an account? <button type="button" onClick={() => setMode('login')}>Sign in</button></> : mode !== 'reset' ? <button type="button" onClick={() => setMode('login')}>← Back to sign in</button> : null}</div>
          <p className="auth-privacy">Your browsing and comparison features never require an account.</p>
        </div>
      </div>
    </section>
  );
}
